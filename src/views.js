import { renderSleepPlan } from './sleep-views.js';
import { appointmentCheckIns, checkInQuestion } from './appointment-care.js';
import { calendarRecordTitle } from './calendar-assistant.js';
import { displayedAgenda, providers } from './connected-model.js';
import { findLunchSlot } from './lunch.js';
import { groupWorkdays, lunchLabel } from './workday.js';
import { icon } from './icons.js';
import { button, empty, esc, jump, options, tag } from './ui.js';
import { CH_ZONE, calendarEntries, dateOf, isActive, nameOf, recordSections, reminderDue, searchRecords, sectionOf, sections, shiftDate, showDate, today, value } from './model.js';

import { isOpenTask, planningKinds } from './planning.js';
import { profileInitials, profileName } from './profile.js';

const labels = new Intl.DateTimeFormat('de-CH', { dateStyle: 'full', timeZone: CH_ZONE });
const monthFormat = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: CH_ZONE });
const dayHeading = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CH_ZONE });
const shortMonth = new Intl.DateTimeFormat('de-CH', { month: 'short', timeZone: CH_ZONE });
const kindStyle = {
  Termin: ['calendar',''], Schicht: ['clock','positive'], Pause: ['sun','positive'], Aufgabe: ['tasks','positive'], Frist: ['flag','amber'],
  Arztzeugnis: ['badge','rose'], Rezept: ['file','rose'], Erinnerung: ['bell','amber'], Gespräch: ['message',''],
  Arztbesuch: ['heart','rose'], Wiedervorlage: ['refresh','amber'],
};
const statusColor = value => ({ Abgeschlossen: 'positive', Erledigt: 'positive', Wartet: 'amber', Abgesagt: 'rose', Archiviert: 'amber' })[value] || '';

export const brand = '<span class="brand"><span class="brand-mark">' + icon('logo', 25) + '</span><span>LifeCase</span></span>';
const navGroups = [['', 'Übersicht', 'Meine Woche', 'Kalender', 'Einkaufen', 'Scannen'], ['Postfach', 'Posteingang', 'Terminprüfung'], ['Dossiers', 'Fälle', 'Chronik', 'Gespräche', 'Beweismittel', 'Personen'], ['Gesundheit', 'Gesundheit', 'Arztzeugnisse', 'Rezepte', 'Gesundheitsdaten'], ['Werkzeuge', 'Erinnerungen', 'Google Drive', 'Suche', 'PDF-Export', 'Verbindungen']];
const navButton = (label, view, compact = false) => '<button class="' + (compact ? '' : 'nav-item') + '" type="button" data-view="' + esc(label) + '"' +
  (view === label ? ' aria-current="page"' : '') + '>' + icon(sections[label].icon, compact ? 21 : 18) +
  esc(compact ? ({ Übersicht: 'Heute', 'Meine Woche': 'Woche' })[label] ?? label : label) + '</button>';

