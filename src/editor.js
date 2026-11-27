import { icon } from './icons.js';
import { button, empty, esc, options, tag } from './ui.js';
import { dateOf, filesFor, isActive, linksOf, MAX_FILE, nameOf, sectionOf, sections, showDate, showTimestamp, today, value } from './model.js';
import { archive, downloadOriginal, history, message, saveRecord, uploadOriginal, userError } from './backend.js';

const dialog = document.querySelector('#dialog');
let busy = false;
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', () => { if (!dialog.open) dialog.replaceChildren(); });

export function closeDialog(force = false) {
  if (dialog.open && (!busy || force)) dialog.close();
}
export function openDialog(title, body, foot = '', form = false) {
  const content = '<header class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Schliessen">' +
    icon('close') + '</button></header><div class="dialog-body">' + body + '</div>' + (foot ? '<footer class="dialog-foot">' + foot + '</footer>' : '');
  dialog.innerHTML = form ? '<form>' + content + '</form>' : content;
  if (!dialog.open) dialog.showModal();
  return dialog;
}
export function errorAt(container, error) {
  const target = container.querySelector('.form-error');
  if (!target) return;
  target.textContent = message(error);
  target.hidden = false;
}
const errorBox = '<p class="form-error wide" role="alert" hidden></p>';
const footClose = button('Schliessen', 'close');
const inSortOrder = (a, b) => nameOf(a).localeCompare(nameOf(b), 'de-CH');

function input(field, selected, rows, row) {
  const { key, label, type, required, choices, min, max, step } = field;
  if (type === 'links') {
    const linked = Array.isArray(selected) ? selected : [];
    const candidates = rows.filter(item => item.id !== row?.id && field.sections.includes(sectionOf(item)) && (isActive(item) || linked.includes(item.id))).sort(inSortOrder);
    return '<fieldset class="links-control wide input-wrap"><legend>' + esc(label) + '</legend><div class="link-options">' +
      (candidates.length ? candidates.map(item => '<label class="check"><input type="checkbox" name="' + key + '" value="' + esc(item.id) + '"' +
        (linked.includes(item.id) ? ' checked' : '') + '> ' + esc(nameOf(item)) + (!isActive(item) ? ' (archiviert)' : '') + '</label>').join('') :
        '<span class="hint">Noch keine passenden Einträge vorhanden.</span>') + '</div></fieldset>';
  }
  const attr = ' name="' + key + '"' + (required ? ' required' : '') + (key === 'title' ? ' autofocus' : '');
  let control;
  if (type === 'textarea') {
    control = '<textarea' + attr + ' maxlength="24000" rows="3">' + esc(selected) + '</textarea>';
  } else if (type === 'select') {
    const items = choices.map(item => [item, field.labels?.[item] ?? item]);
    if (!choices.includes(selected) && selected) items.push([selected, selected]);
    control = '<select' + attr + '>' + options(items, selected) + '</select>';
  } else {
    control = '<input type="' + type + '"' + attr + ' value="' + esc(selected) + '"' +
      (type === 'number' ? ' min="' + min + '" max="' + max + '" step="' + step + '"' : ' maxlength="250"') + '>';
  }
  return '<label class="input-wrap' + (type === 'textarea' || key === 'title' ? ' wide' : '') + '">' + esc(label) + control + '</label>';
}
function readFields(form, info, row) {
  const values = new FormData(form);
  const fields = { ...row?.fields };
  for (const field of info.fields) {
    if (field.type === 'links') {
      fields[field.key] = values.getAll(field.key);
      if (fields[field.key].length > 100) throw userError('Wähle höchstens 100 Verknüpfungen pro Feld.');
    } else {
      fields[field.key] = String(values.get(field.key) ?? '').trim();
      if (field.required && fields[field.key] === '') throw userError('Bitte fülle «' + field.label + '» aus.');
    }
  }
  if (fields.validFrom && fields.validUntil < fields.validFrom) throw userError('«Gültig bis» muss auf oder nach «Gültig ab» liegen.');
  if (fields.date && fields.endDate && fields.endDate < fields.date) throw userError('Das Ende muss auf oder nach dem Beginn liegen.');
  if (fields.endTime && (!fields.time || ((!fields.endDate || fields.endDate === fields.date) && fields.endTime <= fields.time))) throw userError('Gib eine Uhrzeit und eine spätere Endzeit an.');
  return fields;
}
async function task(control, callback, onError = error => errorAt(dialog, error)) {
  const card = control.closest('form');
  const controls = card ? [...card.querySelectorAll('button, input, select, textarea')] : [control];
  const active = controls.filter(element => !element.disabled);
  active.forEach(element => { element.disabled = true; });
  busy = true;
  try {
    await callback();
  } catch (error) {
    onError(error);
  } finally {
    busy = false;
    active.forEach(element => { element.disabled = false; });
  }
}
export function editRecord(section, row, ctx, initial = {}) {
  const info = sections[section];
  const todayDefault = today();
  const seeds = { date: ['Chronik','Kalender','Gespräche'].includes(section) ? todayDefault : '', validFrom: todayDefault, ...initial };
  const form = openDialog(row ? info.noun + ' bearbeiten' : info.create, '<div class="form-grid">' + info.fields.map(field => input(field,
    row ? value(row, field.key) || field.initial || '' : seeds[field.key] ?? field.initial ?? '', ctx.rows(), row)).join('') +
    '<label class="input-wrap wide">Originaldateien<input type="file" name="originals" multiple><span class="hint">Bis zu 25 MB pro Datei.</span></label>' +
    errorBox + '</div>', button('Abbrechen', 'close') + '<button type="submit" class="button primary">' + icon('check', 18) + 'Speichern</button>', true).querySelector('form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    let fields;
    let originals;
    try {
      fields = readFields(form, info, row);
      originals = [...form.elements.originals.files];
      if (originals.some(file => file.size > MAX_FILE)) throw userError('Eine Originaldatei darf höchstens 25 MB gross sein.');
      if (originals.some(file => file.name.length > 255)) throw userError('Ein Dateiname darf höchstens 255 Zeichen haben.');
    } catch (error) {
      errorAt(form, error);
      return;
    }
    task(form.querySelector('[type="submit"]'), async () => {
      const epoch = ctx.epoch();
      const saved = await saveRecord(row?.section || section, fields, row);
      if (epoch !== ctx.epoch()) return;
      ctx.addRecord(saved);
      let failures = 0;
      for (const original of originals) {
        if (epoch !== ctx.epoch()) return;
        try {
          const file = await uploadOriginal(saved, original);
          if (epoch === ctx.epoch()) ctx.addFile(file);
        } catch {
          failures++;
        }
      }
      if (epoch !== ctx.epoch()) return;
      if (failures) await ctx.sync(false);
      ctx.notify(failures ? 'Eintrag gespeichert. ' + failures + ' Datei-Upload(s) konnten nicht abgeschlossen werden.' : 'Eintrag gespeichert.');
      openRecord(saved.id, ctx);
    });
  });
}

