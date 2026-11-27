import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAppointment, interpretAppointment, markCalendarSpacing } from '../src/calendar-assistant.js';
import { calendarEntries, monthBefore, reminderDue } from '../src/model.js';
import { displayedAgenda } from '../src/connected-model.js';
import { authorizationUrl, driveOriginal, listDriveFiles } from '../supabase/functions/lifecase-connect/providers.js';

const reference = new Date('2026-11-27T23:25:00Z');

test('the chat uses Swiss dates and saves an explicit appointment draft', () => {
  assert.deepEqual(interpretAppointment('hab morgen um 15:30 arzttermin', null, reference), {
    status: 'ready', draft: { date: '2026-11-29', time: '15:30', endTime: '', title: 'Arzttermin' },
  });
  assert.equal(interpretAppointment('hab morgen oder Montag um 15:30 Arzttermin', null, reference).status, 'ambiguous');
  assert.equal(interpretAppointment('ich habe keinen Arzttermin morgen um 15:30', null, reference).status, 'unsupported');
});

test('the chat asks for missing information and preserves the appointment name on replies', () => {
  const first = interpretAppointment('Arzttermin morgen', null, reference);
  assert.equal(first.status, 'missing_time');
  const second = interpretAppointment('um 15:45', first.draft, reference);
  assert.deepEqual(second.draft, { title:'Arzttermin', date:'2026-11-29', time:'15:45', endTime:'' });
  assert.equal(second.status, 'ready');
  const other = interpretAppointment('am Montag morgen um 08:00 Arzttermin', null, reference);
  assert.equal(other.draft.date, '2026-11-30');
});

test('calendar spacing distinguishes a short gap, a shared start and an overlap', () => {
  const date = '2026-11-28';
  const item = (time, endTime, opts={}) => ({ date, time, endTime, state:'Offen', kind:'Termin', ...opts });
  const marked = markCalendarSpacing([item('09:00','10:00'),item('10:10','10:30'),item('13:00','14:00'),
    item('13:50',''),item('15:00',''),item('15:26',''),item('20:00',''),item('20:00',''),item('09:20','',{state:'Abgesagt'})]);
  assert.deepEqual(marked.map(row => row.spacing), ['Knapp','Knapp','Überschneidung','Überschneidung','Knapp','Knapp','Überschneidung','Überschneidung','']);
  assert.equal(markCalendarSpacing([item('23:10','00:15',{endDate:'2026-11-29'}), item('00:04','',{date:'2026-11-29'})])[1].spacing, 'Überschneidung');
});

test('external calendar end times participate in chat duplicate and spacing checks', () => {
  const date = '2026-11-28';
  const record = { id:'a', section:'Kalender', fields:{ title:'Arzt', date, time:'10:10', kind:'Termin', status:'Offen' } };
  const agenda = displayedAgenda([record], [{ id:'b', provider:'google', title:'Besprechung', date, time:'09:00', endTime:'10:00', timeEndDate:date }]);
  assert.deepEqual(agenda.map(row => row.spacing), ['Knapp','Knapp']);
  assert.equal(duplicateAppointment(agenda, { date, time:'10:10', title:'arzt' })?.row.id, 'a');
});

test('one-calendar-month expiry handles leap years and opt-out', () => {
  assert.equal(monthBefore('2028-03-31'), '2028-02-29');
  assert.equal(monthBefore('2026-03-31'), '2026-02-28');
  assert.equal(monthBefore('2027-01-31'), '2026-12-31');
  const entries = calendarEntries([{ id:'a', section:'Rezepte', fields:{validUntil:'2026-03-31'} },
    { id:'b', section:'Arztzeugnisse', fields:{ 'Gültig bis':'2026-03-31', expiryReminder:'off' } }]);
  assert.equal(reminderDue(entries[0], '2026-02-27'), false);
  assert.equal(reminderDue(entries[0], '2026-02-28'), true);
  assert.equal(entries[0].reminderDays,'31');
  assert.equal(reminderDue(entries[1], '2026-02-28'), false);
});

