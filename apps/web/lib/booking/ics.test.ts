import { describe, expect, it } from 'vitest';
import { addMinutesLocal, buildIcs, escapeText, foldLine, icsFileName } from './ics';

describe('.ics（台北時間）', () => {
  const ics = buildIcs({
    orderNo: 'YS8K2M4Q7T',
    serviceName: '感情合盤',
    minutes: 90,
    date: '2026-10-07',
    time: '19:00',
    url: 'https://example.com/booking/success?order=YS8K2M4Q7T',
    now: new Date(Date.UTC(2026, 8, 24, 7, 30, 5)),
    host: 'example.com',
  });
  const unfolded = ics.replace(/\r\n /g, '');
  const lines = unfolded.split('\r\n');

  it('DTSTART/DTEND 用 TZID=Asia/Taipei，附 +0800 的 VTIMEZONE', () => {
    expect(lines).toContain('DTSTART;TZID=Asia/Taipei:20261007T190000');
    expect(lines).toContain('DTEND;TZID=Asia/Taipei:20261007T203000');
    expect(lines).toContain('TZID:Asia/Taipei');
    expect(lines).toContain('TZOFFSETTO:+0800');
    expect(lines).toContain('DTSTAMP:20260924T073005Z');
    expect(lines).toContain('UID:YS8K2M4Q7T@example.com');
    expect(lines).toContain('SUMMARY:緣舍命理｜感情合盤 線上諮詢');
  });

  it('CRLF 換行、BEGIN/END 成對', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('每行不超過 75 octets（中文 3 bytes 也不會被切斷）', () => {
    const enc = new TextEncoder();
    for (const l of ics.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    const long = 'DESCRIPTION:' + '緣舍命理'.repeat(20);
    const folded = foldLine(long);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    for (const l of folded.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
  });

  it('跨午夜、跳脫字元、檔名', () => {
    expect(addMinutesLocal('2026-12-31', '23:30', 90)).toEqual({ date: '2027-01-01', time: '01:00' });
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(icsFileName('YS8K2M4Q7T')).toBe('yuanshe-YS8K2M4Q7T.ics');
  });
});
