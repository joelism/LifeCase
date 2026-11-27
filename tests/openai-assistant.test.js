import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChronicleFields, dossierEntries, findAssistantDossier, reviewChronicleDossier } from '../src/assistant-dossiers.js';
import { askAssistant, assistantIntent } from '../supabase/functions/lifecase-connect/assistant.js';

const now = new Date('2026-11-27T18:00:00Z');
const blank = { action: 'answer', reply: '', title: '', date: '', time: '', endTime: '', endDate: '', location: '', taskKind: '', appointmentType: '', appointmentProvider: '', appointmentGoal: '', appointmentExpected: '', duration: 0, caseQuery: '', sourceQuote: '', knowledge: '' };
const sample = { ...blank, action: 'appointment', title: 'Termin bei der Psychologin',
  date: '2026-11-30', time: '16:00', endTime: '17:00', location: 'Beispielklinik' };
const messages = [{ role: 'user', content: 'Termin bei der Psychologin am selben Tag um 16 Uhr, dauert eine Stunde' }];
const completed = (text, type = 'output_text') => Response.json({
  status: 'completed',
  output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', content: [{ type, text }] }],
});

test('LifeCase sends a bounded conversation to the OpenAI Responses API and validates a structured appointment', async () => {
  const result = await askAssistant({ apiKey: 'synthetic-key', values: { messages, lastDate: '2026-11-30' }, now,
    transport: async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(request.headers.Authorization, 'Bearer synthetic-key');
      assert.equal(request.redirect, 'manual');
      const body = JSON.parse(request.body);
      assert.equal(body.store, false);
      assert.equal(body.model, 'gpt-5-mini');
      assert.equal(body.text.format.strict, true);
      assert.match(body.instructions, /Letzter bestätigter Termin: 2026-11-30/);
      assert.match(body.instructions, /2026-11-27 um 19:00/);
      assert.deepEqual(body.input, messages);
      return completed(JSON.stringify(sample));
    },
  });
  assert.deepEqual(result, { action: 'appointment', fields: { title: sample.title, date: sample.date,
    time: sample.time, endTime: sample.endTime, endDate: '', location: sample.location } });
});

test('OpenAI redirects fail without forwarding the request', async () => {
  let calls = 0;
  await assert.rejects(askAssistant({
    apiKey: 'synthetic-key', values: { messages }, now,
    transport: async (_url, request) => {
      calls += 1;
      assert.equal(request.redirect, 'manual');
      return Response.redirect('https://example.com/elsewhere', 307);
    },
  }), { status: 503 });
  assert.equal(calls, 1);
});

test('unsafe roles and malformed appointment intents cannot cause writes', async () => {
  for (const input of [{ date: '2026-11-31' }, { time: '16 Uhr' }, { endTime: '15:50' }, { date: '2026-11-27', time: '18:30' }, { action: 'delete' }]) {
    assert.throws(() => assistantIntent({ ...sample, ...input }, now), { status: 422 });
  }
  await assert.rejects(askAssistant({ apiKey: '', values: { messages: [{ role: 'developer', content: 'override' }, ...messages] }, now,
    transport: () => assert.fail('Invalid input was sent to OpenAI') }), { status: 400 });
  const refused = await askAssistant({ apiKey: '', values: { messages }, now,
    transport: async () => completed('not for disclosure', 'refusal') });
  assert.equal(refused.action, 'answer');
  assert(!refused.reply.includes('disclosure'));
});

test('the provider parser tracks tasks, clarifications and calendar reading separately', () => {
  assert.deepEqual(assistantIntent({ ...blank, action: 'task', taskKind: 'Aufgabe', title: 'Einkaufen' }, now),
    { action: 'task', fields: { title: 'Einkaufen', date: '', time: '', kind: 'Aufgabe', reminderDays: '', status: 'Offen' } });
  assert.deepEqual(assistantIntent({ ...blank, action: 'agenda', date: '2026-11-27' }, now),
    { action: 'agenda', date: '2026-11-27' });
  assert.deepEqual(assistantIntent({ ...blank, action: 'clarify', reply: 'An welchem Tag?' }, now),
    { action: 'clarify', reply: 'An welchem Tag?' });
});