export function shell(view, inner, state) {
  const reminders = calendarEntries(state.rows).filter(item => reminderDue(item, today())).length +
    appointmentCheckIns(state.rows).length;
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
    icon('search', 17) + '<span>Suchen</span><kbd>⌘ K</kbd></button><button type="button" class="icon-btn assistant-trigger" data-assistant aria-label="LifeCase-Assistent">' +
    icon('chat', 21) + '</button><button type="button" class="icon-btn notification-button" data-view="Erinnerungen" aria-label="Erinnerungen' +
    (reminders ? ', ' + reminders + ' fällig' : '') + '">' + icon('bell', 19) +
    (reminders ? '<span class="notice-count" aria-hidden="true">' + (reminders > 9 ? '9+' : reminders) + '</span>' : '') +
    '</button><button type="button" class="icon-btn top-sync" data-reload aria-label="Synchronisieren">' + icon('refresh', 19) +
    '</button></div></header><main id="main" class="main' + (view === 'Übersicht' ? ' dashboard-main' : '') + '" tabindex="-1">' +
    (state.error ? '<div class="banner" role="alert">' + icon('info', 18) + esc(state.error) + '</div>' : '') + inner +
    '</main></div><nav class="bottom-nav mobile" aria-label="Mobile Navigation">' + ['Übersicht', 'Meine Woche', 'Kalender', 'Einkaufen'].map(label => navButton(label, view, true)).join('') +
    '<button type="button" data-menu="" aria-expanded="' + state.menu + '">' + icon('menu', 21) + 'Mehr</button></nav></div>';
}
export const heading = (section, actions = '') => '<div class="heading"><div><h1>' + esc(section) + '</h1><p>' + esc(sections[section].description) + '</p></div>' +
  (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
export const panel = (title, body, action = '') => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + action + '</div>' + body + '</section>';

const spacingTag = item => item?.spacing ? '<span class="spacing-tag ' + (item.spacing === 'Überschneidung' ? 'collision' : '') + '">' + esc(item.spacing) + '</span>' : '';

export function recordRow(row, info = '', item = null, compact = false) {
  const [symbol, color] = item ? kindStyle[item.kind] ?? ['calendar', ''] : [sections[sectionOf(row)]?.icon ?? 'file', ''];
  const status = row.archived_at ? 'Archiviert' : item ? item.kind : value(row, 'status') || value(row, 'kind');
  const details = info || (item ? [compact ? '' : showDate(item.date), [item.time, item.endTime].filter(Boolean).join('–'), item.state !== 'Offen' ? item.state : ''].filter(Boolean).join(' · ') :
    [value(row, 'category') || value(row, 'organisation') || sectionOf(row), showDate(dateOf(row))].filter(Boolean).join(' · '));
  const emblem = item && !compact ? '<span class="date-badge"><small>' + esc(shortMonth.format(new Date(item.date + 'T12:00:00Z'))) + '</small>' + esc(item.date.slice(-2)) + '</span>' :
    '<span class="tile-icon ' + color + '">' + icon(symbol, 19) + '</span>';
  return '<button type="button" class="row" data-open="' + esc(row.id) + '">' + emblem + '<span class="row-info"><span class="row-title">' +
    esc(calendarRecordTitle(row)) + '</span><span class="row-sub">' + esc(details) + '</span></span><span class="row-tail">' + spacingTag(item) + tag(status, color || statusColor(status)) + icon('right', 15) + '</span></button>';
}

function externalRow(item, compact = false) {
  const event = item.external;
  return '<button type="button" class="row external-row" data-external-open="' + esc(event.provider + '|' + event.id + '|' + event.date) + '">' +
    '<span class="provider-mark ' + event.provider + '">' + providers[event.provider].mark + '</span>' + '<span class="row-info"><span class="row-title">' + esc(event.title) +
    '</span><span class="row-sub">' + esc([compact ? '' : showDate(event.date), event.time || (event.allDay ? 'Ganztägig' : ''), event.location].filter(Boolean).join(' · ')) +
    '</span></span><span class="row-tail">' + spacingTag(item) + tag(providers[event.provider].calendar) + icon('right', 15) + '</span></button>';
}

function agendaRow(item, compact = false) {
  if (item.shifts) {
    return '<button type="button" class="row workday-row" data-workday="' + esc(item.row.id) + '">' +
      '<span class="tile-icon">' + icon('clock', 19) + '</span><span class="row-info"><strong class="row-title">' +
      esc(nameOf(item.row)) + '</strong><small class="row-sub">' + esc([compact ? '' : showDate(item.date), item.time + '–' + item.endTime].filter(Boolean).join(' · ')) +
      '</small><span class="workday-break">' + icon('sun', 14) + esc(lunchLabel(item.lunch)) + '</span></span><span class="row-tail">' +
      icon('right', 15) + '</span></button>';
  }
  return item.external ? externalRow(item, compact) : recordRow(item.row, '', item, compact);
}

function upcomingRows(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  }
  return [...groups].map(([date, events]) => '<div class="dashboard-day"><h3>' +
    esc(dayHeading.format(new Date(date + 'T12:00:00Z'))) + '</h3>' + events.map(item => agendaRow(item, true)).join('') + '</div>').join('');
}

function externalStatus(connected) {
  if (!connected) return '';
  const messages = connected.calendarErrors.map(err => '<div class="banner" role="status">' + esc(err) + '</div>').join('');
  return messages + (connected.calendarLoading ? '<p class="hint calendar-sync" role="status">Externe Kalender werden geladen …</p>' : '');
}

function shortcut(symbol, label, action, target) {
  return '<button type="button" class="dash-shortcut" data-' + action + '="' + esc(target) + '"><span class="tile-icon">' +
    icon(symbol, 19) + '</span><span>' + esc(label) + '</span>' + icon('right', 14) + '</button>';
}

export function checkInPanel(rows, limit = rows.length) {
  if (!rows.length) return '';
  return panel('Nach dem Termin', rows.slice(0, limit).map(row =>
    '<button type="button" class="row care-row" data-care-check-in="' + esc(row.id) + '">' +
    '<span class="tile-icon">' + icon('chat', 18) + '</span><span class="row-info"><strong class="row-title">' +
    esc(checkInQuestion(row)) + '</strong><small class="row-sub">' +
    esc([nameOf(row), value(row, 'appointmentExpected')].filter(Boolean).join(' · ')) +
    '</small></span><span class="row-tail">' + icon('right', 15) + '</span></button>').join(''),
  rows.length > limit ? jump('Alle Rückfragen', 'view', 'Erinnerungen') : '');
}

