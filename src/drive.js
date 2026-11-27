import { connection } from './connections-api.js';
import { message, saveImportedMail, storeImportedOriginal, userError } from './backend.js';
import { editRecord, errorAt, openDialog, openRecord } from './editor.js';
import { icon } from './icons.js';
import { isActive, nameOf, sectionOf, sha256, showDate, today } from './model.js';
import { button, empty, esc, options, tag } from './ui.js';
import { heading, panel } from './views.js';

const initial = () => ({ stack: [], rows: [], query: '', next: '', loading: false, loaded: false, error: '' });
const acceptedSections = ['Fälle','Arztzeugnisse','Rezepte','Beweismittel','Gesundheit'];

export function makeDrive(ctx, accounts, updateAccounts) {
  const state = initial();
  let sequence = 0;
  function reset() { ++sequence; Object.assign(state, initial()); }
  function update() { if (ctx.view() === 'Google Drive') ctx.render(); }
  async function load(append = false) {
    if (!accounts()?.drive?.connected) return;
    const serial = ++sequence;
    state.loading = true;
    state.error = '';
    update();
    try {
      const response = await connection('drive-list', { provider: 'drive', folder: state.stack.at(-1)?.id || '',
        query: state.query, cursor: append ? state.next : '' });
      if (serial !== sequence) return;
      state.rows = append ? [...state.rows, ...response.rows.filter(row => !state.rows.some(original => original.id === row.id))] : response.rows;
      state.next = response.next;
    } catch (error) {
      if (serial === sequence) state.error = message(error);
    } finally {
      if (serial === sequence) {
        state.loading = false;
        state.loaded = true;
        update();
      }
    }
  }
  function activate() { if (ctx.view() === 'Google Drive' && !state.loaded && !state.loading) load(); }
  function view() {
    const info = accounts()?.drive;
    const title = heading('Google Drive', info?.connected ? button('Drive trennen', 'drive-disconnect', '', 'close') : '');
    if (!info?.connected) {
      return title + '<div class="panel">' + empty('folder', info?.available ? 'Google Drive verbinden' :
        accounts() ? 'Google Drive noch nicht eingerichtet' : 'Verbindungsstatus wird geladen …',
        info?.available ? 'LifeCase kann PDFs und Bilder aus deinem Drive lesen. Du wählst die Dokumente für den Import.' :
        accounts() ? 'Für die Verbindung braucht LifeCase eine Google-OAuth-Registrierung und die aktivierte Drive API.' : '',
        info?.available ? button('Mit Google verbinden', 'connect', 'drive', 'link', 'primary') : '') + '</div>';
    }
    const files = state.rows.map(file => '<button type="button" class="row drive-row" data-drive-open="' + esc(file.id) + '">' +
      '<span class="tile-icon">' + icon(file.folder ? 'folder' : 'file', 18) + '</span><span class="row-info"><span class="row-title">' +
      esc(file.name) + '</span><span class="row-sub">' + esc(file.folder ? 'Ordner' : [showDate(file.date), file.size ? new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 }).format(file.size / 1024 / 1024) + ' MB' : ''].filter(Boolean).join(' · ')) +
      '</span></span>' + icon('right', 16) + '</button>').join('');
    const crumbs = state.stack.length ? state.stack.map(item => item.name).join(' / ') : 'Meine Ablage';
    return title + '<form class="filters" id="drive-search"><label class="input-wrap wide">Dateiname suchen<input name="query" type="search" maxlength="160" value="' +
      esc(state.query) + '" placeholder="z. B. Arztzeugnis"></label><button class="button primary" type="submit">' + icon('search', 17) + 'Suchen</button></form>' +
      (state.error ? '<p class="banner" role="alert">' + esc(state.error) + '</p>' : '') +
      panel(state.query ? 'Suchergebnisse' : crumbs, files || empty('folder', state.loading ? 'Dateien werden geladen …' : 'Keine Bilder oder PDFs'),
        state.loading ? tag('Lädt …') : state.stack.length || state.query ? button('Zurück', 'drive-up', '', 'left') : '') +
      (state.next && !state.loading ? '<div class="mail-more">' + button('Mehr laden', 'drive-more', '', 'plus') + '</div>' : '');
  }
  function importFile(file) {
    if (!file.canDownload || file.size > 20 * 1024 * 1024) {
      ctx.notify(file.canDownload ? 'Diese Datei ist grösser als 20 MB.' : 'Google Drive erlaubt den Download dieser Datei nicht.');
      return;
    }
    const candidates = ctx.rows().filter(row => isActive(row) && acceptedSections.includes(sectionOf(row))).sort((a,b) => nameOf(a).localeCompare(nameOf(b), 'de-CH'));
    const form = openDialog('Aus Google Drive ablegen', '<p class="mail-content">' + esc(file.name) + '</p><label class="input-wrap">Ziel in LifeCase<select name="target">' +
      options([['', 'Neues Dokument'], ...candidates.map(row => [row.id, sectionOf(row) + ' · ' + nameOf(row)])], '') +
      '</select></label><p class="form-error" hidden role="alert"></p>', button('Abbrechen', 'close') +
      '<button type="submit" class="button primary">' + icon('download', 17) + 'Importieren</button>', true).querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const control = event.submitter;
      control.disabled = true;
      const epoch = ctx.epoch();
      try {
        const chosen = form.elements.target.value;
        const existing = chosen ? candidates.find(row => row.id === chosen) : null;
        const blob = await connection('drive-file', { provider: 'drive', id: file.id }, true);
        if (epoch !== ctx.epoch()) return;
        const safeName = file.name.replace(/[\u0000-\u001f/\\]/g, '_').slice(0, 220) || 'Drive-Datei';
        const original = new File([blob], safeName, { type: file.mime });
        const fingerprint = await sha256(new Blob([file.id + ':' + await sha256(original)]));
        if (epoch !== ctx.epoch()) return;
        const row = existing ?? await saveImportedMail({ title: safeName, source: 'Google Drive', date: today(), kind: file.mime === 'application/pdf' ? 'PDF' : 'Foto',
          externalKey: 'drive:' + fingerprint });
        if (epoch !== ctx.epoch()) return;
        const saved = await storeImportedOriginal(row, original);
        if (epoch !== ctx.epoch()) return;
        ctx.addFile(saved);
        ctx.addRecord(row);
        ctx.notify('Original aus Google Drive abgelegt.');
        if (!form.isConnected) return;
        if (existing) openRecord(row.id, ctx);
        else openDialog('Dokument abgelegt', '<p>' + esc(nameOf(row)) + '</p><div class="actions">' +
          button('Dokument öffnen','open',row.id,'file') + button('Arztzeugnis erfassen','drive-certificate',row.id,'plus') +
          button('Rezept erfassen','drive-prescription',row.id,'plus') + '</div>', button('Schliessen','close'));
      } catch (error) { if (epoch === ctx.epoch()) errorAt(form, error); }
      finally { control.disabled = false; }
    });
  }
  async function click(data) {
    if ('driveOpen' in data) {
      const selected = state.rows.find(row => row.id === data.driveOpen);
      if (!selected) return;
      if (selected.folder) { state.stack.push(selected); state.rows = []; state.query = ''; await load(); }
      else importFile(selected);
    } else if ('driveUp' in data) {
      if (state.query) state.query = '';
      else state.stack.pop();
      state.rows = [];
      await load();
    } else if ('driveMore' in data) await load(true);
    else if ('driveDisconnect' in data) {
      const epoch = ctx.epoch();
      await connection('disconnect', { provider: 'drive' });
      if (epoch !== ctx.epoch()) return;
      reset();
      await updateAccounts();
      ctx.notify('Google Drive getrennt.');
    } else if ('driveCertificate' in data || 'drivePrescription' in data) {
      editRecord('driveCertificate' in data ? 'Arztzeugnisse' : 'Rezepte', null, ctx,
        { documentIds: [data.driveCertificate ?? data.drivePrescription] });
    }
  }
  function handle(data) {
    if (!Object.keys(data).some(name => /^drive[A-Z]/.test(name))) return false;
    click(data).catch(error => ctx.notify(message(error)));
    return true;
  }
  function submit(event) {
    if (event.target.id !== 'drive-search') return;
    event.preventDefault();
    state.query = String(new FormData(event.target).get('query') ?? '').trim();
    state.rows = [];
    load();
  }
  return { view, activate, reset, handle, submit };
}
