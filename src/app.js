import { makeDaily } from './daily.js';
import { everydayActions, mailReview, scanPage, shoppingPage } from './daily-views.js';
import { makeConnections } from './connections.js';
import { connectionsView, healthView, mailboxView } from './connected-views.js';
import { db, downloadBlob, files, get, message, records, userError } from './backend.js';
import { calendarFile } from './calendar-file.js';
import { bindRecordActions, closeDialog, editRecord, errorAt, openDialog, openRecord } from './editor.js';
import { icon } from './icons.js';
import { calendarEntries, nameOf, recordSections, reminderDue, sectionOf, sections, today, value } from './model.js';
import { button, empty, esc, motif } from './ui.js';
import { brand, calendarPage, dashboard, exportCandidates, exportControls, exportKinds, exportList, heading, panel, recordRow, searchControls, searchResults, sectionPage, selectedCalendar, shell } from './views.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#dialog');
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
const readTheme = () => { try { return localStorage.getItem('lifecase-theme') || 'system'; } catch { return 'system'; } };
const defaults = () => ({ query: '', section: '', caseId: '', personId: '', from: '', to: '', archived: false });
const calendarDefaults = () => ({ month: today().slice(0, 7), selected: '', kind: '', source: '' });
const state = {
  session: null, verified: false, authStage: 'boot', factors: [], pendingFactor: null, email: '', epoch: 0,
  view: 'Übersicht', sectionFilter: '', rows: [], files: [], loading: false, error: '',
  menu: false, calendar: calendarDefaults(), theme: readTheme(),
  search: defaults(), export: { ...defaults(), kind: 'all' }, excluded: new Set(), includeFiles: true,
};
const ctx = {
  calendar: () => state.calendar, view: () => state.view, go, showCalendarDate, render,
  rows: () => state.rows, files: () => state.files, epoch: () => state.epoch,
  addRecord: row => { ++syncVersion; state.loading = false; state.rows = [row, ...state.rows.filter(item => item.id !== row.id)]; render(); },
  addFile: file => { ++syncVersion; state.loading = false; state.files = [file, ...state.files.filter(item => item.id !== file.id)]; },
  notify, sync,
};
const connected = makeConnections(ctx);
const daily = makeDaily(ctx, () => connected.state.accounts);
let noticeTimer;
let syncVersion = 0;
let installPrompt;
let lastSync = 0;

