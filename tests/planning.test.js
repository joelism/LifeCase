import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretTask } from '../src/calendar-assistant.js';
import { expandEvents } from '../src/connected-model.js';
import { followUpDefaults, preparationContext, preparationForRow, preparationSource, weekPlan } from '../src/planning.js';
import { searchRecords } from '../src/model.js';

const record = (id, section, fields) => ({ id, section, fields });

test('seven days cross the year boundary and preserve overdue and undated work', () => {
  const rows = [
    record('shift', 'Kalender', { kind: 'Schicht', date: '2027-01-01', time: '08:00' }),
    record('late', 'Kalender', { kind: 'Wiedervorlage', date: '2026-12-26' }),
    record('open', 'Kalender', { kind: 'Aufgabe' }),
    record('closed', 'Kalender', { kind: 'Aufgabe', status: 'Erledigt' }),
    record('cancelled', 'Kalender', { kind: 'Termin', date: '2027-01-01', status: 'Abgesagt' }),
    record('expiry', 'Rezepte', { validUntil: '2027-01-02', expiryReminder: 'off' }),
  ];
  const events = [{ id: 'appointment', provider: 'google', date: '2027-01-02', title: 'Kontrolle' }];
  const result = weekPlan(rows, events, '2026-12-29', '2026-12-29');
  assert.equal(result.end, '2027-01-04');
  assert.equal(result.shiftCount, 1);
  assert.equal(result.appointments, 1);
  assert.deepEqual(result.late.map(item => item.row.id), ['late']);
  assert.deepEqual(result.inbox.map(item => item.id), ['open']);
  assert.deepEqual(result.days.find(day => day.date === '2027-01-02').entries.map(item => item.kind), ['Rezept', 'Termin']);
});

test('appointment preparation keeps its source and picks related documents', () => {
  const dossier = record('case', 'Fälle', { title: 'Dossier' });
  const visit = record('visit', 'Gesundheit', { kind: 'Arztbesuch', title: 'Kontrolle', date: '2026-12-29', caseIds: ['case'] });
  const certificate = record('cert', 'Arztzeugnisse', { caseIds: ['case'] });
  const other = record('other', 'Rezepte', {});
  const source = preparationForRow(visit);
  assert.equal(source.key, 'row|visit');
  assert.deepEqual(preparationContext([dossier, visit, certificate, other], source).documents, [certificate]);
  assert.deepEqual(followUpDefaults(visit).caseIds, ['case']);
  assert.deepEqual(followUpDefaults(visit).relatedIds, ['visit']);
  assert.equal(preparationForRow(record('task', 'Kalender', { kind: 'Aufgabe', date: '2026-12-30' })), null);
  const events = expandEvents([{ provider: 'microsoft', id: 'event', date: '2026-12-29', endDate: '2026-12-30', time: '09:15' }], '2026-12-29', '2026-12-30');
  assert.equal(preparationSource({ kind: 'Termin', external: events[0] }).key, preparationSource({ kind: 'Termin', external: events[1] }).key);
  assert.equal(preparationSource({ kind: 'Termin', external: { ...events[0], lifeCasePause: true } }), null);
  const prep = record('prep', 'Vorbereitung', { items: [{ title: 'Bericht mitnehmen', done: false }] });
  assert.deepEqual(searchRecords([prep], [], 'Bericht'), [prep]);
});

test('task chat distinguishes undated tasks, due dates and uncertain instructions', () => {
  const thursday = new Date('2026-11-26T12:00:00Z');
  assert.deepEqual(interpretTask('Bis Freitag IV anrufen', thursday).fields,
    { title: 'IV anrufen', kind: 'Aufgabe', date: '2026-11-27', time: '', reminderDays: '0', status: 'Offen' });
  assert.deepEqual(interpretTask('Aufgabe: Milch kaufen', thursday).fields,
    { title: 'Milch kaufen', kind: 'Aufgabe', date: '', time: '', reminderDays: '', status: 'Offen' });
  const reminder = interpretTask('Erinnere mich morgen um 15:30, Formular abgeben', thursday);
  assert.equal(reminder.fields.time, '15:30');
  assert.equal(reminder.fields.title, 'Formular abgeben');
  assert.equal(interpretTask('Frist: Formular abgeben', thursday).status, 'missing_task_day');
  assert.equal(interpretTask('Wiedervorlage morgen oder übermorgen Formular abgeben', thursday).status, 'ambiguous');
  assert.equal(interpretTask('Hab morgen um 15:30 einen Arzttermin', thursday), null);
});
