import { archive, findRecord, message, saveRecord, userError } from './backend.js';
import { providers } from './connected-model.js';
import { lunchLabel } from './workday.js';
import { closeDialog, editRecord, errorAt, openDialog } from './editor.js';
import { icon } from './icons.js';
import { CH_ZONE, isActive, nameOf, sectionOf, shiftDate, showDate, today, value } from './model.js';
import { followUpDefaults, isOpenTask, isPlanningTask, preparationContext, preparationForRow, preparationSource, weekPlan } from './planning.js';
import { button, empty, esc, jump, options, tag } from './ui.js';
import { heading, panel } from './views.js';

const listOf = row => Array.isArray(row?.fields?.items) ? row.fields.items : [];
const itemName = entry => entry.external?.title ?? nameOf(entry.row);
const eventKey = event => [event.provider, event.id, event.date].join('|');
const weekdays = new Intl.DateTimeFormat('de-CH', { weekday: 'short', timeZone: CH_ZONE });
const calendarSymbols = { Schicht: 'clock', Pause: 'sun', Frist: 'flag', Wiedervorlage: 'flag', Aufgabe: 'tasks', Arztzeugnis: 'badge', Rezept: 'file', Erinnerung: 'bell' };
const dateLabel = day => weekdays.format(new Date(day + 'T12:00:00Z'));

export function renderWeek(plan, state, allRows, connected) {
  const current = today();
  const entry = (item, showDay = false) => {
    const row = item.row;
    const result = item.shifts ? null : preparationSource(item);
    const prep = result && allRows.find(item => sectionOf(item) === 'Vorbereitung' && isActive(item) && value(item, 'subjectKey') === result.key);
    const action = item.shifts ? 'workday' : row ? 'open' : 'external-open';
    const key = row ? row.id : eventKey(item.external);
    const isTask = row && isOpenTask(row);
    const info = [showDay ? showDate(item.date) : '', [item.time, item.endTime].filter(Boolean).join('–'),
      item.external ? providers[item.external.provider]?.calendar : item.kind].filter(Boolean).join(' · ');
    const check = isTask ? '<button type="button" class="plan-check" data-planner-done="' + esc(row.id) + '" aria-label="' +
      esc(nameOf(row) + ' erledigen') + '">' + icon('check', 16) + '</button>' :
      '<span class="tile-icon ' + (item.kind === 'Frist' ? 'amber' : '') + '">' + icon(calendarSymbols[item.kind] || 'calendar', 17) + '</span>';
    const prepareLabel = prep ? (value(prep, 'status') === 'Bereit' ? 'Vorbereitet' : 'Vorbereitung') : 'Vorbereiten';
    return '<div class="week-entry">' + check + '<button type="button" class="week-entry-main" data-' + action + '="' + esc(key) +
      '"><strong>' + esc(itemName(item)) + '</strong><small>' + esc(info) + '</small>' + (item.lunch ? '<span class="workday-break">' + icon('sun', 14) + esc(lunchLabel(item.lunch)) + '</span>' : '') + '</button><div class="week-entry-actions">' +
      (item.spacing ? tag(item.spacing, item.spacing === 'Knapp' ? 'amber' : 'rose') : '') +
      (result ? button(prepareLabel, row ? 'planner-prepare' : 'planner-external', key, value(prep || { fields: {} }, 'status') === 'Bereit' ? 'check' : 'tasks') : '') + '</div></div>';
  };
  const strip = '<nav class="week-strip" aria-label="Tage im Wochenblick">' + plan.days.map(day =>
    '<button type="button" data-planner-day="' + day.date + '" aria-label="' + esc(showDate(day.date) + ', ' + day.entries.length + ' Einträge') +
    '"' + (day.date === current ? ' aria-current="date"' : '') + ' aria-pressed="' + (state.selected === day.date) + '"><span>' +
    esc(dateLabel(day.date)) + '</span><strong>' + Number(day.date.slice(-2)) + '</strong><small>' +
    (day.entries.length || '·') + '</small></button>').join('') + '</nav>';
  const days = state.selected ? plan.days.filter(day => day.date === state.selected) : plan.days.filter(day => day.entries.length);
  const dayCards = days.map(day => panel(day.date === current ? 'Heute' : dateLabel(day.date) + ' · ' + showDate(day.date),
    day.entries.length ? day.entries.map(item => entry(item)).join('') : empty('calendar', 'Keine Einträge an diesem Tag'),
    jump('Zum Kalender', 'planner-calendar', day.date, 'calendar'))).join('');
  const late = plan.late.length ? panel('Überfällig', plan.late.map(item => entry(item, true)).join('')) : '';
  const inbox = panel('Aufgaben ohne Datum', plan.inbox.length ? plan.inbox.map(row => entry({ row, kind: 'Aufgabe' })).join('') :
    empty('tasks', 'Keine Aufgaben ohne Datum'));
  const undo = state.completed ? '<div class="week-undo" role="status"><span>Erledigt · ' + esc(nameOf(state.completed)) + '</span>' +
    button('Rückgängig', 'planner-undo', state.completed.id, 'refresh') + '</div>' : '';
  const range = '<section class="panel week-controls"><button class="icon-btn" data-planner-step="-7" type="button" aria-label="Vorherige sieben Tage">' +
    icon('left') + '</button><div><strong>' + esc(showDate(plan.start) + ' – ' + showDate(plan.end)) + '</strong><span>' +
    esc(plan.appointments + ' Termine · ' + plan.shiftCount + ' Schichten · ' + plan.taskCount + ' Aufgaben und Fristen') +
    '</span></div><button class="icon-btn" data-planner-step="7" type="button" aria-label="Nächste sieben Tage">' + icon('right') +
    '</button></section>';
  const status = (connected.calendarErrors ?? []).map(error => '<div class="banner" role="status">' + esc(error) + '</div>').join('') +
    (connected.calendarLoading ? '<p class="hint" role="status">Externe Kalender werden geladen …</p>' : '');
  return heading('Meine Woche', button('Aufgabe erfassen', 'planner-new', '', 'plus', 'primary')) + range + strip +
    '<div class="week-filters actions">' + button('Ab heute', 'planner-reset', '', 'calendar') +
    (state.selected ? button('Alle Tage', 'planner-day', '', 'week') : '') + '</div>' + status + undo +
    '<div class="week-grid"><div class="week-days">' + (dayCards || '<div class="panel">' + empty('week', 'Keine Einträge für diese Woche') + '</div>') +
    '</div><aside class="week-focus" aria-label="Offene Aufgaben">' + late + inbox + '</aside></div>';
}

