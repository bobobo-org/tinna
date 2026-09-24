// 綠界回呼參數（測試用），欄位與官方文件的回傳參數一致

export function paidParams(tradeNo: string, amount: number, extra: Record<string, string> = {}) {
  return {
    CustomField1: tradeNo.slice(0, 10),
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    MerchantID: '3002607',
    MerchantTradeNo: tradeNo,
    PaymentDate: '2026/09/24 10:05:00',
    PaymentType: 'Credit_CreditCard',
    PaymentTypeChargeFee: '100',
    RtnCode: '1',
    RtnMsg: '交易成功',
    SimulatePaid: '0',
    StoreID: '',
    TradeAmt: String(amount),
    TradeDate: '2026/09/24 10:01:00',
    TradeNo: '2609241001001234',
    ...extra,
  };
}

export function atmInfoParams(tradeNo: string, amount: number, extra: Record<string, string> = {}) {
  return {
    BankCode: '822',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    ExpireDate: '2026/09/25',
    MerchantID: '3002607',
    MerchantTradeNo: tradeNo,
    PaymentType: 'ATM_CHINATRUST',
    RtnCode: '2',
    RtnMsg: 'Get VirtualAccount Succeeded',
    StoreID: '',
    TradeAmt: String(amount),
    TradeDate: '2026/09/24 10:01:00',
    TradeNo: '2609241001005678',
    vAccount: '9103522175887271',
    ...extra,
  };
}

export const bookingBody = {
  service_id: 'love',
  date: '2026-10-07',
  time: '19:00',
  name: '王小美',
  gender: 'female',
  birth_date: '1995-03-12',
  birth_time: '',
  birth_place: '台北市',
  phone: '0912345678',
  email: 'guest@example.com',
  questions: '',
  pay_method: 'card',
  agree: true,
};
