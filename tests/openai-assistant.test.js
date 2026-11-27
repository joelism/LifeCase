import test from 'node:test';
import assert from 'node:assert/strict';
import { askAssistant, assistantIntent } from '../supabase/functions/lifecase-connect/assistant.js';

const now = new Date('2026-11-27T18:00:00Z');
const blank = { action: 'answer', reply: '', title: '', date: '', time: '', endTime: '', endDate: '', location: '', taskKind: '', duration: 0 };
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
