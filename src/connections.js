import { message, saveImportedMail, storeImportedOriginal, userError } from './backend.js';
import { clearHealthRows, connection, healthRows, writeHealthRows } from './connections-api.js';
import { expandEvents, providers } from './connected-model.js';
import { mailDetail } from './connected-views.js';
import { closeDialog, editRecord, errorAt, openDialog, openRecord } from './editor.js';
import { measures } from './health-data.js';
import { icon } from './icons.js';
import { isActive, nameOf, sectionOf, shiftDate, showDate, today } from './model.js';
import { button, empty, esc, options } from './ui.js';

const initialMail = (provider = 'microsoft', query = '') => ({ provider, query, rows: [], next: '', loading: false, loaded: false, error: '' });
const initial = () => ({
  accounts: null, statusLoading: false, callback: '', error: '', mail: initialMail(),
  events: [], eventsKey: '', eventsLoaded: false, calendarLoading: false, calendarErrors: [],
  health: [], recentSleep: null, metric: 'steps', healthRange: '30', healthLoading: false, healthLoaded: false, healthError: '',
});

export function makeConnections(ctx) {
  const state = initial();
  let lastStatus = 0;
  let mailSerial = 0;
  let calendarSerial = 0;
  let stopHealthRead;
  let recentSleepAt = 0;
  let recentSleepSerial = 0;
  const errorBox = '<p class="form-error" role="alert" hidden></p>';
  const submit = (label, symbol) => '<button type="submit" class="button primary">' + icon(symbol, 18) + esc(label) + '</button>';
  const update = (views = []) => {
    if (!views.length || views.includes(ctx.view())) ctx.render();
  };
  const request = async (form, callback) => {
    const control = form.querySelector('[type="submit"]');
    control.disabled = true;
    try { await callback(); } catch (error) { errorAt(form, error); } finally { control.disabled = false; }
  };
  function reset() {
    ++mailSerial;
    ++calendarSerial;
    stopHealthRead?.();
    stopHealthRead = null;
    recentSleepAt = 0;
    ++recentSleepSerial;
    lastStatus = 0;
    Object.assign(state, initial());
  }
  async function status(force = false) {
    if (state.statusLoading || (!force && Date.now() - lastStatus < 120000)) return;
    const epoch = ctx.epoch();
    state.statusLoading = true;
    update(['Verbindungen', 'Posteingang', 'Terminprüfung', 'Google Drive']);
    try {
      const result = await connection('status');
      if (epoch !== ctx.epoch()) return;
      state.accounts = result.accounts;
      state.callback = result.callback;
      state.error = '';
      ctx.accountsLoaded();
      lastStatus = Date.now();
    } catch (error) {
      if (epoch === ctx.epoch()) state.error = message(error);
    } finally {
      if (epoch === ctx.epoch()) {
        state.statusLoading = false;
        update(['Verbindungen', 'Posteingang', 'Terminprüfung', 'Google Drive']);
        if (ctx.view() === 'Posteingang') ensureMail();
        if (['Übersicht', 'Kalender', 'Meine Woche'].includes(ctx.view())) agenda();
      }
    }
  }
  function selectMail(provider) {
    if (provider !== state.mail.provider) {
      ++mailSerial;
      state.mail = initialMail(provider);
    }
  }
  function ensureMail() {
    if (!state.accounts?.[state.mail.provider]?.connected) {
      const target = Object.keys(providers).find(key => state.accounts?.[key]?.connected);
      if (target) selectMail(target);
    }
    if (state.accounts?.[state.mail.provider]?.connected && !state.mail.loaded && !state.mail.loading) loadMail();
  }
  async function loadMail(query = state.mail.query, append = false) {
    const serial = ++mailSerial;
    const { provider, next } = state.mail;
    if (!append) state.mail = initialMail(provider, query);
    state.mail.loading = true;
    state.mail.error = '';
    update(['Posteingang']);
    try {
      const result = await connection('mail', { provider, query, cursor: append ? next : '' });
      if (serial !== mailSerial) return;
      const old = new Set(state.mail.rows.map(row => row.id));
      state.mail.rows.push(...result.rows.filter(row => !old.has(row.id)));
      state.mail.next = result.next;
    } catch (error) {
      if (serial === mailSerial) state.mail.error = message(error);
    } finally {
      if (serial === mailSerial) {
        state.mail.loading = false;
        state.mail.loaded = true;
        update(['Posteingang']);
      }
    }
  }
  async function agenda(force = false) {
    if (!state.accounts) return;
    const wanted = Object.keys(providers).filter(key => state.accounts[key]?.connected);
    const month = ctx.calendar().month;
    const first = month + '-01';
    const [year, monthNumber] = month.split('-').map(Number);
    const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const dashboard = ctx.view() === 'Übersicht';
    const weekly = ctx.view() === 'Meine Woche';
    const from = weekly ? shiftDate(ctx.weekStart(), -1) : dashboard ? today() : shiftDate(first, -6);
    const through = weekly ? shiftDate(from, 8) : dashboard ? shiftDate(from, 30) : shiftDate(next, 13);
    const key = [from, through, ...wanted].join('|');
    if (!force && key === state.eventsKey && (state.calendarLoading || state.events.length || state.calendarErrors.length || state.eventsLoaded)) return;
    const serial = ++calendarSerial;
    const changed = key !== state.eventsKey;
    state.eventsKey = key;
    if (changed) state.events = [];
    state.calendarErrors = [];
    state.calendarLoading = wanted.length > 0;
    state.eventsLoaded = !wanted.length;
    update(['Übersicht', 'Kalender', 'Meine Woche']);
    if (!wanted.length) return;
    const responses = await Promise.allSettled(wanted.map(provider => connection('calendar', { provider, from, through })));
    if (serial !== calendarSerial) return;
    state.events = [];
    for (const [index, result] of responses.entries()) {
      if (result.status === 'fulfilled') state.events.push(...(dashboard
        ? result.value.events.map(event => event.date < from ? { ...event, originalDate: event.date, date: from, time: '' } : event)
        : expandEvents(result.value.events, from, through)));
      else state.calendarErrors.push(providers[wanted[index]].calendar + ' · ' + message(result.reason));
    }
    state.calendarLoading = false;
    state.eventsLoaded = true;
    update(['Übersicht', 'Kalender', 'Meine Woche']);
  }
  async function loadRecentSleep() {
    if (Date.now() - recentSleepAt < 5 * 60000) return;
    recentSleepAt = Date.now();
    const serial = ++recentSleepSerial;
    try {
      const rows = await healthRows(shiftDate(today(), -6), 'sleep');
      if (serial !== recentSleepSerial) return;
      state.recentSleep = rows;
      update(['Übersicht']);
    } catch { /* The suggested time can still be calculated from the calendar. */ }
  }
  async function loadHealth(force = false) {
    if (state.healthLoading || (state.healthLoaded && !force)) return;
    const epoch = ctx.epoch();
    state.healthLoading = true;
    update(['Gesundheitsdaten']);
    try {
      const result = await healthRows(shiftDate(today(), -365));
      if (epoch !== ctx.epoch()) return;
      state.health = result;
      ++recentSleepSerial;
      recentSleepAt = Date.now();
      state.recentSleep = result.filter(row => row.metric === 'sleep');
      state.healthLoaded = true;
      state.healthError = '';
    } catch (error) {
      if (epoch === ctx.epoch()) state.healthError = message(error);
    } finally {
      if (epoch === ctx.epoch()) {
        state.healthLoading = false;
        update(['Gesundheitsdaten']);
      }
    }
  }
  function activate() {
    const view = ctx.view();
    if (view === 'Gesundheitsdaten') return loadHealth(true);
    if (!['Übersicht', 'Kalender', 'Meine Woche', 'Verbindungen', 'Posteingang', 'Terminprüfung', 'Google Drive'].includes(view)) return;
    status();
    if (view === 'Posteingang') ensureMail();
    if (['Übersicht','Kalender','Meine Woche'].includes(view)) agenda();
  }
  function consumeReturn() {
    const url = new URL(location.href);
    const result = url.searchParams.get('lcConnection');
    if (!result) return;
    url.searchParams.delete('lcConnection');
    history.replaceState(null, '', url);
    ctx.go(result === 'drive-connected' ? 'Google Drive' : 'Verbindungen');
    ctx.notify(['connected','drive-connected'].includes(result) ? 'Konto verbunden.' : 'Die Verbindung konnte nicht abgeschlossen werden. Starte die Freigabe erneut.');
    status(true);
  }
  async function openMail(id) {
    const epoch = ctx.epoch();
    const provider = state.mail.provider;
    const loading = empty('mail', 'Nachricht wird geladen …');
    const modal = openDialog('Nachricht', loading);
    const marker = modal.querySelector('.dialog-body');
    try {
      const mail = await connection('detail', { provider, id });
      if (epoch !== ctx.epoch() || !modal.open || !marker.isConnected) return;
      showMailImport(mail, item => connection('file', { provider, id, attachment: item.id }, true));
    } catch (error) {
      if (epoch === ctx.epoch() && modal.open && marker.isConnected) openDialog('Nachricht', '<p class="form-error" role="alert">' + esc(message(error)) + '</p>', button('Schliessen', 'close'));
    }
  }
  function showMailImport(mail, getFile) {
    const provider = providers[mail.provider]?.title || 'EML-Import';
    const modal = openDialog(mail.subject, mailDetail(mail, ctx.rows()),
      button('Schliessen', 'close') + submit('Im Dossier speichern', 'download'), true);
    const form = modal.querySelector('form');
    const epoch = ctx.epoch();
    form.addEventListener('submit', event => {
      event.preventDefault();
      const details = new FormData(form);
      request(form, async () => {
        const caseId = String(details.get('caseId') || '');
        const dossier = ctx.rows().find(row => row.id === caseId && sectionOf(row) === 'Fälle' && isActive(row));
        if (!dossier) throw userError('Wähle ein aktives Dossier.');
        const saved = await saveImportedMail({
          title: mail.subject.slice(0, 250), kind: 'E-Mail', date: mail.day, source: provider + ' · ' + mail.sender,
          notes: mail.text.slice(0, 24000), externalKey: mail.key + ':' + caseId, caseIds: [caseId],
        });
        if (epoch !== ctx.epoch()) return;
        ctx.addRecord(saved);
        const selected = details.getAll('attachments').map(id => mail.attachments.find(file => file.id === id)).filter(Boolean);
        const toSave = details.has('original') ? [{ id: '', name: mail.filename || mail.subject.slice(0, 160) + '.eml' }, ...selected] : selected;
        let failures = 0;
        for (const item of toSave) {
          if (epoch !== ctx.epoch()) return;
          try {
            const blob = await getFile(item);
            if (epoch !== ctx.epoch()) return;
            const name = item.name.replace(/[\u0000-\u001F/\\]/g, '_').slice(0, 240);
            const file = await storeImportedOriginal(saved, new File([blob], name || 'Anhang', { type: blob.type }));
            if (epoch === ctx.epoch()) ctx.addFile(file);
          } catch { failures++; }
        }
        if (epoch !== ctx.epoch()) return;
        ctx.notify(failures ? 'E-Mail gespeichert. ' + failures + ' Datei(en) konnten nicht übernommen werden. Du kannst den Import wiederholen.' :
          'E-Mail im Dossier «' + nameOf(dossier) + '» gespeichert.');
        if (!form.isConnected || !modal.open) return;
        if (details.has('task')) editRecord('Kalender', null, ctx, { kind: 'Aufgabe', title: 'Nachfassen · ' + nameOf(saved).slice(0, 225),
          caseIds: [caseId], relatedIds: [saved.id] });
        else openRecord(saved.id, ctx);
      });
    });
  }
  function startMailImport() {
    const form = openDialog('E-Mail als Datei importieren', '<p>Speichere die Nachricht aus Outlook oder Gmail als .eml und wähle sie hier aus.</p>' +
      '<label class="input-wrap">E-Mail-Datei<input type="file" name="mailFile" accept=".eml,message/rfc822" required></label>' + errorBox,
      button('Abbrechen', 'close') + submit('Nachricht öffnen', 'eye'), true).querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      request(form, async () => {
        const file = form.elements.mailFile.files[0];
        const { readMailFile } = await import('./mail-file.js');
        const parsed = await readMailFile(file);
        if (form.isConnected && form.closest('dialog').open) showMailImport(parsed.mail, item => parsed.files.get(item.id));
      });
    });
  }
  function disconnect(provider) {
    const form = openDialog(providers[provider].title + ' trennen', '<p>LifeCase entfernt den Kontozugriff und blendet die externen Termine aus. Bereits importierte E-Mails bleiben in deinen Dossiers.</p>' + errorBox,
      button('Abbrechen', 'close') + submit('Verbindung trennen', 'close'), true).querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      request(form, async () => {
        const epoch = ctx.epoch();
        await connection('disconnect', { provider });
        if (epoch !== ctx.epoch()) return;
        state.accounts[provider] = { ...state.accounts[provider], connected: false, email: '' };
        if (state.mail.provider === provider) {
          ++mailSerial;
          state.mail = initialMail();
        }
        ++calendarSerial;
        if (ctx.calendar().source === provider) ctx.calendar().source = '';
        state.events = state.events.filter(event => event.provider !== provider);
        state.eventsKey = '';
        state.calendarLoading = false;
        closeDialog();
        ctx.notify('Verbindung getrennt.');
        await status(true);
      });
    });
  }
  async function connect(provider, write = false) {
    try {
      const data = await connection(write === 'drafts' ? 'start-mail-drafts' : write ? 'start-calendar-write' : 'start', { provider });
      const url = new URL(data.url);
      if (!['login.microsoftonline.com', 'accounts.google.com'].includes(url.hostname) || url.protocol !== 'https:') throw userError('Ungültige Anbieteradresse.');
      location.assign(url);
    } catch (error) { ctx.notify(message(error)); }
  }
  async function copyOutlookCallback() {
    const callback = state.callback;
    if (!callback) return;
    const epoch = ctx.epoch();
    try {
      await navigator.clipboard.writeText(callback);
      if (epoch === ctx.epoch()) ctx.notify('Rücksprungadresse kopiert.');
    } catch {
      if (epoch !== ctx.epoch()) return;
      const field = openDialog('Rücksprungadresse kopieren', '<label class="input-wrap">Rücksprungadresse für Microsoft Entra' +
        '<textarea readonly rows="3">' + esc(callback) + '</textarea></label>', button('Schliessen', 'close')).querySelector('textarea');
      field.focus();
      field.select();
    }
  }
  function openEvent(key) {
    const entry = state.events.find(item => item.provider + '|' + item.id + '|' + item.date === key);
    if (!entry) return;
    const when = [showDate(entry.date), entry.time || (entry.allDay ? 'Ganztägig' : '')].filter(Boolean).join(' · ');
    const body = '<dl class="detail"><div><dt>Quelle</dt><dd>' + esc(providers[entry.provider].calendar) + '</dd></div><div><dt>Datum</dt><dd>' +
      esc(when) + '</dd></div>' + (entry.location ? '<div><dt>Ort</dt><dd>' + esc(entry.location) + '</dd></div>' : '') + '</dl>';
    openDialog(entry.title, body, button('Schliessen', 'close') + button('Aufgabe erstellen', 'event-task', key, 'plus') +
      (!entry.lifeCasePause ? button('Vorbereiten', 'planner-external', key, 'tasks', 'primary') : ''));
  }
  function startHealthImport() {
    stopHealthRead?.();
    const form = openDialog('Apple-Health-Export importieren', '<p>Wähle den vollständigen ZIP-Export aus Apple Health. Den Zeitraum legst du hier in LifeCase fest.</p>' +
      '<div class="form-grid health-import-grid"><label class="input-wrap wide">Apple-Health-Export<input type="file" name="healthFile" accept=".zip,.xml,application/zip,application/xml,text/xml" required></label>' +
      '<label class="input-wrap">Von<input type="date" name="from" value="' + shiftDate(today(), -89) + '" max="' + today() + '" required></label>' +
      '<label class="input-wrap">Bis<input type="date" name="through" value="' + today() + '" max="' + today() + '" required></label></div>' +
      '<p class="hint">LifeCase liest die Datei auf diesem Gerät. Gespeichert werden die Tageswerte, die du in der Vorschau auswählst.</p>' +
      '<div class="health-import-progress" data-health-progress hidden><p class="hint" role="status">Export wird gelesen …</p>' +
      '<progress max="100" aria-label="Fortschritt beim Lesen des Exports"></progress></div>' + errorBox,
      button('Abbrechen', 'close') + submit('Vorschau laden', 'eye'), true).querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const fields = new FormData(form);
      request(form, async () => {
        const from = fields.get('from');
        const through = fields.get('through');
        if (from > through || from < shiftDate(through, -364) || through > today()) throw userError('Wähle einen Zeitraum von höchstens 365 Tagen bis heute.');
        stopHealthRead?.();
        const parser = new Worker(new URL('./health-worker.js', import.meta.url), { type: 'module' });
        const dialog = form.closest('dialog');
        const progress = form.querySelector('[data-health-progress]');
        progress.hidden = false;
        progress.querySelector('progress').removeAttribute('value');
        form.querySelector('.form-error').hidden = true;
        let cancel;
        const groups = await new Promise((resolve, reject) => {
          cancel = () => resolve(null);
          stopHealthRead = cancel;
          dialog.addEventListener('close', cancel, { once: true });
          parser.onmessage = ({ data }) => {
            if (data.error) reject(userError(data.error));
            else if (typeof data.progress === 'number') progress.querySelector('progress').value = data.progress;
            else resolve(data.groups);
          };
          parser.onerror = () => reject(userError('Die Datei konnte auf diesem Gerät nicht gelesen werden.'));
          parser.postMessage({ file: fields.get('healthFile'), from, through });
        }).finally(() => {
          parser.terminate();
          dialog.removeEventListener('close', cancel);
          progress.hidden = true;
          if (stopHealthRead === cancel) stopHealthRead = null;
        });
        if (!groups || !form.isConnected || !dialog.open) return;
        showHealthPreview(groups, from, through);
      });
    });
  }
  function showHealthPreview(groups, from, through) {
    const metrics = Object.entries(measures).map(([metric, item]) => {
      const items = groups.map((group, index) => [group, index]).filter(([group]) => group.metric === metric);
      if (!items.length) return '';
      return '<label class="input-wrap">' + esc(item.label) + '<select name="' + metric + '">' + options([['', 'Überspringen'],
        ...items.map(([group, index]) => [String(index), group.name + ' · ' + group.values.length + ' Tage'])], String(items[0][1])) + '</select></label>';
    }).join('');
    const title = 'Tageswerte prüfen';
    if (!metrics) {
      openDialog(title, empty('heart', 'Keine passenden Tageswerte', 'Wähle einen anderen Zeitraum oder eine neuere Exportdatei.'), button('Zurück', 'health-import'));
      return;
    }
    const form = openDialog(title, '<p>' + esc(showDate(from) + ' bis ' + showDate(through)) +
      '</p><div class="form-grid">' + metrics + '</div><p class="hint">Gleiche Tage und Messwerte aus früheren Exporten werden aktualisiert. Pro Messwert wird eine Quelle übernommen, damit parallele Geräte nicht doppelt zählen.</p>' +
      errorBox, button('Zurück', 'health-import') + submit('Tageswerte speichern', 'check'), true).querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const fields = new FormData(form);
      request(form, async () => {
        const selected = [...fields.values()].filter(Boolean).flatMap(index => groups[Number(index)].values);
        if (!selected.length) throw userError('Wähle mindestens einen Messwert aus.');
        const epoch = ctx.epoch();
        await writeHealthRows(selected);
        if (epoch !== ctx.epoch()) return;
        closeDialog();
        ctx.notify(selected.length + ' Tageswerte gespeichert.');
        await loadHealth(true);
      });
    });
  }
  function deleteHealth() {
    const form = openDialog('Gesundheitsdaten löschen', '<p>Alle bisher importierten und synchronisierten Tageswerte werden dauerhaft aus LifeCase entfernt. Deine Gesundheitseinträge und Arztzeugnisse bleiben erhalten.</p>' + errorBox,
      button('Abbrechen', 'close') + '<button class="button danger" type="submit">Tageswerte löschen</button>', true).querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      request(form, async () => {
        const epoch = ctx.epoch();
        await clearHealthRows();
        if (epoch !== ctx.epoch()) return;
        closeDialog();
        ctx.notify('Tageswerte gelöscht.');
        await loadHealth(true);
      });
    });
  }
  function handleClick(data) {
    if ('integrationRefresh' in data) status(true);
    else if ('copyOutlookCallback' in data) copyOutlookCallback();
    else if ('connect' in data) connect(data.connect);
    else if ('connectMailDrafts' in data) connect(data.connectMailDrafts, 'drafts');
    else if ('connectCalendarWrite' in data) connect(data.connectCalendarWrite, true);
    else if ('disconnect' in data) disconnect(data.disconnect);
    else if ('mailProvider' in data) {
      selectMail(data.mailProvider);
      if (ctx.view() !== 'Posteingang') ctx.go('Posteingang');
      else { update(); ensureMail(); }
    } else if ('mailReload' in data) loadMail();
    else if ('mailMore' in data) loadMail(state.mail.query, true);
    else if ('mailOpen' in data) openMail(data.mailOpen);
    else if ('mailImport' in data) startMailImport();
    else if ('externalReload' in data) agenda(true);
    else if ('externalOpen' in data) openEvent(data.externalOpen);
    else if ('eventTask' in data) {
      const entry = state.events.find(item => item.provider + '|' + item.id + '|' + item.date === data.eventTask);
      if (entry) editRecord('Kalender', null, ctx, { kind: 'Aufgabe', title: entry.title.slice(0, 250), date: entry.date, location: entry.location });
    } else if ('healthImport' in data) startHealthImport();
    else if ('healthClear' in data) deleteHealth();
    else if ('healthMetric' in data) { state.metric = data.healthMetric; update(); }
    else return false;
    return true;
  }
  function search(form) { loadMail(String(new FormData(form).get('query') || '').trim()); }
  function range(element) { state.healthRange = element.value; update(); }
  return { state, reset, status, agenda, showMailImport, loadRecentSleep, activate, consumeReturn, click: handleClick, search, range };
}
