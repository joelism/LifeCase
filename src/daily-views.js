import { icon } from './icons.js';
import { isActive, nameOf, sectionOf, showDate, showTimestamp, value } from './model.js';
import { providers } from './connected-model.js';
import { button, empty, esc, jump, tag } from './ui.js';
import { heading, panel, recordRow } from './views.js';

const shoppingRows = rows => rows.filter(row => sectionOf(row) === 'Einkaufen');
export const itemsOf = row => Array.isArray(row?.fields?.items) ? row.fields.items : [];

export function shoppingPage(rows, state) {
  const active = shoppingRows(rows).filter(isActive);
  const list = active.find(row => row.id === state.listId) || active[0];
  const items = itemsOf(list);
  const checked = items.filter(item => item.done).length;
  const options = active.map(row => '<button class="button" type="button" data-shopping-list="' + esc(row.id) +
    '" aria-pressed="' + (row.id === list?.id) + '">' + esc(nameOf(row)) + '</button>').join('');
  const row = item => '<article class="shopping-item"><button type="button" class="shop-check" data-shop-toggle="' + esc(item.id) +
    '" aria-pressed="' + Boolean(item.done) + '" aria-label="' + esc(item.done ? item.name + ' wieder öffnen' : item.name + ' abhaken') + '">' +
    (item.done ? icon('check', 16) : '') + '</button><button type="button" class="shop-name' + (item.done ? ' done' : '') +
    '" data-shop-edit="' + esc(item.id) + '">' + esc(item.name) + (item.quantity ? '<span>' + esc(item.quantity) + '</span>' : '') +
    '</button><button type="button" data-shop-remove="' + esc(item.id) + '" class="icon-btn" aria-label="' +
    esc(item.name + ' entfernen') + '">' + icon('close', 16) + '</button></article>';
  const body = '<form id="shop-add-form" class="shopping-add"><label class="input-wrap">Artikel<input name="name" maxlength="120" placeholder="z. B. Milch" required></label>' +
    '<label class="input-wrap">Menge<input name="quantity" maxlength="40" placeholder="z. B. 2 l"></label><button class="button primary" type="submit">' +
    icon('plus', 17) + 'Hinzufügen</button></form>' +
    (items.length ? '<div class="shopping-lines">' + items.filter(item => !item.done).map(row).join('') +
      (checked ? '<details class="shopping-done"' + (state.showDone ? ' open' : '') + '><summary>Abgehakt · ' + checked + '</summary>' +
        items.filter(item => item.done).map(row).join('') + '</details>' : '') + '</div>' :
      empty('cart', 'Deine Liste ist leer')) +
    '<div class="shopping-footer actions">' + (checked ? button('Abgehakte entfernen', 'shop-clear', '', 'check') : '') +
    button('Liste bearbeiten', 'shop-rename', '', 'edit') + button('Liste archivieren', 'shop-archive', '', 'archive') + '</div>';
  return heading('Einkaufen', button('Neue Liste', 'shop-create', '', 'plus', 'primary')) +
    (options ? '<div class="theme-choices shopping-tabs">' + options + '</div>' : '') +
    (list ? panel(nameOf(list), body, tag((items.length - checked) + ' offen', 'green')) :
      '<div class="panel">' + empty('cart', 'Noch keine Einkaufsliste', '', button('Erste Liste anlegen', 'shop-create', '', 'plus')) + '</div>') +
    (shoppingRows(rows).some(row => !isActive(row)) ? '<details class="shopping-archive panel"><summary>Archivierte Listen</summary>' +
      shoppingRows(rows).filter(row => !isActive(row)).map(row => '<div class="shopping-archived-row"><span>' + esc(nameOf(row)) + '</span>' +
        button('Wiederherstellen', 'shop-restore', row.id, 'refresh') + '</div>').join('') + '</details>' : '');
}

export function scanPage(rows) {
  const scans = rows.filter(row => isActive(row) && sectionOf(row) === 'Beweismittel' && value(row, 'scanType')).slice(0, 14);
  const cards = [
    ['document', 'Dokument mit Termin', 'Karte, Brief oder Einladung fotografieren. Datum und Uhrzeit werden als Vorschlag übernommen.', 'camera', 'Dokument scannen'],
    ['plan', 'Arbeitsplan', 'Arbeitsplan als Foto oder Screenshot hinzufügen und deine Schichten in den Kalender übernehmen.', 'calendar', 'Arbeitsplan hochladen'],
  ];
  return heading('Scannen') + '<div class="scan-grid">' + cards.map(([mode,title,text,symbol,action]) =>
    '<article class="panel scan-card"><span class="tile-icon ' + (mode === 'plan' ? 'green' : '') + '">' + icon(symbol, 22) +
    '</span><div><h2>' + title + '</h2><p>' + text + '</p></div>' + button(action, 'scan-start', mode, 'plus', 'primary') + '</article>').join('') +
    '</div><div class="dash-secondary">' + panel('Letzte Scans', scans.length ? scans.map(row => recordRow(row)).join('') :
      empty('file', 'Noch keine gescannten Dokumente')) + '</div>';
}

