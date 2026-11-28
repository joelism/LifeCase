import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAppointments, detectShifts, readDates } from '../supabase/functions/lifecase-connect/appointment-intake.js';
import { incomingMailPage } from '../supabase/functions/lifecase-connect/providers.js';
import { planCandidates } from '../src/scan-layout.js';
import { calendarFile } from '../src/calendar-file.js';
import { shoppingPage } from '../src/daily-views.js';

const reference = new Date('2026-11-27T18:00:00Z');

test('a confirmed Swiss appointment has one explicit time and source evidence', () => {
  const [match] = detectAppointments({ subject: 'Terminbestätigung Sprechstunde',
    body: 'Ihr Termin ist am 30. November 2026 um 08.10 Uhr.\nOrt: Praxis Aarau\n> Am 3.12.2026 um 09:00',
    reference });
  assert.equal(match.date, '2026-11-30');
  assert.equal(match.time, '08:10');
  assert.equal(match.location, 'Praxis Aarau');
  assert.match(match.evidence, /8\.10 Uhr/);
  assert.equal(match.automatic, true);
  assert.equal(readDates('31.11.2026', reference).length, 0);
});

test('cancellations, ambiguous proposals, receipts and signatures are handled conservatively', () => {
  const [canceled] = detectAppointments({ subject: 'Termin abgesagt',
    body: 'Das Gespräch am 30.11.2026 um 14:30 Uhr findet nicht statt.', reference });
  assert.equal(canceled.automatic, false);
  assert.match(canceled.reviewReason, /Absage/);
  const alternatives = detectAppointments({ subject: 'Terminbestätigung',
    body: 'Voraussichtlich am 30.11.2026 um 15 Uhr.\nAlternativ 1.12.2026 um 09 Uhr.', reference });
  assert.equal(alternatives.length, 2);
  assert.ok(alternatives.every(item => !item.automatic));
  assert.deepEqual(detectAppointments({ subject: 'Ihre Onlinebestellung', body: 'Zustellung 30.11.2026 um 15 Uhr.', reference }), []);
});

test('scanning recognises separate date and time lines and overnight shifts', () => {
  const [scan] = detectAppointments({ mode: 'scan', body: 'Nächster Besuch\nDatum: 30.11.26\nUhrzeit: 14:30', reference });
  assert.equal(scan.date, '2026-11-30');
  assert.equal(scan.time, '14:30');
  const shifts = detectShifts('Mo 30.11.2026\n08.10–17.00\nDi 1.12.2026 18:00–02:00', reference);
  assert.deepEqual(shifts.map(row => [row.date, row.time, row.endTime]), [
    ['2026-11-30', '08:10', '17:00'], ['2026-12-01', '18:00', '02:00'],
  ]);
  const exported = calendarFile([{ row: { id: 'shift' }, date: '2026-12-01', endDate: '2026-12-02', time: '18:00', endTime: '02:00', kind: 'Schicht' }]);
  assert.match(exported, /DTEND;TZID=Europe\/Zurich:20261202T020000/);
});

test('team plan assigns only the named row to columns and leaves a free day empty', () => {
  const line = (text, spaced) => ({ text, offsets: spaced.map(([word, x]) => ({ index: text.indexOf(word), x })) });
  const result = { text: '', lines: [
    line('30.11.2026 01.12.2026 02.12.2026', [['30.11', 190], ['01.12', 350], ['02.12', 510]]),
    line('Testperson 07:00-12:00 12:00-17:00', [['Testperson', 10], ['07:00', 192], ['12:00-17', 512]]),
    line('Andere 10:00-19:00', [['Andere', 10], ['10:00', 350]]),
  ] };
  const matches = planCandidates(result, reference, { team: true, employee: 'Testperson' });
  assert.deepEqual(matches.map(row => [row.date, row.time]), [['2026-11-30','07:00'], ['2026-12-02','12:00']]);
  assert.deepEqual(planCandidates(result, reference, { team: true, employee: 'Fehlt' }), []);
});

test('mail polling restricts both providers to inbox and a received time', async t => {
  const fake = t.mock.method(global, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname.includes('googleapis')) return Response.json({ messages: [{ id: 'mail1' }] });
    return Response.json({ value: [{ id: 'mail2', receivedDateTime: '2026-11-27T10:15:00Z' }] });
  });
  assert.deepEqual((await incomingMailPage('google', 'qa', reference, null, 60)).rows, [{ id: 'mail1' }]);
  assert.equal((await incomingMailPage('microsoft', 'qa', reference, null, 60)).rows[0].id, 'mail2');
  const urls = fake.mock.calls.map(call => new URL(call.arguments[0]));
  assert.equal(urls[0].searchParams.get('labelIds'), 'INBOX');
  assert.match(urls[0].searchParams.get('q'), /^after:\d{10}$/);
  assert.match(urls[1].pathname, /mailFolders\/inbox/);
  assert.match(urls[1].searchParams.get('$filter'), /receivedDateTime ge /);
});

test('shopping list exposes quantities, escaped labels, and the open count', () => {
  const html = shoppingPage([{ id: 'a', section: 'Einkaufen', fields: { title: 'Test', items: [
    { id: '1', name: 'Milch', quantity: '2 l', done: false }, { id: '2', name: 'Tomaten < 1 kg', quantity: '', done: true },
  ] } }], { listId: 'a' });
  assert.match(html, /1 offen/);
  assert.match(html, /2 l/);
  assert.match(html, /Tomaten &lt; 1 kg/);
  assert.match(html, /Abgehakt · 1/);
});
