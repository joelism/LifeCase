import { readDates, readTimeRanges } from '../supabase/functions/lifecase-connect/appointment-intake.js';
import { nameOf, sectionOf, shiftDate, today, value } from './model.js';

const week = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const relativePattern = /\b(?:heute|morgen|[üu]bermorgen)\b/giu;
const weekdayPattern = /\b(?:am\s+)?(?:(?:nächste[nr]?|kommende[nr]?|diese[nr]?)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/giu;
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
  const relative = [...text.matchAll(relativePattern)].filter(match => {
    // "Montag morgen" describes the time of day, not an extra date.
    return match[0].toLowerCase() !== 'morgen' || !week.some(name => text.slice(0, match.index).trimEnd().toLowerCase().endsWith(name));
  });
  const relativeDays = relative.map(match => {
    const word = match[0].toLocaleLowerCase('de-CH');
    return { date: shiftDate(day, word === 'heute' ? 0 : word === 'morgen' ? 1 : 2), index: match.index, length: match[0].length };
  });
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  const weekdays = [...text.matchAll(weekdayPattern)].map(match => {
    const weekday = week.indexOf(match[1].toLocaleLowerCase('de-CH'));
    const ahead = (weekday - dow + 7) % 7;
    return { date: shiftDate(day, ahead || (/^(?:am\s+)?(?:nächste[nr]?|kommende[nr]?)\b/i.test(match[0]) ? 7 : 0)), index: match.index, length: match[0].length, weekday };
  });
  // In "Montag, 30.11." the weekday describes the written date.
  if (explicit.length) return [...explicit, ...weekdays.map(item => {
    const match = explicit.find(date => new Date(date.date + 'T12:00:00Z').getUTCDay() === item.weekday);
    return match ? { ...item, date: match.date } : item;
  }), ...relativeDays];
  return [...relativeDays, ...weekdays];
}
function hideSpans(text, spans) {
  let copy = text;
  for (const part of [...spans].sort((a, b) => b.index - a.index)) {
    copy = copy.slice(0, part.index) + ' '.repeat(part.length) + copy.slice(part.index + part.length);
  }
  return copy;
}
function readClocks(text) {
  const ranges = readTimeRanges(text).map(range => ({ ...range, length: range.evidence.replace(/^\D+/, '').length }));
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

const sameDay = /\b(?:am\s+)?(?:(?:selben|gleichen)\s+(?:tag|datum)|dann\s+auch\s+noch)\b/giu;
const durationPattern = /\b(?:(?:das\s+)?(?:dauert|geht)\s+|für\s+)?(anderthalb|halbe[nr]?|eine?n?|\d+(?:[,.]\d+)?)\s*(stunden?|std\.?|h\b|minuten?|min\.?)\b/giu;
const filler = /^(?:(?:und|auch|ebenso|danach|anschliessend|also|ich|hab(?:e)?|hatte|ist|sind|dann|noch|ja|gesagt|bereits|bitte|mein(?:e[nm]?)?|einen|eine|ein|[dD]en|der|die|das|am|um|vom)\b[\s,.:;–-]*)+/iu;
const placeMarker = /(?:[\s,;]+|^)(?:(?:ort|adresse|treffpunkt)\s*:\s*|(?:im|in der|in den|in|bei(?!\s+(?:dr|prof|med)\.))\s+)(?=[\p{L}\d])/iu;
const cap = text => text ? text[0].toLocaleUpperCase('de-CH') + text.slice(1) : '';
const trimSentence = text => text.replace(/^[\s.,;:–-]+|[\s.,;:–-]+$/g, '').replace(/\s+/g, ' ');

function splitAppointmentText(text) {
  const cleaned = trimSentence(text.replace(/\b(?:in (?:meinen|den) kalender|eintragen|einplanen)\b/gi, '')
    .replace(/\s+ein[.!]?$/i, '')).replace(filler, '');
  const mark = placeMarker.exec(cleaned);
  const subject = trimSentence(mark ? cleaned.slice(0, mark.index) : cleaned).replace(/\b(?:am|um|den)\s*$/i, '').trim();
  const title = /^psychologin$/i.test(subject) ? 'Termin bei der Psychologin' : cap(subject);
  const location = mark ? trimSentence(cleaned.slice(mark.index + mark[0].length))
    .replace(/^mir (?:zu ?hause)/i, 'Bei mir zu Hause') : '';
  return { title: title.slice(0, 160), location: location.slice(0, 250) };
}

function readDurations(text) {
  return [...text.matchAll(durationPattern)].filter(match => !/(?:\b(?:um|gegen|ab|at)\s+|:)$/i.test(text.slice(0, match.index))).map(match => {
    const amount = match[1].toLowerCase();
    const number = amount === 'anderthalb' ? 1.5 : amount.startsWith('halb') ? .5 :
      amount.startsWith('ein') ? 1 : Number(amount.replace(',', '.'));
    return { index: match.index, length: match[0].length, minutes: number * (/^(?:st|h)/i.test(match[2]) ? 60 : 1) };
  });
}

export function interpretAppointment(input, draft = null, reference = new Date(), lastDate = '') {
  const text = String(input ?? '').trim();
  if (!text || blocked.test(text)) return { status: 'unsupported', draft };
  const durations = readDurations(text);
  const withoutDuration = hideSpans(text, durations);
  const days = readDays(withoutDuration, reference);
  const distinctDays = [...new Set(days.map(item => item.date))];
  const relative = [...text.matchAll(sameDay)].map(match => ({ index: match.index, length: match[0].length }));
  const withoutDates = hideSpans(withoutDuration, [...days, ...relative]);
  const clocks = readClocks(withoutDates);
  const extracted = splitAppointmentText(hideSpans(withoutDates, clocks));
  const next = {
    date: distinctDays[0] || draft?.date || (relative.length ? lastDate : ''),
    time: clocks[0]?.time || draft?.time || '',
    endTime: clocks.length ? clocks[0].endTime || '' : draft?.endTime || '',
    title: draft?.title || extracted.title,
  };
  const location = extracted.location || draft?.location;
  if (location) next.location = location;
  if (durations[0] || draft?.duration !== undefined) next.duration = durations[0]?.minutes ?? draft.duration;
  if (!draft && !plausibleIntent.test(text) && !distinctDays.length && !clocks.length && !relative.length) return { status: 'unsupported', draft };
  if (distinctDays.length > 1 || clocks.length > 1 || durations.length > 1 || /\b(?:oder|alternativ|entweder)\b/i.test(text)) {
    if (distinctDays.length > 1) next.date = '';
    if (clocks.length > 1) { next.time = ''; next.endTime = ''; }
    if (durations.length > 1) delete next.duration;
    return { status: 'ambiguous', draft: next };
  }
  if (!next.title) return { status: 'missing_title', draft: next };
  if (!next.date) return { status: 'missing_day', draft: next };
  if (!next.time) return { status: 'missing_time', draft: next };
  if (next.date < today(reference) || (next.date === today(reference) && next.time < localMinute(reference))) {
    return { status: 'past', draft: { ...next, date: '' } };
  }
  if (next.duration !== undefined) {
    const end = minuteOf(next.time) + next.duration;
    const endTime = pad(Math.floor((end % 1440) / 60)) + ':' + pad(end % 60);
    if (!Number.isInteger(next.duration) || next.duration <= 0 || next.duration >= 1440 ||
        (next.endTime && next.endTime !== endTime)) {
      delete next.duration;
      return { status: 'ambiguous', draft: { ...next, endTime: '' } };
    }
    next.endTime = endTime;
    if (end >= 1440) next.endDate = shiftDate(next.date, 1);
    delete next.duration;
  } else if (next.endTime && next.endTime <= next.time) {
    return { status: 'ambiguous', draft: { ...next, endTime: '' } };
  }
  return { status: 'ready', draft: next };
}

export function legacyChatAppointment(row) {
  if (sectionOf(row) !== 'Kalender' || value(row, 'kind') !== 'Termin' ||
      row.fields.intakeSource !== 'Terminassistent' || row.fields.chatVersion) return null;
  const original = nameOf(row);
  if (/^(?:(?:ich hab(?:e)? )?ja gesagt|am selben tag|am gleichen tag|nächster)\b/i.test(original)) {
    return { original, title: '', location: value(row, 'location') };
  }
  const withoutDays = hideSpans(original, readDays(original, new Date((value(row, 'date') || today()) + 'T10:00:00Z')));
  const extracted = splitAppointmentText(hideSpans(withoutDays, readDurations(withoutDays)));
  return extracted.title && (extracted.title !== original || extracted.location) ?
    { original, title: extracted.title, location: value(row, 'location') || extracted.location } : null;
}

export function calendarRecordTitle(row) {
  const legacy = legacyChatAppointment(row);
  return legacy ? legacy.title || 'Termin · Titel prüfen' : nameOf(row);
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
    germanFold(entry.external?.title ?? (entry.row ? calendarRecordTitle(entry.row) : '')) === germanFold(draft.title));
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
  const dates = [...new Set(days.map(item => item.date))];
  const remainder = hideSpans(words, days);
  const times = readClocks(remainder);
  const title = asTitle(hideSpans(remainder, times))
    .replace(/^(?:bis|spätestens|daran|bitte)\b\s*/i, '').replace(/\b(?:bis|spätestens)\s*$/i, '').trim();
  if (dates.length > 1 || times.length > 1 || (days.length && /\boder\b/i.test(words))) {
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
