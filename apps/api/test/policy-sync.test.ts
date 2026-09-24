import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_PENDING_ATM, MAX_PENDING_PER_CUSTOMER } from '../src/lib/policy';

// apply_atm_issued（0003）的「逾時預約恢復待轉帳」無法從 API 帶參數（簽章不能改），上限寫在 SQL 裡；
// 這裡確認 SQL 的常數與 apps/api/src/lib/policy.ts 一致。
describe('SQL 內的上限常數與 policy.ts 一致', () => {
  it('apply_atm_issued 的每人上限與全站 ATM 上限', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../supabase/migrations/0003_review_fixes.sql', import.meta.url)),
      'utf8',
    );
    const fn = sql.slice(sql.indexOf('create or replace function public.apply_atm_issued'));
    const block = fn.slice(fn.indexOf("if v_bk.status = 'expired' then"), fn.indexOf("return jsonb_build_object('result', 'limit_exceeded'"));
    const limits = [...block.matchAll(/\)\s*>=\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(limits).toEqual([MAX_PENDING_PER_CUSTOMER, MAX_PENDING_ATM]);
  });
});
