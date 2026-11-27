import { icon } from './icons.js';
import { button, empty, esc, jump, motif, options, tag } from './ui.js';
import { CH_ZONE, calendarEntries, dateOf, dayDistance, isActive, nameOf, recordSections, reminderDue, searchRecords, sectionOf, sections, shiftDate, showDate, today, value } from './model.js';

const labels = new Intl.DateTimeFormat('de-CH', { dateStyle: 'full', timeZone: CH_ZONE });
const monthFormat = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: CH_ZONE });
const shortMonth = new Intl.DateTimeFormat('de-CH', { month: 'short', timeZone: CH_ZONE });
const kindStyle = {
  Termin: ['calendar',''], Aufgabe: ['tasks','green'], Frist: ['flag','amber'],
  Arztzeugnis: ['badge','rose'], Erinnerung: ['bell','amber'], Gespräch: ['message',''],
  Arztbesuch: ['heart','rose'], Wiedervorlage: ['refresh','amber'],
};
const statusColor = value => ({ Abgeschlossen: 'green', Erledigt: 'green', Wartet: 'amber', Abgesagt: 'rose', Archiviert: 'amber' })[value] || '';

export const brand = '<span class="brand"><img src="./icon-192.png" width="39" height="39" alt=""><span>LifeCase</span></span>';
const navGroups = [['', 'Übersicht'], ['Dossiers', 'Fälle', 'Chronik', 'Gespräche', 'Kalender', 'Beweismittel', 'Personen'], ['Gesundheit', 'Gesundheit', 'Arztzeugnisse'], ['Werkzeuge', 'Suche', 'PDF-Export']];
const navButton = (label, view, compact = false) => '<button class="' + (compact ? '' : 'nav-item') + '" type="button" data-view="' + esc(label) + '"' +
  (view === label ? ' aria-current="page"' : '') + '>' + icon(sections[label].icon, compact ? 21 : 18) + esc(label) + '</button>';

