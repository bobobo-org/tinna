import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import type { KolPatch, ReferralCodePatch } from '../db/types';
import { apiError, readJsonObject } from '../lib/http';
import { CODE_RE, discountLabel, type ReferralCode } from '../lib/referral';
import { addMonths, fromTaipei, isValidDate, monthKey, parseMonth, taipeiDate, taipeiMonth, toTaipeiIso } from '../lib/time';
import type { AdminEnv } from './admin';

// 後台：KOL 與推薦碼管理、成效與佣金統計（登入檢查在 app.ts 的 /admin/* middleware）

const DAY_MS = 24 * 60 * 60 * 1000;

const dateOn = z.string().refine(isValidDate, '日期格式不正確');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `請勿超過 ${max} 字`)
    .nullable()
    .optional()
    .transform((s) => (s ? s : null));

const kolCreate = z.object({
  name: z.string({ required_error: '請填寫名稱' }).trim().min(1, '請填寫名稱').max(60, '名稱請勿超過 60 字'),
  contact: optText(200),
  note: optText(500),
});

const kolPatch = z.object({
  name: z.string().trim().min(1, '請填寫名稱').max(60, '名稱請勿超過 60 字').optional(),
  contact: optText(200),
  note: optText(500),
  active: z.boolean().optional(),
});

const codeFields = {
  discountType: z.enum(['percent', 'amount'], { errorMap: () => ({ message: '請選擇折扣方式' }) }),
  discountValue: z.number({ invalid_type_error: '請填寫折扣' }).int('折扣請填整數').positive('折扣必須大於 0').max(100000, '折扣太大'),
  commissionRate: z.number({ invalid_type_error: '佣金比例請填 0–100' }).min(0, '佣金比例請填 0–100').max(100, '佣金比例請填 0–100'),
  appliesBooking: z.boolean(),
  appliesVip: z.boolean(),
  appliesShop: z.boolean(),
  startsOn: dateOn.nullable(),
  endsOn: dateOn.nullable(),
  maxUses: z.number().int('次數請填整數').positive('次數必須大於 0').nullable(),
};

const codeCreate = z.object({
  kolId: z.string().uuid('請選擇 KOL'),
  code: z
    .string({ required_error: '請填寫推薦碼' })
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => CODE_RE.test(s), '推薦碼請用 3–20 個英文、數字、- 或 _'),
  discountType: codeFields.discountType,
  discountValue: codeFields.discountValue,
  commissionRate: codeFields.commissionRate.optional().default(0),
  appliesBooking: codeFields.appliesBooking.optional().default(true),
  appliesVip: codeFields.appliesVip.optional().default(true),
  appliesShop: codeFields.appliesShop.optional().default(true),
  startsOn: codeFields.startsOn.optional().default(null),
  endsOn: codeFields.endsOn.optional().default(null),
  maxUses: codeFields.maxUses.optional().default(null),
});

const codePatch = z.object({
  discountType: codeFields.discountType.optional(),
  discountValue: codeFields.discountValue.optional(),
  commissionRate: codeFields.commissionRate.optional(),
  appliesBooking: codeFields.appliesBooking.optional(),
  appliesVip: codeFields.appliesVip.optional(),
  appliesShop: codeFields.appliesShop.optional(),
  startsOn: codeFields.startsOn.optional(),
  endsOn: codeFields.endsOn.optional(),
  maxUses: codeFields.maxUses.optional(),
  active: z.boolean().optional(),
});

/** zod 錯誤 → { 欄位: 第一個訊息 } */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/** 開始日 00:00；結束日含當天 → 隔天 00:00（台北時間） */
const startOf = (d: string | null | undefined) => (d ? fromTaipei(d, '00:00') : null);
const endOf = (d: string | null | undefined) => (d ? new Date(fromTaipei(d, '00:00').getTime() + DAY_MS) : null);

/** 折扣設定是否合理（打折 1–90%；期間不可顛倒） */
function checkCode(c: { discountType: string; discountValue: number; startsAt: Date | null; endsAt: Date | null }): Record<string, string> | null {
  if (c.discountType === 'percent' && c.discountValue > 90) return { discountValue: '打折最多 90%（等於 1 折）' };
  if (c.startsAt && c.endsAt && c.endsAt.getTime() <= c.startsAt.getTime()) return { endsOn: '結束日不能早於開始日' };
  return null;
}

