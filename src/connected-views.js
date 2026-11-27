import { icon } from './icons.js';
import { isActive, nameOf, sectionOf, shiftDate, showDate, showTimestamp, today } from './model.js';
import { measures, preferredHealthDays } from './health-data.js';
import { providers } from './connected-model.js';
import { button, empty, esc, jump, options, tag } from './ui.js';
import { heading, panel } from './views.js';

const providerBadge = key => '<span class="provider-mark ' + key + '" aria-hidden="true">' + (providers[key]?.mark ?? icon('mail', 18)) + '</span>';
const note = text => '<p class="hint">' + esc(text) + '</p>';

export function connectionsView(state) {
  const cards = Object.entries(providers).map(([key, provider]) => {
    const current = state.accounts?.[key];
    return '<article class="panel integration-card"><div class="provider-heading">' + providerBadge(key) + '<div><h2>' + provider.title +
      '</h2><p>' + provider.calendar + ' und E-Mails</p></div></div>' +
      (current?.connected ? tag('Verbunden', 'green') + '<p class="connection-address">' + esc(current.email) + '</p><div class="actions">' +
        button('Posteingang öffnen', 'mail-provider', key, 'mail', 'primary') + button('Trennen', 'disconnect', key, '', 'danger') + '</div>' :
        current?.available ? '<p>Termine im Kalender anzeigen und einzelne Nachrichten deinen Dossiers zuordnen.</p>' + button('Verbinden', 'connect', key, 'link', 'primary') :
        '<p>' + (state.statusLoading ? 'Verbindung wird geprüft …' : 'Die Anbieterregistrierung ist noch offen.') + '</p>' +
        '<details class="connection-guide"><summary>Einrichtung anzeigen</summary><p>' + (key === 'microsoft'
          ? 'Registriere LifeCase als Web-App in Microsoft Entra für persönliche Microsoft-Konten.'
          : 'Registriere LifeCase als Webanwendung in Google Cloud und aktiviere Gmail API und Google Calendar API.') +
        '</p>' + (state.callback ? '<code>' + esc(state.callback) + '</code>' : '') + '</details>') + '</article>';
  }).join('');
  return heading('Verbindungen', button('Status prüfen', 'integration-refresh', '', 'refresh')) +
    (state.error ? '<div class="banner" role="alert">' + esc(state.error) + '</div>' : '') +
    '<div class="integration-grid">' + cards + '<article class="panel integration-card"><div class="provider-heading"><span class="provider-mark apple">' +
    icon('heart', 22) + '</span><div><h2>Apple Health</h2><p>Gesundheitsdaten vom iPhone</p></div></div><p>Importiere ausgewählte Tageswerte aus einem Apple-Health-Export.</p>' +
    button('Gesundheitsdaten öffnen', 'view', 'Gesundheitsdaten', 'arrow') + '</article></div>';
}

export function mailboxView(state) {
  const source = state.mail.provider;
  const choices = Object.entries(providers).filter(([key]) => state.accounts?.[key]?.connected);
  const sourceButtons = choices.map(([key, item]) => '<button type="button" class="button" data-mail-provider="' + key + '" aria-pressed="' +
    (source === key) + '">' + providerBadge(key) + esc(item.title) + '</button>').join('');
  const mailControls = '<div class="theme-choices mailbox-sources">' + sourceButtons + '</div><form class="filters" id="mail-search">' +
    '<label class="input-wrap wide">In ' + providers[source].title + ' suchen<input type="search" name="query" maxlength="160" value="' +
    esc(state.mail.query) + '" placeholder="Betreff, Absender oder Stichwort"></label><button class="button primary" type="submit">' + icon('search', 18) +
    'Suchen</button></form>';
  const list = state.mail.rows.map(row => '<button class="row mail-row" type="button" data-mail-open="' + esc(row.id) + '">' + providerBadge(source) +
    '<span class="row-info"><span class="row-title">' + esc(row.subject) + '</span><span class="row-sub">' +
    esc([row.sender, showTimestamp(row.date)].filter(Boolean).join(' · ')) + '</span></span><span class="row-tail">' +
    (row.hasAttachments ? icon('paperclip', 17) : '') + icon('right', 16) + '</span></button>').join('');
  return heading('Posteingang', button('.eml importieren', 'mail-import', '', 'upload') + button('Terminprüfung', 'view', 'Terminprüfung', 'calendar') + button('Verbindungen', 'view', 'Verbindungen', 'link')) +
    (state.statusLoading && !choices.length ? empty('mail', 'Verbindungen werden geprüft …') : !choices.length ?
      '<div class="panel">' + empty('mail', 'Verbinde dein E-Mail-Konto', 'Du kannst auch eine als .eml gespeicherte Nachricht direkt importieren.',
        button('Zu den Verbindungen', 'view', 'Verbindungen', 'link', 'primary')) + '</div>' : mailControls +
      (state.mail.error ? '<div class="banner" role="alert">' + esc(state.mail.error) + '</div>' : '') +
      panel(state.mail.query ? 'Suchergebnisse' : 'Neueste Nachrichten', list || empty('mail',
        state.mail.loading ? 'Nachrichten werden geladen …' : 'Keine Nachrichten in dieser Ansicht'),
      state.mail.loading ? tag('Lädt …') : jump('Aktualisieren', 'mail-reload', '', 'refresh')) +
      (state.mail.next && !state.mail.loading ? '<div class="mail-more">' + button('Mehr laden', 'mail-more', '', 'plus') + '</div>' : ''));
}