export function shell(view, inner, state) {
  const activeReminderCount = calendarEntries(state.rows).filter(item => reminderDue(item, today())).length;
  return '<div class="layout' + (state.menu ? ' menu-open' : '') + '"><button type="button" class="scrim" data-menu="" aria-label="Menü schliessen"></button>' +
    '<aside class="sidebar">' + brand + '<nav class="side-nav" aria-label="Hauptnavigation">' + navGroups.map(([label, ...group]) =>
      (label ? '<h2>' + esc(label) + '</h2>' : '') + group.map(item => navButton(item, view)).join('')).join('') +
    '</nav><div class="sidebar-foot">' + navButton('Einstellungen', view) + '<div class="privacy">' + icon('lock', 14) + 'Privater Bereich</div></div></aside>' +
    '<div class="workspace"><header class="top"><div class="top-date">' + icon('calendar', 17) + esc(labels.format(new Date())) +
    '</div><div class="mobile-brand">' + brand + '</div><div class="top-actions"><button class="find" type="button" data-view="Suche" aria-label="Global suchen">' +
    icon('search', 17) + '<span>Suchen</span><kbd>⌘ K</kbd></button><button type="button" class="icon-btn" data-reminders="" aria-label="Erinnerungen' +
    (activeReminderCount ? ', ' + activeReminderCount + ' fällig' : '') + '">' + icon('bell', 19) + '</button><button type="button" class="icon-btn" data-reload="" aria-label="Synchronisieren">' +
    icon('refresh', 19) + '</button></div></header><main id="main" class="main" tabindex="-1">' +
    (state.error ? '<div class="banner" role="alert">' + icon('info', 18) + esc(state.error) + '</div>' : '') + inner +
    '</main></div><nav class="bottom-nav mobile" aria-label="Mobile Navigation">' + ['Übersicht', 'Fälle', 'Kalender'].map(label => navButton(label, view, true)).join('') +
    '<button type="button" data-menu="" aria-expanded="' + state.menu + '">' + icon('menu', 21) + 'Mehr</button></nav></div>';
}
export const heading = (section, actions = '') => '<div class="heading"><div><h1>' + esc(section) + '</h1><p>' + esc(sections[section].description) + '</p></div>' +
  (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
export const panel = (title, body, action = '') => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + action + '</div>' + body + '</section>';

export function recordRow(row, info = '', item = null) {
  const [symbol, color] = item ? kindStyle[item.kind] ?? ['calendar', ''] : [sections[sectionOf(row)]?.icon ?? 'file', ''];
  const status = row.archived_at ? 'Archiviert' : item ? item.kind : value(row, 'status') || value(row, 'kind');
  const details = info || (item ? [showDate(item.date), item.time, item.state !== 'Offen' ? item.state : ''].filter(Boolean).join(' · ') :
    [value(row, 'category') || value(row, 'organisation') || sectionOf(row), showDate(dateOf(row))].filter(Boolean).join(' · '));
  const emblem = item ? '<span class="date-badge"><small>' + esc(shortMonth.format(new Date(item.date + 'T12:00:00Z'))) + '</small>' + esc(item.date.slice(-2)) + '</span>' :
    '<span class="tile-icon ' + color + '">' + icon(symbol, 19) + '</span>';
  return '<button type="button" class="row" data-open="' + esc(row.id) + '">' + emblem + '<span class="row-info"><span class="row-title">' +
    esc(nameOf(row)) + '</span><span class="row-sub">' + esc(details) + '</span></span><span class="row-tail">' + tag(status, color || statusColor(status)) + icon('right', 15) + '</span></button>';
}

export function dashboard(rows, loading) {
  const day = today();
  const active = rows.filter(isActive);
  const open = active.filter(row => sectionOf(row) === 'Fälle' && value(row, 'status') !== 'Abgeschlossen');
  const timeline = calendarEntries(active).filter(item => item.state === 'Offen');
  const appointments = timeline.filter(item => ['Termin', 'Gespräch', 'Arztbesuch'].includes(item.kind) && item.date >= day);
  const tasks = timeline.filter(item => ['Aufgabe', 'Frist'].includes(item.kind));
  const certs = timeline.filter(item => item.kind === 'Arztzeugnis' && item.date >= day && dayDistance(day, item.date) <= 30);
  const reminders = timeline.filter(item => reminderDue(item, day));
  const due = timeline.filter(item => item.date >= day || ['Aufgabe','Frist','Wiedervorlage'].includes(item.kind));
  const metricItems = [
    ['Offene Fälle', open.length, 'folder', '', 'Fälle|offen'],
    ['Nächste Termine', appointments.length, 'calendar', 'green', 'Kalender|termine'],
    ['Aufgaben und Fristen', tasks.length, 'tasks', 'amber', 'Kalender|aufgaben'],
    ['Zeugnisse bis in 30 Tagen', certs.length, 'badge', 'rose', 'Arztzeugnisse|bald'],
  ];
  return '<section class="hero">' + motif + '<div><h1>Übersicht</h1><p>' + esc(sections['Übersicht'].description) + '</p>' +
    button('Eintrag erfassen', 'quick', '', 'plus', 'hero-cta') + '</div></section><div class="metrics">' +
    metricItems.map(([label, count, symbol, color, target]) => '<button type="button" class="metric" data-metric="' + esc(target) + '"><span class="tile-icon ' + color + '">' + icon(symbol, 19) +
      '</span><span class="metric-arrow">' + icon('arrow', 15) + '</span><strong>' + (loading ? '–' : count) + '</strong><span class="metric-label">' + esc(label) + '</span></button>').join('') +
    '</div>' + (reminders.length ? panel('Fällige Erinnerungen', reminders.slice(0, 4).map(item => recordRow(item.row, '', item)).join(''), jump('Alle', 'reminders', '')) : '') +
    '<div class="dash-grid">' + panel('Bevorstehend', due.length ? due.slice(0, 5).map(item => recordRow(item.row, '', item)).join('') :
      empty('calendar', loading ? 'Wird synchronisiert …' : 'Keine bevorstehenden Einträge', 'Termine, Fristen und Arztzeugnisse erscheinen hier.'), jump('Zum Kalender', 'view', 'Kalender')) +
    panel('Offene Fälle', open.length ? open.slice(0, 5).map(row => recordRow(row)).join('') :
      empty('folder', loading ? 'Wird synchronisiert …' : 'Keine offenen Fälle', '', button('Fall anlegen', 'create', 'Fälle', 'plus')), jump('Alle Fälle', 'view', 'Fälle')) + '</div>';
}

export function sectionPage(section, rows, filter, loading) {
  const info = sections[section];
  const day = today();
  const local = searchRecords(rows, [], '', { section, archived: filter === 'archiv', onlyArchived: filter === 'archiv' }).filter(row => {
    if (filter === 'offen') return value(row, 'status') !== 'Abgeschlossen';
    if (filter === 'bald') return value(row, 'validUntil') >= day && dayDistance(day, value(row, 'validUntil')) <= 30;
    return true;
  });
  if (section === 'Chronik' || section === 'Gespräche') local.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  if (section === 'Arztzeugnisse') local.sort((a, b) => String(value(b, 'validUntil')).localeCompare(String(value(a, 'validUntil'))));
  const choices = [['', 'Aktive Einträge'], ['archiv', 'Archiv']];
  if (section === 'Fälle') choices.splice(1, 0, ['offen', 'Offene Fälle']);
  if (section === 'Arztzeugnisse') choices.splice(1, 0, ['bald', 'Ablauf in 30 Tagen']);
  return heading(section, button(info.create, 'create', section, 'plus', 'primary')) +
    '<div class="filters"><label class="input-wrap">Ansicht<select data-section-filter>' + options(choices, filter) + '</select></label></div>' +
    '<section class="panel" aria-label="' + esc(section) + '">' + (local.length ? local.map(row => recordRow(row,
      section === 'Arztzeugnisse' && value(row, 'validUntil') ? 'Gültig bis ' + showDate(value(row, 'validUntil')) + ' · ' + value(row, 'incapacity') + ' % AU' : '')).join('') :
      empty(info.icon, loading ? 'Wird synchronisiert …' : filter ? 'Keine passenden Einträge' : info.empty, '', filter ? '' : button(info.create, 'create', section, 'plus'))) + '</section>';
}

const calendarKinds = [['', 'Alle Arten'], ['termine', 'Termine und Besuche'], ['aufgaben', 'Aufgaben und Fristen'], ['Arztzeugnis', 'Arztzeugnisse'], ['Erinnerung', 'Erinnerungen'], ['Wiedervorlage', 'Wiedervorlagen']];
export function calendarPage(rows, calendar) {
  const day = today();
  const first = calendar.month + '-01';
  const dow = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const start = shiftDate(first, -dow);
  const matches = calendarEntries(rows).filter(item => {
    if (calendar.kind === 'termine') return ['Termin','Gespräch','Arztbesuch'].includes(item.kind) && item.state === 'Offen' && item.date >= day;
    if (calendar.kind === 'aufgaben') return ['Aufgabe','Frist'].includes(item.kind) && item.state === 'Offen';
    return !calendar.kind || item.kind === calendar.kind;
  });
  const counts = new Map();
  matches.forEach(item => counts.set(item.date, (counts.get(item.date) ?? 0) + 1));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = shiftDate(start, index);
    const count = counts.get(date);
    return '<button type="button" class="day ' + (date.startsWith(calendar.month) ? '' : 'outside') + (day === date ? ' current' : '') +
      '" data-day="' + date + '" aria-label="' + esc(showDate(date) + (count ? ', ' + count + ' Einträge' : '')) + '" aria-pressed="' + (calendar.selected === date) +
      '"' + (day === date ? ' aria-current="date"' : '') + '>' + Number(date.slice(-2)) + (count ? '<small>' + count + '</small>' : '') + '</button>';
  }).join('');
  const monthTitle = monthFormat.format(new Date(first + 'T12:00:00Z'));
  const items = matches.filter(item => calendar.selected ? item.date === calendar.selected : calendar.kind === 'termine' || calendar.kind === 'aufgaben' || item.date.startsWith(calendar.month));
  const month = '<section class="panel"><div class="panel-head"><div class="actions"><button type="button" class="icon-btn" data-month="-1" aria-label="Vorheriger Monat">' + icon('left') +
    '</button><h2 class="calendar-title">' + esc(monthTitle) + '</h2><button type="button" class="icon-btn" data-month="1" aria-label="Nächster Monat">' + icon('right') +
    '</button></div>' + jump('Heute', 'day', day, 'calendar') + '</div><div class="calendar-grid">' +
    ['Mo','Di','Mi','Do','Fr','Sa','So'].map(label => '<span class="weekday">' + label + '</span>').join('') + days + '</div></section>';
  return heading('Kalender', button('Archiv', 'calendar-archive', '', 'archive') + button('Neuer Kalendereintrag', 'create', 'Kalender', 'plus', 'primary')) +
    '<div class="filters"><label class="input-wrap">Eintragsart<select data-calendar-kind>' + options(calendarKinds, calendar.kind) + '</select></label>' +
    (calendar.selected ? button('Tagesfilter entfernen', 'day', '', 'close') : '') + '</div><div class="calendar-layout">' + month +
    panel(calendar.selected ? showDate(calendar.selected) : 'Agenda', items.length ? items.map(item => recordRow(item.row, '', item)).join('') :
      empty('calendar','Keine Einträge in dieser Ansicht'), items.length ? jump('Kalenderdatei', 'ics', 'agenda', 'download') : '') + '</div>';
}
export function selectedCalendar(rows, calendar) {
  return calendarEntries(rows).filter(item => {
    if (calendar.selected ? item.date !== calendar.selected : !['termine','aufgaben'].includes(calendar.kind) && !item.date.startsWith(calendar.month)) return false;
    if (calendar.kind === 'termine') return ['Termin','Gespräch','Arztbesuch'].includes(item.kind) && item.state === 'Offen' && item.date >= today();
    if (calendar.kind === 'aufgaben') return ['Aufgabe','Frist'].includes(item.kind) && item.state === 'Offen';
    return !calendar.kind || calendar.kind === item.kind;
  });
}
const rowOptions = (rows, section, label) => [['', label], ...rows.filter(row => sectionOf(row) === section).map(row => [row.id, nameOf(row)])];
const selection = (label, key, choices, selected) => '<label class="input-wrap">' + esc(label) + '<select name="' + key + '">' + options(choices, selected) + '</select></label>';
const dateInput = (label, key, value) => '<label class="input-wrap">' + esc(label) + '<input type="date" name="' + key + '" value="' + esc(value) + '"></label>';

