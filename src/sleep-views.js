import { icon } from './icons.js';
import { button, esc, options } from './ui.js';
import { showDate, today } from './model.js';
import { sleepDuration, sleepHistory } from './sleep-plan.js';

export function sleepQuestion(plan, name) {
  return (name ? 'Hey, ' + name + '. ' : '') + 'Wann möchtest du am ' + showDate(plan.morning) + ' aufstehen?';
}

export function sleepCalendarNote(plan) {
  return plan.first ? (plan.first.kind === 'Schicht' ? 'Schichtbeginn' : 'Erster Kalendereintrag') + ' um ' + plan.first.time + ' Uhr.' : '';
}

export function renderSleepPlan({ plan, settings, now, calendarIncomplete }, sleepRows) {
  if (plan.alreadyArose) return '';
  const scheduled = plan.status === 'scheduled';
  const question = plan.status === 'question';
  let label = 'Wann möchtest du aufstehen?';
  if (plan.status === 'flexible') label = 'Keine feste Aufstehzeit';
  if (scheduled) label = 'Schlafenszeit ' + plan.bedTime + ' Uhr';
  if (scheduled && plan.minutesLeft !== null) label = 'Bis zum Aufstehen bleiben ' + sleepDuration(plan.minutesLeft);
  if (plan.conflict) label = 'Ein Termin liegt im Schlaffenster';
  if (scheduled && !plan.plannedMinutes) label = 'Kein Schlafzeitfenster vor dem Aufstehen';
  const date = showDate(plan.morning);
  const details = scheduled ? date + ' um ' + plan.wakeTime + ' Uhr · Schlafziel ' + sleepDuration(settings.goal) + '.' :
    date + ' · Dein Schlafzeitfenster ist ' + settings.earliestBed + '–' + settings.latestBed + ' Uhr.';
  const reason = sleepCalendarNote(plan) + (plan.shortBuffer ? ' Bis dahin bleiben ab dem Aufstehen weniger als ' + settings.lead + ' Minuten Puffer.' : '');
  const available = plan.minutesLeft ?? plan.plannedMinutes;
  const shortfall = settings.goal - available;
  const availability = available > 0 && shortfall > 0 && !plan.alreadyArose && !plan.conflict
    ? (plan.minutesLeft === null ? 'Bis dahin sind ' + sleepDuration(available) + ' möglich, ' : 'Das sind ') +
      sleepDuration(shortfall) + ' weniger als dein Schlafziel.' : '';
  const schedule = plan.conflict ? 'Um ' + plan.conflict.time + ' Uhr beginnt ein Eintrag, der mit dem Schlaffenster zusammenfällt.' :
    plan.plannedMinutes > 0 && !plan.alreadyArose && plan.bedDay !== today(now) && plan.minutesLeft === null ?
      'Schlafenszeit am ' + showDate(plan.bedDay) + '.' : '';
  const stats = sleepHistory(sleepRows ?? [], now);
  const summary = stats ? 'Letzte 7 Tage · Ø ' + sleepDuration(stats.average) + ' aus ' + stats.count +
    (stats.count === 1 ? ' Tag mit Schlafdaten' : ' Tagen mit Schlafdaten') : sleepRows ? 'Noch keine Schlafwerte aus den letzten 7 Tagen.' : '';
  const difference = stats && stats.average < settings.goal ? ' · ' + sleepDuration(settings.goal - stats.average) + ' unter deinem Ziel' : '';
  const history = summary ? '<p class="sleep-plan-history">' + esc(summary + difference) + '</p>' : '';
  const note = [availability, reason, schedule, calendarIncomplete ? 'Externe Kalender werden gerade nicht vollständig berücksichtigt.' : ''].filter(Boolean).join(' ');
  return '<section class="panel sleep-plan" aria-labelledby="sleep-plan-title"><span class="tile-icon" aria-hidden="true">' + icon('moon', 20) +
    '</span><div class="sleep-plan-copy"><p class="hint">Schlafplan</p><h2 id="sleep-plan-title">' + esc(label) + '</h2><p>' + esc(details) + '</p>' +
    (note ? '<p class="hint">' + esc(note) + '</p>' : '') + history + '</div>' +
    button(question ? 'Im Chat antworten' : 'Im Chat ändern', 'assistant-sleep', plan.morning, 'chat') + '</section>';
}

export function sleepSettingsFields(settings) {
  const goals = Array.from({ length: 25 }, (_, index) => 360 + index * 15).map(value => [String(value), sleepDuration(value)]);
  return '<div class="form-grid sleep-settings-grid">' +
    '<label class="check wide"><input type="checkbox" name="enabled"' + (settings.enabled ? ' checked' : '') +
    '> Schlafplan am Abend auf «Heute» anzeigen</label>' +
    '<label class="input-wrap">Aufstehzeit als Schnellantwort<input type="time" name="wake" value="' + esc(settings.wake) + '"></label>' +
    '<label class="input-wrap">Schlafziel<select name="goal">' + options(goals, String(settings.goal)) + '</select></label>' +
    '<label class="input-wrap">Frühestens schlafen gehen<input type="time" name="earliestBed" value="' + esc(settings.earliestBed) + '" required></label>' +
    '<label class="input-wrap">Spätestens schlafen gehen<input type="time" name="latestBed" value="' + esc(settings.latestBed) + '" required></label>' +
    '<label class="input-wrap wide">Puffer vor einem frühen Termin (Minuten)<input type="number" name="lead" min="0" max="240" step="1" value="' +
    esc(settings.lead) + '" required></label><p class="hint wide">Der Assistent fragt dich abends nach deiner Aufstehzeit. Du kannst eine Zeit angeben oder ausschlafen.</p>' +
    '<p class="form-error wide" role="alert" hidden></p></div>';
}
