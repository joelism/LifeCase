import { icon } from './icons.js';
import { button, esc, options } from './ui.js';
import { showDate, today } from './model.js';
import { isSleepPlanningTime, planSleep, sleepDuration, sleepHistory } from './sleep-plan.js';

export function renderSleepPlan(entries, sleepRows, settings, { now = new Date(), overview = false, calendarIncomplete = false } = {}) {
  if (!settings.enabled || (overview && !isSleepPlanningTime(now))) return '';
  const plan = planSleep(entries, settings, now);
  if (plan.alreadyArose && overview) return '';
  const stats = sleepHistory(sleepRows ?? [], now);
  const label = plan.conflict ? 'Ein Termin liegt im Schlaffenster' : plan.minutesLeft !== null ?
    'Bis zum Aufstehen bleiben ' + sleepDuration(plan.minutesLeft) : 'Schlafenszeit ' + plan.bedTime + ' Uhr';
  const dayLabel = plan.wakeDay === today(now) ? 'Heute' : plan.wakeDay === plan.morning ? 'Morgen' : showDate(plan.wakeDay);
  const details = dayLabel + ' um ' + plan.wakeTime + ' Uhr aufstehen · Schlafziel ' + sleepDuration(settings.goal) + '.';
  const reason = plan.first ? (plan.first.kind === 'Schicht' ? 'Schichtbeginn' : 'Erster Termin') + ' um ' + plan.first.time + ' Uhr · ' +
    settings.lead + ' Min. Puffer.' :
    'Aus deiner eingestellten Aufstehzeit berechnet.';
  const schedule = plan.conflict ? 'Um ' + plan.conflict.time + ' Uhr beginnt ein Eintrag, der mit dem Schlaffenster zusammenfällt.' :
    plan.bedDay !== today(now) && plan.minutesLeft === null ? 'Schlafenszeit am ' + showDate(plan.bedDay) + '.' : '';
  const summary = stats ? 'Letzte 7 Tage · Ø ' + sleepDuration(stats.average) + ' aus ' + stats.count +
    (stats.count === 1 ? ' Tag mit Schlafdaten' : ' Tagen mit Schlafdaten') : sleepRows ? 'Noch keine Schlafwerte aus den letzten 7 Tagen.' : '';
  const difference = stats && stats.average < settings.goal ? ' · ' + sleepDuration(settings.goal - stats.average) + ' unter deinem Ziel' : '';
  const history = summary ? '<p class="sleep-plan-history">' + esc(summary + difference) + '</p>' : '';
  return '<section class="panel sleep-plan" aria-labelledby="sleep-plan-title"><span class="tile-icon" aria-hidden="true">' + icon('moon', 20) +
    '</span><div class="sleep-plan-copy"><p class="hint">Schlafplan</p><h2 id="sleep-plan-title">' + esc(label) + '</h2><p>' + esc(details) +
    '</p><p class="hint">' + esc([reason, schedule, calendarIncomplete ? 'Externer Kalender wird gerade nicht vollständig berücksichtigt.' : ''].filter(Boolean).join(' ')) +
    '</p>' + history + '</div>' + button('Einstellen', 'sleep-settings', '', 'settings') + '</section>';
}

export function sleepSettingsFields(settings) {
  const goals = Array.from({ length: 25 }, (_, index) => 360 + index * 15).map(value => [String(value), sleepDuration(value)]);
  return '<div class="form-grid sleep-settings-grid">' +
    '<label class="check wide"><input type="checkbox" name="enabled"' + (settings.enabled ? ' checked' : '') +
    '> Schlafplan am Abend auf «Heute» anzeigen</label>' +
    '<label class="input-wrap">Gewohnte Aufstehzeit<input type="time" name="wake" value="' + esc(settings.wake) + '" required></label>' +
    '<label class="input-wrap">Schlafziel<select name="goal">' + options(goals, String(settings.goal)) + '</select></label>' +
    '<label class="input-wrap wide">Puffer vor einem frühen Termin (Minuten)<input type="number" name="lead" min="0" max="240" step="1" value="' +
    esc(settings.lead) + '" required></label><p class="hint wide">Der Vorschlag kann bei frühen Terminen früher ausfallen. Der Schlafverlauf wird in LifeCase berechnet.</p>' +
    '<p class="form-error wide" role="alert" hidden></p></div>';
}
