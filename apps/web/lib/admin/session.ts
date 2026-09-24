/**
 * 後台登入（Supabase Auth，Email＋密碼）— 只在瀏覽器使用
 *
 * - 直接呼叫 Supabase Auth REST（/auth/v1/*），用 NEXT_PUBLIC_SUPABASE_URL／ANON_KEY（anon key 本來就是公開的）
 * - session 存 localStorage；access token 約 1 小時，快到期時用 refresh token 換新
 * - 是否為管理者由 API 判斷（admins 名單），這裡只負責拿到 token
 */

const STORAGE_KEY = 'yuanshe.admin.session.v1';
const REFRESH_MARGIN_MS = 60_000;

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  /** epoch 毫秒 */
  expiresAt: number;
  email: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function config(): { url: string; key: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !key) throw new AuthError('後台登入尚未設定（缺 Supabase 環境變數）');
  return { url, key };
}

/** Supabase Auth 的英文錯誤 → 中文 */
export function authMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email 或密碼不正確';
  if (m.includes('email not confirmed')) return '這個 Email 還沒完成確認，請先到信箱點確認連結';
  if (m.includes('already registered') || m.includes('already been registered')) return '這個 Email 已經設定過密碼，請直接登入';
  if (m.includes('password should be at least') || m.includes('weak password')) return '密碼太短，請至少 8 個字元';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return '目前不開放設定新帳號，請聯絡網站管理者';
  if (m.includes('rate limit') || m.includes('too many')) return '嘗試次數太多，請稍後再試';
  if (m.includes('invalid refresh token') || m.includes('refresh token not found')) return '登入已過期，請重新登入';
  return '登入失敗，請稍後再試';
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string };
}

async function authFetch(path: string, body: unknown, token?: string): Promise<unknown> {
  const { url, key } = config();
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('網路連線不穩，請確認網路後再試一次');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error_description?: string; msg?: string; message?: string; error?: string };
    throw new AuthError(authMessage(e.error_description ?? e.msg ?? e.message ?? e.error ?? ''));
  }
  return data;
}

function toSession(t: TokenResponse, fallbackEmail = ''): AdminSession | null {
  if (!t.access_token || !t.refresh_token) return null;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    email: t.user?.email ?? fallbackEmail,
  };
}

// ---------- localStorage ----------

export function loadSession(): AdminSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AdminSession>;
    if (typeof s.accessToken !== 'string' || typeof s.refreshToken !== 'string' || typeof s.expiresAt !== 'number') return null;
    return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt, email: s.email ?? '' };
  } catch {
    return null;
  }
}

function saveSession(s: AdminSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 無痕模式等：只能在這個分頁用
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------- 動作 ----------

export async function signIn(email: string, password: string): Promise<AdminSession> {
  const data = (await authFetch('/token?grant_type=password', { email: email.trim(), password })) as TokenResponse;
  const s = toSession(data, email.trim());
  if (!s) throw new AuthError('登入失敗，請稍後再試');
  saveSession(s);
  return s;
}

/**
 * 第一次使用：設定密碼（Supabase 註冊）。
 * 需要收信確認時回傳 null（信裡的連結點開後會回到登入頁）；專案關閉確認信時直接登入
 */
export async function signUp(email: string, password: string, redirectTo: string): Promise<AdminSession | null> {
  const data = (await authFetch(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    email: email.trim(),
    password,
  })) as TokenResponse;
  const s = toSession(data, email.trim());
  if (s) saveSession(s);
  return s;
}

/** 忘記密碼：寄重設連結（點開後回到登入頁設定新密碼） */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  await authFetch(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email: email.trim() });
}

/** 重設密碼連結帶回來的 token（網址 # 後面）→ 設定新密碼並登入 */
export async function updatePassword(accessToken: string, refreshToken: string, password: string): Promise<AdminSession> {
  const { url, key } = config();
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: key, 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('網路連線不穩，請確認網路後再試一次');
  }
  if (!res.ok) {
    const e = ((await res.json().catch(() => ({}))) ?? {}) as { msg?: string; message?: string; error_description?: string };
    throw new AuthError(authMessage(e.error_description ?? e.msg ?? e.message ?? ''));
  }
  const user = (await res.json().catch(() => ({}))) as { email?: string };
  const s: AdminSession = { accessToken, refreshToken, expiresAt: Date.now() + 3600 * 1000, email: user.email ?? '' };
  saveSession(s);
  return s;
}

/** 確認信／重設密碼連結帶回來的網址片段：#access_token=…&refresh_token=…&type=signup|recovery */
export function parseAuthFragment(hash: string): { accessToken: string; refreshToken: string; expiresIn: number; type: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresIn: Number(p.get('expires_in')) || 3600, type: p.get('type') ?? '' };
}

/** 用確認信帶回來的 token 直接登入 */
export function adoptSession(accessToken: string, refreshToken: string, expiresIn: number, email = ''): AdminSession {
  const s: AdminSession = { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000, email };
  saveSession(s);
  return s;
}

let refreshing: Promise<AdminSession | null> | null = null;

/** 目前有效的 session（快到期就換新；換不到就登出） */
export async function getSession(): Promise<AdminSession | null> {
  const s = loadSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > REFRESH_MARGIN_MS) return s;
  refreshing ??= (async () => {
    try {
      const data = (await authFetch('/token?grant_type=refresh_token', { refresh_token: s.refreshToken })) as TokenResponse;
      const next = toSession(data, s.email);
      if (!next) throw new AuthError('登入已過期，請重新登入');
      saveSession(next);
      return next;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function signOut(): Promise<void> {
  const s = loadSession();
  clearSession();
  if (!s) return;
  try {
    await authFetch('/logout', {}, s.accessToken);
  } catch {
    // 本機已清掉，伺服器端失敗無所謂
  }
}
