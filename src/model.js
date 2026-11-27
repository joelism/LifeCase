export const CH_ZONE = 'Europe/Zurich';
export const BUCKET = 'lifecase-private';
export const MAX_FILE = 25 * 1024 * 1024;

const field = (key, label, type = 'text', options = {}) => ({ key, label, type, ...options });
const notes = (key, label) => field(key, label, 'textarea');
const select = (key, label, choices, initial = choices[0]) => field(key, label, 'select', { choices, initial });
const title = (label = 'Titel') => field('title', label, 'text', { required: true });
const date = (key, label, required = false) => field(key, label, 'date', { required });
const time = field('time', 'Uhrzeit', 'time');
const cases = field('caseIds', 'Verknüpfte Fälle', 'links', { sections: ['Fälle'] });
const people = field('personIds', 'Ansprechpartner', 'links', { sections: ['Personen'] });
const doctors = { ...people, label: 'Behandelnde Personen' };
const documents = field('documentIds', 'Verknüpfte Dokumente', 'links', { sections: ['Beweismittel'] });
const related = (label, sections) => field('relatedIds', label, 'links', { sections });
const reminder = field('reminderDays', 'Erinnerung vorher', 'select', {
  choices: ['', '0', '1', '2', '3', '7', '14', '30'], initial: '',
  labels: { '': 'Keine Erinnerung', 0: 'Am selben Tag', 1: '1 Tag', 2: '2 Tage', 3: '3 Tage', 7: '7 Tage', 14: '14 Tage', 30: '30 Tage' },
});
const expiryReminder = select('expiryReminder', 'Ablauferinnerung', ['month', 'off']);
expiryReminder.labels = { month: 'Einen Monat vorher', off: 'Ausgeschaltet' };
const location = field('location', 'Ort');
const sectionsInArchive = ['Fälle', 'Chronik', 'Gesundheit', 'Arztzeugnisse', 'Rezepte', 'Gespräche', 'Kalender', 'Beweismittel', 'Personen'];

