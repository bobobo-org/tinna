import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import type { BookingPublic, PayMethod } from '../db/types';
import { BOOKING_LEAD_MS, computeDay, isAllowedMonth } from '../lib/availability';
import { validateBookingBody } from '../lib/booking-schema';
import { apiError, readJsonObject, requestIp } from '../lib/http';
import { generateOrderNo, isOrderNo } from '../lib/order-no';
import {
  HOUR_MS,
  MINUTE_MS,
  formatEcpayDateTime,
  fromTaipei,
  taipeiDate,
  taipeiTime,
  toTaipeiIso,
} from '../lib/time';

export const HOLD_MS: Record<PayMethod, number> = {
  card: 15 * MINUTE_MS,
  line: 15 * MINUTE_MS,
  atm: 24 * HOUR_MS,
};

const MSG_SLOT_TAKEN = '這個時段剛被預約，請重新選擇時段';
const MSG_SLOT_UNAVAILABLE = '這個時段目前無法預約，請重新選擇時段';

export function methodUnavailableMessage(deps: AppDeps, method: PayMethod): string | null {
  if (method === 'line') return deps.linepay ? null : 'LINE Pay 即將開放，請改用信用卡或 ATM 轉帳';
  if (!deps.env.ecpay) return method === 'card' ? '信用卡付款即將開放，請改用其他付款方式' : 'ATM 轉帳即將開放，請改用其他付款方式';
  return null;
}

/** GET /bookings/:orderNo 的回應（不含姓名、電話、Email、生日、問題） */
export function toPublicJson(b: BookingPublic) {
  return {
    orderNo: b.orderNo,
    status: b.status,
    payMethod: b.payMethod,
    amount: b.amount,
    service: { id: b.service.id, name: b.service.name, minutes: b.service.minutes },
    date: taipeiDate(b.startsAt),
    time: taipeiTime(b.startsAt),
    startsAt: toTaipeiIso(b.startsAt),
    holdExpiresAt: b.holdExpiresAt ? toTaipeiIso(b.holdExpiresAt) : null,
    ...(b.atmAccount
      ? {
          atm: {
            bankCode: b.atmBankCode ?? '',
            account: b.atmAccount,
            expireDate: b.atmExpiresAt ? formatEcpayDateTime(b.atmExpiresAt) : null,
          },
        }
      : {}),
  };
}

export function bookingRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post('/bookings', async (c) => {
    const rl = deps.bookingLimiter.hit(requestIp(c));
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      deps.logger.warn('booking.rate_limited', { retry_after: rl.retryAfterSec });
      return apiError(c, 429, 'rate_limited', '送出次數太多了，請稍後再試');
    }

    const body = await readJsonObject(c);
    if (!body) return apiError(c, 400, 'validation', '資料格式不正確，請重新整理後再試');

    const now = deps.now();
    const v = validateBookingBody(body, taipeiDate(now));
    if (!v.ok) {
      const first = Object.values(v.fields)[0] ?? '請確認填寫的資料';
      return apiError(c, 400, 'validation', first, v.fields);
    }
    const d = v.data;

    // 金額一律取 DB services.price
    const service = await deps.db.getActiveService(d.service_id);
    if (!service) return apiError(c, 400, 'validation', '請選擇方案', { service_id: '請選擇方案' });

    const methodMsg = methodUnavailableMessage(deps, d.pay_method);
    if (methodMsg) return apiError(c, 400, 'validation', methodMsg, { pay_method: methodMsg });

    const startsAt = fromTaipei(d.date, d.time);
    if (!isAllowedMonth(d.date.slice(0, 7), now) || startsAt.getTime() < now.getTime() + BOOKING_LEAD_MS) {
      return apiError(c, 409, 'slot_unavailable', MSG_SLOT_UNAVAILABLE);
    }

    const endsAt = new Date(startsAt.getTime() + service.minutes * MINUTE_MS);
    // 先釋出與這個時段重疊、已逾時但背景工作還沒處理到的保留，避免撞 unique index／重疊約束
    await deps.db.expireStaleHolds({ from: startsAt, to: endsAt });

    const [weekly, overrides, busy] = await Promise.all([
      deps.db.listWeeklySlots(),
      deps.db.listOverrides(d.date, d.date),
      deps.db.listBusyBookings(new Date(startsAt.getTime() - 24 * HOUR_MS), new Date(startsAt.getTime() + 24 * HOUR_MS)),
    ]);
    const day = computeDay(d.date, { now, weekly, overrides, busy, durationMinutes: service.minutes });
    const slot = day.slots.find((s) => s.time === d.time);
    if (!slot || day.status === 'closed' || day.status === 'past') {
      return apiError(c, 409, 'slot_unavailable', MSG_SLOT_UNAVAILABLE);
    }
    if (!slot.available) return apiError(c, 409, 'slot_taken', MSG_SLOT_TAKEN);

    const holdExpiresAt = new Date(now.getTime() + HOLD_MS[d.pay_method]);

    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = generateOrderNo();
      const r = await deps.db.insertBooking({
        orderNo,
        serviceId: service.id,
        startsAt,
        endsAt,
        payMethod: d.pay_method,
        amount: service.price,
        holdExpiresAt,
        customerName: d.name,
        gender: d.gender,
        birthDate: d.birth_date,
        birthTime: d.birth_time || null,
        birthPlace: d.birth_place || null,
        phone: d.phone,
        email: d.email,
        questions: d.questions.trim() || null,
      });
      if (r.ok) {
        deps.logger.info('booking.created', {
          order: orderNo,
          service: service.id,
          starts_at: toTaipeiIso(startsAt),
          method: d.pay_method,
        });
        return c.json(
          {
            bookingId: r.id,
            orderNo,
            amount: service.price,
            payMethod: d.pay_method,
            holdExpiresAt: toTaipeiIso(holdExpiresAt),
          },
          201,
        );
      }
      if (r.reason === 'slot_taken') {
        deps.logger.info('booking.slot_taken', { starts_at: toTaipeiIso(startsAt) });
        return apiError(c, 409, 'slot_taken', MSG_SLOT_TAKEN);
      }
      // order_no 撞號 → 換一個再試
    }
    throw new Error('could not allocate order number');
  });

  app.get('/bookings/:orderNo', async (c) => {
    const orderNo = c.req.param('orderNo').toUpperCase();
    if (!isOrderNo(orderNo)) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    const b = await deps.db.getBookingPublic(orderNo);
    if (!b) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    return c.json(toPublicJson(b));
  });

  return app;
}
