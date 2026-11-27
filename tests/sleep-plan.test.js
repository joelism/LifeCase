import assert from 'node:assert/strict';
import test from 'node:test';
import { isSleepPlanningTime, planSleep, readSleepReply, sleepDefaults, sleepHistory, sleepMorning, sleepMorningCanBeSaved, sleepMorningDate, sleepMorningUpdate, sleepPreferences, sleepProfileUpdate, validSleepPlan } from '../src/sleep-plan.js';
import { renderSleepPlan, sleepQuestion, sleepSettingsFields } from '../src/sleep-views.js';

const evening = new Date('2026-11-28T18:00:00Z');
const scheduled = (date, time, patch = {}) => ({ date, time, kind: 'Termin', state: 'Offen', ...patch });
const early = scheduled('2026-11-29', '07:15');
const answer = (wake, now = evening) => ({ date: sleepMorningDate(now), wake });
const view = (entries, sleepRows, reply, now = evening) => renderSleepPlan({ plan: planSleep(entries, sleepDefaults, now, reply), settings: sleepDefaults, now }, sleepRows);

test('an early appointment offers a suggestion that only becomes a plan when confirmed', () => {
  const result = planSleep([
    scheduled('2026-11-29', '04:00', { kind: 'Frist' }),
    scheduled('2026-11-29', '05:00', { state: 'Abgesagt' }),
    scheduled('2026-11-29', '06:00', { external: { busy: false } }),
    early,
  ], sleepDefaults, evening);
  assert.equal(result.status, 'question');
  assert.equal(result.suggestedWake, '06:15');
  assert.equal(result.first.time, '07:15');
  const confirmed = planSleep([early], sleepDefaults, evening, answer(result.suggestedWake));
  assert.equal(confirmed.bedTime, '23:00');
  assert.equal(confirmed.wakeTime, '06:15');
  assert.equal(confirmed.plannedMinutes, 435);
  assert.equal(planSleep([early], sleepDefaults, evening, answer('07:00')).shortBuffer, true);
  assert.equal(planSleep([scheduled('2026-11-29', '14:30')], sleepDefaults, evening).suggestedWake, '');
});

test('an empty calendar prompts in chat instead of assuming 07:00 and a free morning stays flexible', () => {
  const open = view([], [], null);
  assert.match(open, /Wann möchtest du aufstehen\?/);
  assert.match(open, /data-assistant-sleep="2026-11-29"/);
  assert.doesNotMatch(open, /07:00|Bis zum Aufstehen bleiben/);
  const flexible = view([], [], answer(''));
  assert.match(flexible, /Keine feste Aufstehzeit/);
  assert.match(flexible, /23:00–02:00/);
  assert.doesNotMatch(flexible, /07:00|Bis zum Aufstehen bleiben/);
  assert.equal(planSleep([], { ...sleepDefaults, wake: '07:00' }, evening).status, 'question');
});

test('the latest bedtime can fall on the next date within the same overnight window', () => {
  const plan = planSleep([], sleepDefaults, evening, answer('11:00'));
  assert.equal(plan.bedTime, '02:00');
  assert.equal(plan.bedDay, '2026-11-29');
  assert.equal(plan.plannedMinutes, 540);
  const impossible = scheduled('2026-11-29', '00:00', { kind: 'Schicht' });
  const settings = { ...sleepDefaults, earliestBed: '01:00' };
  const card = renderSleepPlan({ plan: planSleep([impossible], settings, evening, answer('00:00')), settings, now: evening }, []);
  assert.match(card, /Kein Schlafzeitfenster vor dem Aufstehen/);
  assert.doesNotMatch(card, /Schlafenszeit 01:00/);
});

test('after midnight the plan uses the coming morning and flags events that overlap the suggested hours', () => {
  const overnight = scheduled('2026-11-28', '22:00', { kind: 'Schicht', endDate:'2026-11-29', endTime:'02:00' });
  assert.equal(planSleep([overnight, early], sleepDefaults, evening, answer('06:15')).conflict.kind, 'Schicht');
  const afterMidnight = new Date('2026-11-28T23:30:00Z');
  const result = planSleep([early], sleepDefaults, afterMidnight, answer('06:15'));
  assert.equal(result.morning, '2026-11-29');
  assert.equal(result.minutesLeft, 345);
  assert.match(view([early], [], answer('06:15'), afterMidnight), /Bis zum Aufstehen bleiben 5 h 45 min/);
  assert.match(sleepQuestion(planSleep([], sleepDefaults, afterMidnight), 'Joel'), /29\.11\.2026/);
  const user = { user_metadata: sleepMorningUpdate(answer('')) };
  assert.deepEqual(sleepMorning(user, afterMidnight), answer(''));
  assert.equal(sleepMorning(user, new Date('2026-11-29T18:00:00Z')), null);
  assert.equal(isSleepPlanningTime(afterMidnight), true);
  assert.equal(isSleepPlanningTime(new Date('2026-11-29T10:00:00Z')), false);
});

test('the Swiss daylight saving change preserves the configured elapsed sleep duration', () => {
  const settings = { ...sleepDefaults, earliestBed: '20:00' };
  const springNight = new Date('2027-03-27T18:00:00Z');
  const fallNight = new Date('2027-10-30T18:00:00Z');
  const spring = planSleep([], settings, springNight, answer('06:00', springNight));
  assert.equal(spring.bedTime, '21:00');
  assert.equal(spring.wakeTime, '06:00');
  const fall = planSleep([], settings, fallNight, answer('06:00', fallNight));
  assert.equal(fall.bedTime, '23:00');
  assert.equal(spring.plannedMinutes, 480);
  assert.equal(fall.plannedMinutes, 480);
});

