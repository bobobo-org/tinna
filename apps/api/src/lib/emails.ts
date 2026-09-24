import type { BookingFull, BookingPayMethod, Order, VipMember, VipPlan } from '../db/types';
import { buildIcs } from './ics';
import type { MailMessage } from './mailer';
import { formatEcpayDateTime, formatTaipeiDisplay, taipeiTime } from './time';
import { expiryDate } from './vip';

// 信件內容（繁體中文）。收件人是顧客本人或老師（ADMIN_EMAIL），所以內文可以有該筆預約資料；
// 但 log 只會記收件網域與主旨（見 mailer.ts）。

export const PAY_METHOD_LABEL: Record<BookingPayMethod, string> = {
  card: '信用卡',
  line: 'LINE Pay',
  atm: 'ATM 轉帳',
  vip: 'VIP 堂數',
};

export const ATTENTION_LABEL: Record<string, string> = {
  amount_mismatch: '付款金額與訂單金額不符（未自動確認）',
  paid_after_expiry_slot_taken: '保留逾時後才付款成功，原時段已被其他人預約',
  paid_after_expiry_past: '保留逾時後才付款成功，諮詢時間已過',
  paid_after_start: '諮詢開始後才入帳',
  paid_after_cancel: '已取消的訂單收到付款',
  paid_after_refund: '已退款的訂單又收到付款',
  duplicate_payment: '同一筆預約重複付款（需退款其中一筆）',
  unknown_trade: '收到無法對應訂單的付款通知',
  linepay_confirm_unknown: 'LINE Pay 付款確認結果不明，請到 LINE Pay 商家後台確認',
  payment_pending_review: '綠界回報「交易付款結果待確認中」（10300066），請到綠界廠商後台確認是否已付款',
  payment_unknown_status: '綠界回報無法辨識的交易狀態，請到綠界廠商後台確認是否已付款',
  possible_duplicate_payment: '預約已確認，但同一筆訂單還有另一次付款結果不明，可能重複扣款，請到金流後台確認',
};

const RESCHEDULE_RULE = '諮詢前 48 小時可免費改期一次；48 小時內取消恕不退款，但可轉讓給親友使用。';
const MEET_PENDING = '視訊連結將於諮詢前另行寄送';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ntd = (n: number): string => `NT$${n.toLocaleString('en-US')}`;

