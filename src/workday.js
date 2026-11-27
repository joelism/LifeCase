import { nameOf, value } from './model.js';

const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const normal = text => String(text ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-CH');
const shiftKey = item => JSON.stringify([item.date, normal(nameOf(item.row)), normal(value(item.row, 'location'))]);

export function shiftWorkdays(entries) {
  const groups = new Map();
  for (const item of entries) {
    if (item.kind !== 'Schicht' || item.state !== 'Offen' || !item.row || !item.date ||
      (item.endDate && item.endDate !== item.date) || !clock.test(item.time) ||
      !clock.test(item.endTime) || item.endTime <= item.time) continue;
    const key = shiftKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const result = [];
  for (const shifts of groups.values()) {
    const ordered = [...shifts].sort((a, b) => a.time.localeCompare(b.time));
    if (ordered.length < 2 || ordered.some((item, i) => i && ordered[i - 1].endTime > item.time)) continue;
    const first = ordered[0];
    const gaps = ordered.slice(1).map((item, i) => ({ time: ordered[i].endTime, endTime: item.time }))
      .filter(gap => gap.time >= '11:30' && gap.endTime <= '14:30' &&
        minute(gap.endTime) - minute(gap.time) >= 30 && minute(gap.endTime) - minute(gap.time) <= 120);
    const lunch = gaps.length === 1 ? gaps[0] : null;
    if (!lunch) continue;
    const overlapping = entries.some(item => {
      if (item.state !== 'Offen' || !['Schicht', 'Pause'].includes(item.kind) || ordered.includes(item) ||
        !clock.test(item.time) || !clock.test(item.endTime)) return false;
      const end = item.endDate || item.date;
      return item.date <= first.date && end >= first.date &&
        (item.date < first.date || item.time < lunch.endTime) &&
        (end > first.date || item.endTime > lunch.time);
    });
    if (overlapping) continue;
    result.push({ ...first, endTime: ordered.at(-1).endTime, shifts: ordered, lunch });
  }
  return result;
}

export function groupWorkdays(entries) {
  const workdays = shiftWorkdays(entries);
  const heads = new Map(workdays.map(item => [item.row.id, item]));
  const tails = new Set(workdays.flatMap(item => item.shifts.slice(1).map(shift => shift.row.id)));
  return entries.filter(item => item.kind !== 'Schicht' || !tails.has(item.row?.id))
    .map(item => item.kind === 'Schicht' ? heads.get(item.row?.id) ?? item : item);
}

export const lunchLabel = ({ time, endTime }) => 'Mittagspause ' + time + '–' + endTime;