function notify(text) {
  notice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 5200);
}
function applyTheme() {
  const isDark = state.theme === 'dark' || (state.theme === 'system' && themeMedia.matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = isDark ? '#101925' : '#f3f6fa';
}
applyTheme();
themeMedia.addEventListener('change', applyTheme);

function cleared() {
  ++state.epoch;
  ++syncVersion;
  state.rows = [];
  state.files = [];
  state.factors = [];
  state.pendingFactor = null;
  state.email = '';
  state.loading = false;
  state.error = '';
  state.view = 'Übersicht';
  state.sectionFilter = '';
  state.calendar = calendarDefaults();
  state.search = defaults();
  state.export = { ...defaults(), kind: 'all' };
  state.excluded.clear();
  state.includeFiles = true;
  state.menu = false;
  connected.reset();
  daily.reset();
  notice.textContent = '';
  closeDialog(true);
}
function publicEmail() {
  const e = state.session?.user?.email ?? '';
  return e ? '<p>Angemeldet als <strong>' + esc(e) + '</strong></p>' : '';
}
function authPage() {
  const signIn = state.authStage === 'login';
  const enroll = state.authStage === 'setup';
  const boot = state.authStage === 'boot';
  const setupError = state.authStage === 'mfa-error';
  const pending = state.pendingFactor?.totp;
  const qr = pending?.qr_code?.startsWith('data:image/svg+xml') ? '<img class="qr" src="' + esc(pending.qr_code) + '" alt="QR-Code für die Authenticator-App">' : '';
  const secret = pending ? qr + '<details><summary>Einrichtungsschlüssel anzeigen</summary><code>' + esc(pending.secret) + '</code></details>' : '';
  const formError = '<p class="form-error" role="alert" hidden></p>';
  const codeInput = '<label class="input-wrap">Sicherheitscode<input name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>';
  const factors = state.factors.length > 1 ? '<label class="input-wrap">Authenticator<select name="factor">' +
    state.factors.map((item, i) => '<option value="' + esc(item.id) + '">' + esc(item.friendly_name || 'Authenticator ' + (i + 1)) + '</option>').join('') + '</select></label>' : '';
  let content;
  if (boot) content = '<h1>Anmeldung</h1><p>Anmeldung wird geprüft …</p>';
  else if (signIn) content = '<h1>Anmelden</h1><p>Verwende dein bestehendes Supabase-Konto für LifeCase.</p><form id="login-form">' +
    '<label class="input-wrap">E-Mail-Adresse<input name="email" type="email" autocomplete="username" value="' + esc(state.email) + '" required></label>' +
    '<label class="input-wrap">Passwort<input name="password" type="password" autocomplete="current-password" required></label>' +
    formError + '<button type="submit" class="button primary">Anmelden ' + icon('arrow', 17) + '</button></form>';
  else if (setupError) content = '<h1>Sicherheitsprüfung</h1>' + publicEmail() + '<p>Der zweite Faktor konnte nicht geladen werden.</p>' +
    button('Erneut versuchen', 'retry-auth', '', 'refresh', 'primary') + button('Abmelden', 'signout', '', 'logout');
  else {
    content = '<h1>' + (enroll ? 'Zweiten Faktor einrichten' : 'Sicherheitscode eingeben') + '</h1>' + publicEmail() +
      '<p>' + (enroll ? 'LifeCase verwendet eine Authenticator-App. Scanne den QR-Code oder übertrage den Einrichtungsschlüssel und gib den aktuellen Code ein.' :
        'Gib den sechsstelligen Code aus deiner Authenticator-App ein.') + '</p>' +
      (enroll && !pending ? '<form id="enroll-form">' + formError + '<button type="submit" class="button primary">Einrichtung starten</button></form>' :
        '<form id="verify-form">' + secret + factors + codeInput + formError + '<button type="submit" class="button primary">Bestätigen</button></form>') +
      button('Abmelden', 'signout', '', 'logout');
  }
  return '<div class="auth"><aside class="auth-visual">' + motif + brand + '<div><h2>Deine persönlichen Dossiers.</h2><p>Fälle, Termine und Gesundheitsunterlagen an einem Ort.</p></div>' +
    '<div class="privacy">' + icon('lock', 16) + 'Geschützter Zugang</div></aside><main class="auth-main"><div class="auth-card">' + content + '</div></main></div>';
}
function settings() {
  const themes = [['system','System','monitor'],['light','Hell','sun'],['dark','Dunkel','moon']];
  return heading('Einstellungen') + panel('Verbindungen', '<div class="panel-body settings-content"><p>Verwalte Outlook, Gmail, Kalender und Apple Health.</p><div class="actions">' + button('Verbindungen öffnen', 'view', 'Verbindungen', 'link') + '</div></div>') +
    panel('Darstellung', '<div class="panel-body settings-content"><div class="theme-choices">' +
      themes.map(([id, label, symbol]) => '<button class="button" type="button" data-theme-choice="' + id + '" aria-pressed="' + (state.theme === id) + '">' + icon(symbol, 17) + esc(label) + '</button>').join('') + '</div></div>') +
    panel('Konto und Datenschutz', '<div class="panel-body settings-content">' + publicEmail() +
      '<p>Der zweite Faktor ist aktiv. LifeCase speichert Einträge in deinem Konto und hält Originaldateien im privaten Speicher.</p><div class="actions">' +
      button('Synchronisieren', 'reload', '', 'refresh') + button('Abmelden', 'signout', '', 'logout', 'danger') + '</div></div>') +
    panel('Installation und Erinnerungen', '<div class="panel-body settings-content"><p>Auf iPhone und iPad öffnest du LifeCase in Safari und wählst im Teilen-Menü «Zum Home-Bildschirm». Auf dem Computer findest du die Installation im Browsermenü.</p>' +
      (installPrompt ? '<div class="actions">' + button('LifeCase installieren', 'install', '', 'download', 'primary') + '</div>' : '') +
      '<p>Fällige Erinnerungen siehst du in LifeCase. Für Hinweise bei geschlossener App kannst du eine Kalenderdatei mit Erinnerungen in deinen Gerätekalender importieren.</p></div>');
}
function mainView() {
  if (state.view === 'Übersicht') return dashboard(state.rows, state.loading, connected.state, everydayActions(state.rows, daily.state));
  if (state.view === 'Einkaufen') return shoppingPage(state.rows, daily.state);
  if (state.view === 'Scannen') return scanPage(state.rows);
  if (state.view === 'Terminprüfung') return mailReview(daily.state, connected.state.accounts);
  if (state.view === 'Posteingang') return mailboxView(connected.state);
  if (state.view === 'Verbindungen') return connectionsView(connected.state);
  if (state.view === 'Gesundheitsdaten') return healthView(connected.state);
  if (state.view === 'Gesundheit') return sectionPage('Gesundheit', state.rows, state.sectionFilter, state.loading) +
    '<div class="dash-secondary">' + panel('Apple Health', '<div class="panel-body actions">' + button('Gesundheitsdaten ansehen', 'view', 'Gesundheitsdaten', 'activity') + '</div>') + '</div>';
  if (state.view === 'Kalender') return state.sectionFilter === 'archiv' ? sectionPage('Kalender', state.rows, 'archiv', state.loading) : calendarPage(state.rows, state.calendar, connected.state);
  if (state.view === 'Suche') return heading('Suche') + searchControls(state.rows, state.search) + '<div id="search-results">' + searchResults(state.rows, state.files, state.search) + '</div>';
  if (state.view === 'PDF-Export') return heading('PDF-Export') + exportControls(state.rows, state.export) + '<div id="export-list">' + exportList(state.rows, state.export, state.excluded, state.includeFiles) + '</div>';
  if (state.view === 'Einstellungen') return settings();
  return sectionPage(state.view, state.rows, state.sectionFilter, state.loading);
}
function render() {
  app.innerHTML = state.verified ? shell(state.view, mainView(), state) : authPage();
  if (!state.verified) bindAuth();
}
function go(view, filter = '', focus = true) {
  if (!sections[view] || !state.verified) return;
  if (view !== 'Kalender' || filter !== 'archiv') {
    state.calendar.kind = view === 'Kalender' ? filter : '';
    state.calendar.selected = '';
  }
  state.view = view;
  state.sectionFilter = filter;
  state.menu = false;
  closeDialog();
  render();
  window.scrollTo(0, 0);
  connected.activate();
  if (view === 'Terminprüfung') daily.load(true);
  if (focus) document.querySelector(view === 'Suche' ? '#search-query' : '#main')?.focus({ preventScroll: true });
}
function showCalendarDate(date, filter = '') {
  state.calendar.month = date.slice(0, 7);
  state.calendar.source = '';
  go('Kalender', filter);
  state.calendar.selected = date;
  render();
}
async function sync(showNotice = false) {
  if (!state.verified) return;
  const epoch = state.epoch;
  daily.load(showNotice);
  const revision = ++syncVersion;
  state.loading = true;
  try {
    const [newRows, newFiles] = await Promise.all([records(), files()]);
    if (epoch !== state.epoch || revision !== syncVersion) return;
    state.rows = newRows;
    state.files = newFiles;
    state.error = '';
    lastSync = Date.now();
    if (showNotice) notify('Einträge synchronisiert.');
  } catch (error) {
    if (epoch !== state.epoch || revision !== syncVersion) return;
    state.error = message(error);
  } finally {
    if (epoch === state.epoch && revision === syncVersion) {
      state.loading = false;
      const shoppingDraft = state.view === 'Einkaufen' && app.querySelector('#shop-add-form input[name="name"]')?.value;
      if ((!shoppingDraft && !['Suche', 'PDF-Export', 'Posteingang', 'Gesundheitsdaten', 'Verbindungen', 'Terminprüfung'].includes(state.view)) || showNotice) render();
      else refreshResults();
    }
  }
}
function localAssurance(session) {
  try {
    const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).aal;
  } catch { return null; }
}
async function acceptSession(session) {
  if (session?.user?.id !== state.session?.user?.id || !session) cleared();
  state.session = session;
  const epoch = state.epoch;
  state.verified = localAssurance(session) === 'aal2';
  if (!session) state.authStage = 'login';
  else if (!state.verified) {
    state.authStage = 'boot';
    render();
    try {
      const factors = get(await db.auth.mfa.listFactors());
      if (epoch !== state.epoch) return;
      state.factors = factors.totp.filter(factor => factor.status === 'verified');
      state.authStage = state.factors.length ? 'challenge' : 'setup';
    } catch {
      if (epoch !== state.epoch) return;
      state.authStage = 'mfa-error';
    }
  }
  render();
  if (state.verified) {
    state.loading = true;
    render();
    connected.activate();
    connected.consumeReturn();
    await sync();
  }
}
function bindAuth() {
  const form = app.querySelector('form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    const data = new FormData(form);
    const epoch = state.epoch;
    submit.disabled = true;
    try {
      if (form.id === 'login-form') {
        state.email = String(data.get('email')).trim();
        const result = get(await db.auth.signInWithPassword({ email: state.email, password: data.get('password') }));
        if (epoch === state.epoch) await acceptSession(result.session);
      }
      if (form.id === 'enroll-form') {
        const factors = get(await db.auth.mfa.listFactors());
        for (const factor of factors.all.filter(item => item.factor_type === 'totp' && item.status === 'unverified' && item.friendly_name === 'LifeCase')) {
          get(await db.auth.mfa.unenroll({ factorId: factor.id }));
        }
        const data = get(await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'LifeCase', issuer: 'LifeCase' }));
        if (epoch !== state.epoch) return;
        state.pendingFactor = data;
        render();
      }
      if (form.id === 'verify-form') {
        const factorId = data.get('factor') || state.pendingFactor?.id || state.factors[0]?.id;
        if (!factorId) throw userError('Der Authenticator konnte nicht ausgewählt werden.');
        get(await db.auth.mfa.challengeAndVerify({ factorId, code: String(data.get('code')) }));
        const result = get(await db.auth.getSession());
        if (epoch === state.epoch) {
          state.pendingFactor = null;
          await acceptSession(result.session);
        }
      }
    } catch (error) {
      if (epoch === state.epoch) errorAt(form, error);
    } finally {
      submit.disabled = false;
    }
  });
}
async function signOut() {
  try {
    const result = await db.auth.signOut({ scope: 'local' });
    if (result.error) throw result.error;
    await acceptSession(null);
  } catch (error) {
    notify(message(error));
  }
}

