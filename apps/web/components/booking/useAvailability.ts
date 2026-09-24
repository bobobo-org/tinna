'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import type { DayView } from '@/lib/booking/types';

/**
 * GET /availability 的快取（key = 方案|月份）
 * - loading：月曆照樣排格子（不跳版），全部不可選
 * - error：顯示「重試」
 * - ok：refreshing 表示背景重新整理中（畫面繼續用舊資料，不閃佔位）
 */
export type AvailEntry =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; days: Record<string, DayView>; fetchedAt: number; refreshing: boolean };

export const availKey = (svc: string, month: string) => `${svc}|${month}`;

/** 回到 Step 2 時，資料超過這個時間就在背景重新抓 */
export const STALE_MS = 60_000;

export function useAvailability() {
  const [cache, setCache] = useState<Record<string, AvailEntry>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const ctrls = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const map = ctrls.current;
    return () => {
      for (const c of map.values()) c.abort();
      map.clear();
    };
  }, []);

  /**
   * 抓某個方案某個月的時段
   * - force：就算有資料／正在抓也重抓（409 之後）
   * - silent：已有資料時不切回 loading（背景更新）
   */
  const load = useCallback((svc: string, month: string, opts: { force?: boolean; silent?: boolean } = {}) => {
    const key = availKey(svc, month);
    const cur = cacheRef.current[key];
    if (!opts.force && (ctrls.current.has(key) || cur?.status === 'ok')) return;
    ctrls.current.get(key)?.abort();
    const ctrl = new AbortController();
    ctrls.current.set(key, ctrl);
    const keepOld = !!opts.silent && cur?.status === 'ok';
    setCache((prev) => {
      const p = prev[key];
      return {
        ...prev,
        [key]: keepOld && p?.status === 'ok' ? { ...p, refreshing: true } : { status: 'loading' },
      };
    });
    api
      .getAvailability(month, svc, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const days = res && typeof res.days === 'object' && res.days ? res.days : {};
        setCache((prev) => ({ ...prev, [key]: { status: 'ok', days, fetchedAt: Date.now(), refreshing: false } }));
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = e instanceof ApiError ? e.message : MSG_NETWORK;
        setCache((prev) => {
          const p = prev[key];
          // 背景更新失敗：保留舊資料就好
          if (keepOld && p?.status === 'ok') return { ...prev, [key]: { ...p, refreshing: false } };
          return { ...prev, [key]: { status: 'error', message } };
        });
      })
      .finally(() => {
        if (ctrls.current.get(key) === ctrl) ctrls.current.delete(key);
      });
  }, []);

  return { cache, load };
}
