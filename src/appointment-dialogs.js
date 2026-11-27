import { checkInDue, checkInQuestion, checkInUpdate, careTypes, validCareSchedule } from './appointment-care.js';
import { findRecord, saveRecord, userError } from './backend.js';
import { closeDialog, errorAt, openDialog } from './editor.js';
import { nameOf, showDate, value } from './model.js';
import { button, esc, options } from './ui.js';

const errorBox = '<p class="form-error wide" role="alert" hidden></p>';
const textInput = (name, label, text = '', placeholder = '', wide = false) =>
  '<label class="input-wrap' + (wide ? ' wide' : '') + '">' + esc(label) + '<input name="' + name +
  '" type="text" maxlength="250" value="' + esc(text) + '" placeholder="' + esc(placeholder) + '"></label>';
const scheduleInput = (name, label, type, text = '', required = false) =>
  '<label class="input-wrap">' + label + '<input name="' + name + '" type="' + type +
  '" value="' + esc(text) + '"' + (required ? ' required' : '') + '></label>';

export function openAppointmentDraft(appointment) {
  const { fields, sourceDate } = appointment;
  const source = sourceDate ? '<p class="hint wide">Vorschlag aus deinem Termin vom ' + esc(showDate(sourceDate)) +
    '. Du kannst die Angaben hier bestätigen oder ändern.</p>' : '';
  const data = '<div class="form-grid">' + source +
    textInput('title', 'Termin', fields.title, '', true) +
    scheduleInput('date', 'Datum', 'date', fields.date, true) + scheduleInput('time', 'Beginn', 'time', fields.time, true) +
    scheduleInput('endTime', 'Ende', 'time', fields.endTime) +
    (fields.endDate ? scheduleInput('endDate', 'Enddatum', 'date', fields.endDate) : '') +
    '<label class="input-wrap">Terminart<select name="appointmentType">' +
    options([['', 'Gesundheitstermin'], ...Object.entries(careTypes)], fields.appointmentType) + '</select></label>' +
    textInput('appointmentProvider', 'Praxis oder Einrichtung', fields.appointmentProvider, '', true) +
    textInput('location', 'Ort oder Adresse', fields.location, 'Ort hinzufügen', true) +
    '<fieldset class="links-control wide care-form"><legend>Vor- und Nachbereitung</legend>' +
    textInput('appointmentGoal', 'Was ist dein Ziel für diesen Termin?', fields.appointmentGoal, 'z. B. Besprechen, wie es weitergeht') +
    textInput('appointmentExpected', 'Was soll dabei herauskommen?', fields.appointmentExpected, 'z. B. ein Arztzeugnis') +
    '<label class="check"><input type="checkbox" name="checkIn" checked> Nach dem Termin nachfragen</label></fieldset>' + errorBox + '</div>';
  return openDialog('Termin prüfen', data, button('Zurück zum Chat', 'care-back', '', 'left') +
    '<button type="submit" class="button primary">Termin speichern</button>', true).querySelector('form');
}

export function readAppointmentDraft(form, existing) {
  const values = new FormData(form);
  const text = (key, size = 250) => String(values.get(key) ?? '').trim().slice(0, size);
  const fields = {
    ...existing, title: text('title', 160), date: text('date'), time: text('time'),
    endTime: text('endTime'), endDate: text('endTime') ? text('endDate') : '',
    appointmentType: text('appointmentType'), appointmentProvider: text('appointmentProvider', 100),
    location: text('location'), appointmentGoal: text('appointmentGoal'),
    appointmentExpected: text('appointmentExpected'), appointmentCheckIn: values.has('checkIn') ? 'pending' : '',
  };
  if (!fields.title) throw userError('Gib dem Termin einen Namen.');
  if (!validCareSchedule(fields)) throw userError('Prüfe das Datum und die Uhrzeiten. Der Termin braucht eine Startzeit und darf nicht in der Vergangenheit liegen.');
  return fields;
}

export function openAppointmentCheckIn(id, ctx) {
  const row = ctx.rows().find(item => item.id === id);
  if (!row || !checkInDue(row)) return;
  const goal = value(row, 'appointmentGoal');
  const expected = value(row, 'appointmentExpected');
  const body = '<div class="care-form"><div class="prep-subtitle"><strong>' + esc(nameOf(row)) +
    '</strong><p>' + esc(showDate(value(row, 'date'))) + '</p></div>' +
    '<p><strong>' + esc(checkInQuestion(row)) + '</strong></p>' +
    (goal ? '<p><span class="hint">Dein Ziel</span><br>' + esc(goal) + '</p>' : '') +
    (expected ? '<p><span class="hint">Was du erwartet hast</span><br>' + esc(expected) + '</p>' : '') +
    '<label class="input-wrap">Notiz zum Termin (optional)<textarea name="notes" rows="3" maxlength="1500">' +
    esc(value(row, 'appointmentReviewNotes')) + '</textarea></label>' + errorBox + '</div>';
  const submit = (label, state, primary = false) => '<button type="submit" name="result" value="' + state +
    '" class="button' + (primary ? ' primary' : '') + '">' + label + '</button>';
  const footer = button('Termin öffnen', 'open', id, 'calendar') + submit('Überspringen', 'skipped') +
    submit(expected ? 'Noch nicht · morgen erinnern' : 'Morgen nochmals fragen', 'later') +
    submit(expected ? 'Erhalten' : goal ? 'Ziel erreicht' : 'Abschliessen', 'done', true);
  const form = openDialog('Nach dem Termin', body, footer, true).querySelector('form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const action = event.submitter?.value;
    if (!['done', 'later', 'skipped'].includes(action) || event.submitter.disabled) return;
    const notes = form.elements.notes.value.trim().slice(0, 1500);
    const epoch = ctx.epoch();
    const controls = [...form.querySelectorAll('button, textarea')];
    controls.forEach(control => { control.disabled = true; });
    try {
      const latest = await findRecord(id);
      if (epoch !== ctx.epoch()) return;
      if (!checkInDue(latest)) {
        ctx.addRecord(latest);
        closeDialog();
        ctx.notify('Diese Rückfrage wurde bereits geändert.');
        return;
      }
      const saved = await saveRecord('Kalender', checkInUpdate(latest.fields, action, notes), latest);
      if (epoch !== ctx.epoch()) return;
      ctx.addRecord(saved);
      closeDialog();
      ctx.notify(action === 'later' ? 'Die Rückfrage erscheint morgen wieder.' :
        action === 'skipped' ? 'Rückfrage ausgeblendet.' : 'Rückmeldung gespeichert.');
    } catch (error) {
      if (epoch === ctx.epoch()) errorAt(form, error);
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  });
}