function filesList(row, ctx) {
  const files = filesFor(row, ctx.files());
  return '<section><h3 class="subheading">Originaldateien</h3><div class="file-list">' + (files.length ? files.map(file =>
    '<div class="file-item"><span class="tile-icon">' + icon('file', 17) + '</span><div><strong class="file-name">' + esc(file.original_name) +
    '</strong><small>' + (file.uploaded_at ? 'Hochgeladen am ' + esc(showTimestamp(file.uploaded_at)) : 'Upload ausstehend') +
    (file.size_bytes != null ? ' · ' + new Intl.NumberFormat('de-CH').format(file.size_bytes) + ' Bytes' : '') + '</small>' +
    (file.sha256 ? '<span class="hash">SHA-256 ' + esc(file.sha256) + '</span>' : '') + '</div>' +
    (file.uploaded_at ? button('Laden', 'original', file.id, 'download') : button('Fortsetzen', 'resume-file', file.id, 'upload')) + '</div>').join('') :
    '<p class="hint">Keine Originaldateien hinterlegt.</p>') + '</div></section>';
}
function chips(ids, rows) {
  return '<div class="chips">' + [...new Set(ids)].map(id => rows.find(item => item.id === id)).filter(Boolean).map(item =>
    '<button class="chip" type="button" data-open="' + esc(item.id) + '">' + esc(nameOf(item)) + '</button>').join('') + '</div>';
}
export function openRecord(id, ctx) {
  const rows = ctx.rows();
  const row = rows.find(item => item.id === id);
  if (!row) return;
  const section = sectionOf(row);
  const info = sections[section];
  const fields = (info?.fields ?? []).filter(field => field.key !== 'title').map(field => {
    const item = value(row, field.key);
    if (item === '' || (Array.isArray(item) && !item.length)) return '';
    let formatted = esc(item);
    if (field.type === 'links') formatted = chips(Array.isArray(item) ? item : [], rows);
    if (field.type === 'date') formatted = esc(showDate(item));
    if (field.labels) formatted = esc(field.labels[item] ?? item);
    return '<div' + (['textarea','links'].includes(field.type) ? ' class="wide"' : '') + '><dt>' + esc(field.label) + '</dt><dd>' + formatted + '</dd></div>';
  }).join('');
  const old = ['Fall / Bereich', 'Beteiligte Personen'].map(label => row.fields[label] ? '<div><dt>' + esc(label) + '</dt><dd>' + esc(row.fields[label]) + '</dd></div>' : '').join('');
  const linked = rows.filter(item => item.id !== row.id && linksOf(item).includes(row.id));
  const attachments = filesList(row, ctx);
  const actionable = ['Kalender','Arztzeugnisse','Gespräche','Gesundheit'].includes(section);
  const arch = row.archived_at;
  const edit = info?.fields && !arch ? button('Bearbeiten', 'edit', id, 'edit', 'primary') : '';
  const output = '<div class="actions">' + tag(section) + (arch ? tag('Archiviert', 'amber') : '') +
    '<small>Aktualisiert am ' + esc(showTimestamp(row.updated_at || row.created_at)) + '</small></div><dl class="detail">' + fields + old + '</dl>' +
    (linked.length ? '<section><h3 class="subheading">Zugehörige Einträge</h3>' + chips(linked.map(item => item.id), rows) + '</section>' : '') +
    attachments + '<div class="actions">' + button('Verlauf', 'history', id, 'clock') + button('PDF', 'record-pdf', id, 'download') +
    (actionable ? button('Kalenderdatei', 'ics', id, 'calendar') : '') + '</div>' + errorBox;
  openDialog(nameOf(row), output, button(arch ? 'Wiederherstellen' : 'Archivieren', 'archive-record', id, 'archive') + edit);
  dialog.dataset.recordId = id;
}
export function bindRecordActions(target, ctx) {
  const row = ctx.rows().find(item => item.id === (target.dataset.edit || target.dataset.archiveRecord || target.dataset.history || dialog.dataset.recordId));
  if (!row) return;
  if (target.hasAttribute('data-edit')) editRecord(sectionOf(row), row, ctx);
  if (target.hasAttribute('data-history')) {
    const epoch = ctx.epoch();
    const container = openDialog('Änderungsverlauf', '<p class="hint">Verlauf wird geladen …</p>' + errorBox, button('Zurück', 'open', row.id, 'left'));
    const body = container.querySelector('.dialog-body');
    task(target, async () => {
      const entries = await history(row.id);
      if (!dialog.open || !body.isConnected || epoch !== ctx.epoch()) return;
      body.innerHTML = entries.length ? entries.map(entry => historyEntry(entry, row)).join('') +
        (entries.length === 100 ? '<p class="hint">Die letzten 100 Änderungen werden angezeigt.</p>' : '') :
        empty('clock', 'Keine Änderungen vorhanden');
    });
  }
  if (target.hasAttribute('data-archive-record')) {
    const archived = !row.archived_at;
    openDialog(archived ? 'Eintrag archivieren' : 'Eintrag wiederherstellen',
      '<p>«' + esc(nameOf(row)) + '» ' + (archived ? 'wird ins Archiv verschoben. Verknüpfungen, Dateien und der Verlauf bleiben verfügbar.' :
        'wird wieder in den aktiven Einträgen angezeigt.') + '</p>' + errorBox,
      button('Abbrechen', 'open', row.id) + '<button type="submit" class="button primary">' + (archived ? 'Archivieren' : 'Wiederherstellen') + '</button>', true)
      .querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const epoch = ctx.epoch();
        task(event.submitter, async () => {
          const updated = await archive(row, archived);
          if (epoch !== ctx.epoch()) return;
          ctx.addRecord(updated);
          ctx.notify(archived ? 'Eintrag archiviert.' : 'Eintrag wiederhergestellt.');
          openRecord(row.id, ctx);
        });
      });
  }
  if (target.hasAttribute('data-original')) {
    const file = filesFor(row, ctx.files()).find(item => item.id === target.dataset.original);
    if (file) task(target, () => downloadOriginal(file), error => ctx.notify(message(error)));
  }
  if (target.hasAttribute('data-resume-file')) {
    const file = filesFor(row, ctx.files()).find(item => item.id === target.dataset.resumeFile);
    if (!file) return;
    openDialog('Upload fortsetzen', '<label class="input-wrap">Wähle «' + esc(file.original_name) + '»<input type="file" name="original" required></label>' + errorBox,
      button('Zurück', 'open', row.id, 'left') + '<button type="submit" class="button primary">Hochladen</button>', true)
      .querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const original = event.target.elements.original.files[0];
        if (!original) return;
        const epoch = ctx.epoch();
        task(event.submitter, async () => {
          const saved = await uploadOriginal(row, original, file);
          if (epoch !== ctx.epoch()) return;
          ctx.addFile(saved);
          ctx.notify('Originaldatei hochgeladen.');
          openRecord(row.id, ctx);
        });
      });
  }
}
const actionLabels = { created: 'Erfasst', updated: 'Bearbeitet', archived: 'Archiviert', restored: 'Wiederhergestellt', file_added: 'Originaldatei hochgeladen' };
function historyEntry(entry, row) {
  const before = entry.before_snapshot?.fields ?? {};
  const after = entry.after_snapshot?.fields ?? {};
  const names = new Map((sections[sectionOf(row)]?.fields ?? []).map(field => [field.key, field.label]));
  const changeLabels = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => names.get(key) || key);
  const fileName = entry.action === 'file_added' ? '<p>' + esc(entry.after_snapshot?.original_name) + '</p>' : '';
  return '<details class="audit-entry"><summary>' + esc(actionLabels[entry.action] || entry.action) + ' · ' + esc(showTimestamp(entry.changed_at)) +
    '</summary><p class="hint">Version ' + entry.revision + '</p>' + fileName +
    (changeLabels.length ? '<p class="hint">Felder: ' + esc(changeLabels.join(', ')) + '</p>' : '') +
    (entry.before_snapshot ? '<pre>' + esc(JSON.stringify(entry.before_snapshot.fields, null, 2)) + '</pre>' : '') +
    (entry.after_snapshot?.fields ? '<pre>' + esc(JSON.stringify(entry.after_snapshot.fields, null, 2)) + '</pre>' : '') + '</details>';
}
