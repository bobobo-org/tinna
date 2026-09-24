/**
 * 「加入行事曆」.ics（RFC 5545）
 *
 * - 時間用台北時間：DTSTART;TZID=Asia/Taipei，附 VTIMEZONE（+08:00、無日光節約）
 * - 文字欄位跳脫 \ ; , 與換行；每行超過 75 octets 以 CRLF + 空白折行（不切斷 UTF-8 多位元組字元）
 */

import { pad2 } from './time';

export interface IcsInput {
  orderNo: string;
  serviceName: string;
  minutes: number;
  /** 台北日期 YYYY-MM-DD */
  date: string;
  /** 台北時間 HH:MM */
  time: string;
  /** 完成頁網址（行事曆裡可點回來看訂單） */
  url?: string;
  /** 額外說明（例：ATM 轉帳期限） */
  note?: string;
  /** DTSTAMP 用；預設現在 */
  now?: Date;
  /** UID 的網域 */
  host?: string;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 每行最多 75 octets，續行以一個空白開頭（空白也算在該行的 75 內） */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 續行前面有一個空白
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 台北「牆上時間」加分鐘（台灣無日光節約，直接用 UTC 欄位計算） */
export function addMinutesLocal(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) + minutes * 60_000);
  return {
    date: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
    time: `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`,
  };
}

const localStamp = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

export function buildIcs(input: IcsInput): string {
  const end = addMinutesLocal(input.date, input.time, input.minutes);
  const description = [
    `方案：${input.serviceName}（${input.minutes} 分鐘）`,
    `訂單編號：${input.orderNo}`,
    '形式：線上視訊，視訊連結會寄到你的 Email。',
    ...(input.note ? [input.note] : []),
  ].join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yuanshe//Booking//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Taipei',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${input.orderNo}@${input.host || 'yuanshe'}`,
    `DTSTAMP:${utcStamp(input.now ?? new Date())}`,
    `DTSTART;TZID=Asia/Taipei:${localStamp(input.date, input.time)}`,
    `DTEND;TZID=Asia/Taipei:${localStamp(end.date, end.time)}`,
    `SUMMARY:${escapeText(`緣舍命理｜${input.serviceName} 線上諮詢`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText('線上視訊')}`,
    ...(input.url ? [`URL:${input.url}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`緣舍命理｜${input.serviceName} 一小時後開始`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function icsFileName(orderNo: string): string {
  return `yuanshe-${orderNo}.ics`;
}
