import { pad2, taipeiParts } from './time';

// iCalendar（RFC 5545）。事件時間以 TZID=Asia/Taipei 表示並附 VTIMEZONE（台灣無日光節約）。

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string;
  url?: string | null;
  stamp: Date;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 超過 75 octets 折行（不切斷 UTF-8 字元），續行以一個空白開頭 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // 續行前面有一個空白
    if (bytes + len > limit) {
      out.push(current);
      current = ch;
      bytes = len;
    } else {
      current += ch;
      bytes += len;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

function taipeiLocal(d: Date): string {
  const p = taipeiParts(d);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}T${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
}

function utcStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

export function buildIcs(ev: IcsEvent): string {
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
    `UID:${ev.uid}`,
    `DTSTAMP:${utcStamp(ev.stamp)}`,
    `DTSTART;TZID=Asia/Taipei:${taipeiLocal(ev.start)}`,
    `DTEND;TZID=Asia/Taipei:${taipeiLocal(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    `DESCRIPTION:${escapeText(ev.description)}`,
    ...(ev.location ? [`LOCATION:${escapeText(ev.location)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:明天有一場緣舍命理線上諮詢',
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:緣舍命理線上諮詢 30 分鐘後開始',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