export function searchControls(rows, filters) {
  return '<form id="search-form" class="filters" role="search"><label class="input-wrap wide">Suchbegriff<input id="search-query" type="search" name="query" placeholder="Titel, Notiz, Person, Dateiname …" value="' +
    esc(filters.query) + '"></label>' + selection('Bereich', 'section', [['', 'Alle Bereiche'], ...recordSections], filters.section) +
    selection('Fall', 'caseId', rowOptions(rows, 'Fälle', 'Alle Fälle'), filters.caseId) +
    selection('Person', 'personId', rowOptions(rows, 'Personen', 'Alle Personen'), filters.personId) +
    dateInput('Von', 'from', filters.from) + dateInput('Bis', 'to', filters.to) +
    '<label class="check"><input type="checkbox" name="archived"' + (filters.archived ? ' checked' : '') + '> Archiv einbeziehen</label></form>';
}
export function searchResults(rows, files, filters) {
  const result = searchRecords(rows, files, filters.query, filters);
  return panel(result.length + (result.length === 1 ? ' Eintrag' : ' Einträge'), result.length ? result.map(row => recordRow(row)).join('') :
    empty('search', 'Keine passenden Einträge', 'Prüfe den Suchbegriff oder ändere die Filter.'));
}
export const exportKinds = {
  all: ['Ausgewählte Einträge', recordSections],
  case: ['Falldossier', recordSections],
  talks: ['Gesprächsprotokoll', ['Gespräche']],
  health: ['Gesundheitsübersicht', ['Gesundheit','Arztzeugnisse']],
  history: ['Chronik', ['Chronik']],
};
export function exportCandidates(rows, filters) {
  return searchRecords(rows, [], '', filters).filter(row => (exportKinds[filters.kind] ?? exportKinds.all)[1].includes(sectionOf(row)))
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
}
export function exportControls(rows, filters) {
  return '<form id="export-form" class="filters">' +
    selection('Vorlage', 'kind', Object.entries(exportKinds).map(([id, [label]]) => [id, label]), filters.kind) +
    selection('Fall', 'caseId', rowOptions(rows, 'Fälle', 'Alle Fälle'), filters.caseId) +
    dateInput('Von', 'from', filters.from) + dateInput('Bis', 'to', filters.to) +
    '<label class="check"><input type="checkbox" name="archived"' + (filters.archived ? ' checked' : '') + '> Archiv einbeziehen</label></form>';
}
export function exportList(rows, filters, excluded, includeFiles) {
  const candidates = exportCandidates(rows, filters);
  return panel('Einträge auswählen', '<div class="panel-body settings-content">' +
    (candidates.length ? '<div class="actions">' + button('Alle markieren', 'export-select', 'all') + button('Auswahl aufheben', 'export-select', 'none') +
    '</div><div class="export-list">' + candidates.map(row => '<label class="check"><input type="checkbox" data-export-row="' + esc(row.id) + '"' +
      (excluded.has(row.id) ? '' : ' checked') + '> ' + esc(nameOf(row) + ' · ' + sectionOf(row) + ' · ' + showDate(dateOf(row))) + '</label>').join('') + '</div>' :
    empty('download', 'Keine Einträge für diese Auswahl')) +
    '<label class="check"><input type="checkbox" data-export-files' + (includeFiles ? ' checked' : '') + '> Dateinamen, Upload-Daten und Prüfsummen einschliessen</label>' +
    '<p class="hint">Der Export enthält die gewählten Einträge. Originaldateien bleiben separat herunterladbar.</p><div class="actions">' +
    button('PDF erstellen', 'make-pdf', '', 'download', 'primary') + '</div></div>');
}
