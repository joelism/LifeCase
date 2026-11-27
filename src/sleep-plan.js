import { preferredHealthDays } from './health-data.js';
import { CH_ZONE, shiftDate, today } from './model.js';

const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const scheduledKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Schicht']);
const planKey = 'lifecase_sleep_plan';
const morningKey = 'lifecase_sleep_morning';
const datedMorningKey = day => morningKey + '_' + day;
const validTime = value => typeof value === 'string' && timePattern.test(value);
const weekdays = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const sleepDayWords = /\b(?:(?:am )?(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|heute(?: morgen)?|morgen)\b/g;
export const sleepDefaults = Object.freeze({ enabled: true, wake: '', goal: 480, lead: 60,
  earliestBed: '23:00', latestBed: '02:00' });

export function validSleepPlan(plan) {
  return typeof plan?.enabled === 'boolean' && (plan.wake === '' || validTime(plan.wake)) &&
    validTime(plan.earliestBed) && validTime(plan.latestBed) &&
    Number.isInteger(plan.goal) && plan.goal >= 360 && plan.goal <= 720 && plan.goal % 15 === 0 &&
    Number.isInteger(plan.lead) && plan.lead >= 0 && plan.lead <= 240;
}

export function sleepPreferences(user) {
  const plan = { ...sleepDefaults, ...user?.user_metadata?.[planKey] };
  return validSleepPlan(plan) ? plan : sleepDefaults;
}

export const sleepProfileUpdate = plan => ({ [planKey]: plan });

export function sleepMorningDate(now = new Date()) {
  const day = today(now);
  return clock.format(now) < '04:00' ? day : shiftDate(day, 1);
}

export function sleepMorning(user, now = new Date()) {
  const day = sleepMorningDate(now);
  const metadata = user?.user_metadata;
  const answer = metadata?.[datedMorningKey(day)] ?? metadata?.[morningKey];
  return answer?.date === day && (answer.wake === '' || validTime(answer.wake)) ? answer : null;
}

export function sleepMorningUpdate(answer, user, now = new Date()) {
  const day = today(now);
  const metadata = Object.keys(user?.user_metadata ?? {});
  const past = metadata.filter(key => /^lifecase_sleep_morning_\d{4}-\d{2}-\d{2}$/.test(key) && key < datedMorningKey(day));
  return { ...Object.fromEntries(past.map(key => [key, null])), [datedMorningKey(answer.date)]: answer };
}

export function readSleepReply(text, questionDay = '', now = new Date()) {
  const reply = text.toLocaleLowerCase('de-CH').trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
    .replace(/^doch /, '').replace(/, (?:dass du das weisst|nur damit du es weisst)$/, '');
  const days = reply.match(sleepDayWords) ?? [];
  if (days.length > 1) return null;
  const day = days[0];
  const current = today(now);
  const upcoming = sleepMorningDate(now);
  let date = questionDay || upcoming;
  if (day === 'morgen') date = shiftDate(current, 1);
  else if (day?.startsWith('heute')) date = current;
  else if (day) {
    const weekday = weekdays.indexOf(day.replace(/^am /, ''));
    const anchor = new Date(upcoming + 'T12:00:00Z').getUTCDay();
    date = shiftDate(upcoming, (weekday + 7 - anchor) % 7);
  }
  const words = day ? reply.replace(day, '').replace(/\s+/g, ' ').trim() : reply;
  const time = words.match(/^(?:(?:(?:ich )?stehe?|stehe? ich|(?:ich )?(?:möchte|muss|will)|(?:möchte|muss|will) ich) )?(?:(?:erst|schon) )?(?:um )?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?: uhr)?(?: (auf|aufstehen))?$/);
  if (time && (questionDay || time[3] || /\bstehe?\b/.test(words))) {
    return { date, wake: time[1].padStart(2, '0') + ':' + (time[2] || '00') };
  }
  const free = /^(?:(?:(?:ich )?hab(?:e)? frei|hab(?:e)? ich frei)(?: und kann ausschlafen)?|frei|keine feste (?:aufsteh)?zeit|ohne wecker)$/;
  const sleepIn = /^(?:ausschlafen|(?:ich )?schlafe? (?:auch )?aus|schlafe? ich (?:auch )?aus|(?:ich )?(?:kann|möchte|will) (?:auch )?ausschlafen|(?:kann|möchte|will) ich (?:auch )?ausschlafen)$/;
  if (sleepIn.test(words) || ((day || questionDay) && free.test(words))) return { date, wake: '' };
  return null;
}