export function makePlanner(ctx) {
  const state = { start: today(), selected: '', completed: null, custom: false };
  const saving = new Set();
  function reset() { state.start = today(); state.selected = ''; state.completed = null; state.custom = false; saving.clear(); }

  function openPreparation(source, existing) {
    if (!source) return;
    const rows = ctx.rows();
    const prior = existing ?? rows.find(row => sectionOf(row) === 'Vorbereitung' && value(row, 'subjectKey') === source.key);
    const linkedCases = preparationContext(rows, source, prior);
    const caseOptions = rows.filter(row => sectionOf(row) === 'Fälle' && (isActive(row) || linkedCases.caseIds.includes(row.id)));
    const positions = '<div id="prepare-checklist"></div><button type="button" class="button" data-prep-add>' + icon('plus', 17) + 'Punkt hinzufügen</button>';
    const recordLink = source.row ? button('Termin öffnen', 'open', source.row.id, 'calendar') : '';
    const documents = (context = linkedCases) => context.documents.length ?
      '<div class="chips">' + context.documents.map(row => '<button type="button" class="chip" data-open="' +
        esc(row.id) + '">' + esc(nameOf(row)) + '</button>').join('') + '</div>' :
      '<p class="hint">Im verknüpften Dossier sind keine passenden Unterlagen abgelegt.</p>';
    const body = '<div class="prep-subtitle"><strong>' + esc(source.title) + '</strong><p>' + esc([showDate(source.date), source.time,
      source.source && providers[source.source]?.calendar].filter(Boolean).join(' · ')) + '</p></div><div class="form-grid">' +
      '<label class="input-wrap wide">Fragen und Stichpunkte<textarea name="notes" rows="4" maxlength="12000" placeholder="Was möchtest du besprechen?">' +
      esc(prior?.fields?.notes || '') + '</textarea></label><fieldset class="links-control wide"><legend>Mitnehmen oder vorher erledigen</legend>' +
      positions + '</fieldset><label class="input-wrap">Dossier<select name="caseId">' +
      options([['', 'Kein Dossier'], ...caseOptions.map(row => [row.id, nameOf(row)])], linkedCases.caseIds[0] || '') +
      '</select></label><label class="input-wrap">Status<select name="status">' +
      options(['Offen','Bereit'], prior?.fields?.status || 'Offen') +
      '</select></label><section class="wide"><h3 class="subheading">Passende Unterlagen</h3><div id="prep-documents">' + documents() +
      '</div></section><p class="form-error wide" role="alert" hidden></p></div>';
    const footer = recordLink + (prior && isActive(prior) ? button('Archivieren', 'prep-archive', prior.id, 'archive') : '') + button('Schliessen', 'close') +
      '<button type="submit" class="button primary">' + icon('check', 18) + 'Vorbereitung speichern</button>';
    const form = openDialog('Vorbereitung', body, footer, true).querySelector('form');
    const list = form.querySelector('#prepare-checklist');
    function add(item = {}, focus = false) {
      if (list.children.length >= 30) return;
      const line = document.createElement('div');
      line.className = 'prep-item';
      line.innerHTML = '<label class="check"><input type="checkbox" aria-label="Erledigt"' + (item.done ? ' checked' : '') +
        '></label><input type="text" maxlength="150" aria-label="Checklistenpunkt" placeholder="z. B. Arztzeugnis mitnehmen" value="' +
        esc(item.title || '') + '"><button type="button" class="icon-btn" data-prep-remove aria-label="Punkt entfernen">' + icon('close', 16) + '</button>';
      list.append(line);
      if (focus) line.querySelector('input[type="text"]').focus();
    }
    listOf(prior).forEach(item => add(item));
    form.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (control?.hasAttribute('data-prep-add')) add({}, true);
      if (control?.hasAttribute('data-prep-remove')) control.closest('.prep-item').remove();
    });
    form.elements.caseId.addEventListener('change', () => {
      const caseId = form.elements.caseId.value;
      const selected = { fields: { caseIds: caseId ? [caseId] : [] } };
      form.querySelector('#prep-documents').innerHTML = documents(preparationContext(ctx.rows(), source, selected));
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (event.submitter.disabled) return;
      const control = event.submitter;
      control.disabled = true;
      const epoch = ctx.epoch();
      try {
        const data = new FormData(form);
        const items = [...list.children].map(line => ({
          title: line.querySelector('input[type="text"]').value.trim(),
          done: line.querySelector('input[type="checkbox"]').checked,
        })).filter(item => item.title);
        const caseId = data.get('caseId');
        const fields = { ...prior?.fields, title: source.title, subjectKey: source.key, source: source.source, date: source.date, time: source.time,
          notes: String(data.get('notes') ?? '').trim(), status: data.get('status') === 'Bereit' ? 'Bereit' : 'Offen',
          caseIds: caseId ? [caseId] : [], relatedIds: source.row && source.row.id !== prior?.id ? [source.row.id] : prior?.fields?.relatedIds ?? [], items };
        let saved = await saveRecord('Vorbereitung', fields, prior);
        if (epoch !== ctx.epoch()) return;
        if (saved.archived_at) saved = await archive(saved, false);
        if (epoch !== ctx.epoch()) return;
        ctx.addRecord(saved);
        closeDialog();
        ctx.notify('Vorbereitung gespeichert.');
      } catch (error) {
        if (epoch === ctx.epoch()) errorAt(form, error.code === '23505' ? userError('Diese Vorbereitung wurde auf einem anderen Gerät erstellt. Aktualisiere LifeCase und öffne sie erneut.') : error);
      } finally { control.disabled = false; }
    });
  }
  function openSaved(row) {
    const source = ctx.rows().map(item => preparationForRow(item)).find(item => item?.key === value(row, 'subjectKey'));
    openPreparation(source ?? { key: value(row, 'subjectKey'), title: nameOf(row), date: value(row, 'date'), time: value(row, 'time'),
      source: value(row, 'source'), row: null }, row);
  }
  async function complete(id, undo) {
    if (saving.has(id)) return;
    saving.add(id);
    const epoch = ctx.epoch();
    try {
      const row = await findRecord(id);
      if (epoch !== ctx.epoch() || !isPlanningTask(row) || !isActive(row)) return;
      const shouldChange = undo ? value(row, 'status') === 'Erledigt' : isOpenTask(row);
      if (!shouldChange) throw userError('Diese Aufgabe wurde bereits auf einem anderen Gerät geändert.');
      const saved = await saveRecord('Kalender', { ...row.fields, status: undo ? 'Offen' : 'Erledigt' }, row);
      if (epoch !== ctx.epoch()) return;
      state.completed = undo ? null : saved;
      ctx.addRecord(saved);
      ctx.notify(undo ? 'Aufgabe wieder geöffnet.' : 'Aufgabe erledigt.');
    } finally { saving.delete(id); }
  }
  function activate() { if (ctx.view() === 'Meine Woche' && !state.custom && state.start < today()) state.start = today(); }
  function click(data) {
    if (!Object.keys(data).some(key => /^planner[A-Z]|^prepArchive$/.test(key))) return false;
    const handle = async () => {
      if ('plannerStep' in data || 'plannerReset' in data) {
        state.start = 'plannerReset' in data ? today() : shiftDate(state.start, Number(data.plannerStep));
        state.custom = 'plannerStep' in data;
        state.selected = '';
        ctx.render();
        ctx.refreshCalendar();
      } else if ('plannerDay' in data) {
        state.selected = data.plannerDay === state.selected ? '' : data.plannerDay;
        ctx.render();
        document.querySelector('[data-planner-day="' + state.selected + '"]')?.focus();
      } else if ('plannerCalendar' in data) ctx.showCalendarDate(data.plannerCalendar);
      else if ('plannerNew' in data) editRecord('Kalender', null, ctx, { kind: 'Aufgabe', date: state.selected || '' });
      else if ('plannerFollowup' in data) {
        const row = ctx.rows().find(row => row.id === data.plannerFollowup);
        if (row) editRecord('Kalender', null, ctx, followUpDefaults(row));
      } else if ('plannerDone' in data || 'plannerUndo' in data) await complete(data.plannerDone || data.plannerUndo, 'plannerUndo' in data);
      else if ('plannerPrepare' in data) {
        const row = ctx.rows().find(row => row.id === data.plannerPrepare);
        const source = preparationForRow(row);
        if (source) openPreparation(source);
      } else if ('plannerExternal' in data) {
        const event = ctx.externalEvents().find(event => eventKey(event) === data.plannerExternal);
        if (event) openPreparation(preparationSource({ external: event, kind: 'Termin' }));
      } else if ('prepArchive' in data) {
        const row = ctx.rows().find(row => row.id === data.prepArchive);
        if (row && sectionOf(row) === 'Vorbereitung') {
          const epoch = ctx.epoch();
          const updated = await archive(row, true);
          if (epoch !== ctx.epoch()) return;
          ctx.addRecord(updated);
          closeDialog();
          ctx.notify('Vorbereitung archiviert.');
        }
      }
    };
    handle().catch(error => ctx.notify(message(error)));
    return true;
  }
  function view(rows, connected) { return renderWeek(weekPlan(rows, connected.events, state.start), state, rows, connected); }
  return { state, reset, activate, click, view, openSaved };
}
