import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import type { BookingPublic, PayMethod } from '../db/types';
import { BOOKING_LEAD_MS, computeDay, isAllowedMonth } from '../lib/availability';
import { MSG, validateBookingBody } from '../lib/booking-schema';
import { apiError, readJsonObject, requestIp } from '../lib/http';
import { errorFields } from '../lib/log';
import { generateOrderNo, isOrderNo } from '../lib/order-no';
import {
  ATM_MIN_LEAD_HOURS,
  HOLD_MS,
  MAX_PENDING_ATM,
  MAX_PENDING_PER_CUSTOMER,
} from '../lib/policy';
import { rateLimitKey } from '../lib/rate-limit';
import { composeTopicQuestions } from '../lib/topics';
import { resolveReferral, type ResolvedReferral } from '../services/referral';
import {
  HOUR_MS,
  MINUTE_MS,
  formatEcpayDateTime,
  fromTaipei,
  taipeiDate,
  taipeiTime,
  toTaipeiIso,
} from '../lib/time';

const MSG_SLOT_TAKEN = '這個時段剛被預約，請重新選擇時段';
const MSG_SLOT_UNAVAILABLE = '這個時段目前無法預約，請重新選擇時段';
const MSG_TOO_MANY_PENDING = '您已有尚未完成付款的預約，請先完成付款，或稍後再試';
const MSG_ATM_LEAD = `ATM 轉帳需於諮詢開始 ${ATM_MIN_LEAD_HOURS} 小時前預約，請改用信用卡`;
const MSG_ATM_FULL = 'ATM 轉帳名額暫滿，請改用信用卡';

export function methodUnavailableMessage(deps: AppDeps, method: PayMethod): string | null {
  if (method === 'line') return deps.linepay ? null : 'LINE Pay 即將開放，請改用信用卡';
  if (method === 'atm' && !deps.env.atmEnabled) return 'ATM 轉帳已停止服務，請改用信用卡';
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
    needsAttention: b.needsAttention,
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
    const rl = deps.bookingLimiter.hit(rateLimitKey(requestIp(c)));
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

    let questions = d.questions.trim();
    if (service.topicLimit !== null) {
      // 自選主題：價位必須是「topic_limit ≥ 題數」最小的那個（最少題數 = 啟用中價位最小的 topic_limit）
      const tiers = (await deps.db.listActiveServices())
        .filter((s) => s.topicLimit !== null)
        .sort((a, b) => (a.topicLimit ?? 0) - (b.topicLimit ?? 0));
      const min = tiers[0]?.topicLimit ?? service.topicLimit;
      const n = d.topics.length;
      if (n < min) return apiError(c, 400, 'validation', MSG.topicsMin(min), { topics: MSG.topicsMin(min) });
      const tier = tiers.find((s) => (s.topicLimit ?? 0) >= n);
      if (tier?.id !== service.id) return apiError(c, 400, 'validation', MSG.topicsTier, { topics: MSG.topicsTier });
      questions = composeTopicQuestions(d.topics, d.topic_note, questions);
    } else if (service.questionRequired && !questions) {
      return apiError(c, 400, 'validation', MSG.questionRequired, { questions: MSG.questionRequired });
    }

    const methodMsg = methodUnavailableMessage(deps, d.pay_method);
    if (methodMsg) return apiError(c, 400, 'validation', methodMsg, { pay_method: methodMsg });

    // KOL 推薦碼：折扣後的金額一樣由 DB 設定計算
    let amount = service.price;
    let referral: ResolvedReferral | null = null;
    if (d.referral_code) {
      const r = await resolveReferral(deps, d.referral_code, 'booking', service.price, now);
      if (!r.ok) return apiError(c, 400, 'validation', r.message, { referral_code: r.message });
      referral = r;
      amount = r.final;
    }

    const startsAt = fromTaipei(d.date, d.time);
    if (!isAllowedMonth(d.date.slice(0, 7), now) || startsAt.getTime() < now.getTime() + BOOKING_LEAD_MS) {
      return apiError(c, 409, 'slot_unavailable', MSG_SLOT_UNAVAILABLE);
    }

    // 時段必須在老師的時段表內（每週時段 ∪ 加開，未公休）。是否已被占用交給 create_booking 在交易內判斷
    // （它會先釋出過期保留、取消同一人同時段的舊保留，再以 unique index／重疊約束擋下衝突）
    const [weekly, overrides] = await Promise.all([deps.db.listWeeklySlots(), deps.db.listOverrides(d.date, d.date)]);
    const day = computeDay(d.date, { now, weekly, overrides, busy: [], durationMinutes: service.minutes });
    const slot = day.slots.find((s) => s.time === d.time);
    if (!slot || !slot.available || day.status === 'closed' || day.status === 'past') {
      return apiError(c, 409, 'slot_unavailable', MSG_SLOT_UNAVAILABLE);
    }

    // C. ATM 只接受 72 小時以後的時段
    if (d.pay_method === 'atm' && startsAt.getTime() < now.getTime() + ATM_MIN_LEAD_HOURS * HOUR_MS) {
      return apiError(c, 400, 'validation', MSG_ATM_LEAD, { pay_method: MSG_ATM_LEAD });
    }

    const endsAt = new Date(startsAt.getTime() + service.minutes * MINUTE_MS);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MS[d.pay_method]);

    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = generateOrderNo();
      const r = await deps.db.createBooking({
        orderNo,
        serviceId: service.id,
        startsAt,
        endsAt,
        payMethod: d.pay_method,
        amount,
        holdExpiresAt,
        customerName: d.name,
        gender: d.gender,
        birthDate: d.birth_date,
        birthTime: d.birth_time || null,
        birthPlace: d.birth_place || null,
        phone: d.phone,
        email: d.email,
        questions: questions || null,
      }, { maxPendingPerCustomer: MAX_PENDING_PER_CUSTOMER, maxPendingAtm: MAX_PENDING_ATM });
      if (r.ok) {
        if (referral) {
          // 記錄失敗不影響預約本身（只是這筆不算進 KOL 成效）
          try {
            await deps.db.recordReferralUse({
              codeId: referral.code.id,
              kind: 'booking',
              orderNo,
              bookingId: r.id,
              originalAmount: referral.original,
              discountAmount: referral.discount,
              finalAmount: referral.final,
              commissionAmount: referral.commission,
            });
          } catch (e) {
            deps.logger.error('referral.record_failed', { order: orderNo, ...errorFields(e) });
          }
        }
        deps.logger.info('booking.created', {
          order: orderNo,
          service: service.id,
          starts_at: toTaipeiIso(startsAt),
          method: d.pay_method,
          replaced: r.replaced,
          referral: referral?.code.code ?? null,
        });
        return c.json(
          {
            bookingId: r.id,
            orderNo,
            amount,
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
      if (r.reason === 'too_many_pending') {
        deps.logger.warn('booking.too_many_pending', { starts_at: toTaipeiIso(startsAt) });
        return apiError(c, 409, 'too_many_pending', MSG_TOO_MANY_PENDING);
      }
      if (r.reason === 'atm_full') {
        deps.logger.warn('booking.atm_full', {});
        return apiError(c, 400, 'validation', MSG_ATM_FULL, { pay_method: MSG_ATM_FULL });
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
