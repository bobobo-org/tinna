import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { apiError } from '../lib/http';
import { REFERRAL_MSG, checkUsable, discountLabel, normalizeCode, type OrderKind } from '../lib/referral';

const KINDS: OrderKind[] = ['booking', 'vip', 'shop'];

/**
 * GET /referral/:code?kind=booking|vip|shop — 下單前預覽推薦碼（顯示折扣）；真正的金額在建立訂單時由 API 重算
 * 推薦碼本來就是公開分享的，不需要登入
 */
export function referralRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/referral/:code', async (c) => {
    const kind = (c.req.query('kind') ?? 'booking') as OrderKind;
    if (!KINDS.includes(kind)) return apiError(c, 400, 'validation', '類型不正確', { kind: '類型不正確' });
    const code = normalizeCode(c.req.param('code'));
    const rc = code ? await deps.db.findReferralCode(code) : null;
    if (!rc) return apiError(c, 404, 'invalid_code', REFERRAL_MSG.invalid);
    const now = deps.now();
    const used = rc.maxUses !== null ? await deps.db.countLiveReferralUses(rc.id, now) : 0;
    const message = checkUsable(rc, kind, now, used);
    if (message) return apiError(c, 409, 'referral_unusable', message);
    return c.json({ code: rc.code, discountType: rc.discountType, discountValue: rc.discountValue, label: discountLabel(rc) });
  });

  return app;
}
