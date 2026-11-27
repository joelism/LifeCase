import { assistantChronicleFields, dossierEntries, findAssistantDossier } from './assistant-dossiers.js';
import { archive, records, saveIntakeRecord, saveRecord, message, userError } from './backend.js';
import { connection } from './connections-api.js';
import { calendarRecordTitle, duplicateAppointment, interpretAppointment, interpretTask } from './calendar-assistant.js';
import { displayedAgenda, expandEvents, providers } from './connected-model.js';
import { openDialog } from './editor.js';
import { icon } from './icons.js';
import { findLunchSlot, lunchRequest, lunchSlotIsFree } from './lunch.js';
import { lunchLabel, shiftWorkdays } from './workday.js';
import { dateOf, nameOf, sectionOf, shiftDate, showDate, sha256, today, value } from './model.js';
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
  let lastDate = '';
  let pendingMessage = '';
  let aiAvailable = null;
  let aiHistory = [];
  let pendingCase = null;
  const add = (side, text, record = '', label = 'Eintrag ansehen') => { history = [...history.slice(-11), { side, text, record, label }]; };
  function reset() { history = []; draft = null; proposal = null; target = ''; busy = false; lastDate = ''; pendingMessage = ''; aiAvailable = null; aiHistory = []; pendingCase = null; }

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
    const result = await agendaFor(request.date);
    if (epoch !== ctx.epoch()) return;
    const scheduled = shiftWorkdays(result.entries.filter(item => item.date === request.date));
    if (scheduled.length) {
      proposal = null;
      add('assistant', 'Laut Arbeitsplan am ' + showDate(request.date) + ': ' + scheduled.map(item => lunchLabel(item.lunch)).join(', ') + '.');
      return;
    }
    if (result.incomplete) throw userError('Ein Kalender ist gerade nicht erreichbar. Versuche die Prüfung erneut.');
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
    if (shiftWorkdays(result.entries.filter(item => item.date === candidate.date)).length || !lunchSlotIsFree(result.entries, candidate)) {
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
    const result = interpretAppointment(text, draft, new Date(), lastDate);
    draft = result.draft;
    if (result.status !== 'ready') { add('assistant', prompts[result.status]); return; }
    await storeAppointment(result.draft, epoch);
  }
  async function storeAppointment(candidate, epoch, dossier = null) {
    const known = await agendaFor(candidate.date);
    if (epoch !== ctx.epoch()) return;
    const found = duplicateAppointment(known.entries, candidate);
    if (found) {
      const linked = dossier && found.row && Array.isArray(value(found.row, 'caseIds')) ? value(found.row, 'caseIds') : [];
      if (dossier && found.row && !linked.includes(dossier.id)) {
        const updated = await saveRecord('Kalender', { ...found.row.fields, caseIds: [...linked, dossier.id] }, found.row);
        if (epoch !== ctx.epoch()) return;
        ctx.addRecord(updated);
        add('assistant', '«' + candidate.title + '» ist mit «' + nameOf(dossier) + '» verknüpft.', updated.id);
      } else add('assistant', '«' + candidate.title + '» steht am ' + showDate(candidate.date) + ' um ' + candidate.time + ' bereits im Kalender.', found.row?.id);
      lastDate = candidate.date;
      draft = null;
      return;
    }
    const hash = await sha256(new Blob([JSON.stringify([candidate.date, candidate.time, candidate.title.normalize('NFKC').toLocaleLowerCase('de-CH')])]));
    if (epoch !== ctx.epoch()) return;
    let saved = await saveIntakeRecord({ ...candidate, chatVersion: 2, kind: 'Termin', status: 'Offen', intakeKey: 'chat:' + hash, intakeSource: 'Terminassistent' });
    if (epoch !== ctx.epoch()) return;
    if (saved.archived_at) saved = await archive(saved, false);
    if (epoch !== ctx.epoch()) return;
    ctx.addRecord(saved);
    const spacing = displayedAgenda([saved, ...known.originals.filter(row => row.id !== saved.id)], known.events).find(row => row.row?.id === saved.id)?.spacing;
    lastDate = candidate.date;
    const end = candidate.endTime ? '–' + (candidate.endDate ? showDate(candidate.endDate) + ' ' : '') + candidate.endTime : '';
    let reply = '«' + nameOf(saved) + '» eingetragen.\n' + showDate(candidate.date) + ' · ' + candidate.time + end + ' Uhr.';
    if (dossier) reply += '\nDossier «' + nameOf(dossier) + '».';
    if (spacing === 'Knapp') reply += ' Ein anderer Termin liegt knapp daneben.';
    if (spacing === 'Überschneidung') reply += ' Der Termin überschneidet sich mit einem anderen Eintrag.';
    if (known.incomplete) reply += ' Der Abgleich mit externen Kalendern war gerade nicht vollständig.';
    add('assistant', reply, saved.id);
    draft = null;
  }
  async function addTask(result, epoch, dossier = null) {
    if (result.status !== 'ready') { add('assistant', prompts[result.status]); return; }
    const fields = result.fields;
    const hash = await sha256(new Blob([JSON.stringify([fields.kind, fields.date, fields.time, fields.title.toLocaleLowerCase('de-CH'), ...(dossier ? [dossier.id] : [])])]));
    if (epoch !== ctx.epoch()) return;
    let saved = await saveIntakeRecord({ ...fields, intakeKey: 'task-chat:' + hash, intakeSource: 'Terminassistent' });
    if (epoch !== ctx.epoch()) return;
    if (saved.archived_at) saved = await archive(saved, false);
    if (epoch !== ctx.epoch()) return;
    ctx.addRecord(saved);
    if (saved.fields.status === 'Erledigt') add('assistant', '«' + nameOf(saved) + '» ist bereits als erledigt markiert.', saved.id);
    else add('assistant', '«' + nameOf(saved) + '» steht ' + (fields.date ?
      'am ' + showDate(fields.date) + (fields.time ? ' um ' + fields.time + ' Uhr' : '') + ' in deiner Planung.' :
      'unter «Aufgaben ohne Datum» in «Meine Woche».') + (dossier ? '\nDossier «' + nameOf(dossier) + '».' : ''), saved.id);
    draft = null;
  }
  async function useOpenAI(text, epoch) {
    const messages = [...aiHistory, { role: 'user', content: text }].slice(-8);
    const result = await connection('assistant', { messages, lastDate });
    if (epoch !== ctx.epoch()) return;
    aiHistory = messages.slice(-7);
    if (result.action === 'chronicle' || result.action === 'case_overview' ||
        (result.caseQuery && ['appointment', 'task'].includes(result.action))) return resolveDossier(result, epoch);
    if (result.action === 'appointment') return storeAppointment(result.fields, epoch);
    if (result.action === 'task') return addTask({ status: 'ready', fields: result.fields }, epoch);
    if (result.action === 'lunch') return suggestLunch(result, epoch);
    if (result.action === 'agenda') return showAgenda(result.date, epoch);
    if (result.action !== 'answer' && result.action !== 'clarify') throw userError('Die Antwort von OpenAI war nicht vollständig.');
    aiHistory = [...aiHistory, { role: 'assistant', content: result.reply.slice(0, 600) }];
    add('assistant', result.reply);
  }
  async function resolveDossier(intent, epoch) {
    const latest = await records();
    if (epoch !== ctx.epoch()) return;
    const { match, choices, mayCreate } = findAssistantDossier(latest, intent.caseQuery);
    if (match) return useDossier(intent, match, epoch);
    pendingCase = { intent, choices: choices.slice(0, 8), mayCreate: mayCreate && intent.action !== 'case_overview' };
    add('assistant', choices.length ?
      'Welches Dossier meinst du?' :
      mayCreate && intent.action !== 'case_overview' ? 'Das Dossier wurde nicht gefunden. Du kannst es hier anlegen.' :
      'Ich finde hier kein passendes Dossier. Nenne mir den Dossiernamen.');
  }
  async function chooseDossier(id, epoch) {
    const selection = pendingCase;
    if (!selection) return;
    const latest = await records();
    if (epoch !== ctx.epoch()) return;
    const { intent, choices, mayCreate } = selection;
    const caseId = id === 'new' ? null : choices.find(row => row.id === id)?.id;
    let dossier = caseId ? latest.find(row => row.id === caseId && !row.archived_at && sectionOf(row) === 'Fälle') : null;
    if (id === 'new') {
      if (!mayCreate) return;
      const existing = findAssistantDossier(latest, intent.caseQuery);
      if (existing.match) dossier = existing.match;
      else if (existing.mayCreate) {
        dossier = await saveRecord('Fälle', { title: intent.caseQuery, status: 'Offen', category: 'Weitere' });
        if (epoch !== ctx.epoch()) return;
        ctx.addRecord(dossier);
      }
    }
    if (!dossier) throw userError('Dieses Dossier ist nicht mehr verfügbar.');
    await useDossier(intent, dossier, epoch);
  }
  async function useDossier(intent, dossier, epoch) {
    if (intent.action === 'case_overview') {
      const latest = await records();
      if (epoch !== ctx.epoch()) return;
      const entries = dossierEntries(latest, dossier.id);
      const recent = entries.slice(0, 6).map(row => [dateOf(row) && showDate(dateOf(row)), sectionOf(row), calendarRecordTitle(row)]
        .filter(Boolean).join(' · '));
      add('assistant', '«' + nameOf(dossier) + '» · ' + entries.length + (entries.length === 1 ? ' verknüpfter Eintrag' : ' verknüpfte Einträge') +
        (recent.length ? '\n' + recent.join('\n') : ''), dossier.id, 'Dossier öffnen');
    }
    if (intent.action === 'chronicle') {
      const key = await sha256(new Blob([JSON.stringify([dossier.id, intent.fields.date, intent.fields.original])]));
      if (epoch !== ctx.epoch()) return;
      const fields = assistantChronicleFields(intent.fields, dossier.id, key);
      const saved = await saveIntakeRecord(fields, 'Chronik');
      if (epoch !== ctx.epoch()) return;
      ctx.addRecord(saved);
      add('assistant', '«' + nameOf(saved) + '» ' + (saved.archived_at ? 'liegt im Archiv von' : 'steht in der Chronik von') +
        ' «' + nameOf(dossier) + '».\n' + showDate(fields.date) + ' · ' + fields.source, saved.id, 'Chronikeintrag öffnen');
    }
    if (intent.action === 'appointment') await storeAppointment({ ...intent.fields, caseIds: [dossier.id] }, epoch, dossier);
    if (intent.action === 'task') await addTask({ status: 'ready', fields: { ...intent.fields, caseIds: [dossier.id] } }, epoch, dossier);
    if (epoch === ctx.epoch()) pendingCase = null;
  }
  async function showAgenda(date, epoch) {
    const result = await agendaFor(date);
    if (epoch !== ctx.epoch()) return;
    const entries = result.entries.filter(item => item.date === date && item.state === 'Offen');
    const lines = entries.slice(0, 8).map(item => (item.time ? item.time + ' · ' : '') +
      (item.external?.title ?? calendarRecordTitle(item.row)));
    if (entries.length > lines.length) lines.push('Weitere Einträge findest du im Kalender.');
    if (result.incomplete) lines.push('Ein Teil der externen Kalender ist gerade nicht erreichbar.');
    add('assistant', showDate(date) + (entries.length ? '\n' + lines.join('\n') :
      ' · Keine Einträge gefunden.' + (lines.length ? '\n' + lines.join('\n') : '')));
  }
  function content() {
    const messages = history.length ? history.map(row => '<div class="assistant-bubble ' + row.side + '"><p>' + esc(row.text) + '</p>' +
      (row.record ? button(row.label,'open',row.record,row.label === 'Dossier öffnen' ? 'folder' : 'calendar') : '') + '</div>').join('') :
      '<div class="assistant-bubble assistant"><p>' + (aiAvailable ?
      'Wobei kann ich dir helfen? Ich kann etwas in einem Dossier festhalten, Termine und Aufgaben erfassen oder deine Planung nachschauen.' :
      'Erfasse einen Termin oder eine Aufgabe oder suche eine Mittagspause.') + '</p></div>';
    const controls = !proposal ? '' :
      '<div class="assistant-tools">' +
      (proposal.destinations.length ? '<label class="input-wrap">Blockieren in<select data-lunch-target>' +
        options([['', 'LifeCase'], ...proposal.destinations.map(key => [key, providers[key].calendar])], target) + '</select></label>' : '') +
      '<div class="actions">' + button('Ja, bitte','lunch-confirm','','check','primary') +
        button('Andere Zeit','lunch-other','','clock') + button('Nein','lunch-cancel') + '</div></div>';
    const status = aiAvailable === null ? 'OpenAI-Verbindung wird geprüft …' :
      aiAvailable ? 'OpenAI verarbeitet die Nachrichten, die du hier absendest.' : 'OpenAI ist für dieses Konto noch nicht aktiviert.';
    const caseControls = !busy && pendingCase ? '<div class="assistant-tools" aria-label="Dossier auswählen">' +
      pendingCase.choices.map(row => button(nameOf(row), 'assistant-case', row.id, 'folder')).join('') +
      (pendingCase.mayCreate ?
        button('Dossier «' + pendingCase.intent.caseQuery + '» anlegen', 'assistant-case', 'new', 'plus') : '') +
      button('Abbrechen', 'assistant-case', 'cancel') + '</div>' : '';
    return '<p class="hint assistant-running">' + status + '</p>' + messages + caseControls +
      (!busy ? controls : '<p class="hint assistant-running" role="status">Einen Moment …</p>');
  }
  function open(autoLunch = false) {
    const dialog = openDialog('LifeCase-Assistent', '<div class="assistant-thread" aria-live="polite">' + content() + '</div>' +
      '<form class="assistant-form"><button type="button" class="icon-btn" data-assistant-lunch-tool aria-label="Mittagspause finden">' + icon('sun', 20) + '</button>' +
      '<textarea name="request" aria-label="Deine Nachricht" maxlength="500" rows="2" placeholder="Was soll ich festhalten oder planen?" ' +
      'enterkeyhint="send" autocomplete="off" required>' + esc(pendingMessage) + '</textarea>' +
      '<button type="submit" class="button primary" aria-label="Nachricht senden">' +
      icon('arrow', 21) + '</button></form>');
    const form = dialog.querySelector('.assistant-form');
    const thread = dialog.querySelector('.assistant-thread');
    const field = form.elements.request;
    const submit = form.querySelector('[type=submit]');
    const scrollToEnd = () => { thread.scrollTop = thread.scrollHeight; };
    const draw = () => { thread.innerHTML = content(); scrollToEnd(); submit.disabled = busy || aiAvailable === null; };
    trackViewport(dialog, form, scrollToEnd);
    field.addEventListener('input', () => { pendingMessage = field.value; });
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!busy && aiAvailable !== null && field.value.trim()) form.requestSubmit();
    });
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
      if (control?.hasAttribute('data-assistant-case')) {
        const id = control.dataset.assistantCase;
        if (id === 'cancel') { pendingCase = null; add('assistant', 'Auswahl abgebrochen.'); draw(); }
        else run(epoch => chooseDossier(id, epoch));
        return;
      }
      if (control?.hasAttribute('data-lunch-confirm')) { add('user', 'Ja, bitte'); run(blockLunch); }
      if (control?.hasAttribute('data-lunch-cancel')) cancel();
      if (control?.hasAttribute('data-lunch-other')) run(alternative);
    });
    form.querySelector('[data-assistant-lunch-tool]').addEventListener('click', () => run(find));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy || aiAvailable === null) return;
      const text = field.value.trim();
      if (!text) return;
      field.value = '';
      pendingMessage = '';
      add('user', text);
      if (proposal && isYes(text)) return run(blockLunch);
      if (proposal && isNo(text)) return cancel();
      if (proposal && /^(?:andere zeit|später)[.! ]*$/i.test(text)) return run(alternative);
      proposal = null;
      if (aiAvailable) {
        if (pendingCase && isNo(text)) { pendingCase = null; add('assistant', 'Auswahl abgebrochen.'); draw(); return; }
        const picked = pendingCase && findAssistantDossier(pendingCase.choices, text).match;
        if (picked) return run(epoch => chooseDossier(picked.id, epoch));
        pendingCase = null;
        return run(epoch => useOpenAI(text, epoch));
      }
      const task = interpretTask(text);
      const request = lunchRequest(text);
      if (task) return run(epoch => addTask(task, epoch));
      if (request) { target = ''; return run(epoch => suggestLunch(request, epoch)); }
      run(epoch => addAppointment(text, epoch));
    });
    draw();
    if (aiAvailable === null) {
      const epoch = ctx.epoch();
      connection('assistant-status').then(result => { if (epoch === ctx.epoch()) aiAvailable = result.available === true; })
        .catch(() => { if (epoch === ctx.epoch()) aiAvailable = false; })
        .finally(() => { if (epoch === ctx.epoch() && form.isConnected) draw(); });
    }
    if (autoLunch && !proposal) run(find);
  }
  return { open, reset };
}

// Keep the composer above the iOS keyboard and the message list independently scrollable.
function trackViewport(dialog, form, scrollToEnd) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const events = new AbortController();
  function update() {
    if (!matchMedia('(max-width: 620px)').matches) return;
    const height = Math.max(0, Math.min(viewport.height - 16, 590));
    dialog.style.setProperty('--assistant-top', Math.max(0, viewport.offsetTop + viewport.height - height - 8) + 'px');
    dialog.style.setProperty('--assistant-height', height + 'px');
    requestAnimationFrame(scrollToEnd);
  }
  const observer = new MutationObserver(() => { if (!form.isConnected) cleanup(); });
  function cleanup() {
    events.abort();
    observer.disconnect();
    if (!dialog.querySelector('.assistant-form')) {
      dialog.style.removeProperty('--assistant-top');
      dialog.style.removeProperty('--assistant-height');
    }
  }
  observer.observe(dialog, { childList: true });
  viewport.addEventListener('resize', update, { signal: events.signal });
  viewport.addEventListener('scroll', update, { signal: events.signal });
  dialog.addEventListener('close', cleanup, { once: true, signal: events.signal });
  update();
}
