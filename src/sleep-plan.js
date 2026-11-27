import { preferredHealthDays } from './health-data.js';
import { CH_ZONE, shiftDate, today } from './model.js';

const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const scheduledKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Schicht']);
const planKey = 'lifecase_sleep_plan';
export const sleepDefaults = Object.freeze({ enabled: true, wake: '07:00', goal: 480, lead: 60 });

export function validSleepPlan(plan) {
  return typeof plan?.enabled === 'boolean' && typeof plan.wake === 'string' && timePattern.test(plan.wake) &&
    Number.isInteger(plan.goal) && plan.goal >= 360 && plan.goal <= 720 && plan.goal % 15 === 0 &&
    Number.isInteger(plan.lead) && plan.lead >= 0 && plan.lead <= 240;
}

export function sleepPreferences(user) {
  const stored = user?.user_metadata?.[planKey];
  return validSleepPlan(stored) ? stored : sleepDefaults;
}

export const sleepProfileUpdate = plan => ({ [planKey]: plan });

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

export function sleepHistory(rows, now = new Date()) {
  const day = today(now);
  const nights = preferredHealthDays(rows, 'sleep', shiftDate(day, -6), day)
    .map(row => Number(row.value)).filter(value => Number.isFinite(value) && value > 0 && value <= 24);
  return nights.length ? { count: nights.length, average: Math.round(nights.reduce((sum, value) => sum + value, 0) / nights.length * 60) } : null;
}

export function planSleep(entries, settings, now = new Date()) {
  const day = today(now);
  const eveningDay = clock.format(now) < '04:00' ? shiftDate(day, -1) : day;
  const morning = shiftDate(eveningDay, 1);
  const normalWake = localTime(morning, settings.wake);
  const timed = entries.filter(item => item.state === 'Offen' && scheduledKinds.has(item.kind) &&
    item.external?.busy !== false && timePattern.test(item.time) && item.date >= eveningDay && item.date <= morning)
    .map(item => ({ ...item, startsAt: localTime(item.date, item.time) })).sort((a, b) => a.startsAt - b.startsAt);
  const first = timed.find(item => item.date === morning && item.startsAt > now.getTime());
  const earlyWake = first ? first.startsAt - settings.lead * 60000 : Infinity;
  const wake = Math.min(normalWake, earlyWake);
  const bed = wake - settings.goal * 60000;
  const conflict = timed.find(item => item.startsAt < wake &&
    (item.startsAt >= bed || (timePattern.test(item.endTime) && localTime(item.endDate || item.date, item.endTime) > bed)));
  return {
    wakeTime: clock.format(wake), wakeDay: today(new Date(wake)),
    bedTime: clock.format(bed), bedDay: today(new Date(bed)),
    first: earlyWake < normalWake ? first : null, conflict,
    minutesLeft: wake > now.getTime() && bed < now.getTime() ? Math.floor((wake - now.getTime()) / 60000) : null,
    alreadyArose: wake <= now.getTime(), morning,
  };
}

export function sleepDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return [hours ? hours + ' h' : '', remaining || !hours ? remaining + ' min' : ''].filter(Boolean).join(' ');
}
