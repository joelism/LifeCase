import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEntries, dateOf, filesFor, nameOf, reminderDue, searchRecords, shiftDate, today } from '../src/model.js';
import { calendarFile } from '../src/calendar-file.js';
import { makePDF } from '../src/pdf.js';

const row = (id, section, fields, archived_at = null) => ({ id, section, fields, archived_at, created_at: '2026-11-25T23:30:00Z' });
const dossier = row('case', 'Fälle', { title: 'Ausbildung', personIds: ['person'], documentIds: ['doc'] });
const chronik = row('log', 'Chronik', { title: 'Rückmeldung', date: '2026-11-28', caseIds: ['case'], notes: 'Abklärung im Gespräch.' });
const doc = row('doc', 'Beweismittel', { title: 'Zeugnis' });
const person = row('person', 'Personen', { Titel: 'Beispielperson' });
const old = row('old', 'Gesundheit', { Titel: 'Archiv', Dateipfad: 'private/original', Dateiname: 'archiv.pdf' }, '2026-11-10T12:00:00Z');
const rows = [dossier, chronik, doc, person, old];
const files = [{ record_id: 'doc', original_name: 'Ärztliche Einschätzung.pdf', uploaded_at: '2026-11-29T11:00:00Z' }];

test('Swiss dates and existing record fields', () => {
  assert.equal(today(new Date('2026-11-25T23:30:00Z')), '2026-11-26');
  assert.equal(dateOf(doc), '2026-11-26');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(nameOf(person), 'Beispielperson');
  assert.equal(filesFor(old, files)[0].original_name, 'archiv.pdf');
});

test('searches record notes and file names and applies linked case, date and archive filters', () => {
  assert.deepEqual(searchRecords(rows, files, 'ruckmeldung abklarung').map(item => item.id), ['log']);
  assert.deepEqual(searchRecords(rows, files, 'arztliche einschatzung', { caseId: 'case' }).map(item => item.id), ['doc']);
  assert.deepEqual(searchRecords(rows, files, '', { personId: 'person' }).map(item => item.id), ['case', 'person']);
  assert.deepEqual(searchRecords(rows, files, '', { from: '2026-11-28' }).map(item => item.id), ['log']);
  assert.deepEqual(searchRecords(rows, files, 'archiv', { archived: true }).map(item => item.id), ['old']);
  assert.deepEqual(searchRecords(rows, files, 'archiv'), []);
});

test('calendar combines appointments, follow-ups, tasks and expiring certificates', () => {
  const entries = calendarEntries([
    row('talk', 'Gespräche', { title: 'Gespräch', status: 'Geplant', date: '2026-11-27', time: '09:00', followUp: '2026-11-30' }),
    row('cert', 'Arztzeugnisse', { title: 'Zeugnis', validUntil: '2026-12-02', reminderDays: '7' }),
    row('todo', 'Kalender', { date: '2026-11-28', kind: 'Aufgabe', status: 'Erledigt', reminderDays: '1' }),
    row('visit', 'Gesundheit', { date: '2026-12-04', kind: 'Arztbesuch', status: 'Geplant' }),
  ]);
  assert.deepEqual(entries.map(item => item.kind), ['Gespräch', 'Aufgabe', 'Wiedervorlage', 'Arztzeugnis', 'Arztbesuch']);
  assert.deepEqual(entries.filter(item => reminderDue(item, '2026-11-27')).map(item => item.kind), ['Arztzeugnis']);
});

test('calendar export contains Swiss time zone, escaped input and reminders', () => {
  const result = calendarFile([{ row: { id: 'a' }, kind: 'Termin', date: '2026-11-27', time: '08:30', endTime: '09:00', reminderDays: '3', title: 'A, B; C' }]);
  assert.match(result, /DTSTART;TZID=Europe\/Zurich:20261127T083000/);
  assert.ok(result.includes('SUMMARY:A\\, B\\; C'));
  assert.match(result, /TRIGGER:-P3D/);
  assert.match(result, /CLASS:PRIVATE/);
  assert.match(result, /END:VCALENDAR\r\n$/);
});

test('selected content generates a multipage PDF', async () => {
  const lengthy = row('long', 'Gespräche', { title: 'Protokoll', notes: ('Längerer Gesprächsverlauf zur Ausbildung. ').repeat(405) });
  const pdf = makePDF('Falldossier', [dossier, lengthy, doc], rows, files, { from: '2026-11-23' }, true);
  const contents = await pdf.text();
  assert.equal(pdf.type, 'application/pdf');
  assert.match(contents, /^%PDF-/);
  assert.match(contents, /\/Count [2-9]/);
});