export function dashboard(rows, loading, connected, { name = '', suggestions = 0, briefing = '', sleepSettings = null } = {}) {
  const day = today();
  const active = rows.filter(isActive);
  const openCases = active.filter(row => sectionOf(row) === 'Fälle' && value(row, 'status') !== 'Abgeschlossen').length;
  const agenda = displayedAgenda(active, connected.events).filter(item => item.state === 'Offen');
  const timeline = groupWorkdays(agenda);
  const sleep = !loading && sleepSettings ? renderSleepPlan(agenda, connected.recentSleep, sleepSettings, {
    overview: true, calendarIncomplete: !connected.accounts || connected.calendarLoading || Boolean(connected.calendarErrors?.length),
  }) : '';
  const datedTasks = timeline.filter(item => planningKinds.includes(item.kind));
  const undated = active.filter(row => isOpenTask(row) && !value(row, 'date')).length;
  const reminders = timeline.filter(item => reminderDue(item, day)).length;
  const overdue = datedTasks.filter(item => item.date < day).length;
  const upcoming = timeline.filter(item => item.date > day);
  const todaysItems = timeline.filter(item => item.date === day);
  const meetings = new Set(['Termin', 'Gespräch', 'Arztbesuch', 'Schicht']);
  const slot = !loading && connected.accounts && !connected.calendarLoading && !connected.calendarErrors.length &&
    !todaysItems.some(item => item.lunch) && todaysItems.filter(item => meetings.has(item.kind) && item.external?.busy !== false).length >= 2 ?
    findLunchSlot(timeline, day) : null;
  const lunchNudge = slot ? '<section class="lunch-nudge panel"><span class="tile-icon positive">' + icon('sun', 20) +
    '</span><div><strong>Platz für deine Mittagspause</strong><p>' + esc(slot.time + '–' + slot.endTime) +
    '</p></div>' + button('Vorschlag prüfen', 'assistant-lunch', '', 'arrow') + '</section>' : '';
  const greeting = name ? 'Hey, ' + name : 'Schön, dass du da bist';
  const todayPanel = panel('Heute', todaysItems.length ? todaysItems.slice(0, 4).map(item => agendaRow(item, true)).join('') :
    empty('calendar', loading ? 'Wird synchronisiert …' : 'Heute steht nichts an'), jump('Tagesansicht', 'calendar-today'));
  const upcomingPanel = panel('Demnächst', upcoming.length ? upcomingRows(upcoming.slice(0, 3)) :
    empty('calendar', loading ? 'Wird synchronisiert …' : 'Keine bevorstehenden Einträge'), jump('Zum Kalender', 'view', 'Kalender'));
  const priorities = [
    ['Fällige Erinnerungen', reminders, 'bell', 'rose', 'Erinnerungen|'],
    [overdue ? 'Überfällige Aufgaben' : 'Offene Aufgaben', overdue || datedTasks.length + undated, 'tasks', overdue ? 'amber' : '', 'Meine Woche|'],
    ['Terminvorschläge', suggestions, 'mail', '', 'Terminprüfung|'],
    ['Offene Fälle', openCases, 'folder', '', 'Fälle|offen'],
  ].filter(([, count]) => count > 0);
  const glance = priorities.length ? '<section class="dash-glance panel"><h2>Im Blick</h2><div class="dash-glance-list">' +
    priorities.map(([label, count, symbol, color, target]) => '<button type="button" class="glance-row" data-metric="' + esc(target) +
      '"><span class="tile-icon ' + color + '">' + icon(symbol, 16) + '</span><span>' + esc(label) + '</span><strong>' + count +
      '</strong>' + icon('right', 14) + '</button>').join('') + '</div></section>' : '';
  const urgent = reminders || overdue;
  return '<header class="day-welcome"><div><span class="day-date">' + esc(labels.format(new Date())) +
    '</span><h1>' + esc(greeting) + '</h1></div>' +
    button('Meine Woche', 'view', 'Meine Woche', 'week', 'day-week') + '</header>' + externalStatus(connected) +
    '<div class="dashboard-flow">' + checkInPanel(appointmentCheckIns(active), 2) + briefing + sleep + todayPanel + lunchNudge + '<nav class="dash-shortcuts" aria-label="Schnellzugriff">' +
    shortcut('plus', 'Eintrag erfassen', 'quick', '') + shortcut('chat', 'Assistent', 'assistant', '') +
    shortcut('camera', 'Dokument scannen', 'scan-start', 'document') + shortcut('mail', 'Posteingang', 'view', 'Posteingang') +
    '</nav>' + (urgent ? glance : '') + upcomingPanel + (urgent ? '' : glance) + '</div>';
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

const calendarKinds = [['', 'Alle Arten'], ['termine', 'Termine und Besuche'], ['Schicht', 'Schichten'], ['Pause', 'Pausen'], ['aufgaben', 'Aufgaben und Fristen'], ['Arztzeugnis', 'Arztzeugnisse'], ['Rezept', 'Rezepte'], ['Erinnerung', 'Erinnerungen'], ['Wiedervorlage', 'Wiedervorlagen']];
export function calendarPage(rows, calendar, connected) {
  const day = today();
  const first = calendar.month + '-01';
  const dow = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const start = shiftDate(first, -dow);
  const matches = groupWorkdays(displayedAgenda(rows, connected.events)).filter(item => {
    if (item.external && calendar.source && item.external.provider !== calendar.source) return false;
    if (!item.external && calendar.source && calendar.source !== 'local') return false;
    if (calendar.kind === 'termine') return ['Termin','Gespräch','Arztbesuch'].includes(item.kind) && item.state === 'Offen' && item.date >= day;
    if (calendar.kind === 'aufgaben') return planningKinds.includes(item.kind) && item.state === 'Offen';
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
  const undated = calendar.kind === 'aufgaben' && !calendar.selected && (!calendar.source || calendar.source === 'local') ?
    rows.filter(row => isOpenTask(row) && !value(row, 'date')) : [];
  return heading('Kalender', button('Archiv', 'calendar-archive', '', 'archive') + button('Neuer Kalendereintrag', 'create', 'Kalender', 'plus', 'primary')) +
    '<div class="filters"><label class="input-wrap">Eintragsart<select data-calendar-kind>' + options(calendarKinds, calendar.kind) + '</select></label>' +
    '<label class="input-wrap">Quelle<select data-calendar-source>' + options([['', 'Alle Quellen'], ['local', 'LifeCase'],
      ...Object.entries(providers).filter(([key]) => connected.accounts?.[key]?.connected).map(([key, provider]) => [key, provider.calendar])], calendar.source) + '</select></label>' +
    (calendar.selected ? button('Tagesfilter entfernen', 'day', '', 'close') : '') +
    (Object.keys(providers).some(key => connected.accounts?.[key]?.connected) ? button('Kalender aktualisieren', 'external-reload', '', 'refresh') : '') +
    '</div>' + externalStatus(connected) + '<div class="calendar-layout">' + month +
    panel(calendar.selected ? showDate(calendar.selected) : 'Agenda', items.length ? items.map(item => agendaRow(item)).join('') :
      empty('calendar','Keine Einträge in dieser Ansicht'), items.some(item => !item.external) ? jump('LifeCase-Termine exportieren', 'ics', 'agenda', 'download') : '') + '</div>' +
    (undated.length ? panel('Aufgaben ohne Datum', undated.map(row => recordRow(row)).join(''), jump('Meine Woche', 'view', 'Meine Woche', 'week')) : '');
}
export function selectedCalendar(rows, calendar) {
  if (calendar.source && calendar.source !== 'local') return [];
  return calendarEntries(rows).filter(item => {
    if (calendar.selected ? item.date !== calendar.selected : !['termine','aufgaben'].includes(calendar.kind) && !item.date.startsWith(calendar.month)) return false;
    if (calendar.kind === 'termine') return ['Termin','Gespräch','Arztbesuch'].includes(item.kind) && item.state === 'Offen' && item.date >= today();
    if (calendar.kind === 'aufgaben') return planningKinds.includes(item.kind) && item.state === 'Offen';
    return !calendar.kind || calendar.kind === item.kind;
  });
}
const rowOptions = (rows, section, label) => [['', label], ...rows.filter(row => sectionOf(row) === section).map(row => [row.id, nameOf(row)])];
const selection = (label, key, choices, selected) => '<label class="input-wrap">' + esc(label) + '<select name="' + key + '">' + options(choices, selected) + '</select></label>';
const dateInput = (label, key, value) => '<label class="input-wrap">' + esc(label) + '<input type="date" name="' + key + '" value="' + esc(value) + '"></label>';

export function searchControls(rows, filters) {
  return '<form id="search-form" class="filters" role="search"><label class="input-wrap wide">Suchbegriff<input id="search-query" type="search" name="query" placeholder="Titel, Notiz, Person, Dateiname …" value="' +
    esc(filters.query) + '"></label>' + selection('Bereich', 'section', [['', 'Alle Bereiche'], ...recordSections, 'Vorbereitung'], filters.section) +
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
