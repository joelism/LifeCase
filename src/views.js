import { displayedAgenda, providers } from './connected-model.js';
import { icon } from './icons.js';
import { button, empty, esc, jump, options, tag } from './ui.js';
import { CH_ZONE, calendarEntries, dateOf, isActive, nameOf, recordSections, reminderDue, searchRecords, sectionOf, sections, shiftDate, showDate, today, value } from './model.js';

import { profileInitials, profileName } from './profile.js';

const labels = new Intl.DateTimeFormat('de-CH', { dateStyle: 'full', timeZone: CH_ZONE });
const monthFormat = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: CH_ZONE });
const shortMonth = new Intl.DateTimeFormat('de-CH', { month: 'short', timeZone: CH_ZONE });
const kindStyle = {
  Termin: ['calendar',''], Schicht: ['clock','green'], Aufgabe: ['tasks','green'], Frist: ['flag','amber'],
  Arztzeugnis: ['badge','rose'], Rezept: ['file','rose'], Erinnerung: ['bell','amber'], Gespräch: ['message',''],
  Arztbesuch: ['heart','rose'], Wiedervorlage: ['refresh','amber'],
};
const statusColor = value => ({ Abgeschlossen: 'green', Erledigt: 'green', Wartet: 'amber', Abgesagt: 'rose', Archiviert: 'amber' })[value] || '';

export const brand = '<span class="brand"><span class="brand-mark">' + icon('logo', 25) + '</span><span>LifeCase</span></span>';
const navGroups = [['', 'Übersicht', 'Kalender', 'Einkaufen', 'Scannen'], ['Postfach', 'Posteingang', 'Terminprüfung'], ['Dossiers', 'Fälle', 'Chronik', 'Gespräche', 'Beweismittel', 'Personen'], ['Gesundheit', 'Gesundheit', 'Arztzeugnisse', 'Rezepte', 'Gesundheitsdaten'], ['Werkzeuge', 'Erinnerungen', 'Google Drive', 'Suche', 'PDF-Export', 'Verbindungen']];
const navButton = (label, view, compact = false) => '<button class="' + (compact ? '' : 'nav-item') + '" type="button" data-view="' + esc(label) + '"' +
  (view === label ? ' aria-current="page"' : '') + '>' + icon(sections[label].icon, compact ? 21 : 18) +
  esc(compact && label === 'Übersicht' ? 'Heute' : label) + '</button>';

