import { shiftDate } from './model.js';

const escape = input => String(input ?? '').replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n')
  .replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = day => day.replaceAll('-', '');
const clock = time => time.replaceAll(':', '').slice(0, 4) + '00';
const encoder = new TextEncoder();
function fold(line) {
  let output = '';
  let bytes = 0;
  for (const char of line) {
    const count = encoder.encode(char).length;
    if (bytes + count > 75) {
      output += '\r\n ';
      bytes = 1;
    }
    output += char;
    bytes += count;
  }
  return output;
}

export function calendarFile(items, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeCase//Kalender//DE', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Zurich',
    'BEGIN:STANDARD', 'DTSTART:19961027T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19960331T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'END:DAYLIGHT', 'END:VTIMEZONE',
  ];
  for (const item of items) {
    const { row, date, time, reminderDays } = item;
    lines.push('BEGIN:VEVENT', 'UID:' + row.id + '-' + stamp(date) + '-' + (item.kind === 'Wiedervorlage' ? 'followup' : 'main') + '@lifecase',
      'DTSTAMP:' + now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
    if (time) {
      lines.push('DTSTART;TZID=Europe/Zurich:' + stamp(date) + 'T' + clock(time));
      const endDay = item.endDate && item.endDate >= date ? item.endDate : date;
      if (item.endTime && (endDay > date || item.endTime > time)) lines.push('DTEND;TZID=Europe/Zurich:' + stamp(endDay) + 'T' + clock(item.endTime));
    } else {
      lines.push('DTSTART;VALUE=DATE:' + stamp(date), 'DTEND;VALUE=DATE:' + stamp(shiftDate(date, 1)));
    }
    lines.push('SUMMARY:' + escape(item.title || item.kind));
    if (item.privateDetail && item.location) lines.push('LOCATION:' + escape(item.location));
    if (item.privateDetail && item.description) lines.push('DESCRIPTION:' + escape(item.description));
    lines.push('CLASS:PRIVATE');
    if (reminderDays !== '' && reminderDays != null && /^\d+$/.test(reminderDays)) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:LifeCase-Erinnerung',
        Number(reminderDays) ? 'TRIGGER:-P' + reminderDays + 'D' : 'TRIGGER:PT0S', 'END:VALARM');
    } else if (item.kind === 'Erinnerung') {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:LifeCase-Erinnerung', 'TRIGGER:PT0S', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  return lines.concat('END:VCALENDAR', '').map(fold).join('\r\n');
}
