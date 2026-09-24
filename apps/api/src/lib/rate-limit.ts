import { BlockList, isIP } from 'node:net';

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

// ---------------------------------------------------------------------
// 用戶端 IP：X-Forwarded-For 由右往左，跳過受信任（proxy／內網）的段，取第一個非受信任 IP。
// 不論 Railway 邊緣是「覆寫」還是「附加」XFF 都安全：用戶端偽造的值只會出現在左邊，不會被選到。
// ---------------------------------------------------------------------

const TRUSTED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT／平台內部
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  TRUSTED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
] as const) {
  TRUSTED.addSubnet(net, prefix, 'ipv6');
}

/** 去掉埠號、方括號，IPv4-mapped IPv6 轉回 IPv4；不是合法 IP 回 null */
function parseIp(raw: string): string | null {
  let s = raw.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) s = mapped[1]!;
  const v = isIP(s);
  return v === 0 ? null : s.toLowerCase();
}

function isTrusted(ip: string): boolean {
  return TRUSTED.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * 取用戶端 IP：
 *  1. X-Forwarded-For 由右往左第一個「合法且非受信任」的 IP
 *  2. 連線來源位址（remote）
 *  3. XFF 最右邊的合法 IP（全部都是受信任段時）
 */
export function clientIp(headers: Headers, remote?: string): string {
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(parseIp)
    .filter((ip): ip is string => ip !== null);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!isTrusted(entries[i]!)) return entries[i]!;
  }
  const r = remote ? parseIp(remote) : null;
  if (r) return r;
  return entries[entries.length - 1] ?? 'unknown';
}

/** 把 IPv6 展開成 8 組 16 進位 */
function expandIpv6(ip: string): string[] {
  let s = ip;
  // 結尾是 IPv4（例如 64:ff9b::1.2.3.4）→ 轉成兩組 16 進位
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((x) => (parseInt(x || '0', 16) || 0).toString(16));
}

/** 限流 key：IPv4 原樣；IPv6 取 /64（同一用戶端常拿到同一個 /64 下的多個位址） */
export function rateLimitKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`;
}
