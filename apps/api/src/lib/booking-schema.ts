import { z } from 'zod';
import { isValidDate, isValidTime } from './time';

// POST /bookings 驗證。規則與錯誤文案同 README §5.5 與原型 validate()：
// 姓名非空、出生日期必填、Email /^[^@\s]+@[^@\s]+\.[^@\s]+$/、手機數字 ≥ 9 碼、agree === true

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const MSG = {
  service: '請選擇方案',
  date: '請選擇日期',
  time: '請選擇時段',
  name: '請填寫姓名',
  gender: '請選擇性別',
  birthDate: '請選擇出生日期',
  birthDateRange: '請確認出生日期',
  birthTime: '出生時間格式不正確',
  email: '請填寫有效的 Email',
  phone: '請填寫手機號碼',
  payMethod: '請選擇付款方式',
  agree: '請勾選同意改期與退款規則',
  topics: '請重新選擇主題',
  topicsMin: (n: number) => `請至少選擇 ${n} 個主題`,
  topicsTier: '主題數量與方案不符，請重新整理頁面後再選一次',
  questionRequired: '請填寫這一欄',
  tooLong: (n: number) => `請勿超過 ${n} 字`,
} as const;

const requiredString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message });

export const bookingBodySchema = z.object({
  service_id: requiredString(MSG.service).trim().min(1, MSG.service).max(32, MSG.service),
  date: requiredString(MSG.date).refine(isValidDate, MSG.date),
  time: requiredString(MSG.time).refine(isValidTime, MSG.time),
  name: requiredString(MSG.name).trim().min(1, MSG.name).max(50, MSG.tooLong(50)),
  gender: z.enum(['female', 'male'], { errorMap: () => ({ message: MSG.gender }) }),
  birth_date: requiredString(MSG.birthDate).refine(isValidDate, MSG.birthDate),
  birth_time: z
    .string({ invalid_type_error: MSG.birthTime })
    .trim()
    .refine((s) => s === '' || isValidTime(s), MSG.birthTime)
    .optional()
    .default(''),
  birth_place: z
    .string({ invalid_type_error: MSG.tooLong(100) })
    .trim()
    .max(100, MSG.tooLong(100))
    .optional()
    .default(''),
  phone: requiredString(MSG.phone)
    .trim()
    .max(30, MSG.phone)
    .refine((s) => s.replace(/\D/g, '').length >= 9, MSG.phone),
  email: requiredString(MSG.email).trim().max(254, MSG.email).regex(EMAIL_RE, MSG.email),
  questions: z
    .string({ invalid_type_error: MSG.tooLong(2000) })
    .max(2000, MSG.tooLong(2000))
    .optional()
    .default(''),
  // 自選主題：依優先順序排列；題數是否符合價位在 route 內對照 services.topic_limit 檢查
  topics: z
    .array(z.string({ invalid_type_error: MSG.topics }).trim().min(1, MSG.topics).max(30, MSG.topics), {
      invalid_type_error: MSG.topics,
    })
    .max(15, MSG.topics)
    .refine((a) => new Set(a).size === a.length, MSG.topics)
    .optional()
    .default([]),
  topic_note: z
    .string({ invalid_type_error: MSG.tooLong(500) })
    .max(500, MSG.tooLong(500))
    .optional()
    .default(''),
  pay_method: z.enum(['card', 'line', 'atm'], { errorMap: () => ({ message: MSG.payMethod }) }),
  agree: z.literal(true, { errorMap: () => ({ message: MSG.agree }) }),
});

export type BookingBody = z.infer<typeof bookingBodySchema>;

export type FieldErrors = Record<string, string>;

/** 驗證並回傳每個欄位的第一個錯誤訊息 */
export function validateBookingBody(
  input: unknown,
  today: string,
): { ok: true; data: BookingBody } | { ok: false; fields: FieldErrors } {
  const parsed = bookingBodySchema.safeParse(input ?? {});
  const fields: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      if (!(key in fields)) fields[key] = issue.message;
    }
    return { ok: false, fields };
  }
  const data = parsed.data;
  // 出生日期合理範圍（不晚於今天、不早於 1900 年）
  if (data.birth_date > today || data.birth_date < '1900-01-01') fields.birth_date = MSG.birthDateRange;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, data };
}
