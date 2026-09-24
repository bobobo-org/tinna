import type { AppDeps } from '../deps';
import {
  REFERRAL_MSG,
  applyDiscount,
  checkUsable,
  commissionOf,
  normalizeCode,
  type OrderKind,
  type ReferralCode,
} from '../lib/referral';

export type ResolvedReferral = {
  ok: true;
  code: ReferralCode;
  original: number;
  discount: number;
  final: number;
  commission: number;
};

/** 下單時的推薦碼：查 DB、檢查能不能用、算折扣後金額與佣金 */
export async function resolveReferral(
  deps: Pick<AppDeps, 'db'>,
  raw: string,
  kind: OrderKind,
  amount: number,
  now: Date,
): Promise<ResolvedReferral | { ok: false; message: string }> {
  const code = normalizeCode(raw);
  if (!code) return { ok: false, message: REFERRAL_MSG.invalid };
  const rc = await deps.db.findReferralCode(code);
  if (!rc) return { ok: false, message: REFERRAL_MSG.invalid };
  const used = rc.maxUses !== null ? await deps.db.countLiveReferralUses(rc.id, now) : 0;
  const message = checkUsable(rc, kind, now, used);
  if (message) return { ok: false, message };
  const { discount, final } = applyDiscount(amount, rc);
  return { ok: true, code: rc, original: amount, discount, final, commission: commissionOf(final, rc.commissionRate) };
}