export const sections = {
  'Meine Woche': { icon: 'week', description: 'Schichten, Termine und Aufgaben an einem Ort planen.' },
  'Vorbereitung': { icon: 'tasks', noun: 'Vorbereitung', description: 'Fragen, Checkliste und Unterlagen für einen Termin.' },
  'Übersicht': { icon: 'grid', description: 'Offene Fälle, nächste Termine und aktuelle Fristen.' },
  'Fälle': {
    icon: 'folder', noun: 'Fall', create: 'Neuer Fall', empty: 'Noch keine Fälle',
    description: 'Dossiers zu Arbeit, Ausbildung, Wohnen und weiteren Themen.',
    fields: [title('Name des Falls'), select('status', 'Status', ['Offen', 'In Bearbeitung', 'Wartet', 'Abgeschlossen']), select('category', 'Bereich', ['Arbeit', 'IV', 'Ausbildung', 'Wohnen', 'Behörden', 'Gesundheit', 'Weitere']), notes('goal', 'Ziele'), notes('notes', 'Ausgangslage und Notizen'), people, documents],
  },
  'Chronik': {
    icon: 'clock', noun: 'Ereignis', create: 'Neues Ereignis', empty: 'Noch keine Ereignisse',
    description: 'Ereignisse mit Zeit, Sachverhalt und Belegen dokumentieren.',
    fields: [title(), date('date', 'Datum', true), time, location, notes('notes', 'Sachverhalt'), notes('assessment', 'Persönliche Einschätzung'), field('source', 'Weitere Quellenangabe'), cases, people, documents],
  },
  'Gesundheit': {
    icon: 'heart', noun: 'Gesundheitseintrag', create: 'Neuer Gesundheitseintrag', empty: 'Noch keine Gesundheitseinträge',
    description: 'Beschwerden, Diagnosen, Medikamente, Therapien und Arztbesuche.',
    fields: [title(), select('kind', 'Art', ['Beschwerde', 'Diagnose', 'Medikament', 'Therapie', 'Arztbesuch', 'Medizinisches Dokument']), select('status', 'Status', ['Aktuell', 'Beendet', 'Geplant']), date('date', 'Datum / Beginn'), date('endDate', 'Ende'), field('dosage', 'Dosierung / Häufigkeit'), location, notes('notes', 'Beschreibung, Verlauf oder Befund'), notes('nextSteps', 'Weitere Schritte'), cases, doctors, documents],
  },
  'Arztzeugnisse': {
    icon: 'badge', noun: 'Arztzeugnis', create: 'Neues Arztzeugnis', empty: 'Noch keine Arztzeugnisse',
    description: 'Gültigkeit, Arbeitsunfähigkeit und Originalzeugnisse.',
    fields: [title(), date('validFrom', 'Gültig ab', true), date('validUntil', 'Gültig bis', true), field('incapacity', 'Arbeitsunfähigkeit (%)', 'number', { min: 0, max: 100, step: 0.1, required: true }), field('doctor', 'Ausstellende Ärztin / ausstellender Arzt'), expiryReminder, { ...reminder, label: 'Weitere Erinnerung vorher' }, notes('notes', 'Notizen'), cases, doctors, documents],
  },
  'Rezepte': {
    icon: 'file', noun: 'Rezept', create: 'Neues Rezept', empty: 'Noch keine Rezepte',
    description: 'Rezepte, Belege und ihre Gültigkeit verwalten.',
    fields: [title('Name des Rezepts'), date('validFrom', 'Gültig ab'), date('validUntil', 'Gültig bis', true), field('doctor', 'Ausstellende Stelle'),
      field('dosage', 'Angabe auf dem Rezept'), expiryReminder, notes('notes', 'Notizen'), cases, doctors, documents],
  },
  'Gespräche': {
    icon: 'message', noun: 'Gespräch', create: 'Neues Gespräch', empty: 'Noch keine Gespräche',
    description: 'Gespräche vorbereiten, protokollieren und Vereinbarungen festhalten.',
    fields: [title(), select('status', 'Status', ['Geplant', 'Durchgeführt', 'Abgesagt']), date('date', 'Datum', true), time, location, notes('agenda', 'Vorbereitung und Fragen'), notes('notes', 'Gesprächsprotokoll'), notes('agreements', 'Vereinbarungen'), notes('nextSteps', 'Nachbereitung und nächste Schritte'), date('followUp', 'Wiedervorlage am'), cases, people, documents],
  },
  'Kalender': {
    icon: 'calendar', noun: 'Kalendereintrag', create: 'Neuer Kalendereintrag', empty: 'Noch keine Kalendereinträge',
    description: 'Termine, Aufgaben, Fristen und Erinnerungen an einem Ort.',
    fields: [title(), select('kind', 'Art', ['Termin', 'Schicht', 'Pause', 'Aufgabe', 'Frist', 'Wiedervorlage', 'Erinnerung']), select('status', 'Status', ['Offen', 'Erledigt', 'Abgesagt']), date('date', 'Datum'), time, field('endTime', 'Bis', 'time'), date('endDate', 'Enddatum (optional)'), location, reminder, notes('notes', 'Notizen'), cases, people, related('Verknüpfte Einträge und Beweismittel', ['Gespräche', 'Arztzeugnisse', 'Rezepte', 'Chronik', 'Gesundheit', 'Beweismittel', 'Kalender', 'Vorbereitung'])],
  },
  'Beweismittel': {
    icon: 'shield', noun: 'Beweismittel', create: 'Neues Beweismittel', empty: 'Noch keine Beweismittel',
    description: 'Private Originaldateien mit Upload-Zeitpunkt und Prüfsumme.',
    fields: [title(), select('kind', 'Art', ['Dokument', 'Screenshot', 'E-Mail', 'Foto', 'PDF', 'Weitere']), date('date', 'Datum des Dokuments'), field('source', 'Quelle'), notes('notes', 'Beschreibung'), cases, people, related('Verknüpfte Einträge', ['Chronik', 'Gesundheit', 'Arztzeugnisse', 'Gespräche', 'Kalender'])],
  },
  'Personen': {
    icon: 'people', noun: 'Person', create: 'Neue Person', empty: 'Noch keine Personen',
    description: 'Ansprechpartner und ihre Verbindungen zu deinen Fällen.',
    fields: [title('Vor- und Nachname'), field('role', 'Funktion'), field('organisation', 'Organisation'), field('email', 'E-Mail-Adresse', 'email'), field('phone', 'Telefon', 'tel'), field('address', 'Adresse'), notes('notes', 'Notizen'), cases],
  },
  'Einkaufen': { icon: 'cart', noun: 'Einkaufsliste', description: 'Einkaufslisten erstellen und Artikel beim Einkaufen abhaken.', fields: [title('Name der Liste')] },
  'Scannen': { icon: 'camera', description: 'Fotos und Arbeitspläne in Termine oder Schichten umwandeln.' },
  'Terminprüfung': { icon: 'mail', description: 'E-Mail-Termine automatisch erfassen und Vorschläge prüfen.' },
  'Gesundheitsdaten': { icon: 'activity', description: 'Tageswerte aus Apple Health und ihr Verlauf.' },
  'Posteingang': { icon: 'mail', description: 'Wichtige E-Mails und Anhänge in deinen Dossiers ablegen.' },
  'Erinnerungen': { icon: 'bell', description: 'Fällige Erinnerungen und Ablaufdaten im Blick behalten.' },
  'Google Drive': { icon: 'folder', description: 'Scans und Originaldateien aus deinem Google Drive in LifeCase ablegen.' },
  'Verbindungen': { icon: 'link', description: 'Konten und Datenquellen für LifeCase verwalten.' },
  'Suche': { icon: 'search', description: 'Einträge, Originaldateien und verknüpfte Inhalte finden.' },
  'PDF-Export': { icon: 'download', description: 'Dossiers und Übersichten mit den gewünschten Inhalten erstellen.' },
  'Einstellungen': { icon: 'settings', description: 'Darstellung, Anmeldung und Installation verwalten.' },
};

