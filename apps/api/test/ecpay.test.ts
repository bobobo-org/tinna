import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCheckoutFields,
  computeCheckMacValue,
  ecpayUrlEncode,
  parseFormBody,
  verifyCheckMacValue,
} from '../src/lib/ecpay';
import type { EcpayConfig } from '../src/env';
import { ECPAY_TEST } from './helpers/harness';

const qs = (s: string) =>
  Object.fromEntries(
    s.split('&').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );

describe('CheckMacValue（綠界官方範例）', () => {
  it('AioCheckOut 建立訂單範例（developers.ecpay.com.tw 檢查碼機制說明）', () => {
    // 官方文件：待加密字串與測試特店 3002607 的 HashKey/HashIV
    const params = qs(
      'TradeDesc=促銷方案&PaymentType=aio&MerchantTradeDate=2023/03/12 15:30:23&MerchantTradeNo=ecpay20230312153023&MerchantID=3002607&ReturnURL=https://www.ecpay.com.tw/receive.php&ItemName=Apple iphone 15&TotalAmount=30000&ChoosePayment=ALL&EncryptType=1',
    );
    expect(computeCheckMacValue(params, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs')).toBe(
      '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840',
    );
  });

  it('付款結果通知範例（付款結果通知頁的回傳參數範例）', () => {
    const params = qs(
      'CustomField1=&CustomField2=&CustomField3=&CustomField4=&MerchantID=3002607&MerchantTradeNo=D9RMXNrihUYM&PaymentDate=2024/12/31 12:26:09&PaymentType=Credit_CreditCard&PaymentTypeChargeFee=10&RtnCode=1&RtnMsg=交易成功&SimulatePaid=0&StoreID=&TradeAmt=402&TradeDate=2024/12/31 12:25:43&TradeNo=2412311225437371',
    );
    const expected = '85D927637935683EA756CDEF76498FEB9F5D098A7A1AC4F0CB3B3609A9D4116A';
    expect(computeCheckMacValue(params, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv)).toBe(expected);
    expect(verifyCheckMacValue({ ...params, CheckMacValue: expected }, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv)).toBe(
      true,
    );
  });

  it('取號結果通知範例（CVS，舊測試特店 2000132 的公開金鑰）', () => {
    const params = qs(
      'Barcode1=&Barcode2=&Barcode3=&ExpireDate=2017/12/28 00:39:03&MerchantID=2000132&MerchantTradeNo=Test1513787899&PaymentNo=LLL17355880822&PaymentType=CVS_CVS&RtnCode=10100073&RtnMsg=Get CVS Code Succeeded.&TradeAmt=2000&TradeDate=2017/12/21 00:39:03&TradeNo=17122100383415923452&StoreID=&CustomField1=&CustomField2=&CustomField3=&CustomField4=',
    );
    expect(computeCheckMacValue(params, '5294y06JbISpM5x9', 'v77hoKGq4kWxNNIS')).toBe(
      'C25373CE6379BB6116FAE8398F4A8E60B71B289D955F6B8A9D9F53FDCC97F571',
    );
  });
});

describe('.NET URL encode（綠界 URLEncode 轉換表）', () => {
  it('- _ . ! * ( ) 不編碼，空白變 +', () => {
    expect(ecpayUrlEncode('-_.!*() ')).toBe('-_.!*()+');
  });
  it('~ \' 與其他符號都要編碼', () => {
    const table: Record<string, string> = {
      '~': '%7e', "'": '%27', '@': '%40', '#': '%23', $: '%24', '%': '%25', '^': '%5e', '&': '%26',
      '=': '%3d', '+': '%2b', ';': '%3b', '?': '%3f', '/': '%2f', '\\': '%5c', '>': '%3e', '<': '%3c',
      '`': '%60', '[': '%5b', ']': '%5d', '{': '%7b', '}': '%7d', ':': '%3a', '"': '%22', ',': '%2c', '|': '%7c',
    };
    for (const [ch, enc] of Object.entries(table)) expect(ecpayUrlEncode(ch).toLowerCase()).toBe(enc);
  });
});

describe('verifyCheckMacValue', () => {
  const base = { MerchantID: '3002607', MerchantTradeNo: 'YS8K2M4Q7TABCDEFGHJK', RtnCode: '1', TradeAmt: '3600' };
  const signed = { ...base, CheckMacValue: computeCheckMacValue(base, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv) };

  it('正確簽章通過（大小寫不影響）', () => {
    expect(verifyCheckMacValue(signed, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv)).toBe(true);
    expect(
      verifyCheckMacValue({ ...signed, CheckMacValue: signed.CheckMacValue.toLowerCase() }, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv),
    ).toBe(true);
  });
  it('竄改金額、缺簽章、錯金鑰都不通過', () => {
    expect(verifyCheckMacValue({ ...signed, TradeAmt: '1' }, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv)).toBe(false);
    expect(verifyCheckMacValue(base, ECPAY_TEST.hashKey, ECPAY_TEST.hashIv)).toBe(false);
    expect(verifyCheckMacValue(signed, 'wrongkey00000000', ECPAY_TEST.hashIv)).toBe(false);
  });
  it('form body 解析（+ 視為空白、UTF-8）', () => {
    const p = parseFormBody('RtnMsg=%E4%BA%A4%E6%98%93%E6%88%90%E5%8A%9F&PaymentDate=2024%2F12%2F31+12%3A26%3A09');
    expect(p).toEqual({ RtnMsg: '交易成功', PaymentDate: '2024/12/31 12:26:09' });
  });
});

describe('buildCheckoutFields', () => {
  const cfg: EcpayConfig = {
    ...ECPAY_TEST,
    env: 'stage',
    checkoutUrl: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  };
  const input = {
    tradeNo: 'YS8K2M4Q7TABCDEFGHJK',
    orderNo: 'YS8K2M4Q7T',
    amount: 3600,
    itemName: '感情合盤 90分鐘線上諮詢',
    tradeDate: new Date('2026-09-24T02:05:09Z'),
    apiUrl: 'https://api.yuanshe.example',
    webUrl: 'https://yuanshe.example',
  };
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('信用卡：Credit + OrderResultURL + ClientBackURL，CheckMacValue 可驗', () => {
    process.env.TZ = 'America/Los_Angeles'; // 容器時區不影響
    const f = buildCheckoutFields(cfg, { ...input, method: 'card' });
    expect(f).toMatchObject({
      MerchantID: '3002607',
      MerchantTradeNo: 'YS8K2M4Q7TABCDEFGHJK',
      MerchantTradeDate: '2026/09/24 10:05:09',
      PaymentType: 'aio',
      TotalAmount: '3600',
      ChoosePayment: 'Credit',
      EncryptType: '1',
      ReturnURL: 'https://api.yuanshe.example/payments/ecpay/notify',
      OrderResultURL: 'https://api.yuanshe.example/payments/ecpay/result',
      ClientBackURL: 'https://yuanshe.example/booking/success?order=YS8K2M4Q7T',
    });
    expect(f.ExpireDate).toBeUndefined();
    expect(f.MerchantTradeNo!.length).toBeLessThanOrEqual(20);
    expect(verifyCheckMacValue(f, cfg.hashKey, cfg.hashIv)).toBe(true);
  });

  it('ATM：ATM + ExpireDate=1 + PaymentInfoURL + ClientRedirectURL，不帶 OrderResultURL', () => {
    const f = buildCheckoutFields(cfg, { ...input, method: 'atm' });
    expect(f.ChoosePayment).toBe('ATM');
    expect(f.ExpireDate).toBe('1');
    expect(f.PaymentInfoURL).toBe('https://api.yuanshe.example/payments/ecpay/atm-info');
    expect(f.ClientRedirectURL).toBe('https://api.yuanshe.example/payments/ecpay/atm-redirect');
    expect(f.OrderResultURL).toBeUndefined();
    expect(verifyCheckMacValue(f, cfg.hashKey, cfg.hashIv)).toBe(true);
  });
});