export function shell(view, inner, state) {
  const reminders = calendarEntries(state.rows).filter(item => reminderDue(item, today())).length;
  const name = profileName(state.session?.user);
  const avatar = '<span class="profile-mark" aria-hidden="true">' + (name ? esc(profileInitials(name)) : icon('people', 17)) + '</span>';
  return '<div class="layout' + (state.menu ? ' menu-open' : '') + '"><button type="button" class="scrim" data-menu="" aria-label="Menü schliessen"></button>' +
    '<aside class="sidebar">' + brand + '<nav class="side-nav" aria-label="Hauptnavigation">' + navGroups.map(([label, ...group]) =>
      (label ? '<h2>' + esc(label) + '</h2>' : '') + group.map(item => navButton(item, view)).join('')).join('') +
    '</nav><div class="sidebar-foot"><button type="button" class="side-profile" data-view="Einstellungen"' +
    (view === 'Einstellungen' ? ' aria-current="page"' : '') + '>' + avatar + '<span class="profile-label"><strong>' + esc(name || 'Mein Profil') +
    '</strong><small>Einstellungen</small></span>' + icon('settings', 16) + '</button></div></aside>' +
    '<div class="workspace"><header class="top"><div class="top-location">' + icon(sections[view].icon, 16) + esc(view) +
    '</div><div class="mobile-brand">' + brand + '</div><div class="top-actions"><button class="find" type="button" data-view="Suche" aria-label="Global suchen">' +
    icon('search', 17) + '<span>Suchen</span><kbd>⌘ K</kbd></button><button type="button" class="icon-btn assistant-trigger" data-assistant aria-label="Terminassistent">' +
    icon('chat', 21) + '</button><button type="button" class="icon-btn notification-button" data-view="Erinnerungen" aria-label="Erinnerungen' +
    (reminders ? ', ' + reminders + ' fällig' : '') + '">' + icon('bell', 19) +
    (reminders ? '<span class="notice-count" aria-hidden="true">' + (reminders > 9 ? '9+' : reminders) + '</span>' : '') +
    '</button><button type="button" class="icon-btn top-sync" data-reload aria-label="Synchronisieren">' + icon('refresh', 19) +
    '</button></div></header><main id="main" class="main' + (view === 'Übersicht' ? ' dashboard-main' : '') + '" tabindex="-1">' +
    (state.error ? '<div class="banner" role="alert">' + icon('info', 18) + esc(state.error) + '</div>' : '') + inner +
    '</main></div><nav class="bottom-nav mobile" aria-label="Mobile Navigation">' + ['Übersicht', 'Kalender', 'Einkaufen', 'Scannen'].map(label => navButton(label, view, true)).join('') +
    '<button type="button" data-menu="" aria-expanded="' + state.menu + '">' + icon('menu', 21) + 'Mehr</button></nav></div>';
}
export const heading = (section, actions = '') => '<div class="heading"><div><h1>' + esc(section) + '</h1><p>' + esc(sections[section].description) + '</p></div>' +
  (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
export const panel = (title, body, action = '') => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + action + '</div>' + body + '</section>';

const spacingTag = item => item?.spacing ? '<span class="spacing-tag ' + (item.spacing === 'Überschneidung' ? 'collision' : '') + '">' + esc(item.spacing) + '</span>' : '';

export function recordRow(row, info = '', item = null) {
  const [symbol, color] = item ? kindStyle[item.kind] ?? ['calendar', ''] : [sections[sectionOf(row)]?.icon ?? 'file', ''];
  const status = row.archived_at ? 'Archiviert' : item ? item.kind : value(row, 'status') || value(row, 'kind');
  const details = info || (item ? [showDate(item.date), [item.time, item.endTime].filter(Boolean).join('–'), item.state !== 'Offen' ? item.state : ''].filter(Boolean).join(' · ') :
    [value(row, 'category') || value(row, 'organisation') || sectionOf(row), showDate(dateOf(row))].filter(Boolean).join(' · '));
  const emblem = item ? '<span class="date-badge"><small>' + esc(shortMonth.format(new Date(item.date + 'T12:00:00Z'))) + '</small>' + esc(item.date.slice(-2)) + '</span>' :
    '<span class="tile-icon ' + color + '">' + icon(symbol, 19) + '</span>';
  return '<button type="button" class="row" data-open="' + esc(row.id) + '">' + emblem + '<span class="row-info"><span class="row-title">' +
    esc(nameOf(row)) + '</span><span class="row-sub">' + esc(details) + '</span></span><span class="row-tail">' + spacingTag(item) + tag(status, color || statusColor(status)) + icon('right', 15) + '</span></button>';
}

function externalRow(item) {
  const event = item.external;
  return '<button type="button" class="row external-row" data-external-open="' + esc(event.provider + '|' + event.id + '|' + event.date) + '">' +
    '<span class="provider-mark ' + event.provider + '">' + providers[event.provider].mark + '</span>' + '<span class="row-info"><span class="row-title">' + esc(event.title) +
    '</span><span class="row-sub">' + esc([showDate(event.date), event.time || (event.allDay ? 'Ganztägig' : ''), event.location].filter(Boolean).join(' · ')) +
    '</span></span><span class="row-tail">' + spacingTag(item) + tag(providers[event.provider].calendar) + icon('right', 15) + '</span></button>';
}

function agendaRow(item) {
  return item.external ? externalRow(item) : recordRow(item.row, '', item);
}

function externalStatus(connected) {
  if (!connected) return '';
  const messages = connected.calendarErrors.map(err => '<div class="banner" role="status">' + esc(err) + '</div>').join('');
  return messages + (connected.calendarLoading ? '<p class="hint calendar-sync" role="status">Externe Kalender werden geladen …</p>' : '');
}

const horizon = '<svg class="hero-horizon" viewBox="0 0 510 260" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">' +
  '<path d="M122 260C108 168 199 88 313 84c85-3 160 27 211 72M91 260C83 147 189 51 311 47c103-3 171 36 223 82M59 260C56 119 183 13 313 11c97-2 190 28 225 79M153 260c-13-73 58-135 159-138 66-2 126 21 173 51" stroke="currentColor"/>' +
  '<path d="M242 115v20m-10-10h20M403 41v14m-7-7h14M435 190v28m-14-14h28" stroke="currentColor" stroke-linecap="round"/>' +
  '<circle cx="242" cy="125" r="3" fill="currentColor"/><circle cx="435" cy="204" r="4" fill="currentColor"/></svg>';

function shortcut(symbol, label, action, target, color = '') {
  return '<button type="button" class="dash-shortcut" data-' + action + '="' + esc(target) + '"><span class="tile-icon ' + color + '">' +
    icon(symbol, 19) + '</span><span>' + esc(label) + '</span>' + icon('right', 14) + '</button>';
}

function featuredAppointment(item, day) {
  if (!item) return '';
  const entry = item.external;
  const title = entry ? entry.title : nameOf(item.row);
  const action = entry ? 'external-open' : 'open';
  const key = entry ? [entry.provider, entry.id, entry.date].join('|') : item.row.id;
  const when = [item.date === day ? 'Heute' : showDate(item.date), item.time].filter(Boolean).join(' · ');
  return '<button type="button" class="hero-next" data-' + action + '="' + esc(key) + '"><span class="hero-next-icon">' + icon('calendar', 19) +
    '</span><span class="hero-next-copy"><span class="hero-next-label">Nächster Termin</span><strong>' + esc(title) +
    '</strong><span class="hero-next-time">' + esc(when) + '</span></span>' + icon('right', 16) + '</button>';
}

export function dashboard(rows, loading, connected, { name = '', suggestions = 0 } = {}) {
  const day = today();
  const active = rows.filter(isActive);
  const open = active.filter(row => sectionOf(row) === 'Fälle' && value(row, 'status') !== 'Abgeschlossen');
  const timeline = displayedAgenda(active, connected.events).filter(item => item.state === 'Offen');
  const appointmentKinds = ['Termin', 'Gespräch', 'Arztbesuch', 'Schicht'];
  const appointments = timeline.filter(item => appointmentKinds.includes(item.kind) && item.date >= day);
  const tasks = timeline.filter(item => ['Aufgabe', 'Frist'].includes(item.kind));
  const reminders = timeline.filter(item => reminderDue(item, day));
  const upcoming = timeline.filter(item => item.date > day);
  const overdue = tasks.filter(item => item.date < day);
  const todaysItems = timeline.filter(item => item.date === day);
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const next = appointments.find(item => item.date > day || !item.time || item.time >= now);
  const greeting = name ? 'Hey, ' + name : 'Dein Tag';
  const todayPanel = panel('Heute', todaysItems.length ? todaysItems.slice(0, 8).map(agendaRow).join('') :
    empty('calendar', loading ? 'Wird synchronisiert …' : 'Heute steht nichts an'), jump('Tagesansicht', 'calendar-today', '', 'calendar'));
  const upcomingPanel = panel('Als Nächstes', upcoming.length ? upcoming.slice(0, 6).map(agendaRow).join('') :
    empty('calendar', loading ? 'Wird synchronisiert …' : 'Keine bevorstehenden Einträge'), jump('Kalender', 'view', 'Kalender'));
  const glance = '<section class="dash-glance panel"><h2>Im Blick</h2><div class="dash-glance-list">' + [
    ['Offene Fälle', open.length, 'folder', '', 'Fälle|offen'],
    ['Aufgaben und Fristen', tasks.length, 'tasks', 'green', 'Kalender|aufgaben'],
    ['Fällige Erinnerungen', reminders.length, 'bell', 'rose', 'Erinnerungen|'],
    ['Terminvorschläge', suggestions, 'mail', 'amber', 'Terminprüfung|'],
  ].map(([label, count, symbol, color, target]) => '<button type="button" class="glance-row" data-metric="' + esc(target) +
    '"><span class="tile-icon ' + color + '">' + icon(symbol, 16) + '</span><span>' + esc(label) + '</span><strong>' +
    (loading ? '–' : count) + '</strong>' + icon('right', 14) + '</button>').join('') + '</div></section>';
  const alerts = (overdue.length ? panel('Überfällige Aufgaben', overdue.slice(0, 4).map(agendaRow).join(''),
    jump('Alle Aufgaben', 'metric', 'Kalender|aufgaben')) : '') +
    (reminders.length ? panel('Fällige Erinnerungen', reminders.slice(0, 4).map(agendaRow).join(''),
      jump('Alle Erinnerungen', 'view', 'Erinnerungen')) : '');
  return '<section class="hero dashboard-hero">' + horizon + '<div class="hero-copy"><span class="hero-date">' +
    icon('calendar', 15) + esc(labels.format(new Date())) + '</span><h1>' + esc(greeting) + '</h1><div class="hero-actions">' +
    button('Terminassistent', 'assistant', '', 'chat', 'hero-cta') + (!name ?
      '<button type="button" class="hero-personalize" data-view="Einstellungen">' + icon('people', 17) + 'Begrüssung anpassen' + '</button>' : '') +
    '</div></div>' + featuredAppointment(next, day) + '</section><nav class="dash-shortcuts" aria-label="Schnellzugriff">' +
    shortcut('plus', 'Eintrag erfassen', 'quick', '') + shortcut('camera', 'Dokument scannen', 'scan-start', 'document', 'amber') +
    shortcut('cart', 'Einkaufen', 'view', 'Einkaufen', 'green') + shortcut('mail', 'Posteingang', 'view', 'Posteingang', 'rose') +
    '</nav>' + externalStatus(connected) + '<div class="dashboard-grid"><div class="dashboard-today">' + todayPanel +
    '</div><aside class="dashboard-side" aria-label="Wichtige Einträge">' + alerts + glance +
    (open.length ? panel('Aktive Dossiers', open.slice(0, 3).map(row => recordRow(row)).join(''), jump('Alle Fälle', 'view', 'Fälle')) : '') +
    '</aside><div class="dashboard-upcoming">' + upcomingPanel + '</div></div>';
}

export function sectionPage(section, rows, filter, loading) {
  const info = sections[section];
  const day = today();
  const local = searchRecords(rows, [], '', { section, archived: filter === 'archiv', onlyArchived: filter === 'archiv' }).filter(row => {
    if (filter === 'offen') return value(row, 'status') !== 'Abgeschlossen';
    if (filter === 'bald') return calendarEntries([row]).some(item => reminderDue(item, day));
    return true;
  });
  if (section === 'Chronik' || section === 'Gespräche') local.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  if (['Arztzeugnisse','Rezepte'].includes(section)) local.sort((a, b) => String(value(b, 'validUntil')).localeCompare(String(value(a, 'validUntil'))));
  const choices = [['', 'Aktive Einträge'], ['archiv', 'Archiv']];
  if (section === 'Fälle') choices.splice(1, 0, ['offen', 'Offene Fälle']);
  if (['Arztzeugnisse','Rezepte'].includes(section)) choices.splice(1, 0, ['bald', 'Ablauf in einem Monat']);
  return heading(section, button(info.create, 'create', section, 'plus', 'primary')) +
    '<div class="filters"><label class="input-wrap">Ansicht<select data-section-filter>' + options(choices, filter) + '</select></label></div>' +
    '<section class="panel" aria-label="' + esc(section) + '">' + (local.length ? local.map(row => recordRow(row,
      ['Arztzeugnisse','Rezepte'].includes(section) && value(row, 'validUntil') ?
        (value(row, 'validUntil') < day ? 'Abgelaufen am ' : 'Gültig bis ') + showDate(value(row, 'validUntil')) +
        (section === 'Arztzeugnisse' ? ' · ' + value(row, 'incapacity') + ' % AU' : '') : '')).join('') :
      empty(info.icon, loading ? 'Wird synchronisiert …' : filter ? 'Keine passenden Einträge' : info.empty, '', filter ? '' : button(info.create, 'create', section, 'plus'))) + '</section>';
}

const calendarKinds = [['', 'Alle Arten'], ['termine', 'Termine und Besuche'], ['Schicht', 'Schichten'], ['aufgaben', 'Aufgaben und Fristen'], ['Arztzeugnis', 'Arztzeugnisse'], ['Rezept', 'Rezepte'], ['Erinnerung', 'Erinnerungen'], ['Wiedervorlage', 'Wiedervorlagen']];
export function calendarPage(rows, calendar, connected) {
  const day = today();
  const first = calendar.month + '-01';
  const dow = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const start = shiftDate(first, -dow);
  const matches = displayedAgenda(rows, connected.events).filter(item => {
    if (item.external && calendar.source && item.external.provider !== calendar.source) return false;
    if (!item.external && calendar.source && calendar.source !== 'local') return false;
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
    '<label class="input-wrap">Quelle<select data-calendar-source>' + options([['', 'Alle Quellen'], ['local', 'LifeCase'],
      ...Object.entries(providers).filter(([key]) => connected.accounts?.[key]?.connected).map(([key, provider]) => [key, provider.calendar])], calendar.source) + '</select></label>' +
    (calendar.selected ? button('Tagesfilter entfernen', 'day', '', 'close') : '') +
    (Object.keys(providers).some(key => connected.accounts?.[key]?.connected) ? button('Kalender aktualisieren', 'external-reload', '', 'refresh') : '') +
    '</div>' + externalStatus(connected) + '<div class="calendar-layout">' + month +
    panel(calendar.selected ? showDate(calendar.selected) : 'Agenda', items.length ? items.map(agendaRow).join('') :
      empty('calendar','Keine Einträge in dieser Ansicht'), items.some(item => !item.external) ? jump('LifeCase-Termine exportieren', 'ics', 'agenda', 'download') : '') + '</div>';
}
export function selectedCalendar(rows, calendar) {
  if (calendar.source && calendar.source !== 'local') return [];
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
  health: ['Gesundheitsübersicht', ['Gesundheit','Arztzeugnisse','Rezepte']],
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
