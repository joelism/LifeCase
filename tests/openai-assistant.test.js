import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChronicleFields, dossierEntries, findAssistantDossier } from '../src/assistant-dossiers.js';
import { askAssistant, assistantIntent } from '../supabase/functions/lifecase-connect/assistant.js';

const now = new Date('2026-11-27T18:00:00Z');
const blank = { action: 'answer', reply: '', title: '', date: '', time: '', endTime: '', endDate: '', location: '', taskKind: '', duration: 0, caseQuery: '', sourceQuote: '', knowledge: '' };
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
      assert.equal(request.redirect, 'error');
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
  assert.throws(() => assistantIntent({ ...response, sourceQuote:'Eine erfundene Bestätigung.' },
    now, [{ role:'user', content:original }]), { status:422 });
  assert.throws(() => assistantIntent({ ...response, date:'2026-12-07' },
    now, [{ role:'user', content:original }]), { status:422 });
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
