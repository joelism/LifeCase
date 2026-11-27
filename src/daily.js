import { archive, findRecord, message, saveImportedMail, saveIntakeRecord, saveRecord, storeImportedOriginal, userError } from './backend.js';
import { connection } from './connections-api.js';
import { dailyData, decideSuggestion, setDailyRules } from './daily-api.js';
import { itemsOf } from './daily-views.js';
import { closeDialog, errorAt, openDialog, openRecord } from './editor.js';
import { icon } from './icons.js';
import { isActive, MAX_FILE, nameOf, sectionOf, sha256, shiftDate, today } from './model.js';
import { button, esc } from './ui.js';
import { detectAppointments } from '../supabase/functions/lifecase-connect/appointment-intake.js';
import { planCandidates } from './scan-layout.js';

const initial = () => ({ listId: '', showDone: false, rules: null, runs: [], suggestions: [], error: '', loading: false, checking: false });
const failureBox = '<p class="form-error wide" role="alert" hidden></p>';
const submit = (title, symbol = 'check') => '<button type="submit" class="button primary">' + icon(symbol, 18) + esc(title) + '</button>';
const input = (name, label, value = '', attributes = '', type = 'text') => '<label class="input-wrap">' + esc(label) + '<input name="' +
  name + '" type="' + type + '" value="' + esc(value) + '" ' + attributes + '></label>';
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const hasRealDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export function makeDaily(ctx, getAccounts) {
  const state = initial();
  let lastLoad = 0;
  let listBusy = false;
  const activeLists = () => ctx.rows().filter(row => sectionOf(row) === 'Einkaufen' && isActive(row));
  const currentList = () => activeLists().find(row => row.id === state.listId) ?? activeLists()[0];
  const refreshView = () => { if (['Terminprüfung','Übersicht'].includes(ctx.view())) ctx.render(); };
  function reset() { lastLoad = 0; listBusy = false; Object.assign(state, initial()); }
  async function load(force = false) {
    if (state.loading || (!force && Date.now() - lastLoad < 120000)) return;
    const epoch = ctx.epoch();
    state.loading = true;
    try {
      const data = await dailyData();
      if (epoch !== ctx.epoch()) return;
      Object.assign(state, data, { error: '' });
      lastLoad = Date.now();
    } catch (error) {
      if (epoch === ctx.epoch()) state.error = message(error);
    } finally {
      if (epoch === ctx.epoch()) {
        state.loading = false;
        refreshView();
      }
    }
  }
  async function runForm(form, action) {
    if (form.dataset.busy) return;
    const control = form.querySelector('[type="submit"]');
    form.dataset.busy = 'true';
    control.disabled = true;
    try { await action(); } catch (error) {
      if (form.querySelector('.form-error')) errorAt(form, error);
      else ctx.notify(message(error));
    } finally { control.disabled = false; delete form.dataset.busy; }
  }
  function onSubmit(form, action) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const fields = new FormData(form);
      runForm(form, () => action(fields));
    });
  }
  async function changeList(listId, change) {
    if (listBusy || !listId) return;
    const epoch = ctx.epoch();
    listBusy = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await findRecord(listId);
        if (epoch !== ctx.epoch()) return;
        if (!isActive(current) || sectionOf(current) !== 'Einkaufen') throw userError('Diese Einkaufsliste ist nicht mehr aktiv.');
        try {
          const updated = await saveRecord('Einkaufen', change(current), current);
          if (epoch === ctx.epoch()) ctx.addRecord(updated);
          return updated;
        } catch (error) {
          if (attempt || !error.userMessage?.includes('anderen Gerät')) throw error;
        }
      }
    } finally { if (epoch === ctx.epoch()) listBusy = false; }
  }
  function shoppingEditor(existing = null) {
    const form = openDialog(existing ? 'Einkaufsliste benennen' : 'Einkaufsliste anlegen',
      input('title', 'Name', existing ? nameOf(existing) : '', 'maxlength="80" required autofocus') + failureBox,
      button('Abbrechen', 'close') + submit('Speichern'), true).querySelector('form');
    onSubmit(form, async fields => {
      const title = String(fields.get('title') ?? '').trim();
      if (!title) throw userError('Gib der Einkaufsliste einen Namen.');
      const epoch = ctx.epoch();
      if (existing) await changeList(existing.id, row => ({ ...row.fields, title }));
      else {
        const created = await saveRecord('Einkaufen', { title, items: [] });
        if (epoch !== ctx.epoch()) return;
        state.listId = created.id;
        ctx.addRecord(created);
      }
      if (epoch === ctx.epoch()) closeDialog();
    });
  }
  function shopItemEditor(itemId) {
    const list = currentList();
    const item = itemsOf(list).find(value => value.id === itemId);
    if (!item) return;
    const form = openDialog('Artikel bearbeiten', '<div class="form-grid">' + input('name', 'Artikel', item.name, 'maxlength="120" required autofocus') +
      input('quantity', 'Menge', item.quantity, 'maxlength="40"') + failureBox + '</div>',
      button('Abbrechen', 'close') + submit('Speichern'), true).querySelector('form');
    onSubmit(form, async fields => {
      const name = String(fields.get('name') ?? '').trim();
      if (!name) throw userError('Gib einen Artikel ein.');
      const quantity = String(fields.get('quantity') ?? '').trim();
      const epoch = ctx.epoch();
      await changeList(list.id, row => ({ ...row.fields, items: itemsOf(row).map(value => value.id === itemId ? { ...value, name, quantity } : value) }));
      if (epoch === ctx.epoch()) closeDialog();
    });
  }
  async function shopAction(action, id) {
    const list = currentList();
    const knownItem = itemsOf(list).find(item => item.id === id);
    if (action === 'toggle' && knownItem?.done) state.showDone = true;
    await changeList(list?.id, row => ({ ...row.fields, items: itemsOf(row).flatMap(item => {
      if ((action === 'remove' && item.id === id) || (action === 'clear' && item.done)) return [];
      return [{ ...item, done: action === 'toggle' && item.id === id && knownItem ? !knownItem.done : item.done }];
    }) }));
  }
  async function archiveList(id, archived) {
    const epoch = ctx.epoch();
    const list = id ? ctx.rows().find(row => row.id === id) : currentList();
    if (!list || sectionOf(list) !== 'Einkaufen') return;
    const updated = await archive(list, archived);
    if (epoch !== ctx.epoch()) return;
    if (!archived) state.listId = updated.id;
    ctx.addRecord(updated);
    ctx.notify(archived ? 'Einkaufsliste archiviert.' : 'Einkaufsliste wiederhergestellt.');
  }
  async function addShopping(form, fields) {
    const name = String(fields.get('name') ?? '').trim();
    const quantity = String(fields.get('quantity') ?? '').trim();
    if (!name) throw userError('Gib einen Artikel ein.');
    const item = { id: crypto.randomUUID(), name, quantity, done: false };
    const changed = await changeList(currentList()?.id, row => {
      if (itemsOf(row).length >= 300) throw userError('Diese Liste hat bereits 300 Artikel.');
      return { ...row.fields, items: [...itemsOf(row), item] };
    });
    if (changed) document.querySelector('#shop-add-form input[name="name"]')?.focus();
    else form.elements.name.value = name;
  }
  function beginScan(mode) {
    const plan = mode === 'plan';
    const body = '<div class="form-grid"><label class="input-wrap wide">Foto aufnehmen<input name="camera" type="file" accept="image/*" capture="environment"></label>' +
      '<label class="input-wrap wide">Foto oder Screenshot auswählen<input name="image" type="file" accept="image/*"></label>' +
      input('reference', 'Bezugsdatum', today(), 'required', 'date') +
      (plan ? '<label class="input-wrap">Art des Plans<select name="team"><option value="">Meine Schichten</option><option value="team">Teamplan</option></select></label>' +
        input('employee', 'Name im Teamplan', '', 'maxlength="80" placeholder="Vor- oder Nachname wie im Plan"') : '') +
      '<label class="input-wrap wide">Text einfügen<textarea name="text" rows="3" maxlength="24000" placeholder="Optional, wenn du den Text bereits hast"></textarea></label></div>' +
      '<p class="hint">Das Foto wird auf diesem Gerät gelesen. Beim Speichern wird es deinem privaten Dokumentenspeicher hinzugefügt.</p>' +
      '<p class="scan-progress hint" role="status"></p>' + failureBox;
    const form = openDialog(plan ? 'Arbeitsplan hochladen' : 'Dokument scannen', body, button('Abbrechen', 'close') +
      submit('Texterkennung starten', 'camera'), true).querySelector('form');
    onSubmit(form, async fields => {
      const camera = fields.get('camera');
      const image = fields.get('image');
      const file = camera?.size ? camera : image?.size ? image : null;
      const text = String(fields.get('text') ?? '').trim();
      if (!file && !text) throw userError('Wähle ein Foto aus oder füge den Text ein.');
      if (file && file.size > MAX_FILE) throw userError('Das Foto darf höchstens 25 MB gross sein.');
      const reference = String(fields.get('reference') ?? '');
      if (!hasRealDate(reference)) throw userError('Wähle ein gültiges Bezugsdatum.');
      const team = fields.get('team') === 'team';
      const employee = String(fields.get('employee') ?? '').trim();
      if (team && !employee) throw userError('Gib den Namen ein, der im Plan bei deinen Schichten steht.');
      const epoch = ctx.epoch();
      const progress = form.querySelector('.scan-progress');
      let warned = '';
      let result = { text, lines: [] };
      if (file && !text) {
        progress.textContent = 'Texterkennung wird geladen …';
        try {
          const { readPhoto } = await import('./ocr.js');
          result = await readPhoto(file, plan, fraction => {
            progress.textContent = 'Foto wird gelesen · ' + Math.round(fraction * 100) + ' %';
          });
        } catch {
          warned = 'Die Texterkennung konnte das Foto nicht lesen. Du kannst die Angaben von Hand ergänzen und das Original anhängen.';
        }
      }
      if (epoch !== ctx.epoch() || !form.isConnected || !form.closest('dialog').open) return;
      const base = new Date(reference + 'T12:00:00Z');
      const candidates = plan ? planCandidates(result, base, { team, employee }) :
        detectAppointments({ body: result.text, mode: 'scan', reference: base });
      if (team && !candidates.length && !warned) warned = 'Die Zeile mit deinem Namen konnte den Datumsüberschriften nicht sicher zugeordnet werden. Ergänze deine Schichten hier.';
      await showScanReview({ plan, file, reference, candidates, warned, epoch });
    });
  }
  async function showScanReview(scan) {
    const title = scan.plan ? 'Migros · Schicht' : 'Termin aus Dokument';
    const evidence = scan.candidates.map(row => row.evidence).filter(Boolean).slice(0, 16);
    const body = (scan.warned ? '<p class="banner">' + esc(scan.warned) + '</p>' : '') +
      '<p>' + (scan.candidates.length ? 'Prüfe die erkannten Angaben und entferne Einträge, die du nicht übernehmen möchtest.' :
        'Es wurden keine eindeutigen Angaben erkannt. Du kannst einen Eintrag ergänzen oder das Foto als Dokument ablegen.') + '</p>' +
      input('location', scan.plan ? 'Filiale / Ort' : 'Ort', scan.candidates.find(row => row.location)?.location ?? '', 'maxlength="120"') +
      '<div id="scan-rows"></div><div class="actions">' + button(scan.plan ? 'Schicht hinzufügen' : 'Termin hinzufügen', 'scan-add-line', '', 'plus') + '</div>' +
      (evidence.length ? '<details><summary>Erkannte Textstellen</summary><div class="mail-content">' + esc(evidence.join('\n')) + '</div></details>' : '') +
      (scan.file ? '<label class="check"><input type="checkbox" name="keepOriginal" checked> Foto im privaten Dokumentenspeicher ablegen</label>' : '') + failureBox;
    const form = openDialog(scan.plan ? 'Schichten prüfen' : 'Termin prüfen', body, button('Abbrechen', 'close') + submit('In LifeCase speichern'), true).querySelector('form');
    const rows = form.querySelector('#scan-rows');
    const add = (row = {}) => {
      if (rows.children.length >= 31) return;
      const card = document.createElement('fieldset');
      card.className = 'scan-line form-grid';
      card.innerHTML = '<legend>' + (scan.plan ? 'Schicht' : 'Termin') + '</legend>' +
        input('title', 'Titel', row.title || title, 'maxlength="160" required') +
        input('date', 'Datum', row.date || scan.reference, 'required', 'date') +
        input('time', 'Von', row.time, scan.plan ? 'required' : '', 'time') +
        input('endTime', 'Bis', row.endTime, scan.plan ? 'required' : '', 'time') +
        '<button type="button" class="text-button" data-scan-remove-line>' + icon('close', 16) + 'Eintrag entfernen</button>';
      rows.append(card);
    };
    scan.candidates.forEach(add);
    if (!scan.candidates.length && !scan.file) add();
    form.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (control?.hasAttribute('data-scan-add-line')) add();
      if (control?.hasAttribute('data-scan-remove-line')) control.closest('fieldset').remove();
    });
    onSubmit(form, async fields => {
      const location = String(fields.get('location') ?? '').trim();
      const keepOriginal = scan.file && fields.has('keepOriginal');
      const records = [...rows.querySelectorAll('fieldset')].map(card => {
        const get = name => card.querySelector('[name="' + name + '"]').value.trim();
        const title = get('title');
        const time = get('time');
        const endTime = get('endTime');
        const date = get('date');
        if (!title || !hasRealDate(date) || (time && !clock.test(time)) || (endTime && (!time || !clock.test(endTime))) ||
            (scan.plan && (!time || !endTime || time === endTime)) || (!scan.plan && endTime && endTime <= time)) {
          throw userError('Prüfe Titel, Datum und Uhrzeit in den gewählten Einträgen.');
        }
        const endDate = endTime && endTime < time ? shiftDate(date, 1) : '';
        return { title, date, time, endTime, endDate, location, kind: scan.plan ? 'Schicht' : 'Termin', status: 'Offen' };
      });
      if (!records.length && !keepOriginal) throw userError('Füge einen Termin hinzu oder lege das Foto ab.');
      const fingerprint = scan.file ? await sha256(scan.file) : await sha256(new Blob([JSON.stringify(records)]));
      if (scan.epoch !== ctx.epoch()) return;
      let documentRow;
      if (keepOriginal) {
        documentRow = await saveImportedMail({ title: (scan.plan ? 'Arbeitsplan · ' : 'Dokument · ') + scan.file.name.slice(0, 180),
          kind: 'Dokument', date: scan.reference, source: scan.plan ? 'Arbeitsplan' : 'Kamera-Scan', scanType: scan.plan ? 'plan' : 'document',
          externalKey: 'scan:' + fingerprint + ':' + (scan.plan ? 'plan' : 'document') });
        if (scan.epoch !== ctx.epoch()) return;
        const originalName = scan.file.name.slice(0, 245) || 'Scan.jpg';
        const original = new File([scan.file], originalName, { type: scan.file.type });
        const item = await storeImportedOriginal(documentRow, original);
        if (scan.epoch !== ctx.epoch()) return;
        ctx.addFile(item);
        ctx.addRecord(documentRow);
      }
      let saved = 0;
      for (const record of records) {
        const intakeKey = ['scan', scan.plan ? 'plan' : 'document', fingerprint, record.date, record.time, record.endTime].join(':');
        const created = await saveIntakeRecord({ ...record, intakeKey, intakeSource: scan.plan ? 'Arbeitsplan' : 'Kamera-Scan',
          relatedIds: documentRow ? [documentRow.id] : [] });
        if (scan.epoch !== ctx.epoch()) return;
        ctx.addRecord(created);
        saved++;
      }
      closeDialog();
      ctx.notify(saved ? (saved === 1 ? 'Ein Eintrag wurde' : saved + ' Einträge wurden') + ' im Kalender gespeichert.' : 'Foto im privaten Dokumentenspeicher abgelegt.');
      if (saved) ctx.showCalendarDate(records[0].date, scan.plan ? 'Schicht' : '');
      else if (documentRow) openRecord(documentRow.id, ctx);
    });
  }
  function openSuggestion(id) {
    const item = state.suggestions.find(row => row.id === id);
    if (!item) return;
    const data = item.details;
    const form = openDialog('Terminvorschlag prüfen', (data.reason ? '<p class="banner">' + esc(data.reason) + '</p>' : '') +
      '<p class="mail-content">' + esc(data.evidence) + '</p><div class="form-grid">' + input('title', 'Titel', data.title, 'maxlength="250" required') +
      input('date', 'Datum', data.date, 'required', 'date') + input('time', 'Um', data.time, '', 'time') +
      input('endTime', 'Bis', data.endTime, '', 'time') + input('location', 'Ort', data.location, 'maxlength="250"') + '</div>' + failureBox,
      button('Verwerfen', 'suggestion-dismiss', item.id, 'close') + submit('Im Kalender speichern'), true).querySelector('form');
    onSubmit(form, async fields => {
      const record = { ...Object.fromEntries(fields), kind: 'Termin', status: 'Offen', intakeSource: item.provider,
        intakeKey: item.intake_key, notes: data.evidence };
      if (!record.title.trim() || !hasRealDate(record.date) || (record.endTime && (!record.time || record.endTime <= record.time))) {
        throw userError('Prüfe Titel, Datum und Uhrzeit.');
      }
      const epoch = ctx.epoch();
      const updated = await saveIntakeRecord(record);
      if (epoch !== ctx.epoch()) return;
      ctx.addRecord(updated);
      await decideSuggestion(item.id, 'accepted');
      if (epoch !== ctx.epoch()) return;
      closeDialog();
      ctx.notify('Termin im Kalender gespeichert.');
      await load(true);
    });
  }
  async function checkMail() {
    if (state.checking) return;
    const epoch = ctx.epoch();
    state.checking = true;
    refreshView();
    try {
      const result = await connection('check-mail');
      if (epoch !== ctx.epoch()) return;
      ctx.notify(result.failed ? 'Mailprüfung teilweise abgeschlossen. Die Details stehen bei «Terminprüfung».' :
        result.checked + ' Nachrichten geprüft · ' + result.saved + ' gespeichert · ' + result.suggested + ' zur Prüfung');
      await Promise.all([ctx.sync(false), load(true)]);
    } catch (error) { if (epoch === ctx.epoch()) ctx.notify(message(error)); }
    finally {
      if (epoch === ctx.epoch()) {
        state.checking = false;
        refreshView();
      }
    }
  }
  function click(data) {
    const action = async () => {
      if ('shopCreate' in data) shoppingEditor();
      else if ('shoppingList' in data) { state.listId = data.shoppingList; state.showDone = false; ctx.render(); }
      else if ('shopRename' in data) { if (currentList()) shoppingEditor(currentList()); }
      else if ('shopEdit' in data) shopItemEditor(data.shopEdit);
      else if ('shopToggle' in data) await shopAction('toggle', data.shopToggle);
      else if ('shopRemove' in data) await shopAction('remove', data.shopRemove);
      else if ('shopClear' in data) await shopAction('clear');
      else if ('shopArchive' in data) await archiveList(null, true);
      else if ('shopRestore' in data) await archiveList(data.shopRestore, false);
      else if ('scanStart' in data) beginScan(data.scanStart);
      else if ('checkMail' in data) await checkMail();
      else if ('suggestion' in data) openSuggestion(data.suggestion);
      else if ('suggestionDismiss' in data) {
        const epoch = ctx.epoch();
        await decideSuggestion(data.suggestionDismiss, 'dismissed');
        if (epoch !== ctx.epoch()) return;
        closeDialog();
        await load(true);
      }
    };
    if (!Object.keys(data).some(key => /^(shop|scanStart$|checkMail$|suggestion)/.test(key))) return false;
    action().catch(error => ctx.notify(message(error)));
    return true;
  }
  function submitPage(event) {
    const form = event.target;
    if (!['shop-add-form','daily-rules-form'].includes(form.id)) return;
    event.preventDefault();
    const fields = new FormData(form);
    runForm(form, async () => {
      if (form.id === 'shop-add-form') return addShopping(form, fields);
      const enabled = fields.has('enabled');
      if (enabled && !['microsoft','google'].some(key => getAccounts()?.[key]?.connected)) throw userError('Verbinde zuerst Outlook oder Gmail.');
      const epoch = ctx.epoch();
      const rules = await setDailyRules({ enabled, automatic: fields.has('automatic') });
      if (epoch !== ctx.epoch()) return;
      state.rules = rules;
      refreshView();
      ctx.notify(enabled ? 'Mailprüfung aktiviert.' : 'Mailprüfung pausiert.');
    });
  }
  return { state, reset, load, click, submitPage };
}
