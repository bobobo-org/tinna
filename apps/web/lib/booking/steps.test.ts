import { describe, expect, it } from 'vitest';
import { buildSearch, initNav, navBackDelta, navPush, navReplace, parseStep, syncExternal } from './steps';

describe('網址參數', () => {
  it('parseStep：1–4 以外一律 1', () => {
    expect(parseStep('2')).toBe(2);
    expect(parseStep('4')).toBe(4);
    for (const bad of [null, undefined, '', '0', '5', 'abc', '2.5', '-1']) expect(parseStep(bad)).toBe(1);
  });

  it('buildSearch', () => {
    expect(buildSearch('love', 2)).toBe('svc=love&step=2');
    expect(buildSearch(null, 1)).toBe('');
    expect(buildSearch(null, 2)).toBe('step=2');
    expect(buildSearch('a&b', 1)).toBe('svc=a%26b&step=1');
  });
});

describe('上一步 / 瀏覽器上一頁', () => {
  it('一路 push 下一步 → 上一步用 history.back()（delta -1）', () => {
    let h = initNav(1);
    h = navPush(h, 2);
    h = navPush(h, 3);
    expect(navBackDelta(h, 2)).toBe(-1);
    // 瀏覽器（或 history.back）回到 2
    h = syncExternal(h, 2);
    expect(h).toEqual({ entries: [1, 2, 3], idx: 1 });
    expect(navBackDelta(h, 1)).toBe(-1);
  });

  it('深連結直接進 Step 2（前面沒有 Step 1 的歷史）→ 上一步改用 replace', () => {
    const h = initNav(2);
    expect(navBackDelta(h, 1)).toBeNull();
    expect(navReplace(h, 1)).toEqual({ entries: [1], idx: 0 });
  });

  it('409 從 Step 4 回 Step 2：歷史裡有 2 → history.go(-2)', () => {
    let h = initNav(1);
    for (const s of [2, 3, 4] as const) h = navPush(h, s);
    expect(navBackDelta(h, 2)).toBe(-2);
    // 中間夾著更早的步驟就不能一路跳回去
    expect(navBackDelta({ entries: [2, 1, 4], idx: 2 }, 2)).toBeNull();
  });

  it('瀏覽器下一頁、未知的網址', () => {
    let h = initNav(1);
    h = navPush(h, 2);
    h = syncExternal(h, 1); // 上一頁
    h = syncExternal(h, 2); // 下一頁
    expect(h).toEqual({ entries: [1, 2], idx: 1 });
    expect(syncExternal(h, 4)).toEqual({ entries: [4], idx: 0 });
    expect(syncExternal(h, 2)).toBe(h);
  });

  it('push 會丟掉目前位置之後的歷史', () => {
    let h = initNav(1);
    h = navPush(h, 2);
    h = navPush(h, 3);
    h = syncExternal(h, 2);
    h = navPush(h, 3);
    expect(h).toEqual({ entries: [1, 2, 3], idx: 2 });
  });
});
