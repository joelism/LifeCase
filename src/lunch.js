import { CH_ZONE, shiftDate, today } from './model.js';
import { readDates } from '../supabase/functions/lifecase-connect/appointment-intake.js';

const duringLunch = { start: 12 * 60, end: 14 * 60 };
const busyKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Pause']);
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const uid = item => item.external ? item.external.provider + '|' + item.external.id : item.row?.id;
const mins = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
const roundUp = minute => Math.ceil(minute / 5) * 5;
const valid = time => typeof time === 'string' && clock.test(time);

function span(item, day, includeUntimed = true) {
  const first = item.external?.originalDate ?? item.date;
  const last = item.endDate || item.external?.endDate || item.date;
  if (day < first || day > last) return null;
  if (item.external?.allDay || (!valid(item.time) && first === item.date)) {
    return includeUntimed ? { start: 0, end: 1440 } : null;
  }
  const start = first < day ? 0 : mins(item.time);
  const end = last > day ? 1440 : valid(item.endTime) && (first < day || mins(item.endTime) > start) ? mins(item.endTime) : start + 30;
  return { start, end };
}

function availability(entries, day, now) {
  const active = entries.filter(item => item.state === 'Offen' && item.external?.busy !== false && uid(item));
  const byEntry = new Map();
  for (const item of active) if (!byEntry.has(uid(item)) || valid(item.time)) byEntry.set(uid(item), item);
  const unique = [...byEntry.values()];
  const shifts = unique.filter(item => item.kind === 'Schicht').map(item => span(item, day, false)).filter(Boolean);
  const pauses = unique.filter(item => item.kind === 'Pause' || (item.external?.lifeCasePause === true))
    .map(item => span(item, day)).filter(item => item && item.start < duringLunch.end && item.end > duringLunch.start);
  const blocks = unique.filter(item => busyKinds.has(item.kind)).map(item => span(item, day)).filter(Boolean)
    .sort((a,b) => a.start - b.start);
  const current = today(now);
  const floor = day === current ? roundUp(mins(localTime.format(now)) + 1) : duringLunch.start;
  const windows = (shifts.length ? shifts : [duringLunch]).map(item => ({
    start: Math.max(floor, duringLunch.start, roundUp(item.start)),
    end: Math.min(duringLunch.end, item.end),
  })).filter(item => item.end > item.start).sort((a,b) => a.start - b.start);
  return { windows, blocks, pauses, current };
}

export function findLunchSlot(entries, day, { duration = 45, after = '', now = new Date() } = {}) {
  const { windows, blocks, pauses, current } = availability(entries, day, now);
  if (day < current || !Number.isInteger(duration) || duration < 15 || duration > 120 || pauses.length) return null;
  for (const window of windows) {
    let cursor = Math.max(window.start, valid(after) ? mins(after) : 0);
    for (const block of blocks) {
      if (block.end <= cursor) continue;
      if (cursor + duration <= Math.min(window.end, block.start)) break;
      cursor = roundUp(block.end);
      if (cursor + duration > window.end) break;
    }
    if (cursor + duration <= window.end) {
      const end = cursor + duration;
      return { date: day, time: timeOf(cursor), endTime: timeOf(end), duration,
        following: blocks.filter(item => item.start >= end && item.start < 18 * 60 && item.end > item.start).length };
    }
  }
  return null;
}

export function lunchSlotIsFree(entries, slot, now = new Date()) {
  const { windows, blocks, pauses, current } = availability(entries, slot.date, now);
  if (slot.date < current || pauses.length || !valid(slot.time) || !valid(slot.endTime)) return false;
  const start = mins(slot.time);
  const end = mins(slot.endTime);
  return end > start && windows.some(window => start >= window.start && end <= window.end) &&
    !blocks.some(item => item.start < end && item.end > start);
}

export function lunchRequest(text, now = new Date()) {
  if (!/\b(?:mittagspausen?|lunch)\b/i.test(text)) return null;
  const dates = readDates(text, now);
  const duration = /\b(\d{1,3})\s*(?:min(?:uten)?\.?|minutes)\b/i.exec(text);
  const day = today(now);
  const offset = /\b(?:übermorgen|ubermorgen)\b/i.test(text) ? 2 : /\bmorgen\b/i.test(text) ? 1 : 0;
  return { date: dates[0]?.date || shiftDate(day, offset), duration: duration ? Number(duration[1]) : 45 };
}
