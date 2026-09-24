import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { BASE_ENV } from './helpers/harness';

describe('env 驗證', () => {
  it('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → 清楚的錯誤', () => {
    const r = loadEnv({ NODE_ENV: 'production', WEB_URL: 'https://a.tw' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toContain('缺少 SUPABASE_URL');
    expect(r.errors.join('\n')).toContain('缺少 SUPABASE_SERVICE_ROLE_KEY');
  });

  it('production 缺 WEB_URL → 錯誤；開發環境預設 localhost:3000', () => {
    const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).ok).toBe(false);
    const dev = loadEnv(base);
    expect(dev.ok && dev.env.webOrigins).toEqual(['http://localhost:3000']);
    expect(dev.ok && dev.env.apiUrl).toBe('http://localhost:8080');
    expect(dev.ok && dev.env.port).toBe(8080);
  });

  it('金流參數缺少 → 只停用該付款方式，不會失敗', () => {
    const r = loadEnv({ ...BASE_ENV, ECPAY_HASH_IV: '', LINEPAY_CHANNEL_ID: '123' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.ecpay).toBeNull();
    expect(r.env.linepay).toBeNull();
    expect(r.env.warnings.join('\n')).toContain('ECPAY_HASH_IV');
    expect(r.env.warnings.join('\n')).toContain('LINEPAY_CHANNEL_SECRET');
  });

  it('ECPAY_ENV=prod 配公開測試特店 → 停用', () => {
    const r = loadEnv({ ...BASE_ENV, ECPAY_ENV: 'prod' });
    expect(r.ok && r.env.ecpay).toBeNull();
  });

  it('ECPAY_ENV 不合法 → 停用', () => {
    const r = loadEnv({ ...BASE_ENV, ECPAY_ENV: 'production' });
    expect(r.ok && r.env.ecpay).toBeNull();
  });

  it('production 缺 API_URL → 金流停用（不 crash）', () => {
    const r = loadEnv({ ...BASE_ENV, NODE_ENV: 'production', API_URL: undefined });
    expect(r.ok).toBe(true);
    expect(r.ok && r.env.ecpay).toBeNull();
  });

  it('WEB_URL 逗號分隔、去尾斜線；production 不加 localhost', () => {
    const r = loadEnv({ ...BASE_ENV, NODE_ENV: 'production', WEB_URL: 'https://yuanshe.tw/, https://www.yuanshe.tw' });
    expect(r.ok && r.env.webOrigins).toEqual(['https://yuanshe.tw', 'https://www.yuanshe.tw']);
    expect(r.ok && r.env.webUrl).toBe('https://yuanshe.tw');
    const dev = loadEnv({ ...BASE_ENV, WEB_URL: 'https://yuanshe.tw' });
    expect(dev.ok && dev.env.webOrigins).toEqual(['https://yuanshe.tw', 'http://localhost:3000']);
  });

  it('version：BUILD_SHA 檔優先，其次 GIT_SHA，都沒有是 dev', () => {
    const file = loadEnv({ ...BASE_ENV, GIT_SHA: 'fromenv' }, { buildShaFromFile: ' abc123\n' });
    expect(file.ok && file.env.buildSha).toBe('abc123');
    const env = loadEnv({ ...BASE_ENV, GIT_SHA: 'fromenv' }, { buildShaFromFile: null });
    expect(env.ok && env.env.buildSha).toBe('fromenv');
    const empty = loadEnv({ ...BASE_ENV }, { buildShaFromFile: '   ' });
    expect(empty.ok && empty.env.buildSha).toBe('dev');
  });

  it('RESEND_API_KEY 缺 MAIL_FROM → dry-run', () => {
    const r = loadEnv({ ...BASE_ENV, RESEND_API_KEY: 're_x' });
    expect(r.ok && r.env.mail.resendApiKey).toBeNull();
    const r2 = loadEnv({ ...BASE_ENV, RESEND_API_KEY: 're_x', MAIL_FROM: '緣舍命理 <hello@yuanshe.tw>' });
    expect(r2.ok && r2.env.mail.resendApiKey).toBe('re_x');
  });
});
