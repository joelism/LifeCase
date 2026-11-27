import { calendarEntries, shiftDate } from './model.js';

export const providers = {
  microsoft: { title: 'Outlook', calendar: 'Outlook-Kalender', mark: 'O', trust: 'microsoft' },
  google: { title: 'Gmail', calendar: 'Google Kalender', mark: 'G', trust: 'google' },
};

export function displayedAgenda(rows, external = []) {
  return [...calendarEntries(rows), ...external.map(event => ({
    external: event, date: event.date, time: event.time, kind: 'Termin', state: 'Offen',
  }))].sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
}

export function expandEvents(events, from, through) {
  return events.flatMap(event => {
    const entries = [];
    const start = event.date < from ? from : event.date;
    for (let day = start; day <= event.endDate && day <= through; day = shiftDate(day, 1)) {
      entries.push({ ...event, originalDate: event.date, date: day, time: day === event.date ? event.time : '' });
    }
    return entries;
  });
}
