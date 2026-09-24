import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SupabaseDb } from '../src/db/supabase';

// supabase-js 以「參數名稱」呼叫 RPC（PostgREST），名稱或數量跟 SQL 函式對不上時只會在正式環境 500。
// 這裡解析 supabase/migrations/*.sql 的函式簽章（同名函式以最後一個 migration 為準），
// 跟 SupabaseDb 實際送出的參數逐一比對。

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

function sqlSignatures(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const m of sql.matchAll(re)) {
      const params = m[2]!
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.split(/\s+/)[0]!);
      out.set(m[1]!, params);
    }
  }
  return out;
}

function recordingClient() {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const results: Record<string, unknown> = {
    expire_stale_holds: 0,
    create_booking: { result: 'created', id: 'x', replaced: 0 },
    apply_payment_paid: { result: 'confirmed' },
    apply_atm_issued: { result: 'issued' },
    mark_payment_failed: { result: 'failed' },
    flag_payment_attention: { result: 'flagged' },
  };
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return { data: results[name], error: null };
    },
  };
  return { client, calls };
}

describe('RPC 參數名稱與 SQL 函式簽章一致', () => {
  it('SupabaseDb 送出的參數 = migrations 裡的函式參數', async () => {
    const { client, calls } = recordingClient();
    const db = new SupabaseDb(client as never);
    const now = new Date('2026-10-07T11:00:00Z');
    await db.expireStaleHolds({ from: now, to: now });
    await db.createBooking(
      {
        orderNo: 'YS8K2M4Q7T',
        serviceId: 'love',
        startsAt: now,
        endsAt: now,
        payMethod: 'card',
        amount: 3600,
        holdExpiresAt: now,
        customerName: 'x',
        gender: 'female',
        birthDate: '1990-01-01',
        birthTime: null,
        birthPlace: null,
        phone: '0912345678',
        email: 'a@b.co',
        questions: null,
      },
      { maxPendingPerCustomer: 2, maxPendingAtm: 5 },
    );
    await db.applyPaymentPaid({ provider: 'ecpay', tradeNo: 't', amount: 1, providerTxnId: null, event: 'e', raw: {} });
    await db.applyAtmIssued({
      tradeNo: 't',
      amount: 1,
      providerTxnId: null,
      bankCode: '822',
      account: '1',
      expiresAt: now,
      event: 'e',
      raw: {},
    });
    await db.markPaymentFailed({ provider: 'ecpay', tradeNo: 't', event: 'e', raw: {} });
    await db.flagPaymentAttention({ provider: 'ecpay', tradeNo: 't', event: 'e', raw: {}, reason: 'r' });

    const sigs = sqlSignatures();
    expect(calls.map((c) => c.name).sort()).toEqual(
      ['apply_atm_issued', 'apply_payment_paid', 'create_booking', 'expire_stale_holds', 'flag_payment_attention', 'mark_payment_failed'],
    );
    for (const c of calls) {
      const sql = sigs.get(c.name);
      expect(sql, `SQL 找不到 public.${c.name}`).toBeDefined();
      expect(Object.keys(c.params).sort(), `public.${c.name} 參數`).toEqual([...sql!].sort());
    }
  });
});