export function codeJson(c: ReferralCode) {
  return {
    id: c.id,
    code: c.code,
    kolId: c.kolId,
    kolName: c.kolName,
    discountType: c.discountType,
    discountValue: c.discountValue,
    label: discountLabel(c),
    commissionRate: c.commissionRate,
    appliesBooking: c.appliesBooking,
    appliesVip: c.appliesVip,
    appliesShop: c.appliesShop,
    startsOn: c.startsAt ? taipeiDate(c.startsAt) : null,
    endsOn: c.endsAt ? taipeiDate(new Date(c.endsAt.getTime() - DAY_MS)) : null,
    maxUses: c.maxUses,
    active: c.active,
    createdAt: toTaipeiIso(c.createdAt),
  };
}

export function adminReferralRoutes(deps: AppDeps) {
  const app = new Hono<AdminEnv>();

  // KOL 列表（含各自的推薦碼）
  app.get('/admin/kols', async (c) => {
    const [kols, codes] = await Promise.all([deps.db.listKols(), deps.db.listReferralCodes()]);
    return c.json({
      kols: kols.map((k) => ({
        id: k.id,
        name: k.name,
        contact: k.contact,
        note: k.note,
        active: k.active,
        createdAt: toTaipeiIso(k.createdAt),
        codes: codes.filter((x) => x.kolId === k.id).map(codeJson),
      })),
    });
  });

  app.post('/admin/kols', async (c) => {
    const parsed = kolCreate.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
    }
    const k = await deps.db.createKol(parsed.data);
    return c.json({ kol: { ...k, createdAt: toTaipeiIso(k.createdAt), codes: [] } }, 201);
  });

  app.patch('/admin/kols/:id', async (c) => {
    const body = (await readJsonObject(c)) ?? {};
    const parsed = kolPatch.safeParse(body);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
    }
    const patch: KolPatch = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if ('contact' in body) patch.contact = parsed.data.contact ?? null;
    if ('note' in body) patch.note = parsed.data.note ?? null;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;
    const k = await deps.db.updateKol(c.req.param('id'), patch);
    if (!k) return apiError(c, 404, 'not_found', '找不到這位 KOL');
    return c.json({ kol: { ...k, createdAt: toTaipeiIso(k.createdAt) } });
  });

  app.post('/admin/referral-codes', async (c) => {
    const parsed = codeCreate.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
    }
    const d = parsed.data;
    const startsAt = startOf(d.startsOn);
    const endsAt = endOf(d.endsOn);
    const bad = checkCode({ discountType: d.discountType, discountValue: d.discountValue, startsAt, endsAt });
    if (bad) return apiError(c, 400, 'validation', Object.values(bad)[0]!, bad);
    const r = await deps.db.createReferralCode({
      code: d.code,
      kolId: d.kolId,
      discountType: d.discountType,
      discountValue: d.discountValue,
      commissionRate: d.commissionRate,
      appliesBooking: d.appliesBooking,
      appliesVip: d.appliesVip,
      appliesShop: d.appliesShop,
      startsAt,
      endsAt,
      maxUses: d.maxUses,
    });
    if (r === 'duplicate') return apiError(c, 409, 'duplicate', '這個推薦碼已經有人用了，請換一個', { code: '這個推薦碼已經有人用了，請換一個' });
    if (r === 'no_kol') return apiError(c, 404, 'not_found', '找不到這位 KOL', { kolId: '找不到這位 KOL' });
    return c.json({ code: codeJson(r) }, 201);
  });

  app.patch('/admin/referral-codes/:id', async (c) => {
    const body = (await readJsonObject(c)) ?? {};
    const parsed = codePatch.safeParse(body);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
    }
    const current = (await deps.db.listReferralCodes()).find((x) => x.id === c.req.param('id'));
    if (!current) return apiError(c, 404, 'not_found', '找不到這個推薦碼');
    const d = parsed.data;
    const patch: ReferralCodePatch = {};
    if (d.discountType !== undefined) patch.discountType = d.discountType;
    if (d.discountValue !== undefined) patch.discountValue = d.discountValue;
    if (d.commissionRate !== undefined) patch.commissionRate = d.commissionRate;
    if (d.appliesBooking !== undefined) patch.appliesBooking = d.appliesBooking;
    if (d.appliesVip !== undefined) patch.appliesVip = d.appliesVip;
    if (d.appliesShop !== undefined) patch.appliesShop = d.appliesShop;
    if ('startsOn' in body) patch.startsAt = startOf(d.startsOn);
    if ('endsOn' in body) patch.endsAt = endOf(d.endsOn);
    if ('maxUses' in body) patch.maxUses = d.maxUses ?? null;
    if (d.active !== undefined) patch.active = d.active;
    const bad = checkCode({
      discountType: patch.discountType ?? current.discountType,
      discountValue: patch.discountValue ?? current.discountValue,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : current.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : current.endsAt,
    });
    if (bad) return apiError(c, 400, 'validation', Object.values(bad)[0]!, bad);
    const r = await deps.db.updateReferralCode(current.id, patch);
    if (!r) return apiError(c, 404, 'not_found', '找不到這個推薦碼');
    return c.json({ code: codeJson(r) });
  });

  // 成效與佣金：?from=YYYY-MM-DD&to=YYYY-MM-DD（含當天；預設本月）。只算已付款的訂單
  app.get('/admin/referral-stats', async (c) => {
    const now = deps.now();
    const q = c.req.query();
    const from = q.from || `${taipeiMonth(now)}-01`;
    if (!isValidDate(from)) return apiError(c, 400, 'validation', '日期格式不正確', { from: '日期格式不正確' });
    let end: Date;
    if (q.to) {
      // 有給 to：含當天
      if (!isValidDate(q.to) || q.to < from) return apiError(c, 400, 'validation', '日期範圍不正確', { to: '日期範圍不正確' });
      end = new Date(fromTaipei(q.to, '00:00').getTime() + DAY_MS);
    } else {
      // 沒給 to：到 from 所在月份的月底
      const ym = parseMonth(from.slice(0, 7))!;
      const next = addMonths(ym.year, ym.month, 1);
      end = fromTaipei(`${monthKey(next.year, next.month)}-01`, '00:00');
    }
    const start = fromTaipei(from, '00:00');
    const [uses, codes, kols] = await Promise.all([
      deps.db.listReferralUses({ from: start, to: end, now }),
      deps.db.listReferralCodes(),
      deps.db.listKols(),
    ]);

    type Sum = { orders: number; pending: number; revenue: number; discount: number; commission: number };
    const zero = (): Sum => ({ orders: 0, pending: 0, revenue: 0, discount: 0, commission: 0 });
    const byKol = new Map<string, Sum>();
    const byCode = new Map<string, Sum>();
    for (const u of uses) {
      for (const [map, key] of [
        [byKol, u.kolId],
        [byCode, u.codeId],
      ] as const) {
        const s = map.get(key) ?? zero();
        if (u.orderState === 'paid') {
          s.orders += 1;
          s.revenue += u.finalAmount;
          s.discount += u.discountAmount;
          s.commission += u.commissionAmount;
        } else if (u.orderState === 'pending') {
          s.pending += 1;
        }
        map.set(key, s);
      }
    }
    const kolName = new Map(kols.map((k) => [k.id, k.name]));
    return c.json({
      from,
      to: taipeiDate(new Date(end.getTime() - DAY_MS)),
      kols: kols.map((k) => ({ kolId: k.id, name: k.name, active: k.active, ...(byKol.get(k.id) ?? zero()) })),
      codes: codes.map((x) => ({ codeId: x.id, code: x.code, kolId: x.kolId, ...(byCode.get(x.id) ?? zero()) })),
      uses: uses.slice(0, 500).map((u) => ({
        orderNo: u.orderNo,
        kind: u.kind,
        code: u.code,
        kolName: kolName.get(u.kolId) ?? '',
        createdAt: toTaipeiIso(u.createdAt),
        originalAmount: u.originalAmount,
        discountAmount: u.discountAmount,
        finalAmount: u.finalAmount,
        commissionAmount: u.commissionAmount,
        state: u.orderState,
      })),
    });
  });

  return app;
}