test('recent sleep uses one value per day and preserves the user-configured preference', () => {
  const sleep = (day, value, source = 'export') => ({ day, value, source, metric: 'sleep' });
  const rows = [sleep('2026-11-28', 6), sleep('2026-11-28', 8, 'healthkit'), sleep('2026-11-27', 7),
    sleep('2026-11-20', 20), { ...sleep('2026-11-26', 24), metric: 'weight' }];
  assert.deepEqual(sleepHistory(rows, evening), { count: 2, average: 450 });
  const card = view([early], rows, answer('06:15'));
  assert.match(card, /Schlafenszeit 23:00 Uhr/);
  assert.match(card, /7 h 15 min möglich, 45 min weniger als dein Schlafziel/);
  assert.match(card, /7 h 30 min aus 2 Tagen mit Schlafdaten/);
  assert.match(card, /30 min unter deinem Ziel/);
  const preferences = { enabled: false, wake:'06:45', goal:450, lead:30 };
  const migrated = sleepPreferences({ user_metadata: sleepProfileUpdate(preferences) });
  assert.equal(validSleepPlan({ ...migrated, latestBed: '25:00' }), false);
  assert.deepEqual(migrated, { ...sleepDefaults, ...preferences });
  const custom = { ...migrated, earliestBed: '23:30', latestBed: '01:45' };
  assert.deepEqual(sleepPreferences({ user_metadata: sleepProfileUpdate(custom) }), custom);
  assert.match(sleepSettingsFields(custom), /type="time" name="wake" value="06:45"/);
  assert.match(sleepSettingsFields(custom), /type="time" name="latestBed" value="01:45"/);
});

test('the chat accepts clear times or free mornings without consuming other assistant requests', () => {
  for (const reply of ['Ich habe morgen frei.', 'hab morgen frei', 'Keine feste Zeit', 'morgen schlafe ich aus', 'ich schlafe morgen aus']) {
    assert.deepEqual(readSleepReply(reply, answer('').date, evening), answer(''), reply);
  }
  for (const reply of ['9:30', 'Um 9.30 Uhr', 'Ich stehe morgen um 9:30 auf']) {
    assert.deepEqual(readSleepReply(reply, answer('').date, evening), answer('09:30'), reply);
  }
  for (const reply of ['Wann habe ich morgen frei?', 'Arzttermin morgen um 9:30', 'Ich bin bis 9:30 frei', '25:00', '9:00 oder 10:00']) {
    assert.equal(readSleepReply(reply, answer('').date, evening), null, reply);
  }
});

test('explicit messages work at any hour with no open sleep question; standalone times stay ambiguous', () => {
  const afternoon = new Date('2026-11-28T13:00:00Z');
  for (const reply of ['Ich kann morgen ausschlafen', 'Morgen habe ich frei und kann ausschlafen', 'Hab morgen frei']) {
    assert.deepEqual(readSleepReply(reply, '', afternoon), answer(''), reply);
  }
  for (const reply of ['Morgen stehe ich erst um 9:30 auf', 'Ich muss morgen um 9:30 aufstehen', 'Ich stehe um 9:30 auf']) {
    assert.deepEqual(readSleepReply(reply, '', afternoon), answer('09:30'), reply);
  }
  for (const reply of ['morgen um 9:30', '9:30', 'morgen um 9:30 arbeiten', 'morgen frei?']) {
    assert.equal(readSleepReply(reply, '', afternoon), null, reply);
  }
});

test('midnight keeps an explicitly different day separate from the open sleep question', () => {
  const afterMidnight = new Date('2026-11-28T23:30:00Z');
  const morning = answer('09:30');
  const nextDay = { date: '2026-11-30', wake: '' };
  assert.deepEqual(readSleepReply('Morgen kann ich ausschlafen', morning.date, afterMidnight), nextDay);
  assert.deepEqual(readSleepReply('heute Morgen stehe ich um 9:30 auf', '', afterMidnight), morning);
  const user = { user_metadata: { ...sleepMorningUpdate(morning), ...sleepMorningUpdate(nextDay) } };
  assert.deepEqual(sleepMorning(user, afterMidnight), morning);
  assert.deepEqual(sleepMorning(user, new Date('2026-11-29T18:00:00Z')), nextDay);
  assert.deepEqual(sleepMorning({ user_metadata: { lifecase_sleep_morning: morning } }, afterMidnight), morning);
  assert.equal(sleepMorningCanBeSaved(nextDay, afterMidnight), true);
  assert.equal(sleepMorningCanBeSaved({ ...morning, wake: '00:15' }, afterMidnight), false);
});

test('the screenshot message still saves the requested weekday during a temporary AI outage', () => {
  const current = new Date('2026-11-27T23:52:00Z');
  const answer = readSleepReply('am sonntag kann ich auch ausschlafen, dass du das weisst', '2026-11-28', current);
  assert.deepEqual(answer, { date: '2026-11-29', wake: '' });
  assert.equal(sleepMorningCanBeSaved(answer, current), true);
  assert.equal(sleepMorningCanBeSaved({ date: '2026-11-31', wake: '' }, current), false);
  assert.equal(sleepMorningCanBeSaved({ date: '2027-01-10', wake: '' }, current), false);
});
