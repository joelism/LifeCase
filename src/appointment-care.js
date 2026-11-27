import { legacyChatAppointment } from './calendar-assistant.js';
import { CH_ZONE, isActive, nameOf, sectionOf, shiftDate, today, value } from './model.js';

export const careTypes = {
  psychology: 'Psychologisches Gespräch',
  psychiatry: 'Psychiatrischer Termin',
  medical: 'Arzttermin',
};
const typeTitle = { psychology: 'psychologisches Gespräch', psychiatry: 'psychiatrischer Termin', medical: 'Arzttermin' };
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const localClock = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clean = input => typeof input === 'string' ? input.trim() : '';
const key = input => clean(input).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const pd = /\b(?:pdag|psychiatrische dienste aargau)\b/;

export function careIdentity(fields) {
  const title = key(fields.title);
  const provider = clean(fields.appointmentProvider);
  const knownProvider = pd.test(key([fields.title, provider, fields.location].join(' '))) ? 'PDAG' : provider;
  const recordedType = Object.hasOwn(careTypes, fields.appointmentType) ? fields.appointmentType : '';
  const type = recordedType || (/\b(?:pscholog\w*|psycholog\w*|psychotherap\w*)\b/.test(title) ? 'psychology' :
    /\bpsychiatr\w*\b/.test(title.replace(pd, '')) ? 'psychiatry' :
      /\b(?:arzt(?:termin|besuch)?|arztin|arztinnen|zahnarzt\w*|augenarzt\w*|hausarzt\w*)\b/.test(title) ? 'medical' : '');
  return { type, provider: knownProvider };
}

function appointmentRecord(row) {
  const section = sectionOf(row);
  const kind = value(row, 'kind');
  return isActive(row) && value(row, 'status') !== 'Abgesagt' &&
    ((section === 'Kalender' && (!kind || kind === 'Termin')) ||
      (section === 'Gesundheit' && kind === 'Arztbesuch') || section === 'Gespräche');
}

function rememberedAppointment(row) {
  const legacy = legacyChatAppointment(row);
  const title = legacy?.title || nameOf(row);
  const location = clean(value(row, 'location') || legacy?.location);
  const identity = careIdentity({ ...row.fields, title, location });
  return { ...identity, title, date: value(row, 'date'),
    location: key(location) === key(identity.provider) ? '' : location };
}

export function suggestAppointment(fields, records) {
  const requested = careIdentity(fields);
  const requestedTitle = key(fields.title);
  const specificTitle = requestedTitle.replace(/\b(?:arzttermin|arztbesuch|arzt|arztin|aerztin|arztinnen|termin|bei|der|dem|am)\b/g, '').trim();
  const prior = records.filter(appointmentRecord).map(rememberedAppointment)
    .filter(item => validDay(item.date) && item.date < fields.date && item.type)
    .filter(item => (!requested.type || item.type === requested.type) &&
      (!requested.provider || key(item.provider) === key(requested.provider)))
    .filter(item => requested.provider || requested.type !== 'medical' ||
      (specificTitle && key(item.title) === requestedTitle));
  const types = new Set(prior.map(item => item.type));
  const type = requested.type || (types.size === 1 ? prior[0].type : '');
  const matching = prior.filter(item => item.type === type);
  const providers = new Map(matching.filter(item => item.provider).map(item => [key(item.provider), item.provider]));
  const provider = requested.provider || (providers.size === 1 ? [...providers.values()][0] : '');
  const explicitLocation = clean(fields.location);
  const suppliedLocation = key(explicitLocation) === key(provider) ? '' : explicitLocation;
  const withLocation = matching.filter(item => item.location);
  const locations = new Set(withLocation.map(item => key(item.location)));
  const repeat = !suppliedLocation && providers.size <= 1 && locations.size === 1 ?
    withLocation.filter(item => !provider || !item.provider || key(item.provider) === key(provider))
      .sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  const date = repeat?.date || (provider && (!requested.provider || !requested.type) && matching.find(item => item.provider)?.date) || '';
  return {
    fields: { ...fields, appointmentType: type, appointmentProvider: provider, location: suppliedLocation || repeat?.location || '' },
    sourceDate: date,
    confirmsLocation: Boolean(repeat),
  };
}

export function appointmentQuestion(appointment, name = '') {
  const { fields, sourceDate, confirmsLocation } = appointment;
  const greeting = name ? 'Hey ' + name + ', ' : '';
  const type = typeTitle[fields.appointmentType];
  const where = fields.appointmentProvider ? ' bei ' + fields.appointmentProvider : '';
  if (sourceDate && type && (confirmsLocation || where)) {
    return (greeting ? greeting + 'geht' : 'Geht') + ' es wieder um ' +
      (fields.appointmentType === 'psychology' ? 'ein ' : 'einen ') + type + where +
      (confirmsLocation ? ' (' + fields.location + ')' : '') + '?';
  }
  if (!type && where) {
    return (greeting ? greeting + 'um' : 'Um') + ' welche Art von Termin' + where + ' geht es?';
  }
  return (greeting ? greeting + 'was' : 'Was') + ' ist dein Ziel für diesen Termin?';
}

export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

export function validCareSchedule({ date, time, endDate, endTime }, now = new Date()) {
  const day = today(now);
  if (!validDay(date) || date < day || !clock.test(time) || (date === day && time < localClock.format(now))) return false;
  const end = endDate || date;
  return (!endDate || (validDay(end) && end > date && endTime)) &&
    (!endTime || (clock.test(endTime) && (end > date || endTime > time)));
}

export function checkInDue(row, now = new Date()) {
  if (!appointmentRecord(row) || value(row, 'appointmentCheckIn') !== 'pending') return false;
  const date = value(row, 'date');
  if (!validDay(date)) return false;
  const recordedEnd = value(row, 'endDate');
  const endDate = validDay(recordedEnd) && recordedEnd >= date ? recordedEnd : date;
  const endTime = value(row, 'endTime');
  const hasEnd = clock.test(endTime);
  const day = today(now);
  const after = value(row, 'appointmentCheckAfter');
  return (!validDay(after) || day >= after) &&
    (hasEnd ? (day > endDate || (day === endDate && localClock.format(now) >= endTime)) : day > endDate);
}

export function appointmentCheckIns(rows, now = new Date()) {
  return rows.filter(row => checkInDue(row, now)).sort((a, b) => value(b, 'date').localeCompare(value(a, 'date')));
}

export function checkInQuestion(row) {
  const outcome = value(row, 'appointmentExpected');
  return outcome ? 'Hast du erhalten, was du gebraucht hast?' :
    value(row, 'appointmentGoal') ? 'Konntest du dein Ziel beim Termin erreichen?' : 'Wie ist der Termin gelaufen?';
}

export function checkInUpdate(fields, action, notes, now = new Date()) {
  return { ...fields, appointmentReviewNotes: notes,
    appointmentCheckIn: action === 'later' ? 'pending' : action,
    appointmentCheckAfter: action === 'later' ? shiftDate(today(now), 1) : '' };
}
