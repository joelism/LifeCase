import { connection } from './connections-api.js';
import { displayedAgenda } from './connected-model.js';
import { findLunchSlot } from './lunch.js';
import { CH_ZONE, isActive, reminderDue, sectionOf, shiftDate, today, value } from './model.js';
import { isOpenTask, planningKinds, preparationSource } from './planning.js';
import { icon } from './icons.js';
import { button, esc } from './ui.js';
import { groupWorkdays } from './workday.js';

const appointmentKinds = new Set(['Termin', 'Gespräch', 'Arztbesuch']);
const clock = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: CH_ZONE });

export function briefingSnapshot(rows, events, suggestions = 0, now = new Date()) {
  const day = today(now);
  const through = shiftDate(day, 1);
  const agenda = displayedAgenda(rows, events).filter(item => item.state === 'Offen');
  const grouped = groupWorkdays(agenda);
  const days = [day, through].map(date => {
    const items = grouped.filter(item => item.date === date);
    const scheduled = items.filter(item => appointmentKinds.has(item.kind) || item.kind === 'Schicht');
    return {
      appointments: items.filter(item => appointmentKinds.has(item.kind)).length,
      shifts: items.filter(item => item.kind === 'Schicht').length,
      tasks: items.filter(item => planningKinds.includes(item.kind)).length,
      firstTime: scheduled.find(item => item.time)?.time || '',
      tight: scheduled.filter(item => item.spacing === 'Knapp').length,
      overlaps: scheduled.filter(item => item.spacing === 'Überschneidung').length,
    };
  });
  const overdue = agenda.filter(item => item.date < day && planningKinds.includes(item.kind)).length;
  const openTasks = rows.filter(isOpenTask).length;
  const reminders = agenda.filter(item => reminderDue(item, day)).length;
  const expiring = rows.filter(row => isActive(row) && ['Arztzeugnisse', 'Rezepte'].includes(sectionOf(row)) &&
    value(row, 'validUntil') >= day && value(row, 'validUntil') <= shiftDate(day, 7)).length;
  const options = {};
  const next = agenda.find(item => item.date >= day && item.date <= through && appointmentKinds.has(item.kind) &&
    (item.date !== day || !item.time || item.time >= clock.format(now)) && preparationSource(item));
  if (next) options.prepare = next.external ?
    ['Termin vorbereiten', 'planner-external', [next.external.provider, next.external.id, next.external.date].join('|'), 'tasks'] :
    ['Termin vorbereiten', 'planner-prepare', next.row.id, 'tasks'];
  if (reminders || expiring) options.reminders = ['Erinnerungen öffnen', 'view', 'Erinnerungen', 'bell'];
  if (overdue || openTasks || days.some(item => item.tasks || item.tight || item.overlaps)) {
    options.week = ['Woche planen', 'view', 'Meine Woche', 'week'];
  }
  if (suggestions) options.mail = ['Terminvorschläge prüfen', 'view', 'Terminprüfung', 'mail'];
  if (days[0].appointments >= 2 && !grouped.some(item => item.date === day && item.lunch) && findLunchSlot(agenda, day, { now })) {
    options.lunch = ['Mittagspause suchen', 'assistant-lunch', '', 'sun'];
  }
  return { options, facts: { day, days, overdue, openTasks, reminders, expiring, suggestions, actions: Object.keys(options) } };
}

export function makeDailyBriefing(ctx) {
  let requested = '';
  let result = null;
  let busy = false;
  let retryAt = 0;
  function reset() { requested = ''; result = null; busy = false; retryAt = 0; }
  async function refresh(snapshot) {
    const signature = JSON.stringify(snapshot.facts);
    if (busy || (signature === requested && (result || Date.now() < retryAt))) return;
    requested = signature;
    retryAt = Date.now() + 5 * 60000;
    busy = true;
    result = null;
    const epoch = ctx.epoch();
    try {
      const response = await connection('assistant-briefing', { briefing: snapshot.facts });
      if (epoch === ctx.epoch() && response.action === 'briefing' && typeof response.text === 'string') result = response;
    } catch { /* The calendar and concrete suggestions still use local data. */ }
    finally {
      if (epoch === ctx.epoch()) { busy = false; if (ctx.view() === 'Übersicht') ctx.render(); }
    }
  }
  function view(snapshot) {
    const signature = JSON.stringify(snapshot.facts);
    const brief = requested === signature ? result : null;
    const { days, overdue, expiring, reminders, suggestions } = snapshot.facts;
    const summary = days.map(item => [
      item.appointments ? item.appointments + (item.appointments === 1 ? ' Termin' : ' Termine') : '',
      item.shifts ? item.shifts + (item.shifts === 1 ? ' Schicht' : ' Schichten') : '',
      item.tasks ? item.tasks + (item.tasks === 1 ? ' Aufgabe oder Frist' : ' Aufgaben und Fristen') : '',
    ].filter(Boolean).join(' · ') || 'Keine datierten Einträge');
    const offer = snapshot.options[brief?.help] || Object.values(snapshot.options)[0];
    const alerts = [overdue && overdue + (overdue === 1 ? ' überfällige Aufgabe' : ' überfällige Aufgaben'),
      expiring && expiring + (expiring === 1 ? ' Dokument läuft bald ab' : ' Dokumente laufen bald ab'),
      reminders && reminders + (reminders === 1 ? ' fällige Erinnerung' : ' fällige Erinnerungen'),
      suggestions && suggestions + (suggestions === 1 ? ' Terminvorschlag' : ' Terminvorschläge'),
      ...days.map((item, index) => item.overlaps ? (index ? 'Morgen' : 'Heute') + ' mit Überschneidungen' :
        item.tight ? (index ? 'Morgen' : 'Heute') + ' mit knappen Abständen' : '')].filter(Boolean);
    return '<section class="panel daily-briefing" aria-labelledby="daily-briefing-title"><div class="panel-head"><h2 id="daily-briefing-title">' +
      icon('sun', 19) + (brief ? 'KI-Tagesbrief' : 'Heute &amp; morgen') + '</h2></div><div class="panel-body">' +
      '<dl class="briefing-days"><div><dt>Heute</dt><dd>' + esc(summary[0]) + '</dd></div><div><dt>Morgen</dt><dd>' +
      esc(summary[1]) + '</dd></div></dl>' +
      (alerts.length ? '<p class="briefing-alerts">' + esc(alerts.join(' · ')) + '</p>' : '') +
      (brief ? '<p>' + esc(brief.text) + '</p>' : '') +
      (offer ? '<div class="actions">' + button(...offer) + '</div>' : '') + '</div></section>';
  }
  return { refresh, reset, view };
}
