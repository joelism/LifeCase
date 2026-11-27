import { archive, records, saveIntakeRecord, message } from './backend.js';
import { connection } from './connections-api.js';
import { duplicateAppointment, interpretAppointment } from './calendar-assistant.js';
import { displayedAgenda, expandEvents, providers } from './connected-model.js';
import { openDialog } from './editor.js';
import { icon } from './icons.js';
import { nameOf, shiftDate, showDate, sha256 } from './model.js';
import { button, esc } from './ui.js';

const prompts = {
  unsupported: 'Schreib mir einen neuen Termin, den ich eintragen soll.',
  missing_title: 'Wie soll der Termin heissen?',
  missing_day: 'An welchem Tag soll ich den Termin eintragen?',
  missing_time: 'Um welche Uhrzeit ist der Termin?',
  ambiguous: 'Ich erkenne mehrere Angaben. Nenne bitte einen Termin mit einem Datum und einer Startzeit.',
  past: 'Diese Uhrzeit liegt bereits in der Vergangenheit. An welchem Tag soll ich den Termin eintragen?',
};

export function makeAssistant(ctx, currentAccounts) {
  let history = [];
  let draft = null;
  let busy = false;
  const add = (side, text, record = '') => { history = [...history.slice(-11), { side, text, record }]; };
  function reset() { history = []; draft = null; busy = false; }
  function content() {
    return history.length ? history.map(row => '<div class="assistant-bubble ' + row.side + '"><p>' + esc(row.text) + '</p>' +
      (row.record ? button('Termin ansehen','open',row.record,'calendar') : '') + '</div>').join('') :
      '<div class="assistant-bubble assistant"><p>Schreib mir einen Termin. Zum Beispiel «Hab morgen um 15:30 Arzttermin».</p></div>';
  }
  function open() {
    const dialog = openDialog('Terminassistent', '<div class="assistant-thread" aria-live="polite">' + content() + '</div>' +
      '<form class="assistant-form"><label class="input-wrap"><span>Deine Nachricht</span><input name="request" type="text" maxlength="300" ' +
      'placeholder="Morgen um 15:30 Arzttermin" autocomplete="off" required autofocus></label><button type="submit" class="button primary" aria-label="Nachricht senden">' +
      icon('arrow', 21) + '</button></form>');
    const form = dialog.querySelector('.assistant-form');
    const thread = dialog.querySelector('.assistant-thread');
    const draw = () => { thread.innerHTML = content(); thread.scrollTop = thread.scrollHeight; };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const field = form.elements.request;
      const text = field.value.trim();
      if (!text) return;
      field.value = '';
      add('user', text);
      const result = interpretAppointment(text, draft);
      draft = result.draft;
      if (result.status !== 'ready') {
        add('assistant', prompts[result.status]);
        draw();
        return;
      }
      const epoch = ctx.epoch();
      const submit = form.querySelector('button');
      busy = true;
      submit.disabled = true;
      draw();
      try {
        const status = currentAccounts() ?? (await connection('status').catch(() => ({}))).accounts ?? {};
        const from = shiftDate(draft.date, -1);
        const through = shiftDate(draft.date, 1);
        const activeProviders = Object.keys(providers).filter(provider => status[provider]?.connected);
        const [originals, external] = await Promise.all([records(), Promise.allSettled(activeProviders.map(provider =>
          connection('calendar', { provider, from, through })))]);
        if (epoch !== ctx.epoch()) return;
        const events = external.flatMap(result => result.status === 'fulfilled' ? expandEvents(result.value.events, from, through) : []);
        const externalUnavailable = external.some(result => result.status === 'rejected');
        const known = displayedAgenda(originals, events);
        const found = duplicateAppointment(known, draft);
        if (found) {
          add('assistant', '«' + draft.title + '» steht am ' + showDate(draft.date) + ' um ' + draft.time + ' bereits im Kalender.', found.row?.id);
        } else {
          const hash = await sha256(new Blob([JSON.stringify([draft.date, draft.time, draft.title.normalize('NFKC').toLocaleLowerCase('de-CH')])]));
          if (epoch !== ctx.epoch()) return;
          let saved = await saveIntakeRecord({ ...draft, kind: 'Termin', status: 'Offen', intakeKey: 'chat:' + hash, intakeSource: 'Terminassistent' });
          if (epoch !== ctx.epoch()) return;
          if (saved.archived_at) saved = await archive(saved, false);
          if (epoch !== ctx.epoch()) return;
          ctx.addRecord(saved);
          const spacing = displayedAgenda([saved, ...originals.filter(row => row.id !== saved.id)], events).find(row => row.row?.id === saved.id)?.spacing;
          let reply = 'Eingetragen. ' + nameOf(saved) + ' am ' + showDate(draft.date) + ' um ' + draft.time + ' Uhr.';
          if (spacing === 'Knapp') reply += ' Ein anderer Termin liegt knapp daneben.';
          if (spacing === 'Überschneidung') reply += ' Der Termin überschneidet sich mit einem anderen Eintrag.';
          if (externalUnavailable) reply += ' Ein externer Kalender war für den Abgleich gerade nicht erreichbar.';
          add('assistant', reply, saved.id);
        }
        draft = null;
      } catch (error) {
        if (epoch === ctx.epoch()) {
          add('assistant', 'Der Termin konnte nicht gespeichert werden. ' + message(error));
          draft = null;
          if (form.isConnected) field.value = text;
        }
      } finally {
        if (epoch === ctx.epoch()) {
          busy = false;
          if (form.isConnected) { submit.disabled = false; draw(); field.focus(); }
          else if (dialog.querySelector('.assistant-thread')) open();
        }
      }
    });
    thread.scrollTop = thread.scrollHeight;
  }
  return { open, reset };
}