function timeRange(b: BookingFull): string {
  return `${formatTaipeiDisplay(b.startsAt)}–${taipeiTime(b.endsAt)}（台北時間）`;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="zh-Hant"><body style="margin:0;padding:24px 12px;background:#fff8fa;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;color:#63142f">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border-top:4px solid #e8749c;padding:28px 24px;box-shadow:0 20px 40px -30px rgba(138,23,64,.5)">
<div style="font-size:20px;font-weight:700;letter-spacing:.18em;color:#8a1740;margin-bottom:6px">緣舍命理</div>
<h1 style="font-size:22px;margin:0 0 18px;color:#63142f">${esc(title)}</h1>
${bodyHtml}
<p style="font-size:13px;color:#a06a80;margin:28px 0 0">此信由系統自動寄出。</p>
</div></body></html>`;
}

function rows(items: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.9">${items
    .map(
      ([k, v]) =>
        `<tr><td style="color:#a06a80;padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="color:#63142f;padding:4px 0;white-space:pre-line">${esc(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

const textRows = (items: [string, string][]): string => items.map(([k, v]) => `${k}：${v}`).join('\n');

/** 預約成功確認信（附 .ics） */
export function confirmationEmail(b: BookingFull, meetUrl: string | null): MailMessage {
  const meet = meetUrl ?? MEET_PENDING;
  const vip = b.payMethod === 'vip';
  const items: [string, string][] = [
    ['訂單編號', b.orderNo],
    ['諮詢方案', `${b.service.name}（${b.service.minutes} 分鐘）`],
    ['諮詢時間', timeRange(b)],
    ...(vip
      ? ([['付款方式', 'VIP 堂數（使用 1 堂）']] as [string, string][])
      : ([
          ['付款方式', PAY_METHOD_LABEL[b.payMethod]],
          ['付款金額', ntd(b.amount)],
        ] as [string, string][])),
    ['視訊連結', meet],
  ];
  const intro = vip ? '感謝你的預約，已使用 VIP 堂數完成預約。' : '感謝你的預約，付款已完成。';
  const ics = buildIcs({
    uid: `${b.orderNo}@yuanshe`,
    start: b.startsAt,
    end: b.endsAt,
    stamp: new Date(),
    summary: `緣舍命理｜${b.service.name}（${b.service.minutes} 分鐘線上諮詢）`,
    description: `訂單編號：${b.orderNo}\n視訊連結：${meet}\n${RESCHEDULE_RULE}`,
    location: meetUrl ?? '線上視訊（Google Meet）',
    url: meetUrl,
  });
  const html = layout(
    '預約成功',
    `<p style="font-size:15px;line-height:2">${esc(b.customerName)} 您好，${intro}以下是這次諮詢的資訊：</p>
${rows(items)}
<p style="font-size:14px;line-height:2;color:#7a3450;margin-top:18px">諮詢以 Google Meet 視訊進行，也可選擇只開聲音。附件的 .ics 檔可加入行事曆。<br>${esc(RESCHEDULE_RULE)}</p>`,
  );
  const text = `${b.customerName} 您好，${intro}\n\n${textRows(items)}\n\n諮詢以 Google Meet 視訊進行，也可選擇只開聲音。附件的 .ics 檔可加入行事曆。\n${RESCHEDULE_RULE}\n\n緣舍命理`;
  return {
    tag: 'booking_confirmed',
    to: [b.email],
    subject: `【緣舍命理】預約成功 ${b.orderNo}`,
    html,
    text,
    attachments: [
      {
        filename: `yuanshe-${b.orderNo}.ics`,
        content: Buffer.from(ics, 'utf8').toString('base64'),
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
      },
    ],
    idempotencyKey: `booking-confirmed/${b.id}`,
  };
}

/** ATM 取號成功：轉帳資訊信 */
export function transferInfoEmail(b: BookingFull): MailMessage {
  const deadline = b.atmExpiresAt ? `${formatEcpayDateTime(b.atmExpiresAt)}（台北時間）` : '—';
  const items: [string, string][] = [
    ['訂單編號', b.orderNo],
    ['諮詢方案', `${b.service.name}（${b.service.minutes} 分鐘）`],
    ['諮詢時間', timeRange(b)],
    ['銀行代碼', b.atmBankCode ?? '—'],
    ['虛擬帳號', b.atmAccount ?? '—'],
    ['轉帳金額', ntd(b.amount)],
    ['繳費期限', deadline],
  ];
  const note = '時段已為你保留到繳費期限，入帳後會寄出預約成功確認信與視訊連結。請務必在諮詢開始前完成轉帳；每個虛擬帳號只對應這一筆訂單與金額。';
  const html = layout(
    '預約已保留，請完成轉帳',
    `<p style="font-size:15px;line-height:2">${esc(b.customerName)} 您好，以下是你的轉帳資訊：</p>
${rows(items)}
<p style="font-size:14px;line-height:2;color:#7a3450;margin-top:18px">${esc(note)}<br>${esc(RESCHEDULE_RULE)}</p>`,
  );
  const text = `${b.customerName} 您好，以下是你的轉帳資訊：\n\n${textRows(items)}\n\n${note}\n${RESCHEDULE_RULE}\n\n緣舍命理`;
  return {
    tag: 'transfer_info',
    to: [b.email],
    subject: `【緣舍命理】轉帳資訊 ${b.orderNo}`,
    html,
    text,
    idempotencyKey: `transfer-info/${b.id}/${b.atmAccount ?? ''}`,
  };
}

/** 給老師：新訂單（付款確認後） */
export function adminNewOrderEmail(b: BookingFull, adminEmails: string[]): MailMessage {
  const items: [string, string][] = [
    ['訂單編號', b.orderNo],
    ['方案', `${b.service.name}（${b.service.minutes} 分鐘）`],
    ['時間', timeRange(b)],
    ['金額', `${ntd(b.amount)}（${PAY_METHOD_LABEL[b.payMethod]}）`],
    ['姓名', b.customerName],
    ['性別', b.gender === 'male' ? '男' : b.gender === 'female' ? '女' : '—'],
    ['國曆生日', b.birthDate],
    ['出生時間', b.birthTime ?? '未提供'],
    ['出生地', b.birthPlace || '未提供'],
    ['手機', b.phone],
    ['Email', b.email],
    ['想問的問題', b.questions || '（未填）'],
  ];
  return {
    tag: 'admin_new_order',
    to: adminEmails,
    subject: `【新訂單】${b.orderNo} ${b.service.name} ${formatTaipeiDisplay(b.startsAt)}`,
    html: layout('新訂單', rows(items)),
    text: textRows(items),
    idempotencyKey: `admin-new-order/${b.id}`,
  };
}

/** 給老師：需人工處理 */
export function adminAlertEmail(
  args: { orderNo: string | null; reason: string; detail?: string },
  adminEmails: string[],
): MailMessage {
  const label = ATTENTION_LABEL[args.reason] ?? args.reason;
  const items: [string, string][] = [
    ['訂單編號', args.orderNo ?? '（無法對應）'],
    ['狀況', label],
    ...(args.detail ? ([['說明', args.detail]] as [string, string][]) : []),
  ];
  return {
    tag: 'admin_alert',
    to: adminEmails,
    subject: `【需人工處理】${args.orderNo ?? '未知訂單'} ${label}`,
    html: layout('需人工處理', rows(items)),
    text: textRows(items),
  };
}

// ---------- VIP 包堂、商店（0007） ----------

const KIND_LABEL: Record<Order['kind'], string> = { vip: 'VIP 包堂', shop: '商店訂單', gift: 'VIP 贈品' };

function itemRows(o: Order): [string, string][] {
  return o.items.map((i) => [i.name, `${ntd(i.unitPrice)} × ${i.qty}`]);
}

/** VIP 購買成功：卡號與使用方式 */
export function vipCardEmail(o: Order, m: VipMember, plan: VipPlan | null, webUrl: string): MailMessage {
  const items: [string, string][] = [
    ['訂單編號', o.orderNo],
    ['方案', plan ? `${plan.name}（${plan.sessions} 堂，每堂 90 分鐘）` : `${m.sessionsTotal} 堂`],
    ['VIP 卡號', m.cardNo],
    ['可用堂數', `${m.sessionsTotal - m.sessionsUsed} 堂`],
    ['使用期限', `${expiryDate(m.expiresAt)} 前（含當天）`],
    ['付款金額', ntd(o.amount)],
  ];
  const how = `預約方式：到 ${webUrl}/booking 選「VIP 諮詢」，付款步驟輸入 VIP 卡號（Email 需和購買時相同）即可使用 1 堂，不必另外付款。剩餘堂數可在 ${webUrl}/vip 查詢。`;
  return {
    tag: 'vip_purchased',
    to: [o.email],
    subject: `【緣舍命理】VIP 購買成功 ${m.cardNo}`,
    html: layout(
      'VIP 購買成功',
      `<p style="font-size:15px;line-height:2">${esc(o.customerName)} 您好，感謝你成為緣舍 VIP。請保存好你的 VIP 卡號：</p>
${rows(items)}
<p style="font-size:14px;line-height:2;color:#7a3450;margin-top:18px">${esc(how)}</p>`,
    ),
    text: `${o.customerName} 您好，感謝你成為緣舍 VIP。請保存好你的 VIP 卡號：\n\n${textRows(items)}\n\n${how}\n\n緣舍命理`,
    idempotencyKey: `vip-purchased/${o.id}`,
  };
}

/** 商店訂單付款成功 */
export function shopOrderEmail(o: Order): MailMessage {
  const items: [string, string][] = [
    ['訂單編號', o.orderNo],
    ...itemRows(o),
    ['運費', ntd(o.shippingFee)],
    ...(o.discountAmount > 0 ? ([['折扣', `−${ntd(o.discountAmount)}`]] as [string, string][]) : []),
    ['付款金額', ntd(o.amount)],
    ['收件人', `${o.shipName ?? o.customerName}（${o.shipPhone ?? o.phone}）`],
    ['收件地址', o.shipAddress ?? '—'],
  ];
  const note = '商品出貨後會再寄一封信通知你物流單號。收到商品 7 天內（鑑賞期）可申請退換貨。';
  return {
    tag: 'shop_paid',
    to: [o.email],
    subject: `【緣舍命理】訂單付款成功 ${o.orderNo}`,
    html: layout(
      '訂單付款成功',
      `<p style="font-size:15px;line-height:2">${esc(o.customerName)} 您好，感謝你的訂購，付款已完成：</p>
${rows(items)}
<p style="font-size:14px;line-height:2;color:#7a3450;margin-top:18px">${esc(note)}</p>`,
    ),
    text: `${o.customerName} 您好，感謝你的訂購，付款已完成：\n\n${textRows(items)}\n\n${note}\n\n緣舍命理`,
    idempotencyKey: `shop-paid/${o.id}`,
  };
}

/** 商店訂單／贈品出貨通知 */
export function shippedEmail(o: Order): MailMessage {
  const items: [string, string][] = [
    ['訂單編號', o.orderNo],
    ...itemRows(o),
    ['物流單號', o.trackingNo ?? '—'],
    ['收件地址', o.shipAddress ?? '—'],
  ];
  const title = o.kind === 'gift' ? 'VIP 贈品已寄出' : '商品已出貨';
  return {
    tag: 'order_shipped',
    to: [o.email],
    subject: `【緣舍命理】${title} ${o.orderNo}`,
    html: layout(title, `<p style="font-size:15px;line-height:2">${esc(o.customerName)} 您好，你的${o.kind === 'gift' ? '贈品' : '商品'}已經寄出：</p>\n${rows(items)}`),
    text: `${o.customerName} 您好，你的${o.kind === 'gift' ? '贈品' : '商品'}已經寄出：\n\n${textRows(items)}\n\n緣舍命理`,
    idempotencyKey: `order-shipped/${o.id}/${o.trackingNo ?? ''}`,
  };
}

/** 老師：新的 VIP／商店訂單（已付款） */
export function adminNewCommerceOrderEmail(o: Order, to: string[], extra: [string, string][] = []): MailMessage {
  const items: [string, string][] = [
    ['類型', KIND_LABEL[o.kind]],
    ['訂單編號', o.orderNo],
    ...itemRows(o),
    ['金額', ntd(o.amount)],
    ['姓名', o.customerName],
    ['手機', o.phone],
    ['Email', o.email],
    ...(o.shipAddress ? ([['收件', `${o.shipName ?? ''} ${o.shipPhone ?? ''}｜${o.shipAddress}`]] as [string, string][]) : []),
    ...(o.note ? ([['備註', o.note]] as [string, string][]) : []),
    ...extra,
  ];
  return {
    tag: 'admin_new_commerce_order',
    to,
    subject: `【新訂單】${KIND_LABEL[o.kind]} ${o.orderNo} ${ntd(o.amount)}`,
    html: layout(`新的${KIND_LABEL[o.kind]}`, rows(items)),
    text: textRows(items),
    idempotencyKey: `admin-commerce/${o.id}`,
  };
}