export const recordSections = sectionsInArchive;

const legacyFields = {
  title: 'Titel', date: 'Datum', time: 'Uhrzeit', notes: 'Sachverhalt / Notizen',
  assessment: 'Persönliche Einschätzung', validFrom: 'Gültig ab', validUntil: 'Gültig bis',
  incapacity: 'Arbeitsunfähigkeit (%)', source: 'Beleg / Quellenangabe',
};

export const normalizeSection = section => section === 'Dokumente' ? 'Beweismittel' : section;
export const value = (row, key) => row.fields[key] ?? row.fields[legacyFields[key]] ?? '';
export const nameOf = row => value(row, 'title') || 'Ohne Titel';
export const sectionOf = row => normalizeSection(row.section);
export const isActive = row => !row.archived_at;
export const dateOf = row => value(row, 'date') || value(row, 'validFrom') || (row.created_at ? today(new Date(row.created_at)) : '');
export const dateFormat = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeZone: CH_ZONE });
export const dateTimeFormat = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: CH_ZONE });
export const showDate = date => date && !Number.isNaN(Date.parse(date)) ? dateFormat.format(new Date(date.length === 10 ? date + 'T12:00:00Z' : date)) : '–';
export const showTimestamp = date => date && !Number.isNaN(Date.parse(date)) ? dateTimeFormat.format(new Date(date)) : '–';