export function mailDetail(mail, rows) {
  const dossiers = rows.filter(row => isActive(row) && sectionOf(row) === 'Fälle').sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de-CH'));
  return '<div class="mail-meta">' + providerBadge(mail.provider) + '<div><strong>' + esc(mail.sender) + '</strong>' +
    '<span>' + esc(showTimestamp(mail.date)) + '</span></div></div><div class="mail-content">' + esc(mail.text || 'Kein Text in der Vorschau.') + '</div>' +
    '<label class="input-wrap">Dossier<select name="caseId" required>' + options([['', 'Dossier auswählen'], ...dossiers.map(row => [row.id, nameOf(row)])], '') +
    '</select></label>' + (!dossiers.length ? note('Lege zuerst im Bereich Fälle ein Dossier an.') : '') +
    '<label class="check"><input type="checkbox" name="original" checked> Originalnachricht als .eml speichern</label>' +
    (mail.attachments.length ? '<fieldset class="links-control input-wrap"><legend>Anhänge separat speichern</legend><div class="link-options">' +
      mail.attachments.map(file => '<label class="check"><input type="checkbox" name="attachments" value="' + esc(file.id) + '"' +
      (file.size > (mail.provider === 'local' ? 25 : 10) * 1024 * 1024 ? ' disabled' : ' checked') + '> ' + esc(file.name) +
      (file.size > (mail.provider === 'local' ? 25 : 10) * 1024 * 1024 ? ' (zu gross)' : '') + '</label>').join('') + '</div></fieldset>' : '') +
    '<label class="check"><input type="checkbox" name="task"> Anschliessend eine Aufgabe oder Frist anlegen</label><p class="form-error" role="alert" hidden></p>';
}

export function healthView(state) {
  const info = measures[state.metric];
  const through = today();
  const from = shiftDate(through, 1 - Number(state.healthRange));
  const data = preferredHealthDays(state.health, state.metric, from, through);
  const recent = data.at(-1);
  const connected = state.health.some(row => row.source === 'healthkit');
  const formatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
  let chart = '';
  if (data.length) {
    const low = Math.min(...data.map(row => row.value));
    const high = Math.max(...data.map(row => row.value));
    const scale = ['weight', 'resting'].includes(state.metric) ? Math.max(1, high - low) : Math.max(1, high);
    const baseline = ['weight', 'resting'].includes(state.metric) ? low : 0;
    chart = '<div class="health-bars" aria-hidden="true">' + data.map(row => {
      const height = Math.max(5, Math.round(95 * (row.value - baseline) / scale));
      return '<meter min="0" max="100" value="' + height + '" title="' + esc(showDate(row.day) + ' · ' + formatter.format(row.value) + ' ' + info.unit) +
        '">' + height + '</meter>';
    }).join('') + '</div><div class="health-axis"><span>' + esc(showDate(data[0].day)) + '</span><span>' + esc(showDate(recent.day)) + '</span></div>';
  }
  const metricTabs = Object.entries(measures).map(([key, item]) => '<button class="button" type="button" data-health-metric="' + key + '" aria-pressed="' +
    (key === state.metric) + '">' + icon(item.icon, 17) + esc(item.label) + '</button>').join('');
  const main = '<div class="panel-body health-content"><div class="health-toolbar"><div class="theme-choices">' + metricTabs +
    '</div><label class="input-wrap">Zeitraum<select data-health-range>' + options([['7','7 Tage'],['30','30 Tage'],['90','90 Tage'],['365','365 Tage']], state.healthRange) +
    '</select></label></div>' + (recent ? '<div class="health-reading"><strong>' + formatter.format(recent.value) + '</strong> ' + esc(info.unit) +
      '<span>' + esc(showDate(recent.day) + ' · ' + recent.source_name) + '</span></div>' + chart +
      '<details class="health-history"><summary>Tageswerte anzeigen</summary><div class="health-table-wrap"><table><thead><tr><th>Datum</th><th>Wert</th><th>Quelle</th></tr></thead><tbody>' +
      data.slice().reverse().map(row => '<tr><td>' + esc(showDate(row.day)) + '</td><td>' + formatter.format(row.value) + ' ' + esc(info.unit) +
      '</td><td>' + esc(row.source_name) + '</td></tr>').join('') + '</tbody></table></div></details>' :
      empty(info.icon, state.healthLoading ? 'Tageswerte werden geladen …' : 'Keine Werte in diesem Zeitraum', 'Die ausgewählten Messwerte erscheinen nach dem Import hier.')) + '</div>';
  return heading('Gesundheitsdaten', button('Apple-Health-Export importieren', 'health-import', '', 'upload', 'primary')) +
    (state.healthError ? '<div class="banner" role="alert">' + esc(state.healthError) + '</div>' : '') +
    panel(info.label, main) + panel('Datenquellen', '<div class="panel-body settings-content"><p>Apple Health · ' +
      (connected ? 'HealthKit-Tageswerte vorhanden' : 'ZIP- oder XML-Import') + '</p>' +
      '<p>Du wählst beim Import die Messwerte, den Zeitraum und pro Messwert eine Quelle. LifeCase übernimmt Tageswerte. Bei Daten aus beiden Importwegen zeigt LifeCase pro Tag bevorzugt HealthKit-Werte.</p>' +
      (state.health.length ? '<div class="actions">' + button('Importierte Gesundheitsdaten löschen', 'health-clear', '', 'archive', 'danger') + '</div>' : '') + '</div>');
}
