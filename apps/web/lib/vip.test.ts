import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIP_PLANS, getVipPlans, mapVipPlanRows, normalizeVipCard, perSession, savings, slashDate, validLabel } from './vip';

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VIP 卡號', () => {
  it('去空白、轉大寫、補連字號；易混淆字元（0 O 1 I L）不合法', () => {
    expect(normalizeVipCard('vip-ab2c-d3ef')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard(' AB2C D3EF ')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard('VIPAB2CD3EF')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard('VIP-AB2C-D3E')).toBeNull();
    expect(normalizeVipCard('VIP-AB0C-D3EF')).toBeNull();
    expect(normalizeVipCard('')).toBeNull();
  });
});

describe('VIP 方案', () => {
  it('預設方案：堂數越多每堂越便宜', () => {
    const per = VIP_PLANS.map(perSession);
    expect(per).toEqual([4500, 4200, 4100, 4000, 3800]);
    expect(VIP_PLANS.map((p) => savings(p, VIP_PLANS))).toEqual([0, 3000, 4800, 7500, 14000]);
    expect(validLabel(365)).toBe('1 年');
    expect(validLabel(180)).toBe('180 天');
    expect(slashDate('2027-09-24')).toBe('2027/09/24');
  });

  it('mapVipPlanRows：依 sort、欄位改名、停用的不顯示；形狀不對 → null', () => {
    const rows = [
      { id: 'b', name: 'B', sessions: 10, price: 40000, valid_days: 365, description: '  ', sort: 2, active: true },
      { id: 'a', name: 'A', sessions: 4, price: 18000, valid_days: 180, description: '說明', sort: 1, active: true },
      { id: 'c', name: 'C', sessions: 1, price: 5000, valid_days: 30, description: null, sort: 0, active: false },
    ];
    expect(mapVipPlanRows(rows)).toEqual([
      { id: 'a', name: 'A', sessions: 4, price: 18000, validDays: 180, description: '說明' },
      { id: 'b', name: 'B', sessions: 10, price: 40000, validDays: 365, description: null },
    ]);
    expect(mapVipPlanRows([])).toBeNull();
    expect(mapVipPlanRows([{ id: 'x' }])).toBeNull();
    expect(mapVipPlanRows([{ ...rows[0], sessions: 0 }])).toBeNull();
  });

  it('getVipPlans：沒設 env → 預設方案；有 env 讀 Supabase；失敗 → 預設方案', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getVipPlans({})).resolves.toBe(VIP_PLANS);
    expect(fetchMock).not.toHaveBeenCalled();

    const row = { id: 'vip-4', name: 'VIP 4 堂', sessions: 4, price: 18000, valid_days: 365, description: null, sort: 1, active: true };
    fetchMock.mockResolvedValue(new Response(JSON.stringify([row]), { status: 200 }));
    expect((await getVipPlans(ENV)).map((p) => p.id)).toEqual(['vip-4']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://demo.supabase.co/rest/v1/vip_plans?select=*&active=eq.true&order=sort');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(getVipPlans(ENV)).resolves.toBe(VIP_PLANS);
  });
});