export function isSleepPlanningTime(now = new Date()) {
  const hour = Number(clock.format(now).slice(0, 2));
  return hour >= 18 || hour < 4;
}

function localTime(day, time) {
  const nominal = Date.parse(day + 'T' + time + ':00Z');
  const offsetAt = ms => Date.parse(today(new Date(ms)) + 'T' + clock.format(ms) + ':00Z') - ms;
  // The two offsets cover clocks moving forward or back between bedtime and waking.
  const candidates = [-12, 12].map(hours => nominal - offsetAt(nominal + hours * 3600000));
  const matches = candidates.filter(ms => today(new Date(ms)) === day && clock.format(ms) === time);
  return matches.length ? Math.min(...matches) : Math.max(...candidates);
}

export function sleepMorningCanBeSaved({ date, wake }, now = new Date()) {
  const day = today(now);
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= day && date <= shiftDate(day, 31) && Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date &&
    (wake === '' || (validTime(wake) && localTime(date, wake) > now.getTime()));
}

export function sleepHistory(rows, now = new Date()) {
  const day = today(now);
  const nights = preferredHealthDays(rows, 'sleep', shiftDate(day, -6), day)
    .map(row => Number(row.value)).filter(value => Number.isFinite(value) && value > 0 && value <= 24);
  return nights.length ? { count: nights.length, average: Math.round(nights.reduce((sum, value) => sum + value, 0) / nights.length * 60) } : null;
}

export function planSleep(entries, settings, now = new Date(), answer = null) {
  const morning = sleepMorningDate(now);
  const eveningDay = shiftDate(morning, -1);
  const timed = entries.filter(item => item.state === 'Offen' && scheduledKinds.has(item.kind) &&
    item.external?.busy !== false && validTime(item.time) && item.date >= eveningDay && item.date <= morning)
    .map(item => ({ ...item, startsAt: localTime(item.date, item.time) })).sort((a, b) => a.startsAt - b.startsAt);
  const first = timed.find(item => item.date === morning && item.startsAt > now.getTime());
  const latestWake = first ? first.startsAt - settings.lead * 60000 : null;
  const suggestedWake = first?.time < '12:00' && latestWake > now.getTime() && today(new Date(latestWake)) === morning ? clock.format(latestWake) : '';
  if (answer?.date !== morning || !validTime(answer.wake)) {
    return { status: answer?.date === morning && answer.wake === '' ? 'flexible' : 'question', morning, first, suggestedWake };
  }
  const wake = localTime(morning, answer.wake);
  const windowDay = settings.earliestBed < '12:00' ? morning : eveningDay;
  const lastDay = settings.latestBed < settings.earliestBed ? shiftDate(windowDay, 1) : windowDay;
  const earliest = localTime(windowDay, settings.earliestBed);
  const latest = Math.max(earliest, localTime(lastDay, settings.latestBed));
  const bed = Math.min(Math.max(wake - settings.goal * 60000, earliest), latest);
  const plannedMinutes = Math.max(0, Math.floor((wake - bed) / 60000));
  const conflict = plannedMinutes > 0 ? timed.find(item => item.startsAt < wake &&
    (item.startsAt >= bed || (timePattern.test(item.endTime) && localTime(item.endDate || item.date, item.endTime) > bed))) : null;
  return {
    status: 'scheduled', wakeTime: clock.format(wake),
    bedTime: clock.format(bed), bedDay: today(new Date(bed)),
    first, suggestedWake, shortBuffer: first && wake > latestWake, conflict, plannedMinutes,
    minutesLeft: plannedMinutes > 0 && wake > now.getTime() && bed < now.getTime() ?
      Math.floor((wake - now.getTime()) / 60000) : null,
    alreadyArose: wake <= now.getTime(), morning,
  };
}

export function sleepDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return [hours ? hours + ' h' : '', remaining || !hours ? remaining + ' min' : ''].filter(Boolean).join(' ');
}