export function today(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: CH_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = key => parts.find(part => part.type === key).value;
  return [get('year'), get('month'), get('day')].join('-');
}
export function shiftDate(day, offset) {
  const shifted = new Date(day + 'T12:00:00Z');
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}
export function monthBefore(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return '';
  const [year, month, day] = date.split('-').map(Number);
  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, previousMonthLastDay))).toISOString().slice(0, 10);
}
export function dayDistance(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}
export function linksOf(row) {
  return ['caseIds', 'personIds', 'documentIds', 'relatedIds'].flatMap(key => Array.isArray(value(row, key)) ? value(row, key) : []);
}
export function filesFor(row, files) {
  const list = files.filter(file => file.record_id === row.id);
  if (row.fields.Dateipfad) list.unshift({
    id: 'legacy', record_id: row.id, original_name: row.fields.Dateiname || 'Originaldatei',
    path: row.fields.Dateipfad, sha256: row.fields.SHA256, uploaded_at: row.created_at,
  });
  return list;
}
const normalized = input => String(input ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('de-CH');
export function searchRecords(records, files, query, filters = {}) {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  const byId = new Map(records.map(row => [row.id, row]));
  const linkedTo = (row, id) => row.id === id || linksOf(row).includes(id) || (byId.has(id) && linksOf(byId.get(id)).includes(row.id));
  const fileNames = new Map();
  for (const file of files) {
    fileNames.set(file.record_id, [...(fileNames.get(file.record_id) ?? []), file.original_name, file.sha256]);
  }
  return records.filter(row => {
    if (filters.section && filters.section !== sectionOf(row)) return false;
    if (filters.caseId && !linkedTo(row, filters.caseId)) return false;
    if (filters.personId && !linkedTo(row, filters.personId)) return false;
    if (!filters.archived && !isActive(row)) return false;
    if (filters.onlyArchived && isActive(row)) return false;
    const reference = dateOf(row);
    if (filters.from && (!reference || reference < filters.from)) return false;
    if (filters.to && (!reference || reference > filters.to)) return false;
    if (!terms.length) return true;
    const fields = Object.entries(row.fields)
      .filter(([key]) => !['caseIds', 'personIds', 'documentIds', 'relatedIds', 'Dateipfad'].includes(key))
      .map(([key, item]) => key === 'items' && Array.isArray(item) ? item.map(entry => [entry.name ?? entry.title, entry.quantity]).flat() : item);
    const text = normalized([row.section, ...fields, ...linksOf(row).map(id => byId.has(id) ? nameOf(byId.get(id)) : ''), ...(fileNames.get(row.id) ?? [])].join(' '));
    return terms.every(term => text.includes(term));
  });
}
export function calendarEntries(records) {
  return records.filter(isActive).flatMap(row => {
    const section = sectionOf(row);
    const kind = value(row, 'kind') || 'Termin';
    const state = value(row, 'status') || 'Offen';
    if (section === 'Kalender' && value(row, 'date')) {
      return [{ row, date: value(row, 'date'), time: value(row, 'time'), endTime: value(row, 'endTime'), endDate: value(row, 'endDate'), kind, state, reminderDays: value(row, 'reminderDays') }];
    }
    if (['Arztzeugnisse', 'Rezepte'].includes(section) && value(row, 'validUntil')) {
      const date = value(row, 'validUntil');
      const reminderDate = value(row, 'expiryReminder') === 'off' ? '' : monthBefore(date);
      const additional = value(row, 'reminderDays');
      return [{ row, date, time: '', kind: section === 'Rezepte' ? 'Rezept' : 'Arztzeugnis', state: 'Offen',
        reminderDate, reminderDays: reminderDate ? String(dayDistance(reminderDate, date)) : additional,
        extraReminderDays: reminderDate ? additional : '' }];
    }
    if (section === 'Gespräche' && state !== 'Abgesagt') {
      const entries = [];
      if (state === 'Geplant' && value(row, 'date')) entries.push({ row, date: value(row, 'date'), time: value(row, 'time'), kind: 'Gespräch', state: 'Offen' });
      if (value(row, 'followUp')) entries.push({ row, date: value(row, 'followUp'), time: '', kind: 'Wiedervorlage', state: 'Offen' });
      return entries;
    }
    if (section === 'Gesundheit' && value(row, 'kind') === 'Arztbesuch' && state === 'Geplant' && value(row, 'date')) {
      return [{ row, date: value(row, 'date'), time: '', kind: 'Arztbesuch', state: 'Offen' }];
    }
    return [];
  }).sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
}
export function reminderDue(item, current) {
  if (item.state !== 'Offen' || !item.date) return false;
  if (item.reminderDate && current >= item.reminderDate && current <= item.date) return true;
  if (item.kind === 'Erinnerung' && item.date <= current) return true;
  if (item.reminderDays === '' || item.reminderDays == null || !/^\d+$/.test(item.reminderDays)) return false;
  return current >= shiftDate(item.date, -Number(item.reminderDays)) && current <= item.date;
}
export async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
