import { describe, expect, it } from 'vitest';
import { bearerToken, emailSha256 } from '../src/lib/admin-auth';
import { fromTaipei } from '../src/lib/time';
import { adminHeaders, makeHarness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

describe('後台登入（/admin/*）', () => {
  it('沒帶 token / token 無效 → 401；不在管理者名單 → 403', async () => {
    const h = makeHarness({ now: NOW });
    expect((await h.app.request('/admin/me')).status).toBe(401);
    expect((await h.app.request('/admin/me', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    h.auth.tokens.set('guest-token', 'guest@example.com');
    const res = await h.app.request('/admin/me', { headers: { Authorization: 'Bearer guest-token' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).error).toBe('forbidden');
  });

  it('管理者 → /admin/me 回 Email；名單比對 sha256(小寫、去空白)', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h, 'Owner@Example.com');
    const res = await h.app.request('/admin/me', { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'Owner@Example.com' });
    expect(emailSha256(' OWNER@example.com ')).toBe(emailSha256('owner@example.com'));
    expect(emailSha256('pinklady6666@gmail.com')).toBe('71c571082e21626d70120de4a6b5843ec64167f7a6d88a64202093af0d23e1fb');
  });

  it('bearerToken 解析', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer x')).toBe('x');
    expect(bearerToken('Basic x')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('CORS 預檢允許 Authorization 標頭', async () => {
    const h = makeHarness({ now: NOW });
    const pre = await h.app.request('/admin/me', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://yuanshe.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('後台寫入請求：不在白名單的 Origin → 403；POST 不是 JSON → 415（在驗證登入之前）', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h);
    const evil = await h.app.request('/admin/me', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    const text = await h.app.request('/admin/me', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: 'x',
    });
    expect(text.status).toBe(415);
  });
});

describe('GET /admin/bookings', () => {
  it('預設今天起 30 天、依開始時間排序、含顧客資料', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h);
    const later = h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), customerName: '王小美', questions: '今年感情？' });
    const sooner = h.db.addBooking({ startsAt: fromTaipei('2026-09-30', '10:00'), status: 'confirmed', holdExpiresAt: null });
    h.db.addBooking({ startsAt: fromTaipei('2026-11-20', '10:00') }); // 超過 30 天
    h.db.addBooking({ startsAt: fromTaipei('2026-09-20', '10:00') }); // 過去
    const res = await h.app.request('/admin/bookings', { headers });
    expect(res.status).toBe(200);
    const b = (await res.json()) as Json;
    expect(b.from).toBe('2026-09-24');
    expect(b.to).toBe('2026-10-24');
    expect(b.bookings.map((x: Json) => x.orderNo)).toEqual([sooner.orderNo, later.orderNo]);
    const row = b.bookings[1];
    expect(row).toMatchObject({
      status: 'pending_payment',
      date: '2026-10-07',
      time: '19:00',
      startsAt: '2026-10-07T19:00:00+08:00',
      service: { id: 'love', name: '感情合盤' },
      customer: { name: '王小美', phone: '0912345678', email: 'guest@example.com', birthDate: '1990-01-01' },
      questions: '今年感情？',
    });
  });

  it('日期區間（含 to 當天）與狀態篩選', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h);
    const a = h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '20:30'), status: 'confirmed', holdExpiresAt: null });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '10:00'), status: 'expired' });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-08', '10:00'), status: 'confirmed', holdExpiresAt: null });
    const res = await h.app.request('/admin/bookings?from=2026-10-07&to=2026-10-07&status=confirmed', { headers });
    const b = (await res.json()) as Json;
    expect(b.bookings.map((x: Json) => x.orderNo)).toEqual([a.orderNo]);
  });

  it('參數不正確 → 400', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h);
    for (const qs of ['from=2026/10/01', 'from=2026-10-10&to=2026-10-01', 'from=2026-01-01&to=2027-06-01', 'status=paid']) {
      const res = await h.app.request(`/admin/bookings?${qs}`, { headers });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Json).error).toBe('validation');
    }
  });

  it('log 不含顧客個資與管理者 Email', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h, 'secret-owner@example.com');
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), customerName: '王小美' });
    await h.app.request('/admin/bookings', { headers });
    const text = h.logger.text();
    for (const pii of ['王小美', '0912345678', 'guest@example.com', 'secret-owner']) expect(text).not.toContain(pii);
  });
});