test('Drive asks only for its read scope, searches safely and downloads an original', async t => {
  const authorization = new URL(authorizationUrl('drive', {client_id:'qa'}, 'https://example.invalid/callback','state','challenge'));
  assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.readonly');
  const mock = t.mock.method(global, 'fetch', async input => {
    const url = new URL(input);
    if (url.searchParams.get('alt') === 'media') return new Response('test');
    if (url.pathname.endsWith('/files')) return Response.json({ files:[{id:'f',name:'Scan.pdf',mimeType:'application/pdf',size:'4'}] });
    return Response.json({id:'f',mimeType:'application/pdf',size:'4'});
  });
  const list = await listDriveFiles('token','root',"Test's",'');
  assert.equal(list.rows[0].name,'Scan.pdf');
  assert.match(new URL(mock.mock.calls[0].arguments[0]).searchParams.get('q'), /Test\\'s/);
  assert.equal(new TextDecoder().decode(await driveOriginal('token','f')),'test');
});

test('the appointment chat separates a spoken title, place and duration across messages', () => {
  const now = new Date('2026-11-27T18:00:00Z');
  const first = interpretAppointment('Am Montag, 30.11., einen Arzttermin bei Dr. Muster im Praxiszentrum, Teststrasse 1, Aarau um 14:30', null, now);
  assert.deepEqual(first, { status:'ready', draft:{date:'2026-11-30', time:'14:30', endTime:'', title:'Arzttermin bei Dr. Muster',
    location:'Praxiszentrum, Teststrasse 1, Aarau'} });
  const follow = 'danach habe ich am selben tag um 16:00 psychologin bei Beispielklinik, geht eine stunde';
  const same = interpretAppointment(follow, null, now, first.draft.date);
  assert.deepEqual(same, {status:'ready', draft:{date:'2026-11-30', time:'16:00', endTime:'17:00', title:'Termin bei der Psychologin', location:'Beispielklinik'} });
  const pending = interpretAppointment(follow, null, now);
  assert.equal(pending.status, 'missing_day');
  assert.deepEqual(interpretAppointment('ich hab ja gesagt am selben tag, nächster montag', pending.draft, now).draft, same.draft);
  const third = interpretAppointment('und ebenso am montag ist dann noch mein Bezugspersonengespräch mit Lea bei mir zuhause, Beispielstrasse 9, 5000 Aarau um 17:30', null, now);
  assert.equal(third.draft.title, 'Bezugspersonengespräch mit Lea');
  assert.equal(third.draft.location, 'Bei mir zu Hause, Beispielstrasse 9, 5000 Aarau');
  assert.equal(interpretAppointment('Montag, 01.12., 14:30 Kontrolltermin', null, now).status, 'ambiguous');
  assert.equal(interpretAppointment('Montag um 16:00 Kontrolltermin, dauert 1.5 Stunden', null, now).draft.endTime, '17:30');
});

test('legacy chat fragments show safe short titles and never infer a missing subject', async () => {
  const { calendarRecordTitle, legacyChatAppointment } = await import('../src/calendar-assistant.js');
  const row = { id:'qa', section:'Kalender', fields:{kind:'Termin', date:'2026-11-30', intakeSource:'Terminassistent',
    title:'Und ebenso ist dann noch mein Gespräch mit Lea bei mir zuhause, Beispielstrasse 9, Aarau'} };
  assert.equal(calendarRecordTitle(row), 'Gespräch mit Lea');
  assert.match(legacyChatAppointment(row).location, /Beispielstrasse 9/);
  const incomplete = { ...row, fields:{ ...row.fields, title:'Ja gesagt am selben tag, nächster' } };
  assert.equal(calendarRecordTitle(incomplete), 'Termin · Titel prüfen');
  assert.equal(legacyChatAppointment(incomplete).title, '');
});
