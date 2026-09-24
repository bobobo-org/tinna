import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine } from '../src/lib/ics';
import { ResendMailer } from '../src/lib/mailer';
import { runJobsOnce } from '../src/jobs/expire-holds';
import { formatEcpayDateTime, fromTaipei, parseEcpayDateTime, toTaipeiIso } from '../src/lib/time';
import { FixedWindowRateLimiter } from '../src/lib/rate-limit';
import { MemoryLogger, makeFakeFetch, makeHarness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');

describe('/health、404、CORS', () => {
  it('/health 回 ok、台北時間、版本', async () => {
    const h = makeHarness({ now: NOW, env: { GIT_SHA: 'deadbeef' } });
    const res = await h.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, time: '2026-09-24T10:00:00+08:00', version: 'deadbeef' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('未知路徑 → JSON 404', async () => {
    const h = makeHarness({ now: NOW });
    const res = await h.app.request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', message: '找不到這個網址' });
  });

  it('只允許 WEB_URL；非 production 另允許 localhost:3000', async () => {
    const h = makeHarness({ now: NOW });
    const ok = await h.app.request('/config', { headers: { Origin: 'https://yuanshe.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://yuanshe.example');
    const local = await h.app.request('/config', { headers: { Origin: 'http://localhost:3000' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const evil = await h.app.request('/config', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await h.app.request('/bookings', {
      method: 'OPTIONS',
      headers: { Origin: 'https://yuanshe.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://yuanshe.example');
  });

  it('production 不允許 localhost', async () => {
    const h = makeHarness({ now: NOW, env: { NODE_ENV: 'production' } });
    const local = await h.app.request('/config', { headers: { Origin: 'http://localhost:3000' } });
    expect(local.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('背景工作', () => {
  it('逾時保留 → expired；補寄沒寄成功的確認信', async () => {
    const h = makeHarness({ now: NOW });
    const stale = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      holdExpiresAt: new Date(NOW.getTime() - 1),
    });
    const fresh = h.db.addBooking({ startsAt: fromTaipei('2026-10-08', '19:00') });
    const unsent = h.db.addBooking({
      startsAt: fromTaipei('2026-10-09', '19:00'),
      status: 'confirmed',
      holdExpiresAt: null,
      confirmedAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    await runJobsOnce(h.deps);
    expect(stale.status).toBe('expired');
    expect(fresh.status).toBe('pending_payment');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
    expect(unsent.confirmationSentAt).not.toBeNull();
    expect(unsent.adminNotifiedAt).not.toBeNull();
    await runJobsOnce(h.deps);
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('重複付款被標記人工處理的已確認預約，確認信仍會補寄；諮詢開始後才入帳的不寄', async () => {
    const h = makeHarness({ now: NOW });
    const dup = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'confirmed',
      holdExpiresAt: null,
      confirmedAt: new Date(NOW.getTime() - 10 * 60_000),
      needsAttention: true,
      attentionReason: 'duplicate_payment',
      adminNotifiedAt: NOW,
    });
    h.db.addBooking({
      startsAt: fromTaipei('2026-10-08', '19:00'),
      status: 'confirmed',
      holdExpiresAt: null,
      confirmedAt: new Date(NOW.getTime() - 10 * 60_000),
      needsAttention: true,
      attentionReason: 'paid_after_start',
      adminNotifiedAt: NOW,
    });
    await runJobsOnce(h.deps);
    expect(h.mailer.tags()).toEqual(['booking_confirmed']);
    expect(h.mailer.sent[0]!.subject).toContain(dup.orderNo);
  });

  it('限流：清理有節流、key 數有上限', () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter(10, 3600_000, () => t, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`198.51.100.${i}`);
    expect(rl.size).toBe(100);
    expect(rl.hit('198.51.100.999').allowed).toBe(true); // 最新的 key 還在
    t = 3600_001 + 60_001;
    rl.hit('x');
    expect(rl.size).toBe(1); // 視窗過後清空
  });
});

describe('時間與 .ics', () => {
  it('綠界日期：ATM 只有日期 → 當天 23:59:59（台北）', () => {
    expect(parseEcpayDateTime('2026/10/02')!.toISOString()).toBe('2026-10-02T15:59:59.000Z');
    expect(parseEcpayDateTime('2026/10/02 12:00:00')!.toISOString()).toBe('2026-10-02T04:00:00.000Z');
    expect(parseEcpayDateTime('2026/02/30')).toBeNull();
    expect(formatEcpayDateTime(new Date('2026-10-02T15:59:59Z'))).toBe('2026/10/02 23:59:59');
    expect(toTaipeiIso(new Date('2026-10-07T11:00:00Z'))).toBe('2026-10-07T19:00:00+08:00');
  });

  it('.ics：TZID=Asia/Taipei、CRLF、每行 ≤ 75 octets', () => {
    const ics = buildIcs({
      uid: 'YS8K2M4Q7T@yuanshe',
      start: new Date('2026-10-07T11:00:00Z'),
      end: new Date('2026-10-07T12:30:00Z'),
      stamp: new Date('2026-09-24T02:00:00Z'),
      summary: '緣舍命理｜感情合盤（90 分鐘線上諮詢）',
      description: `訂單編號：YS8K2M4Q7T\n視訊連結：視訊連結將於諮詢前另行寄送\n諮詢前 48 小時可免費改期一次；48 小時內取消恕不退款，但可轉讓給親友使用。a,b;c\\d`,
      location: '線上視訊（Google Meet）',
    });
    expect(ics).toContain('DTSTART;TZID=Asia/Taipei:20261007T190000\r\n');
    expect(ics).toContain('DTEND;TZID=Asia/Taipei:20261007T203000\r\n');
    expect(ics).toContain('DTSTAMP:20260924T020000Z\r\n');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    // 折行後還原內容不變
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('48 小時內取消恕不退款，但可轉讓給親友使用。a\\,b\\;c\\\\d');
    expect(unfolded).toContain('訂單編號：YS8K2M4Q7T\\n視訊連結');
    expect(foldLine('a'.repeat(80)).split('\r\n ')).toHaveLength(2);
  });
});

describe('寄信 dry-run', () => {
  it('沒有 RESEND_API_KEY → 只記收件網域與主旨，不打 API', async () => {
    const logger = new MemoryLogger();
    const f = makeFakeFetch(() => ({ body: '{}' }));
    const mailer = new ResendMailer({ resendApiKey: null, from: 'x <a@b.co>', adminEmails: [] }, logger, f as unknown as typeof fetch);
    const r = await mailer.send({ tag: 't', to: ['guest.person@gmail.com'], subject: '【緣舍命理】預約成功 YS8K2M4Q7T', html: '王小美', text: '王小美' });
    expect(r).toEqual({ ok: true, dryRun: true });
    expect(f.calls).toHaveLength(0);
    const text = logger.text();
    expect(text).toContain('gmail.com');
    expect(text).toContain('預約成功 YS8K2M4Q7T');
    expect(text).not.toContain('guest.person');
    expect(text).not.toContain('王小美');
  });

  it('有 RESEND_API_KEY → POST api.resend.com，帶 Idempotency-Key 與附件', async () => {
    const logger = new MemoryLogger();
    const f = makeFakeFetch(() => ({ body: '{"id":"email_123"}' }));
    const mailer = new ResendMailer(
      { resendApiKey: 're_test', from: '緣舍命理 <hello@yuanshe.tw>', adminEmails: [] },
      logger,
      f as unknown as typeof fetch,
    );
    const r = await mailer.send({
      tag: 't',
      to: ['a@b.co'],
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
      idempotencyKey: 'booking-confirmed/1',
      attachments: [{ filename: 'a.ics', content: 'QkVHSU4=', contentType: 'text/calendar' }],
    });
    expect(r).toEqual({ ok: true, dryRun: false, id: 'email_123' });
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    const headers = call.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe('booking-confirmed/1');
    const body = JSON.parse(call.init!.body as string);
    expect(body.from).toBe('緣舍命理 <hello@yuanshe.tw>');
    expect(body.attachments[0]).toEqual({ filename: 'a.ics', content: 'QkVHSU4=', content_type: 'text/calendar' });
  });
});
