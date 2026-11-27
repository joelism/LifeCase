import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCheckIns, appointmentQuestion, checkInDue, checkInUpdate, suggestAppointment, validCareSchedule } from '../src/appointment-care.js';
import { checkInPanel } from '../src/views.js';

const record = (id, patch, archived_at = null) => ({
  id, section: 'Kalender', fields: { kind: 'Termin', status: 'Offen', ...patch }, archived_at,
});
const appointment = { title: 'Psychologisches Gespräch', date: '2027-01-01', time: '', appointmentType: 'psychology' };
const address = 'PDAG, Beispielstrasse 12, Aarau';
const previous = record('example', { date: '2026-11-01', title: 'Psychologin bei PDAG', location: address });

test('one compatible prior appointment provides an address proposal without inventing a start time', () => {
  const { fields, sourceDate, confirmsLocation } = suggestAppointment(appointment, [previous]);
  assert.equal(fields.appointmentProvider, 'PDAG');
  assert.equal(fields.location, address);
  assert.equal(fields.time, '');
  assert.equal(sourceDate, '2026-11-01');
  assert.equal(confirmsLocation, true);
  assert.match(appointmentQuestion({ fields, sourceDate, confirmsLocation }, 'Joel'), /^Hey Joel, geht es wieder um ein psychologisches Gespräch bei PDAG/);
});

test('provider shorthand uses the matching appointment type and explicit corrections take precedence', () => {
  const requested = { title: 'PDAG', date: appointment.date, appointmentProvider: 'PDAG' };
  const right = suggestAppointment(requested, [previous]);
  assert.equal(right.fields.appointmentType, 'psychology');
  assert.equal(right.fields.location, address);
  const corrected = suggestAppointment({ ...appointment, location: 'Andere Strasse 4' }, [previous]);
  assert.equal(corrected.fields.location, 'Andere Strasse 4');
  assert.equal(corrected.confirmsLocation, false);
});

test('ambiguous sites and unrelated, cancelled, archived or later appointments supply no address', () => {
  const otherSite = record('second', { ...previous.fields, location: 'PDAG, Andere Strasse 1' });
  assert.equal(suggestAppointment(appointment, [previous, otherSite]).fields.location, '');
  const psychiatry = record('psychiatry', { ...previous.fields, title: 'Psychiatrischer Termin bei PDAG' });
  const cancelled = record('cancelled', { ...previous.fields, status: 'Abgesagt' });
  const archived = record('archived', previous.fields, '2026-11-02');
  const later = record('later', { ...previous.fields, date: '2027-01-02' });
  assert.equal(suggestAppointment(appointment, [psychiatry, cancelled, archived, later]).fields.location, '');
  assert.equal(suggestAppointment({ title: 'PDAG', date: appointment.date }, [previous, psychiatry]).fields.appointmentType, '');
  assert.equal(suggestAppointment({ title: 'Arzttermin', date: appointment.date }, [
    record('doctor', { ...previous.fields, title: 'Arzttermin' }),
  ]).fields.location, '');
});

test('check-ins start when a Swiss appointment ends, support snoozing and stay hidden after completion', () => {
  const row = record('care', { title: 'Arzttermin', date: '2027-01-01', time: '14:00', endTime: '15:00',
    appointmentExpected: 'Arztzeugnis', appointmentCheckIn: 'pending' });
  const justBefore = new Date('2027-01-01T13:59:00Z');
  const end = new Date('2027-01-01T14:00:00Z');
  assert.equal(checkInDue(row, justBefore), false);
  assert.deepEqual(appointmentCheckIns([row], end), [row]);
  const snoozed = { ...row, fields: checkInUpdate(row.fields, 'later', 'Noch offen', end) };
  assert.equal(checkInDue(snoozed, end), false);
  assert.equal(checkInDue(snoozed, new Date('2027-01-01T23:00:00Z')), true);
  assert.match(checkInPanel([row]), /Arztzeugnis/);
  const done = { ...row, fields: checkInUpdate(row.fields, 'done', 'Erhalten', end) };
  assert.equal(done.fields.appointmentReviewNotes, 'Erhalten');
  assert.equal(checkInDue(done, end), false);
  assert.equal(checkInDue({ ...row, fields: { ...row.fields, status: 'Abgesagt' } }, end), false);
  const unknownEnd = { ...row, fields: { ...row.fields, endTime: '' } };
  assert.equal(checkInDue(unknownEnd, end), false);
  assert.equal(checkInDue(unknownEnd, new Date('2027-01-01T23:00:00Z')), true);
  assert.equal(validCareSchedule({ date: row.fields.date, time: '' }, justBefore), false);
  assert.equal(validCareSchedule({ date: row.fields.date, time: '16:00' }, justBefore), true);
});
