import { createHash } from 'node:crypto';

// 後台登入：Supabase Auth 的 access token → 驗證（Email 必須已收信確認）→ 以 sha256(Email) 比對 admins 表。
// repo 是公開的，所以 admins 表的初始資料只存雜湊。

export interface AuthUser {
  email: string;
}

export interface AuthVerifier {
  /** token 無效、過期、Email 尚未確認 → null */
  verify(accessToken: string): Promise<AuthUser | null>;
}

export function emailSha256(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** 取出 `Authorization: Bearer <token>` 的 token */
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1]! : null;
}
