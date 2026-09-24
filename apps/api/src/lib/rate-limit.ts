// 記憶體固定視窗限流（單一程序即可；多副本時各自計數）

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly clock: () => number = Date.now,
    /** 最多追蹤幾個 key；超過時丟掉最舊的（Map 依插入順序），避免被大量假 IP 灌爆記憶體 */
    readonly maxKeys = 50_000,
  ) {}

  hit(key: string): RateLimitResult {
    const now = this.clock();
    // 清理最多每分鐘一次，不會每個請求都掃整張表
    if (now - this.lastPrune > 60_000) this.prune(now);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.delete(key);
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
      while (this.hits.size > this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
    }
    entry.count += 1;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  get size(): number {
    return this.hits.size;
  }

  prune(now = this.clock()): void {
    this.lastPrune = now;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

/**
 * Railway 在 proxy 後面：取 x-forwarded-for 第一段（依需求）。
 * 注意：若 proxy 是「附加」而非「覆寫」這個 header，第一段可由用戶端偽造，限流只能算是盡力而為。
 */
export function clientIp(headers: Headers, fallback?: string): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return fallback || 'unknown';
}
