import { z } from 'zod';
import { EMAIL_RE, MSG } from './booking-schema';
import { isValidDate } from './time';

// VIP 購買、商店下單、VIP 查詢的請求驗證（錯誤訊息可直接顯示）

const requiredString = (message: string) => z.string({ required_error: message, invalid_type_error: message });

const contactFields = {
  name: requiredString(MSG.name).trim().min(1, MSG.name).max(50, MSG.tooLong(50)),
  email: requiredString(MSG.email).trim().max(254, MSG.email).regex(EMAIL_RE, MSG.email),
  phone: requiredString(MSG.phone)
    .trim()
    .max(30, MSG.phone)
    .refine((s) => s.replace(/\D/g, '').length >= 9, MSG.phone),
  referral_code: z.string({ invalid_type_error: MSG.referral }).trim().max(20, MSG.referral).optional().default(''),
};

export const vipOrderSchema = z.object({
  plan_id: requiredString('請選擇方案').trim().min(1, '請選擇方案').max(32, '請選擇方案'),
  ...contactFields,
  birth_date: z
    .string({ invalid_type_error: '請確認生日' })
    .optional()
    .default('')
    .refine((s) => s === '' || isValidDate(s), '請確認生日'),
  agree: z.literal(true, { errorMap: () => ({ message: '請勾選同意購買與使用規則' }) }),
});

export const vipLookupSchema = z.object({
  card_no: requiredString('請輸入 VIP 卡號').trim().min(1, '請輸入 VIP 卡號').max(20, '請輸入正確的 VIP 卡號'),
  email: requiredString(MSG.email).trim().max(254, MSG.email).regex(EMAIL_RE, MSG.email),
});

export const shopOrderSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string({ invalid_type_error: '商品不正確' }).uuid('商品不正確'),
        qty: z.number({ invalid_type_error: '數量不正確' }).int('數量不正確').min(1, '數量不正確').max(20, '每樣商品最多 20 件'),
      }),
      { invalid_type_error: '購物車是空的', required_error: '購物車是空的' },
    )
    .min(1, '購物車是空的')
    .max(30, '商品種類太多')
    .refine((a) => new Set(a.map((i) => i.product_id)).size === a.length, '購物車內容重複，請重新整理'),
  ...contactFields,
  ship_name: requiredString('請填寫收件人').trim().min(1, '請填寫收件人').max(50, MSG.tooLong(50)),
  ship_phone: requiredString('請填寫收件人手機')
    .trim()
    .max(30, '請填寫收件人手機')
    .refine((s) => s.replace(/\D/g, '').length >= 9, '請填寫收件人手機'),
  ship_address: requiredString('請填寫收件地址').trim().min(6, '請填寫完整的收件地址').max(200, MSG.tooLong(200)),
  note: z.string({ invalid_type_error: MSG.tooLong(500) }).trim().max(500, MSG.tooLong(500)).optional().default(''),
  agree: z.literal(true, { errorMap: () => ({ message: '請勾選同意購物與退換貨規則' }) }),
});

/** zod 錯誤 → { 欄位: 第一個訊息 } */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
