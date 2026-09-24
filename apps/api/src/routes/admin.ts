import { Hono, type MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps';
import type { BookingStatus } from '../db/types';
import { bearerToken, emailSha256, type AuthUser } from '../lib/admin-auth';
import { apiError } from '../lib/http';
import { errorFields } from '../lib/log';
import { fromTaipei, isValidDate, taipeiDate, taipeiTime, toTaipeiIso } from '../lib/time';

// 後台 API（/admin/*）：Supabase Auth 登入（Email 已確認）且在 admins 名單內才可使用。
// 回應含顧客個資 → 不寫進 log。

export type AdminEnv = { Variables: { adminEmail: string } };

const BOOKING_STATUSES: BookingStatus[] = [
  'pending_payment',
  'awaiting_transfer',
  'confirmed',
  'cancelled',
  'expired',
  'refunded',
];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

/**
 * 所有 /admin/*：Bearer token（Supabase Auth，Email 已確認）＋在 admins 名單內。
 * 在 app.ts 對 /admin/* 註冊一次（各個後台路由檔不必重複驗證）
 */
export function adminAuth(deps: AppDeps): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return apiError(c, 401, 'unauthorized', '請先登入後台');
    let user: AuthUser | null = null;
    try {
      user = await deps.auth.verify(token);
    } catch (e) {
      deps.logger.warn('admin.verify_failed', errorFields(e));
    }
    if (!user) return apiError(c, 401, 'unauthorized', '登入已過期，請重新登入');
    if (!(await deps.db.isAdmin(emailSha256(user.email)))) {
      deps.logger.warn('admin.forbidden', { path: c.req.path });
      return apiError(c, 403, 'forbidden', '這個帳號沒有後台權限');
    }
    c.set('adminEmail', user.email);
    await next();
  };
}

export function adminRoutes(deps: AppDeps) {
  const app = new Hono<AdminEnv>();

  app.get('/admin/me', (c) => c.json({ email: c.get('adminEmail') }));

  // 預約列表：?from=YYYY-MM-DD&to=YYYY-MM-DD（台北時間，含 to 當天；預設今天起 30 天）&status=confirmed,pending_payment
  app.get('/admin/bookings', async (c) => {
    const q = c.req.query();
    const from = q.from || taipeiDate(deps.now());
    if (!isValidDate(from)) return apiError(c, 400, 'validation', '日期格式不正確', { from: '日期格式不正確' });
    const to = q.to || taipeiDate(new Date(fromTaipei(from, '00:00').getTime() + 30 * DAY_MS));
    if (!isValidDate(to) || to < from) return apiError(c, 400, 'validation', '日期範圍不正確', { to: '日期範圍不正確' });
    const start = fromTaipei(from, '00:00');
    const end = new Date(fromTaipei(to, '00:00').getTime() + DAY_MS);
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      return apiError(c, 400, 'validation', '日期範圍最多一年', { to: '日期範圍最多一年' });
    }
    let statuses: BookingStatus[] | null = null;
    if (q.status) {
      const list = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.every((s): s is BookingStatus => (BOOKING_STATUSES as string[]).includes(s))) {
        return apiError(c, 400, 'validation', '狀態不正確', { status: '狀態不正確' });
      }
      statuses = list;
    }
    const rows = await deps.db.listBookingsAdmin({ from: start, to: end, statuses, limit: 500 });
    return c.json({
      from,
      to,
      bookings: rows.map((b) => ({
        orderNo: b.orderNo,
        status: b.status,
        payMethod: b.payMethod,
        amount: b.amount,
        date: taipeiDate(b.startsAt),
        time: taipeiTime(b.startsAt),
        startsAt: toTaipeiIso(b.startsAt),
        endsAt: toTaipeiIso(b.endsAt),
        confirmedAt: b.confirmedAt ? toTaipeiIso(b.confirmedAt) : null,
        service: b.service,
        customer: {
          name: b.customerName,
          gender: b.gender,
          birthDate: b.birthDate,
          birthTime: b.birthTime,
          birthPlace: b.birthPlace,
          phone: b.phone,
          email: b.email,
        },
        questions: b.questions,
        needsAttention: b.needsAttention,
        attentionReason: b.attentionReason,
      })),
    });
  });

  return app;
}