const runStatus = value => ({ ok: 'Erfolgreich', partial: 'Teilweise geprüft', failed: 'Verbindung prüfen' })[value];
export function mailReview(state, accounts) {
  const ready = Object.keys(providers).some(key => accounts?.[key]?.connected);
  const rules = state.rules;
  return heading('Terminprüfung', button('Verbindungen', 'view', 'Verbindungen', 'link')) +
    (state.error ? '<div class="banner" role="alert">' + esc(state.error) + '</div>' : '') +
    panel('E-Mails auf Termine prüfen', '<div class="panel-body settings-content"><p>Prüft neue Nachrichten im Posteingang um 08:00, 12:00, 16:00 und 20:00 Uhr (Schweizer Zeit). ' +
    'LifeCase speichert die erkannten Termindaten und bei Bedarf die passende Textstelle.</p>' +
    (ready ? '<form id="daily-rules-form" class="settings-content"><label class="check"><input name="enabled" type="checkbox"' +
      (rules?.enabled ? ' checked' : '') + '> Geplante Mailprüfung aktivieren</label><label class="check"><input name="automatic" type="checkbox"' +
      (rules?.automatic !== false ? ' checked' : '') + '> Eindeutige Termine direkt im Kalender speichern</label>' +
      '<p class="form-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button primary">' + icon('check', 17) + 'Speichern</button>' +
      (rules?.enabled ? button(state.checking ? 'Prüft …' : 'Jetzt prüfen', 'check-mail', '', 'refresh') : '') + '</div></form>' :
      '<div class="actions">' + button('Outlook oder Gmail verbinden', 'view', 'Verbindungen', 'link', 'primary') + '</div>') +
    (state.runs.length ? '<div class="mail-run-list">' + state.runs.map(run => '<div><strong>' + esc(providers[run.provider].title) + '</strong><span>' +
      esc(showTimestamp(run.checked_at)) + ' · ' + esc(runStatus(run.status)) + ' · ' + run.checked + ' geprüft, ' + run.saved + ' gespeichert, ' +
      run.suggested + ' vorgeschlagen</span></div>').join('') + '</div>' : '') + '</div>') +
    panel('Vorschläge zur Prüfung', state.suggestions.length ? state.suggestions.map(row => '<button type="button" class="row" data-suggestion="' +
      esc(row.id) + '"><span class="tile-icon amber">' + icon('calendar', 18) + '</span><span class="row-info"><span class="row-title">' + esc(row.details.title) +
      '</span><span class="row-sub">' + esc([showDate(row.details.date), row.details.time || 'Uhrzeit fehlt',
        row.details.reason || providers[row.provider].title].join(' · ')) + '</span></span>' + icon('right', 17) + '</button>').join('') :
      empty('mail', state.loading ? 'Vorschläge werden geladen …' : 'Keine offenen Vorschläge'));
}

export function everydayActions(rows, daily) {
  const open = shoppingRows(rows).filter(isActive).reduce((count, row) => count + itemsOf(row).filter(item => !item.done).length, 0);
  return '<div class="dashboard-links everyday-links"><div class="action-card"><span class="tile-icon green">' + icon('cart', 21) +
    '</span><div><strong>Einkaufen</strong><p>' + (open ? open + ' offene Artikel' : 'Einkaufslisten') + '</p></div>' + jump('Öffnen','view','Einkaufen') +
    '</div><div class="action-card"><span class="tile-icon">' + icon('camera', 21) + '</span><div><strong>Scannen</strong><p>Dokument oder Arbeitsplan</p></div>' +
    jump('Öffnen','view','Scannen') + '</div>' +
    '<div class="action-card"><span class="tile-icon amber">' + icon('calendar', 21) + '</span><div><strong>Terminprüfung</strong><p>' +
    (daily.suggestions.length ? daily.suggestions.length + ' offen' : 'Termine aus E-Mails') + '</p></div>' + jump('Öffnen','view','Terminprüfung') + '</div></div>';
}
