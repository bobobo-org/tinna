import { describe, expect, it } from 'vitest';
import { makeHarness, postJson } from './helpers/harness';

// 正式環境預設關閉 ATM（ATM_ENABLED 沒設）：/config 回 atm=false、新預約不接受 ATM，信用卡照常

const NOW = new Date('2026-09-24T10:00:00+08:00');

const valid = {
  service_id: 'love',
  date: '2026-10-07',
  time: '19:00',
  name: '王小美',
  gender: 'female',
  birth_date: '1995-03-12',
  phone: '0912345678',
  email: 'a@b.co',
  pay_method: 'atm',
  agree: true,
};

describe('ATM 預設關閉', () => {
  it('沒設 ATM_ENABLED → /config atm=false（信用卡照常）', async () => {
    const h = makeHarness({ now: NOW, env: { ATM_ENABLED: undefined } });
    const cfg = (await (await h.app.request('/config')).json()) as { payments: Record<string, boolean> };
    expect(cfg.payments).toEqual({ card: true, atm: false, line: false });
    expect(h.env.atmEnabled).toBe(false);
  });

  it('新預約選 ATM → 400 fields.pay_method，不建立訂單；信用卡可以', async () => {
    const h = makeHarness({ now: NOW, env: { ATM_ENABLED: undefined } });
    const res = await postJson(h, '/bookings', valid);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields.pay_method).toBe('ATM 轉帳已停止服務，請改用信用卡');
    expect(h.db.bookings).toHaveLength(0);
    expect((await postJson(h, '/bookings', { ...valid, pay_method: 'card' })).status).toBe(201);
  });

  it('ATM_ENABLED=true（不分大小寫）才開啟', async () => {
    expect(makeHarness({ env: { ATM_ENABLED: 'TRUE' } }).env.atmEnabled).toBe(true);
    expect(makeHarness({ env: { ATM_ENABLED: '1' } }).env.atmEnabled).toBe(false);
  });
});
