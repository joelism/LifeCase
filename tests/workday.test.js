import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEntries } from '../src/model.js';
import { groupWorkdays, shiftWorkdays } from '../src/workday.js';
import { persistsSession } from '../src/session.js';
import { weekPlan } from '../src/planning.js';
import { calendarPage, selectedCalendar } from '../src/views.js';

const day = '2026-12-05';
const shift = (id, time, endTime, fields = {}) => ({ id, section: 'Kalender',
  fields: { title: 'Migros · Schicht', kind: 'Schicht', date: day, time, endTime, ...fields } });

test('matching split shifts produce one day with a midday break and keep both source entries', () => {
  const rows = [shift('pm', '13:00', '18:05'), shift('am', '07:30', '12:00')];
  const entries = calendarEntries(rows);
  const days = groupWorkdays(entries);
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].lunch, { time: '12:00', endTime: '13:00' });
  assert.deepEqual(days[0].shifts.map(item => item.row.id), ['am', 'pm']);
  assert.equal(days[0].endTime, '18:05');
  assert.equal(weekPlan(rows, [], day, day).shiftCount, 1);
  const calendar = { month: '2026-12', selected: day, kind: '', source: '' };
  assert.match(calendarPage(rows, calendar, { events: [], calendarErrors: [] }), /Mittagspause 12:00–13:00/);
  assert.equal(selectedCalendar(rows, calendar).length, 2);
});

test('the afternoon gap is recognised while unrelated and ambiguous gaps remain separate', () => {
  const am = shift('am', '10:30', '13:00', { location: 'Aarau' });
  const pm = shift('pm', '14:00', '19:05', { location: 'Aarau' });
  assert.deepEqual(shiftWorkdays(calendarEntries([am, pm]))[0].lunch, { time: '13:00', endTime: '14:00' });
  assert.equal(shiftWorkdays(calendarEntries([am, shift('x', '14:00', '19:05', { location: 'Olten' })])).length, 0);
  assert.equal(shiftWorkdays(calendarEntries([am, pm, shift('pause', '13:00', '14:00', { kind: 'Pause' })])).length, 0);
  assert.equal(shiftWorkdays(calendarEntries([am, pm, shift('other', '13:20', '13:50', { location: 'Olten' })])).length, 0);
});

test('only the isolated Home Screen app keeps an auth session on the shared GitHub hostname', () => {
  assert.equal(persistsSession('joelism.github.io', true), true);
  assert.equal(persistsSession('joelism.github.io', false), false);
  assert.equal(persistsSession('joelism.github.io', undefined), false);
  assert.equal(persistsSession('lifecase.example.invalid', undefined), true);
});
