import { archive, records, saveIntakeRecord, message, userError } from './backend.js';
import { connection } from './connections-api.js';
import { duplicateAppointment, interpretAppointment, interpretTask } from './calendar-assistant.js';
import { displayedAgenda, expandEvents, providers } from './connected-model.js';
import { openDialog } from './editor.js';
import { icon } from './icons.js';
import { findLunchSlot, lunchRequest, lunchSlotIsFree } from './lunch.js';
import { nameOf, shiftDate, showDate, sha256, today } from './model.js';
import { button, esc, options } from './ui.js';

const prompts = {
  unsupported: 'Schreib mir einen Termin, eine Aufgabe oder frag nach einer Mittagspause.',
  missing_title: 'Wie soll der Termin heissen?',
  missing_day: 'An welchem Tag soll ich den Termin eintragen?',
  missing_time: 'Um welche Uhrzeit ist der Termin?',
  ambiguous: 'Ich erkenne mehrere Angaben. Nenne bitte einen Termin mit einem Datum und einer Startzeit.',
  past: 'Diese Uhrzeit liegt bereits in der Vergangenheit. An welchem Tag soll ich den Termin eintragen?',
  missing_task_title: 'Nenne die Aufgabe, zum Beispiel «Aufgabe: IV anrufen».',
  missing_task_day: 'Nenne die Aufgabe mit Datum, zum Beispiel «Bis Freitag IV anrufen».',
  past_task: 'Dieses Datum liegt in der Vergangenheit. Gib ein neues Datum für die Aufgabe an.',
};
const isYes = text => /^(?:ja(?:[, ]+bitte)?|bitte blockieren|blockieren|mach das)[.! ]*$/i.test(text);
const isNo = text => /^(?:nein(?:[, ]+danke)?|abbrechen)[.! ]*$/i.test(text);

