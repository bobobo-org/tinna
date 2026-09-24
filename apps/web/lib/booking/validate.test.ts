import { describe, expect, it } from 'vitest';
import { EMPTY_FORM } from './draft';
import {
  EMAIL_RE,
  MSG,
  canGoNext,
  clampStep,
  firstErrorField,
  firstIncompleteStep,
  validateDetails,
  validateStep,
  type ValidationInput,
} from './validate';

const TODAY = '2026-09-24';
const filled = { ...EMPTY_FORM, name: '王小美', bdate: '1990-05-20', email: 'a@b.co', phone: '0912 345 678' };
const base: ValidationInput = { svc: null, date: null, time: null, f: EMPTY_FORM, pay: 'card', agree: false };
const complete: ValidationInput = { ...base, svc: 'love', date: '2026-10-07', time: '19:00', f: filled, agree: true };

describe('validateStep（原型 validate 的規則與文案）', () => {
  it('Step 1 要選方案、Step 2 要選日期與時段', () => {
    expect(validateStep(1, base, TODAY)).toEqual({ svc: MSG.svc });
    expect(validateStep(1, { ...base, svc: 'love' }, TODAY)).toEqual({});
    expect(validateStep(2, { ...base, date: '2026-10-07' }, TODAY)).toEqual({ dt: MSG.dt });
    expect(validateStep(2, { ...base, date: '2026-10-07', time: '19:00' }, TODAY)).toEqual({});
  });

  it('Step 3：姓名、出生日期、Email、手機（文案逐字同原型）', () => {
    expect(validateStep(3, base, TODAY)).toEqual({
      name: '請填寫姓名',
      bdate: '請選擇出生日期',
      email: '請填寫有效的 Email',
      phone: '請填寫手機號碼',
    });
    expect(validateStep(3, { ...base, f: filled }, TODAY)).toEqual({});
  });

  it('姓名只有空白不算；手機數字 ≥ 9 碼（空白、橫線不算）', () => {
    expect(validateDetails({ ...filled, name: '   ' }, TODAY).name).toBe(MSG.name);
    expect(validateDetails({ ...filled, phone: '0912-345-6' }, TODAY).phone).toBe(MSG.phone); // 8 碼
    expect(validateDetails({ ...filled, phone: '0912-345-67' }, TODAY).phone).toBeUndefined(); // 9 碼
    expect(validateDetails({ ...filled, phone: '0912-345-678' }, TODAY).phone).toBeUndefined();
    expect(validateDetails({ ...filled, phone: '+886 912 345 678' }, TODAY).phone).toBeUndefined();
  });

  it('Email 規則同原型 /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/（前後空白會先 trim）', () => {
    for (const ok of ['a@b.co', 'you@example.com', 'x.y+z@mail.co.jp']) expect(EMAIL_RE.test(ok)).toBe(true);
    for (const bad of ['', 'a@b', '@b.co', 'a b@c.co', 'a@@b.co', 'a@b.']) expect(EMAIL_RE.test(bad)).toBe(false);
    expect(validateDetails({ ...filled, email: ' a@b.co ' }, TODAY).email).toBeUndefined();
  });

  it('出生日期範圍同 API：1900-01-01 ～ 今天', () => {
    expect(validateDetails({ ...filled, bdate: '2026-09-24' }, TODAY).bdate).toBeUndefined();
    expect(validateDetails({ ...filled, bdate: '2026-09-25' }, TODAY).bdate).toBe(MSG.bdateRange);
    expect(validateDetails({ ...filled, bdate: '1899-12-31' }, TODAY).bdate).toBe(MSG.bdateRange);
  });

  it('Step 4：只驗同意條款（信用卡不收卡號，沒有卡號驗證）；未開通的付款方式擋下', () => {
    expect(validateStep(4, { ...complete, agree: false }, TODAY)).toEqual({ agree: MSG.agree });
    expect(validateStep(4, complete, TODAY)).toEqual({});
    expect(validateStep(4, { ...complete, pay: 'line', payEnabled: { card: true, atm: true, line: false } }, TODAY)).toEqual({
      pay: MSG.payUnavailable,
    });
    expect(validateStep(4, { ...complete, pay: 'card', payEnabled: { card: true, atm: true, line: false } }, TODAY)).toEqual({});
  });

  it('canGoNext：Step 1/2 未完成不能按；Step 3/4 永遠可按（按了才顯示錯誤）', () => {
    expect(canGoNext(1, base, TODAY)).toBe(false);
    expect(canGoNext(1, { ...base, svc: 'flow' }, TODAY)).toBe(true);
    expect(canGoNext(2, { ...base, svc: 'flow', date: '2026-10-07' }, TODAY)).toBe(false);
    expect(canGoNext(3, base, TODAY)).toBe(true);
    expect(canGoNext(4, base, TODAY)).toBe(true);
  });

  it('firstErrorField 依畫面順序', () => {
    expect(firstErrorField({ email: 'x', name: 'y' })).toBe('name');
    expect(firstErrorField({ phone: 'x', email: 'y' })).toBe('phone');
    expect(firstErrorField({ agree: 'x' })).toBe('agree');
    expect(firstErrorField({})).toBeNull();
  });
});

describe('步驟退回（網址 step 超前 → 第一個未完成的步驟）', () => {
  it('firstIncompleteStep', () => {
    expect(firstIncompleteStep(base, TODAY)).toBe(1);
    expect(firstIncompleteStep({ ...base, svc: 'love' }, TODAY)).toBe(2);
    expect(firstIncompleteStep({ ...base, svc: 'love', date: '2026-10-07' }, TODAY)).toBe(2);
    expect(firstIncompleteStep({ ...base, svc: 'love', date: '2026-10-07', time: '19:00' }, TODAY)).toBe(3);
    expect(firstIncompleteStep(complete, TODAY)).toBe(4);
  });

  it('沒選時段就 step=4 → 2；沒選方案 → 1；資料未填 → 3', () => {
    expect(clampStep(4, { ...base, svc: 'love' }, TODAY)).toBe(2);
    expect(clampStep(4, base, TODAY)).toBe(1);
    expect(clampStep(2, base, TODAY)).toBe(1);
    expect(clampStep(4, { ...complete, f: EMPTY_FORM }, TODAY)).toBe(3);
    expect(clampStep(4, complete, TODAY)).toBe(4);
  });

  it('往回的步驟不動（已完成的步驟可以回去改）', () => {
    expect(clampStep(1, complete, TODAY)).toBe(1);
    expect(clampStep(2, complete, TODAY)).toBe(2);
    expect(clampStep(3, complete, TODAY)).toBe(3);
  });
});