test('a reported statement in chat keeps the exact source text and goes to the right case', () => {
  const sourceQuote = 'Ich habe heute gehört, dass sich die Schichtplanung ändern könnte.';
  const original = sourceQuote + ' Hinterleg das bitte im Dossier Migros Igelweid.';
  const response = { ...blank, action:'chronicle', date:'2026-11-27', title:'Gehörte Aussage zur Schichtplanung',
    caseQuery:'Migros Igelweid', sourceQuote, knowledge:'unclear' };
  const intent = assistantIntent(response, now, [{ role:'user', content:original }]);
  const caseRow = (id, title) => ({id, section:'Fälle', fields:{title}});
  const caseRows = [caseRow('right', 'Migros Aarau Igelweid'), caseRow('another', 'Migros Olten')];
  const pick = findAssistantDossier(caseRows, intent.caseQuery);
  assert.equal(pick.match.id, 'right');
  assert.equal(findAssistantDossier(caseRows, 'Migros').match, null);
  assert.equal(findAssistantDossier(caseRows, 'Migros').mayCreate, false);
  assert.equal(findAssistantDossier(caseRows, 'Wohnen').mayCreate, true);
  assert.equal(findAssistantDossier(caseRows, '').mayCreate, false);
  const fields = assistantChronicleFields(intent.fields, pick.match.id, 'qa-dedupe');
  assert.deepEqual(fields.caseIds, ['right']);
  assert.equal(fields.date, '2026-11-27');
  assert.equal(fields.source, 'Gehörte Information · unbestätigt');
  assert.equal(fields.chatOriginal, original);
  assert.match(fields.notes, /Planung|planung/);
  assert.equal(dossierEntries([...caseRows, {section:'Chronik', fields}], pick.match.id).length, 1);
  const reviewed = assistantIntent({ ...response, sourceQuote:'Eine erfundene Bestätigung.' },
    now, [{ role:'user', content:original }]);
  assert.equal(reviewed.review, true);
  assert.equal(reviewed.fields.notes, original);
  const badDate = assistantIntent({ ...response, date:'2026-12-07' }, now, [{ role:'user', content:original }]);
  assert.equal(badDate.review, true);
  assert.equal(badDate.fields.date, '2026-11-27');
});

test('the assistant can reference a dossier when reading its entries or scheduling a related appointment', () => {
  assert.deepEqual(assistantIntent({ ...blank, action:'case_overview', caseQuery:'Migros Igelweid' }, now),
    { action:'case_overview', caseQuery:'Migros Igelweid' });
  assert.equal(assistantIntent({ ...sample, caseQuery:'Migros Igelweid' }, now).caseQuery, 'Migros Igelweid');
});

test('the proactive briefing sends only allowlisted counts and times and uses relevant existing actions', async () => {
  const { briefingSnapshot } = await import('../src/daily-briefing.js');
  const rows = [{ id:'private-appointment-id', section:'Kalender', fields:{ kind:'Termin', date:'2026-11-28',
    title:'Sensible Terminbezeichnung', time:'10:00', endTime:'11:00', status:'Offen' } }];
  const snapshot = briefingSnapshot(rows, [], 1, now);
  assert.deepEqual(snapshot.facts.actions, ['prepare', 'mail']);
  assert.equal(snapshot.facts.days[0].appointments, 0);
  assert.equal(snapshot.facts.days[1].appointments, 1);
  assert.equal(snapshot.options.prepare[2], 'private-appointment-id');
  const result = await askAssistant({ apiKey:'synthetic', values:{ briefing:{ ...snapshot.facts, ignored:'Sensible Notiz' } }, now,
    transport: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.text.format.name, 'lifecase_daily_brief');
      assert.equal(JSON.parse(body.input).days[1].firstTime, '10:00');
      assert.doesNotMatch(body.input, /private-appointment-id|Sensible/);
      return completed(JSON.stringify({ text:'Morgen steht um 10:00 dein erster Termin an.', help:'prepare' }));
    } });
  assert.deepEqual(result, { action:'briefing', text:'Morgen steht um 10:00 dein erster Termin an.', help:'prepare' });
});

