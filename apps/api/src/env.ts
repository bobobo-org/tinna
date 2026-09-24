import { z } from 'zod';

// 啟動時驗證環境變數：
// * 缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或 production 缺 WEB_URL）→ 回傳清楚錯誤，程序結束
// * 金流參數缺少或不合法 → 只停用該付款方式（/config 回 false），不讓整個服務 crash
// * 寄信參數缺少 → dry-run（只 log 收件網域與主旨）

export type EcpayEnv = 'stage' | 'prod';
export type LinePayEnv = 'sandbox' | 'prod';

export interface EcpayConfig {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  env: EcpayEnv;
  checkoutUrl: string;
}

export interface LinePayConfig {
  channelId: string;
  channelSecret: string;
  env: LinePayEnv;
  apiBase: string;
}

export interface MailConfig {
  resendApiKey: string | null; // null → dry-run
  from: string;
  adminEmails: string[];
}

export interface Env {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** 允許的前端 origin（CORS）；第一個用來組導回網址 */
  webOrigins: string[];
  webUrl: string;
  /** 本 API 對外網址（金流回呼用）；null 表示無法產生回呼網址 → 金流停用 */
  apiUrl: string | null;
  ecpay: EcpayConfig | null;
  linepay: LinePayConfig | null;
  mail: MailConfig;
  meetUrl: string | null;
  buildSha: string;
  warnings: string[];
}

export const ECPAY_CHECKOUT_URLS: Record<EcpayEnv, string> = {
  stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  prod: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
};

export const LINEPAY_API_BASES: Record<LinePayEnv, string> = {
  sandbox: 'https://sandbox-api-pay.line.me',
  prod: 'https://api-pay.line.me',
};

/** 綠界公開測試特店（developers.ecpay.com.tw「測試介接資訊」），不可用在正式環境 */
export const ECPAY_PUBLIC_TEST_MERCHANT_ID = '3002607';

const DEFAULT_MAIL_FROM = '緣舍命理 <no-reply@example.com>';

