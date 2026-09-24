import { describe, expect, it } from 'vitest';
import { addDays, monthRange, toCsv } from './format';
import { authMessage, parseAuthFragment } from './session';

describe('後台小工具', () => {
  it('addDays：跨月、跨年、閏年', () => {
    expect(addDays('2026-09-24', 7)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('monthRange', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('toCsv：逗號、引號、換行加引號', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', '兩行\n文字', null, 3]])).toBe('a,"b,c","say ""hi""","兩行\n文字",,3');
  });
});

describe('後台登入', () => {
  it('確認信／重設密碼連結帶回來的 token', () => {
    expect(parseAuthFragment('#access_token=a.b&refresh_token=r1&expires_in=3600&type=recovery')).toEqual({
      accessToken: 'a.b',
      refreshToken: 'r1',
      expiresIn: 3600,
      type: 'recovery',
    });
    expect(parseAuthFragment('#error=access_denied')).toBeNull();
    expect(parseAuthFragment('')).toBeNull();
  });

  it('Supabase 英文錯誤 → 中文', () => {
    expect(authMessage('Invalid login credentials')).toBe('Email 或密碼不正確');
    expect(authMessage('Email not confirmed')).toContain('確認');
    expect(authMessage('User already registered')).toContain('直接登入');
    expect(authMessage('Password should be at least 6 characters')).toContain('密碼太短');
    expect(authMessage('something else')).toBe('登入失敗，請稍後再試');
  });
});
