import assert from 'node:assert/strict';
import test from 'node:test';
import { isSleepPlanningTime, planSleep, sleepDefaults, sleepHistory, sleepPreferences, sleepProfileUpdate, validSleepPlan } from '../src/sleep-plan.js';
import { renderSleepPlan, sleepSettingsFields } from '../src/sleep-views.js';

const evening = new Date('2026-11-28T18:00:00Z');
const scheduled = (date, time, patch = {}) => ({ date, time, kind: 'Termin', state: 'Offen', ...patch });
const early = scheduled('2026-11-29', '07:15');

test('the earliest real obligation can move bedtime earlier but later events leave the preferred wake time', () => {
  const result = planSleep([
    scheduled('2026-11-29', '04:00', { kind: 'Frist' }),
    scheduled('2026-11-29', '05:00', { state: 'Abgesagt' }),
    scheduled('2026-11-29', '06:00', { external: { busy: false } }),
    early,
  ], sleepDefaults, evening);
  assert.equal(result.bedTime, '22:15');
  assert.equal(result.wakeTime, '06:15');
  assert.equal(result.first.time, '07:15');
  assert.equal(planSleep([scheduled('2026-11-29', '10:00')], sleepDefaults, evening).bedTime, '23:00');
});

test('after midnight the plan uses the coming morning and flags events that overlap the suggested hours', () => {
  const overnight = scheduled('2026-11-28', '22:00', { kind: 'Schicht', endDate:'2026-11-29', endTime:'02:00' });
  assert.equal(planSleep([overnight, early], sleepDefaults, evening).conflict.kind, 'Schicht');
  const afterMidnight = new Date('2026-11-28T23:30:00Z');
  const result = planSleep([early], sleepDefaults, afterMidnight);
  assert.equal(result.morning, '2026-11-29');
  assert.equal(result.minutesLeft, 345);
  assert.equal(isSleepPlanningTime(afterMidnight), true);
  assert.equal(isSleepPlanningTime(new Date('2026-11-29T10:00:00Z')), false);
});

test('the Swiss daylight saving change preserves the configured elapsed sleep duration', () => {
  const spring = planSleep([], { ...sleepDefaults, wake:'06:00' }, new Date('2027-03-27T18:00:00Z'));
  assert.equal(spring.bedTime, '21:00');
  assert.equal(spring.wakeTime, '06:00');
  const fall = planSleep([], { ...sleepDefaults, wake:'06:00' }, new Date('2027-10-30T18:00:00Z'));
  assert.equal(fall.bedTime, '23:00');
});

test('recent sleep uses one value per day and preserves the user-configured preference', () => {
  const sleep = (day, value, source = 'export') => ({ day, value, source, metric: 'sleep' });
  const rows = [sleep('2026-11-28', 6), sleep('2026-11-28', 8, 'healthkit'), sleep('2026-11-27', 7),
    sleep('2026-11-20', 20), { ...sleep('2026-11-26', 24), metric: 'weight' }];
  assert.deepEqual(sleepHistory(rows, evening), { count: 2, average: 450 });
  assert.match(renderSleepPlan([early], rows, sleepDefaults, { now: evening, overview: true }), /22:15 Uhr/);
  assert.match(renderSleepPlan([early], rows, sleepDefaults, { now: evening }), /7 h 30 min aus 2 Tagen mit Schlafdaten/);
  assert.match(renderSleepPlan([early], rows, sleepDefaults, { now: evening }), /30 min unter deinem Ziel/);
  const preferences = { enabled: false, wake:'06:45', goal:450, lead:30 };
  assert.equal(validSleepPlan({...preferences, lead:-5}), false);
  assert.deepEqual(sleepPreferences({ user_metadata: sleepProfileUpdate(preferences) }), preferences);
  assert.equal(renderSleepPlan([early], rows, preferences, { now: evening }), '');
  assert.match(sleepSettingsFields(preferences), /type="time" name="wake" value="06:45"/);
});