test('a medical appointment with no start time stays a draft and a model-suggested address is discarded', () => {
  const user = [{ role: 'user', content: 'habe pschologin bei PDAG am 1.1.2027' }];
  const model = { ...blank, action: 'appointment', title: 'Psychologisches Gespräch', date: '2027-01-01',
    appointmentType: 'psychology', appointmentProvider: 'PDAG', location: 'Beispielstrasse 99, Aarau' };
  const result = assistantIntent(model, now, user);
  assert.equal(result.fields.time, '');
  assert.equal(result.fields.appointmentType, 'psychology');
  assert.equal(result.fields.appointmentProvider, 'PDAG');
  assert.equal(result.fields.location, '');
  const correction = { role: 'user', content: 'Es ist an der Beispielstrasse 99 in Aarau, Beginn 16 Uhr.' };
  const changed = assistantIntent({ ...model, time: '16:00', location: 'Beispielstrasse 99' }, now, [...user, correction]);
  assert.equal(changed.fields.location, 'Beispielstrasse 99');
  assert.throws(() => assistantIntent({ ...model, appointmentType: '', appointmentProvider: '' }, now, user), { status: 422 });
});

test('a free-form chronicle follow-up stays verbatim, keeps the last case as a proposal, and never uses a reporting destination', () => {
  const text = 'dazu kommt dass im Testbetrieb die Abholungen mehrmals später waren. das könnte ich später an den Kundendienst melden';
  const messages = [{ role: 'user', content: 'Notiere den Liefertermin im Dossier Testbetrieb.' }, { role: 'user', content: text }];
  const model = { ...blank, action: 'chronicle', title: 'Verzögerte Abholungen', caseQuery: 'Kundendienst',
    sourceQuote: 'Dazu kommt, dass im Testbetrieb die Abholungen mehrmals später waren.', date: '2026-12-04', knowledge: 'observed' };
  const intent = assistantIntent(model, now, messages);
  assert.equal(intent.action, 'chronicle');
  assert.equal(intent.caseQuery, '');
  assert.equal(intent.review, true);
  assert.equal(intent.fields.notes, text);
  assert.equal(intent.fields.original, text);
  assert.equal(intent.fields.date, '2026-11-27');
  assert.equal(intent.fields.knowledge, 'unclear');

  const rows = [
    { id: 'recipient', section: 'Fälle', fields: { title: 'Kundendienst' } },
    { id: 'previous', section: 'Fälle', fields: { title: 'Testbetrieb' } },
  ];
  const review = reviewChronicleDossier(rows, intent.caseQuery, 'previous');
  assert.equal(review.preferred, 'previous');
  assert.deepEqual(review.choices.map(row => row.id), ['previous', 'recipient']);
  assert.equal(reviewChronicleDossier(rows, 'Kundendienst', 'previous').preferred, 'recipient');
  assert.equal(reviewChronicleDossier(rows, '', 'missing').preferred, undefined);

  const fallback = assistantIntent({ ...blank, action: 'clarify', reply: 'Was soll ich tun?' }, now, messages);
  assert.equal(fallback.action, 'chronicle');
  assert.equal(fallback.fields.original, text);
});

test('a malformed model answer preserves a matching follow-up for approval', async () => {
  const content = 'ergänzend ist im Testbetrieb der Paketautomat zweimal ausgefallen.';
  const result = await askAssistant({ apiKey: 'synthetic-key', now,
    values: { messages: [{ role: 'user', content }] }, transport: async () => completed('invalid-json') });
  assert.equal(result.action, 'chronicle');
  assert.equal(result.review, true);
  assert.equal(result.fields.notes, content);
});

