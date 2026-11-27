import { readDates, readTimeRanges } from '../supabase/functions/lifecase-connect/appointment-intake.js';
import { shiftDate, today } from './model.js';

const week = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const relativePattern = /\b(?:heute|morgen|[üu]bermorgen)\b/giu;
const weekdayPattern = /\b(?:(?:am|nächsten|kommenden|diesen)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/giu;
const plausibleIntent = /\b(?:termin\w*|arzttermin\w*|besprechung|gespräch|kontrolle|treffen|sitzung|[äa]rztin|arzt|zahnarzt|therapie|training\w*|besuch|erinnerung|schicht|meeting|eintragen|einplanen|kalender|hab(?:e)?|buchen|trage|trag)\b/i;
const blocked = /\b(?:löschen|streichen|entfernen|absagen|verschieben|absage|abgesagt|abgelaufen)\b|\bkein(?:en|e)?\s+(?:termin|arzttermin)/i;
const timeWord = /(?:\b(?:um|gegen|ab|at)\s+(?:ca\.?\s*)?|(?<![\d.])(?=\d{1,2}:))([01]?\d|2[0-3])(?:[:.h]([0-5]\d))?(?![\d./:])(?:\s*(?:Uhr|h)\b)?|(?<![\d.])([01]?\d|2[0-3])(?:[:.h]([0-5]\d))?\s*Uhr\b/giu;
const pureTime = /^\s*([01]?\d|2[0-3])[:.h]([0-5]\d)(?:\s*Uhr)?\s*[.!]?\s*$/i;
const pad = number => String(number).padStart(2, '0');
const localMinute = timestamp => {
  const parts = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(timestamp);
  return parts.find(part => part.type === 'hour').value + ':' + parts.find(part => part.type === 'minute').value;
};
const germanFold = string => string.toLocaleLowerCase('de-CH').replace(/\s+/g, ' ').trim();

function readDays(text, reference) {
  const day = today(reference);
  const explicit = readDates(text, reference);
  if (explicit.length) return explicit;
  const relative = [...text.matchAll(relativePattern)].filter(match => {
    // "Montag morgen" describes the time of day, not an extra date.
    return match[0].toLowerCase() !== 'morgen' || !week.some(name => text.slice(0, match.index).trimEnd().toLowerCase().endsWith(name));
  });
  if (relative.length) return relative.map(match => {
    const word = match[0].toLocaleLowerCase('de-CH');
    return { date: shiftDate(day, word === 'heute' ? 0 : word === 'morgen' ? 1 : 2), index: match.index, length: match[0].length };
  });
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  return [...text.matchAll(weekdayPattern)].map(match => {
    const ahead = (week.indexOf(match[1].toLocaleLowerCase('de-CH')) - dow + 7) % 7;
    return { date: shiftDate(day, ahead || (/^(?:nächsten|kommenden)\b/i.test(match[0]) ? 7 : 0)), index: match.index, length: match[0].length };
  });
}
function hideSpans(text, spans) {
  let copy = text;
  for (const part of [...spans].sort((a, b) => b.index - a.index)) {
    copy = copy.slice(0, part.index) + ' '.repeat(part.length) + copy.slice(part.index + part.length);
  }
  return copy;
}
function readClocks(text) {
  const ranges = readTimeRanges(text).map(range => ({ ...range, length: range.evidence.length }));
  const remaining = hideSpans(text, ranges);
  const exact = pureTime.exec(remaining);
  if (exact) return [...ranges, { time: pad(exact[1]) + ':' + exact[2], index: 0, length: remaining.length, endTime: '' }];
  return [...ranges, ...[...remaining.matchAll(timeWord)].map(match => ({
    time: pad(match[1] || match[3]) + ':' + (match[2] || match[4] || '00'),
    endTime: '', index: match.index, length: match[0].length,
  }))];
}
function asTitle(text) {
  return text.trim().replace(/^(?:(?:ich|habe|hab|einen|eine|ein|bitte|trage|trag|mir|am|den|das)\s+)+/i, '')
    .replace(/\b(?:in (?:meinen|den) kalender|eintragen|einplanen)\b/gi, '').replace(/\s+ein[.!]?$/i, '')
    .replace(/^(?:am|den)\b\s*/i, '').replace(/\s+(?:am|um|den)$/i, '')
    .replace(/^[ .,;:–-]+|[ .,;:–-]+$/g, '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function interpretAppointment(input, draft = null, reference = new Date()) {
  const text = String(input ?? '').trim();
  if (!text || blocked.test(text)) return { status: 'unsupported', draft };
  const days = readDays(text, reference);
  const withoutDays = hideSpans(text, days);
  const clocks = readClocks(withoutDays);
  const next = { date: days[0]?.date || draft?.date || '', time: clocks[0]?.time || draft?.time || '', endTime: clocks[0]?.endTime ?? draft?.endTime ?? '',
    title: draft?.title || '' };
  const title = asTitle(hideSpans(withoutDays, clocks));
  if (!draft && !plausibleIntent.test(text) && !title) return { status: 'missing_title', draft: next };
  if (!draft && !plausibleIntent.test(text) && !days.length && !clocks.length) return { status: 'unsupported', draft };
  if (title && (!draft?.title || (plausibleIntent.test(text) && (days.length || clocks.length)))) next.title = title[0].toLocaleUpperCase('de-CH') + title.slice(1);
  if (days.length > 1 || clocks.length > 1 || /\b(?:oder|alternativ|entweder)\b/i.test(text)) return { status: 'ambiguous', draft };
  if (!next.title) return { status: 'missing_title', draft: next };
  if (!next.date) return { status: 'missing_day', draft: next };
  if (!next.time) return { status: 'missing_time', draft: next };
  if (next.date < today(reference) || (next.date === today(reference) && next.time < localMinute(reference))) {
    return { status: 'past', draft: { ...next, date: '' } };
  }
  if (next.endTime && next.endTime <= next.time) return { status: 'ambiguous', draft: { ...next, endTime: '' } };
  return { status: 'ready', draft: next };
}

const timedKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Schicht', 'Pause']);
const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const startAt = (date, time) => Date.parse(date + 'T00:00:00Z') / 60000 + minuteOf(time);
const validClock = time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

function interval(item) {
  if (item.state !== 'Offen' || !timedKinds.has(item.kind) || !validClock(item.time) || !item.date) return null;
  const start = startAt(item.date, item.time);
  if (!Number.isFinite(start)) return null;
  const end = validClock(item.endTime) ? startAt(item.endDate || item.date, item.endTime) : NaN;
  return { start, end: end > start ? end : start, knownEnd: end > start };
}
const relationStrength = { Knapp: 1, Überschneidung: 2 };
function between(a, b) {
  const first = a.start <= b.start ? a : b;
  const second = a.start <= b.start ? b : a;
  if (first.start === second.start || (first.knownEnd && second.start < first.end)) return 'Überschneidung';
  const limit = first.knownEnd ? 15 : 30;
  return second.start - first.end <= limit ? 'Knapp' : '';
}
export function markCalendarSpacing(entries) {
  const indexed = entries.map((item, index) => ({ item, index, period: interval(item) })).filter(row => row.period)
    .sort((a, b) => a.period.start - b.period.start);
  const markings = new Map();
  for (const [index, earlier] of indexed.entries()) {
    for (let next = index + 1; next < indexed.length; next++) {
      const later = indexed[next];
      if (later.period.start - earlier.period.end > 30) break;
      const relation = between(earlier.period, later.period);
      if (!relation) continue;
      for (const row of [earlier, later]) if (!(relationStrength[markings.get(row.index)] >= relationStrength[relation])) markings.set(row.index, relation);
    }
  }
  return entries.map((item, index) => ({ ...item, spacing: markings.get(index) || '' }));
}

export function duplicateAppointment(entries, draft) {
  return entries.find(entry => entry.state === 'Offen' && entry.date === draft.date && entry.time === draft.time &&
    germanFold(entry.external?.title ?? entry.row?.fields?.title ?? entry.row?.fields?.Titel ?? '') === germanFold(draft.title));
}

export function interpretTask(input, reference = new Date()) {
  const text = String(input ?? '').trim();
  const explicit = /^(aufgabe|frist|wiedervorlage)\b\s*[:–-]?\s*/i.exec(text);
  const reminder = /^erinnere? mich(?:\s+daran)?\s*[,.:]?\s*/i.exec(text);
  const byDate = /^bis\s+/i.exec(text);
  const prefix = explicit ?? reminder ?? byDate;
  if (!prefix) return null;
  const kind = ({ frist: 'Frist', wiedervorlage: 'Wiedervorlage' })[explicit?.[1]?.toLowerCase()] || 'Aufgabe';
  const words = text.slice(prefix[0].length);
  const days = readDays(words, reference);
  const remainder = hideSpans(words, days);
  const times = readClocks(remainder);
  const title = asTitle(hideSpans(remainder, times))
    .replace(/^(?:bis|spätestens|daran|bitte)\b\s*/i, '').replace(/\b(?:bis|spätestens)\s*$/i, '').trim();
  if (days.length > 1 || times.length > 1 || (days.length && /\boder\b/i.test(words))) {
    return { status: 'ambiguous' };
  }
  if (!title) return { status: 'missing_task_title' };
  const date = days[0]?.date || '';
  const time = times[0]?.time || '';
  if (!date && (kind !== 'Aufgabe' || time || reminder || byDate)) return { status: 'missing_task_day' };
  if (date && date < today(reference)) return { status: 'past_task' };
  return { status: 'ready', fields: { title: title[0].toLocaleUpperCase('de-CH') + title.slice(1), kind, date, time,
    reminderDays: date ? '0' : '', status: 'Offen' } };
}