function refreshResults() {
  const results = app.querySelector('#search-results');
  if (results) results.innerHTML = searchResults(state.rows, state.files, state.search);
  const list = app.querySelector('#export-list');
  if (list) list.innerHTML = exportList(state.rows, state.export, state.excluded, state.includeFiles);
}
function handleFilter(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const parent = target.closest('form');
  if (parent?.id === 'search-form' || parent?.id === 'export-form') {
    const data = new FormData(parent);
    const key = parent.id === 'search-form' ? 'search' : 'export';
    state[key] = { ...Object.fromEntries(data), archived: data.has('archived') };
    refreshResults();
  }
  if (target.matches('[data-section-filter]') && event.type === 'change') {
    state.sectionFilter = target.value;
    render();
    app.querySelector('[data-section-filter]')?.focus();
  }
  if (target.matches('[data-calendar-kind]') && event.type === 'change') {
    state.calendar.kind = target.value;
    render();
    app.querySelector('[data-calendar-kind]')?.focus();
  }
  if (target.matches('[data-calendar-source]') && event.type === 'change') {
    state.calendar.source = target.value;
    render();
    app.querySelector('[data-calendar-source]')?.focus();
  }
  if (target.matches('[data-health-range]') && event.type === 'change') {
    connected.range(target);
    app.querySelector('[data-health-range]')?.focus();
  }
  if (target.matches('[data-export-row]')) {
    if (target.checked) state.excluded.delete(target.dataset.exportRow);
    else state.excluded.add(target.dataset.exportRow);
  }
  if (target.matches('[data-export-files]')) state.includeFiles = target.checked;
}
function quick() {
  openDialog('Eintrag erfassen', '<div class="quick-grid">' + recordSections.map(section =>
    button(sections[section].create, 'create', section, sections[section].icon)).join('') + '</div>');
}
function reminderList() {
  const due = calendarEntries(state.rows).filter(item => reminderDue(item, today()));
  openDialog('Erinnerungen', (due.length ? '<div class="panel">' + due.map(item => recordRow(item.row, '', item)).join('') + '</div>' :
    empty('bell', 'Keine fälligen Erinnerungen')) + '<p class="hint">Plane Erinnerungen im Kalender oder direkt beim Arztzeugnis.</p>',
    button('Zum Kalender', 'view', 'Kalender', 'calendar', 'primary'));
}
function pdfItem(id) {
  const row = state.rows.find(item => item.id === id);
  if (!row) return;
  const section = sectionOf(row);
  state.export = { ...defaults(), kind: { Fälle:'case', Gespräche:'talks', Gesundheit:'health', Arztzeugnisse:'health', Chronik:'history' }[section] || 'all',
    caseId: section === 'Fälle' ? id : '', archived: Boolean(row.archived_at) };
  state.excluded = new Set(section === 'Fälle' ? [] : state.rows.filter(item => item.id !== id).map(item => item.id));
  go('PDF-Export');
}
async function exportPdf(control) {
  const selected = exportCandidates(state.rows, state.export).filter(row => !state.excluded.has(row.id));
  if (!selected.length) {
    notify('Wähle mindestens einen Eintrag aus.');
    return;
  }
  control.disabled = true;
  const epoch = state.epoch;
  try {
    const { makePDF } = await import('./pdf.js');
    if (epoch !== state.epoch) return;
    const title = exportKinds[state.export.kind][0];
    const dossier = state.export.kind === 'case' && state.rows.find(row => row.id === state.export.caseId);
    const name = title + (dossier ? ' · ' + nameOf(dossier) : '');
    downloadBlob(makePDF(name, selected, state.rows, state.files, state.export, state.includeFiles), 'LifeCase_' + today() + '.pdf');
    notify('PDF erstellt.');
  } catch (error) {
    notify(message(error));
  } finally {
    control.disabled = false;
  }
}
function ics(id) {
  const base = id === 'agenda' ? selectedCalendar(state.rows, state.calendar) : calendarEntries(state.rows).filter(item => item.row.id === id);
  const items = base.filter(item => item.state === 'Offen');
  if (!items.length) {
    notify('Für diese Auswahl sind keine offenen Termine verfügbar.');
    return;
  }
  openDialog('Kalenderdatei erstellen', '<p>Beim Import speichert dein Kalender die Termine und Erinnerungen. Je nach Kalenderkonto können sie mit anderen Geräten synchronisiert werden.</p>' +
    '<label class="check"><input name="privateDetail" type="checkbox"> Titel, Ortsangaben und Notizen aufnehmen</label>',
    button('Abbrechen', 'close') + '<button type="submit" class="button primary">' + icon('download', 18) + 'Kalenderdatei laden</button>', true)
    .querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const detail = event.target.elements.privateDetail.checked;
      const prepared = items.map(item => ({ ...item, title: detail ? nameOf(item.row) : 'LifeCase · ' + item.kind,
        endTime: value(item.row, 'endTime'), endDate: value(item.row, 'endDate'), location: value(item.row, 'location'), description: value(item.row, 'notes'), privateDetail: detail }));
      downloadBlob(new Blob([calendarFile(prepared)], { type: 'text/calendar;charset=utf-8' }), 'LifeCase_' + today() + '.ics');
      closeDialog();
      notify('Kalenderdatei erstellt.');
    });
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  const action = target.dataset;
  if ('signout' in action) { await signOut(); return; }
  if ('retryAuth' in action) { await acceptSession(state.session); return; }
  if (!state.verified) return;
  if (daily.click(action) || connected.click(action)) return;
  if ('close' in action) closeDialog();
  else if ('view' in action) go(action.view);
  else if ('metric' in action) go(...action.metric.split('|'));
  else if ('reload' in action) { connected.activate(); if (['Übersicht', 'Kalender'].includes(state.view)) connected.agenda(true); await sync(true); }
  else if ('menu' in action) {
    state.menu = !state.menu;
    render();
    (state.menu ? app.querySelector('.sidebar button') : app.querySelector('.bottom-nav [data-menu]'))?.focus();
  } else if ('quick' in action) quick();
  else if ('reminders' in action) reminderList();
  else if ('open' in action) {
    const item = state.rows.find(row => row.id === action.open);
    if (item && sectionOf(item) === 'Einkaufen') {
      daily.state.listId = item.id;
      go('Einkaufen');
    } else openRecord(action.open, ctx);
  }
  else if ('create' in action) editRecord(action.create, null, ctx,
    action.create === 'Kalender' && state.calendar.selected ? { date: state.calendar.selected } : {});
  else if ('calendarToday' in action) showCalendarDate(today());
  else if ('calendarArchive' in action) go('Kalender', 'archiv');
  else if ('day' in action) {
    state.calendar.selected = action.day;
    if (action.day) state.calendar.month = action.day.slice(0, 7);
    render();
    connected.agenda();
    if (action.day) app.querySelector('.day[data-day="' + action.day + '"]')?.focus();
  } else if ('month' in action) {
    const [year, month] = state.calendar.month.split('-').map(Number);
    state.calendar.month = new Date(Date.UTC(year, month - 1 + Number(action.month), 1)).toISOString().slice(0, 7);
    state.calendar.selected = '';
    render();
    connected.agenda();
    app.querySelector('[data-month="' + action.month + '"]')?.focus();
  } else if ('ics' in action) ics(action.ics);
  else if ('recordPdf' in action) pdfItem(action.recordPdf);
  else if ('makePdf' in action) await exportPdf(target);
  else if ('exportSelect' in action) {
    for (const row of exportCandidates(state.rows, state.export)) {
      if (action.exportSelect === 'all') state.excluded.delete(row.id);
      else state.excluded.add(row.id);
    }
    refreshResults();
  } else if ('themeChoice' in action) {
    state.theme = action.themeChoice;
    try { localStorage.setItem('lifecase-theme', state.theme); } catch { /* Device setting will reset after reload. */ }
    applyTheme();
    render();
    app.querySelector('[data-theme-choice="' + state.theme + '"]')?.focus();
  } else if ('install' in action && installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    render();
  } else bindRecordActions(target, ctx);
});
app.addEventListener('input', handleFilter);
app.addEventListener('change', handleFilter);
app.addEventListener('submit', event => {
  daily.submitPage(event);
  if (event.target.matches('#search-form,#export-form')) event.preventDefault();
  if (event.target.matches('#mail-search')) {
    event.preventDefault();
    connected.search(event.target);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.menu) {
    state.menu = false;
    render();
  }
  if (state.verified && !dialog.open && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    go('Suche');
  }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('online', () => sync());
window.addEventListener('offline', () => {
  state.error = 'Offline. Änderungen benötigen eine Internetverbindung.';
  if (state.verified && !dialog.open) render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.verified && Date.now() - lastSync > 15_000) sync();
});
setInterval(() => {
  if (!document.hidden && state.verified && !dialog.open) sync();
}, 60_000);
db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') setTimeout(() => { if (state.session) acceptSession(null); }, 0);
  if (event === 'TOKEN_REFRESHED') setTimeout(() => {
    if (!session || session.user.id !== state.session?.user?.id) return;
    if (state.verified && localAssurance(session) !== 'aal2') {
      cleared();
      acceptSession(session);
    } else state.session = session;
  }, 0);
});
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', document.baseURI)).catch(() => {});
}
try {
  const current = get(await db.auth.getSession());
  await acceptSession(current.session);
} catch (error) {
  await acceptSession(null);
  notify(message(error));
}