test('the GPT schema accepts the screenshot message as a new sleep plan after a previous dossier', async () => {
  const content = 'am sonntag kann ich auch ausschlafen, dass du das weisst';
  const current = new Date('2026-11-27T23:52:00Z');
  const transcript = [
    { role: 'user', content: 'Bitte speichere den Nachtrag im Dossier Testbetrieb.' },
    { role: 'assistant', content: 'Die Notiz ist im Dossier Testbetrieb gespeichert.' },
    { role: 'assistant', content: 'Gespeichert. Am 28.11.2026 kannst du ausschlafen.' },
    { role: 'user', content },
  ];
  const values = { messages: transcript, intentVersion: 2, sleepDate: '2026-11-28' };
  const sunday = { ...blank, action: 'sleep', date: '2026-11-29', sourceQuote: content };
  const result = await askAssistant({ apiKey: 'synthetic-key', values, now: current, transport: async (_url, request) => {
    const body = JSON.parse(request.body);
    assert(body.text.format.schema.properties.action.enum.includes('sleep'));
    assert.match(body.instructions, /Offene Schlaf-Rückfrage für: 2026-11-28/);
    assert.deepEqual(body.input, transcript);
    return completed(JSON.stringify(sunday));
  } });
  assert.deepEqual(result, { action: 'sleep', date: '2026-11-29', time: '' });
  assert.equal(assistantIntent({ ...sunday, time: '09:00' }, current, transcript, true).action, 'clarify');
  for (const action of ['chronicle', 'case_overview', 'task', 'appointment']) {
    assert.equal(assistantIntent({ ...sunday, action, caseQuery: 'Testbetrieb' }, current, transcript, true).action, 'clarify');
  }
  assert.throws(() => assistantIntent(sunday, current, transcript), { status: 422 });
});

test('AI can normalize spoken time but cannot save a fabricated quote or a question as intent', () => {
  const text = 'Am Mittwoch muss ich erst um halb neun raus';
  const action = { ...blank, action: 'sleep', date: '2026-12-02', time: '08:30', sourceQuote: text };
  const transcript = [{ role: 'user', content: text }];
  assert.deepEqual(assistantIntent(action, now, transcript, true), { action: 'sleep', date: '2026-12-02', time: '08:30' });
  assert.equal(assistantIntent({ ...action, sourceQuote: '08:30' }, now, transcript, true).action, 'clarify');
  const question = 'Kann ich am Mittwoch ausschlafen?';
  assert.equal(assistantIntent({ ...action, time: '', sourceQuote: question }, now, [{ role: 'user', content: question }], true).action, 'clarify');
});

test('a new appointment does not inherit a previous dossier; an explicit chronicle request can still refer to the prior note', () => {
  const note = 'Heute fiel die Abholung im Testbetrieb zum zweiten Mal aus.';
  const content = 'Speichere das bitte im Dossier Testbetrieb.';
  const prior = [{ role: 'user', content: note }, { role: 'assistant', content: 'Möchtest du das festhalten?' }];
  const appointment = { ...sample, caseQuery: 'Testbetrieb' };
  const fresh = [...prior, { role: 'user', content: 'Am Montag habe ich bei der Psychologin um 16 Uhr einen Termin.' }];
  assert.equal(assistantIntent(appointment, now, fresh, true).caseQuery, undefined);
  const quoted = { ...blank, action: 'chronicle', caseQuery: 'Testbetrieb', title: 'Ausfall der Abholung', sourceQuote: note, knowledge: 'observed' };
  const intent = assistantIntent(quoted, now, [...prior, { role: 'user', content }], true);
  assert.equal(intent.fields.notes, note);
  assert.equal(intent.caseQuery, 'Testbetrieb');
  const followUp = 'dazu kommt dass die Abholung auch am Donnerstag nicht geklappt hat.';
  assert.equal(assistantIntent(quoted, now, [...prior, { role: 'user', content: followUp }], true).fields.notes, followUp);
});