const str = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), '必須是 http(s) 網址');

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeBaseUrl(u: string): string {
  const url = new URL(u);
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export type LoadEnvResult = { ok: true; env: Env } | { ok: false; errors: string[] };

export function loadEnv(
  raw: Record<string, string | undefined>,
  opts: { buildShaFromFile?: string | null } = {},
): LoadEnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = str(raw.NODE_ENV) ?? 'development';
  const isProduction = nodeEnv === 'production';

  // ---- 必要：Supabase ----
  const supabaseUrl = str(raw.SUPABASE_URL);
  const serviceKey = str(raw.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl) {
    errors.push('缺少 SUPABASE_URL：請填 Supabase 專案網址（Project Settings → API → Project URL，例如 https://xxxx.supabase.co）');
  } else if (!httpUrl.safeParse(supabaseUrl).success) {
    errors.push('SUPABASE_URL 不是合法的 http(s) 網址');
  }
  if (!serviceKey) {
    errors.push('缺少 SUPABASE_SERVICE_ROLE_KEY：請填 Supabase 的 service_role key（Project Settings → API；只能放在後端，不可給前端）');
  }

  // ---- PORT ----
  const portParsed = z.coerce.number().int().min(1).max(65535).safeParse(str(raw.PORT) ?? '8080');
  const port = portParsed.success ? portParsed.data : 8080;
  if (!portParsed.success) errors.push('PORT 必須是 1–65535 的整數');

  // ---- WEB_URL（CORS 與導回網址）----
  const webOrigins: string[] = [];
  const webRaw = str(raw.WEB_URL);
  if (webRaw) {
    for (const part of webRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!httpUrl.safeParse(part).success) {
        errors.push(`WEB_URL 內的「${part}」不是合法的 http(s) 網址`);
        continue;
      }
      const origin = new URL(part).origin;
      if (!webOrigins.includes(origin)) webOrigins.push(origin);
    }
  } else if (isProduction) {
    errors.push('缺少 WEB_URL：請填網站網址（可逗號分隔多個，第一個用於金流完成後導回），例如 https://yuanshe.tw');
  } else {
    webOrigins.push('http://localhost:3000');
  }
  if (!isProduction && !webOrigins.includes('http://localhost:3000')) {
    webOrigins.push('http://localhost:3000');
  }
  const webUrl = webOrigins[0] ?? 'http://localhost:3000';

  // ---- API_URL（金流回呼網址）----
  let apiUrl: string | null = null;
  const apiRaw = str(raw.API_URL);
  if (apiRaw) {
    if (httpUrl.safeParse(apiRaw).success) apiUrl = normalizeBaseUrl(apiRaw);
    else warnings.push('API_URL 不是合法的 http(s) 網址，金流已停用');
  } else if (!isProduction) {
    apiUrl = `http://localhost:${port}`;
  } else {
    warnings.push('缺少 API_URL（本 API 對外網址，金流回呼用），綠界與 LINE Pay 已停用');
  }

  // ---- 綠界 ----
  let ecpay: EcpayConfig | null = null;
  {
    const merchantId = str(raw.ECPAY_MERCHANT_ID);
    const hashKey = str(raw.ECPAY_HASH_KEY);
    const hashIv = str(raw.ECPAY_HASH_IV);
    const envName = str(raw.ECPAY_ENV) ?? 'stage';
    const missing = [
      !merchantId && 'ECPAY_MERCHANT_ID',
      !hashKey && 'ECPAY_HASH_KEY',
      !hashIv && 'ECPAY_HASH_IV',
    ].filter(Boolean) as string[];
    if (missing.length === 3) {
      warnings.push('未設定綠界參數，信用卡與 ATM 付款停用');
    } else if (missing.length > 0) {
      warnings.push(`綠界參數不完整（缺 ${missing.join('、')}），信用卡與 ATM 付款停用`);
    } else if (envName !== 'stage' && envName !== 'prod') {
      warnings.push('ECPAY_ENV 只能是 stage 或 prod，信用卡與 ATM 付款停用');
    } else if (envName === 'prod' && merchantId === ECPAY_PUBLIC_TEST_MERCHANT_ID) {
      warnings.push('ECPAY_ENV=prod 卻使用綠界公開測試特店 3002607，信用卡與 ATM 付款停用');
    } else if (!apiUrl) {
      // 已在 API_URL 段落警告過
    } else {
      ecpay = {
        merchantId: merchantId!,
        hashKey: hashKey!,
        hashIv: hashIv!,
        env: envName,
        checkoutUrl: ECPAY_CHECKOUT_URLS[envName],
      };
      if (isProduction && envName === 'stage') {
        warnings.push('NODE_ENV=production 但 ECPAY_ENV=stage：目前使用綠界測試環境，不會真的收款');
      }
    }
  }

  // ---- LINE Pay ----
  let linepay: LinePayConfig | null = null;
  {
    const channelId = str(raw.LINEPAY_CHANNEL_ID);
    const channelSecret = str(raw.LINEPAY_CHANNEL_SECRET);
    const envName = str(raw.LINEPAY_ENV) ?? 'sandbox';
    if (!channelId && !channelSecret) {
      warnings.push('未設定 LINE Pay 參數，LINE Pay 停用（/config line=false）');
    } else if (!channelId || !channelSecret) {
      warnings.push(`LINE Pay 參數不完整（缺 ${!channelId ? 'LINEPAY_CHANNEL_ID' : 'LINEPAY_CHANNEL_SECRET'}），LINE Pay 停用`);
    } else if (envName !== 'sandbox' && envName !== 'prod') {
      warnings.push('LINEPAY_ENV 只能是 sandbox 或 prod，LINE Pay 停用');
    } else if (!apiUrl) {
      // 已警告
    } else {
      linepay = { channelId, channelSecret, env: envName, apiBase: LINEPAY_API_BASES[envName] };
    }
  }

  // ---- 寄信 ----
  const resendApiKey = str(raw.RESEND_API_KEY) ?? null;
  let from = str(raw.MAIL_FROM);
  let mailKey = resendApiKey;
  if (resendApiKey && !from) {
    warnings.push('有 RESEND_API_KEY 但缺 MAIL_FROM（需為 Resend 已驗證網域的寄件地址），寄信改為 dry-run');
    mailKey = null;
  }
  if (!resendApiKey) warnings.push('未設定 RESEND_API_KEY，寄信為 dry-run（只記錄收件網域與主旨）');
  from ??= DEFAULT_MAIL_FROM;

  const adminEmails: string[] = [];
  for (const a of (str(raw.ADMIN_EMAIL) ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (emailRe.test(a)) adminEmails.push(a);
    else warnings.push('ADMIN_EMAIL 內有不合法的 Email，已略過');
  }

  let meetUrl: string | null = null;
  const meetRaw = str(raw.MEET_URL);
  if (meetRaw) {
    if (httpUrl.safeParse(meetRaw).success) meetUrl = meetRaw;
    else warnings.push('MEET_URL 不是合法的網址，確認信改寫「視訊連結將於諮詢前另行寄送」');
  }

  // /health 的 version：apps/api/BUILD_SHA 檔（CI 在 railway up 前寫入）→ GIT_SHA → "dev"
  const buildSha = str(opts.buildShaFromFile ?? undefined) ?? str(raw.GIT_SHA) ?? 'dev';

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    env: {
      nodeEnv,
      isProduction,
      port,
      supabaseUrl: supabaseUrl!,
      supabaseServiceRoleKey: serviceKey!,
      webOrigins,
      webUrl,
      apiUrl,
      ecpay,
      linepay,
      mail: { resendApiKey: mailKey, from, adminEmails },
      meetUrl,
      buildSha,
      warnings,
    },
  };
}