export function makeAssistant(ctx, currentAccounts) {
  let history = [];
  let draft = null;
  let proposal = null;
  let target = '';
  let busy = false;
  const add = (side, text, record = '') => { history = [...history.slice(-11), { side, text, record }]; };
  function reset() { history = []; draft = null; proposal = null; target = ''; busy = false; }

  async function agendaFor(date, strict = false) {
    const latest = currentAccounts() ?? (await connection('status').catch(() => ({}))).accounts;
    const keys = Object.keys(providers).filter(provider => latest?.[provider]?.connected);
    const from = shiftDate(date, -1);
    const through = shiftDate(date, 1);
    const [originals, answers] = await Promise.all([records(), Promise.allSettled(keys.map(provider => connection('calendar', { provider, from, through })))]);
    const incomplete = !latest || answers.some(answer => answer.status === 'rejected');
    if (strict && incomplete) throw userError('Ein Kalender ist gerade nicht erreichbar. Versuche die Prüfung erneut.');
    const events = answers.flatMap(answer => answer.status === 'fulfilled' ? expandEvents(answer.value.events, from, through) : []);
    const destinations = keys.filter(key => latest[key].calendarWrite);
    return { originals, events, destinations, entries: displayedAgenda(originals, events), incomplete };
  }
  async function suggestLunch(request, epoch, after = '') {
    if (request.duration < 15 || request.duration > 120) {
      add('assistant', 'Wähle für die Mittagspause eine Dauer zwischen 15 und 120 Minuten.');
      return;
    }
    const result = await agendaFor(request.date, true);
    if (epoch !== ctx.epoch()) return;
    const slot = findLunchSlot(result.entries, request.date, { duration: request.duration, after });
    if (!slot) {
      proposal = null;
      add('assistant', 'Zwischen 12:00 und 14:00 finde ich am ' + showDate(request.date) + ' keine weitere freie Pause von ' + request.duration + ' Minuten.');
      return;
    }
    if (!result.destinations.includes(target)) target = '';
    proposal = { ...slot, destinations: result.destinations };
    const time = slot.time + '–' + slot.endTime;
    const afterText = slot.following ? (slot.following === 1 ? ' Danach steht noch ein Termin an.' : ' Danach stehen noch ' + slot.following + ' Termine an.') : '';
    add('assistant', (slot.date === today() ? 'Heute ist ' : 'Am ' + showDate(slot.date) + ' ist ') + time + ' frei.' + afterText +
      ' Soll ich die Mittagspause blockieren?');
  }
  async function blockLunch(epoch) {
    const candidate = proposal;
    if (!candidate) return;
    const selected = target;
    const result = await agendaFor(candidate.date, true);
    if (epoch !== ctx.epoch()) return;
    const previous = result.entries.find(item => item.date === candidate.date && item.time === candidate.time &&
      item.endTime === candidate.endTime && (selected ? item.external?.provider === selected && item.external.lifeCasePause :
        item.kind === 'Pause' && item.row?.fields?.intakeSource === 'Terminassistent'));
    if (previous) {
      proposal = null;
      add('assistant', 'Diese Mittagspause ist bereits eingetragen.', previous.row?.id);
      return;
    }
    if (!lunchSlotIsFree(result.entries, candidate)) {
      proposal = null;
      add('assistant', 'Die Zeit ist inzwischen belegt oder bereits vorbei. Ich prüfe eine andere Lücke.');
      await suggestLunch({ date: candidate.date, duration: candidate.duration }, epoch);
      return;
    }
    if (selected) {
      if (!result.destinations.includes(selected)) throw userError('Die Schreibfreigabe für diesen Kalender fehlt.');
      await connection('block-lunch', { provider: selected, date: candidate.date, time: candidate.time, endTime: candidate.endTime });
      if (epoch !== ctx.epoch()) return;
      proposal = null;
      add('assistant', 'Mittagspause von ' + candidate.time + ' bis ' + candidate.endTime + ' ist im ' + providers[selected].calendar + ' als belegt eingetragen.');
      ctx.refreshCalendar();
      return;
    }
    const fingerprint = await sha256(new Blob([candidate.date + '|' + candidate.time + '|' + candidate.endTime]));
    if (epoch !== ctx.epoch()) return;
    let saved = await saveIntakeRecord({ title: 'Mittagspause', date: candidate.date, time: candidate.time, endTime: candidate.endTime,
      kind: 'Pause', status: 'Offen', intakeSource: 'Terminassistent', intakeKey: 'lunch:' + fingerprint });
    if (epoch !== ctx.epoch()) return;
    if (saved.archived_at) saved = await archive(saved, false);
    if (epoch !== ctx.epoch()) return;
    ctx.addRecord(saved);
    proposal = null;
    add('assistant', 'Mittagspause von ' + candidate.time + ' bis ' + candidate.endTime + ' ist in LifeCase eingetragen.', saved.id);
  }
  async function addAppointment(text, epoch) {
    const result = interpretAppointment(text, draft);
    draft = result.draft;
    if (result.status !== 'ready') { add('assistant', prompts[result.status]); return; }
    const known = await agendaFor(draft.date);
    if (epoch !== ctx.epoch()) return;
    const found = duplicateAppointment(known.entries, draft);
    if (found) {
      add('assistant', '«' + draft.title + '» steht am ' + showDate(draft.date) + ' um ' + draft.time + ' bereits im Kalender.', found.row?.id);
      draft = null;
      return;
    }
    const hash = await sha256(new Blob([JSON.stringify([draft.date, draft.time, draft.title.normalize('NFKC').toLocaleLowerCase('de-CH')])]));
    if (epoch !== ctx.epoch()) return;
    let saved = await saveIntakeRecord({ ...draft, kind: 'Termin', status: 'Offen', intakeKey: 'chat:' + hash, intakeSource: 'Terminassistent' });
    if (epoch !== ctx.epoch()) return;
    if (saved.archived_at) saved = await archive(saved, false);
    if (epoch !== ctx.epoch()) return;
    ctx.addRecord(saved);
    const spacing = displayedAgenda([saved, ...known.originals.filter(row => row.id !== saved.id)], known.events).find(row => row.row?.id === saved.id)?.spacing;
    let reply = 'Eingetragen. ' + nameOf(saved) + ' am ' + showDate(draft.date) + ' um ' + draft.time + ' Uhr.';
    if (spacing === 'Knapp') reply += ' Ein anderer Termin liegt knapp daneben.';
    if (spacing === 'Überschneidung') reply += ' Der Termin überschneidet sich mit einem anderen Eintrag.';
    if (known.incomplete) reply += ' Der Abgleich mit externen Kalendern war gerade nicht vollständig.';
    add('assistant', reply, saved.id);
    draft = null;
  }
  async function addTask(result, epoch) {
    if (result.status !== 'ready') { add('assistant', prompts[result.status]); return; }
    const fields = result.fields;
    const hash = await sha256(new Blob([JSON.stringify([fields.kind, fields.date, fields.time, fields.title.toLocaleLowerCase('de-CH')])]));
    if (epoch !== ctx.epoch()) return;
    let saved = await saveIntakeRecord({ ...fields, intakeKey: 'task-chat:' + hash, intakeSource: 'Terminassistent' });
    if (epoch !== ctx.epoch()) return;
    if (saved.archived_at) saved = await archive(saved, false);
    if (epoch !== ctx.epoch()) return;
    ctx.addRecord(saved);
    if (saved.fields.status === 'Erledigt') add('assistant', '«' + nameOf(saved) + '» ist bereits als erledigt markiert.', saved.id);
    else add('assistant', '«' + nameOf(saved) + '» steht ' + (fields.date ?
      'am ' + showDate(fields.date) + (fields.time ? ' um ' + fields.time + ' Uhr' : '') + ' in deiner Planung.' :
      'unter «Aufgaben ohne Datum» in «Meine Woche».') , saved.id);
    draft = null;
  }
  function content() {
    const messages = history.length ? history.map(row => '<div class="assistant-bubble ' + row.side + '"><p>' + esc(row.text) + '</p>' +
      (row.record ? button('Eintrag ansehen','open',row.record,'calendar') : '') + '</div>').join('') :
      '<div class="assistant-bubble assistant"><p>Frag nach einer Mittagspause oder schreib mir einen Termin oder eine Aufgabe.</p></div>';
    const controls = !proposal ? '<div class="assistant-tools">' + button('Mittagspause finden','lunch-find','','sun') + '</div>' :
      '<div class="assistant-tools">' +
      (proposal.destinations.length ? '<label class="input-wrap">Blockieren in<select data-lunch-target>' +
        options([['', 'LifeCase'], ...proposal.destinations.map(key => [key, providers[key].calendar])], target) + '</select></label>' : '') +
      '<div class="actions">' + button('Ja, bitte','lunch-confirm','','check','primary') +
        button('Andere Zeit','lunch-other','','clock') + button('Nein','lunch-cancel') + '</div></div>';
    return messages + (!busy ? controls : '<p class="hint assistant-running" role="status">Kalender werden geprüft …</p>');
  }
  function open(autoLunch = false) {
    const dialog = openDialog('Terminassistent', '<div class="assistant-thread" aria-live="polite">' + content() + '</div>' +
      '<form class="assistant-form"><label class="input-wrap"><span>Deine Nachricht</span><input name="request" type="text" maxlength="300" ' +
      'placeholder="Morgen um 15:30 Arzttermin" autocomplete="off" required autofocus></label><button type="submit" class="button primary" aria-label="Nachricht senden">' +
      icon('arrow', 21) + '</button></form>');
    const form = dialog.querySelector('.assistant-form');
    const thread = dialog.querySelector('.assistant-thread');
    const field = form.elements.request;
    const submit = form.querySelector('button');
    const draw = () => { thread.innerHTML = content(); thread.scrollTop = thread.scrollHeight; submit.disabled = busy; };
    async function run(action) {
      if (busy) return;
      const epoch = ctx.epoch();
      busy = true;
      draw();
      try { await action(epoch); }
      catch (error) { if (epoch === ctx.epoch()) add('assistant', message(error)); }
      finally {
        if (epoch === ctx.epoch()) {
          busy = false;
          if (form.isConnected) draw();
          else if (dialog.open && dialog.querySelector('.assistant-thread')) open();
        }
      }
    }
    function find(epoch) {
      target = '';
      proposal = null;
      return suggestLunch({ date: today(), duration: 45 }, epoch);
    }
    function cancel() { proposal = null; add('assistant', 'Die Zeit bleibt frei.'); draw(); }
    function alternative(epoch) {
      if (!proposal) return;
      const current = proposal;
      proposal = null;
      return suggestLunch(current, epoch, current.endTime);
    }
    thread.addEventListener('change', event => {
      if (event.target.matches('[data-lunch-target]')) target = event.target.value;
    });
    thread.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (control?.hasAttribute('data-lunch-find')) run(find);
      if (control?.hasAttribute('data-lunch-confirm')) { add('user', 'Ja, bitte'); run(blockLunch); }
      if (control?.hasAttribute('data-lunch-cancel')) cancel();
      if (control?.hasAttribute('data-lunch-other')) run(alternative);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy) return;
      const text = field.value.trim();
      if (!text) return;
      field.value = '';
      add('user', text);
      if (proposal && isYes(text)) return run(blockLunch);
      if (proposal && isNo(text)) return cancel();
      if (proposal && /^(?:andere zeit|später)[.! ]*$/i.test(text)) return run(alternative);
      const task = interpretTask(text);
      const request = lunchRequest(text);
      proposal = null;
      if (task) return run(epoch => addTask(task, epoch));
      if (request) { target = ''; return run(epoch => suggestLunch(request, epoch)); }
      run(epoch => addAppointment(text, epoch));
    });
    draw();
    if (autoLunch && !proposal) run(find);
  }
  return { open, reset };
}
