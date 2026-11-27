import { calendarRecordTitle } from './calendar-assistant.js';
import { displayedAgenda } from './connected-model.js';
import { groupWorkdays } from './workday.js';
import { isActive, linksOf, nameOf, sectionOf, shiftDate, today, value } from './model.js';

export const planningKinds = ['Aufgabe', 'Frist', 'Wiedervorlage'];
export const isPlanningTask = row => sectionOf(row) === 'Kalender' && planningKinds.includes(value(row, 'kind'));
export const isOpenTask = row => isPlanningTask(row) && isActive(row) && !['Erledigt', 'Abgesagt'].includes(value(row, 'status'));
const preparationKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Schicht']);
const localKinds = { Gespräche: 'Gespräch', Gesundheit: 'Arztbesuch' };
const idsOf = (row, field) => row && Array.isArray(value(row, field)) ? value(row, field) : [];

export function weekPlan(rows, events, start = today(), current = today()) {
  const end = shiftDate(start, 6);
  const active = rows.filter(isActive);
  const agenda = displayedAgenda(active, events).filter(item => item.state === 'Offen');
  const within = groupWorkdays(agenda.filter(item => item.date >= start && item.date <= end));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, entries: within.filter(item => item.date === date) };
  });
  const late = agenda.filter(item => planningKinds.includes(item.kind) && item.date < current);
  const inbox = active.filter(row => isOpenTask(row) && !value(row, 'date'));
  return { start, end, days, late, inbox, taskCount: within.filter(item => planningKinds.includes(item.kind)).length,
    shiftCount: within.filter(item => item.kind === 'Schicht').length,
    appointments: within.filter(item => preparationKinds.has(item.kind) && item.kind !== 'Schicht').length };
}

export function preparationSource(item) {
  if (!item || !preparationKinds.has(item.kind)) return null;
  if (item.external) {
    const event = item.external;
    if (event.lifeCasePause) return null;
    return { key: ['external', event.provider, event.id, event.originalDate || event.date].join('|'),
      date: event.originalDate || event.date, time: event.time || '', title: event.title, source: event.provider, row: null };
  }
  return { key: 'row|' + item.row.id, date: value(item.row, 'date'), time: value(item.row, 'time'),
    title: calendarRecordTitle(item.row), row: item.row, source: '' };
}

export function preparationForRow(row) {
  if (!row || !isActive(row) || !value(row, 'date') || value(row, 'status') === 'Abgesagt') return null;
  const kind = localKinds[sectionOf(row)] ?? (sectionOf(row) === 'Kalender' ? value(row, 'kind') || 'Termin' : '');
  if (sectionOf(row) === 'Gesundheit' && value(row, 'kind') !== 'Arztbesuch') return null;
  return preparationSource({ row, kind });
}

export function preparationContext(rows, source, prep) {
  const caseIds = new Set([...idsOf(source.row, 'caseIds'), ...idsOf(prep, 'caseIds')]);
  const context = rows.filter(row => isActive(row) && (caseIds.has(row.id) || idsOf(row, 'caseIds').some(id => caseIds.has(id))));
  const docIds = new Set([...(source.row ? linksOf(source.row) : []), ...(prep ? linksOf(prep) : []), ...context.flatMap(linksOf)]);
  const documents = rows.filter(row => isActive(row) && ['Beweismittel','Arztzeugnisse','Rezepte'].includes(sectionOf(row)) &&
    (docIds.has(row.id) || idsOf(row, 'caseIds').some(id => caseIds.has(id))));
  return { caseIds: [...caseIds], documents: documents.slice(0, 8) };
}

export function followUpDefaults(row) {
  const section = sectionOf(row);
  return {
    kind: 'Wiedervorlage', status: 'Offen', reminderDays: '0', date: shiftDate(today(), 1),
    title: 'Nachfassen · ' + nameOf(row).slice(0, 225),
    caseIds: section === 'Fälle' ? [row.id] : idsOf(row, 'caseIds'),
    relatedIds: section === 'Fälle' ? [] : [row.id],
  };
}
