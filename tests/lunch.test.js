import test from 'node:test';
import assert from 'node:assert/strict';
import { findLunchSlot, lunchRequest, lunchSlotIsFree } from '../src/lunch.js';
import { displayedAgenda, expandEvents } from '../src/connected-model.js';
import { authorizationUrl, createLunchBlock } from '../supabase/functions/lifecase-connect/providers.js';

const date = '2026-11-28';
const now = new Date('2026-11-27T17:00:00Z');
const item = (id, time, endTime, kind = 'Termin') => ({
  id, section: 'Kalender', fields: { title: kind, date, time, endTime, kind, status: 'Offen' },
});

test('a free 45-minute lunch is found between meetings and rechecked before writing', () => {
  const rows = [item('a','12:00','12:30'),item('b','13:15','14:00'),item('c','14:00','15:00'),item('d','15:00','16:00')];
  const known = displayedAgenda(rows);
  const proposal = findLunchSlot(known,date,{now});
  assert.deepEqual(proposal,{date,time:'12:30',endTime:'13:15',duration:45,following:3});
  assert.equal(lunchSlotIsFree(known,proposal,now),true);
  assert.equal(lunchSlotIsFree(displayedAgenda([...rows,item('late','12:45','13:00')]),proposal,now),false);
  assert.equal(findLunchSlot(displayedAgenda([...rows,item('block','12:30','13:15','Pause')]),date,{now}),null);
});

test('shift bounds, transparent events and busy events crossing midnight are respected', () => {
  const events = expandEvents([
    { id:'cross',provider:'google',date:'2026-11-27',time:'23:30',endTime:'12:20',endDate:date,timeEndDate:date,busy:true },
    { id:'free',provider:'google',date,time:'12:30',endTime:'13:30',endDate:date,timeEndDate:date,busy:false },
  ], '2026-11-27', date);
  const known = displayedAgenda([item('shift','12:10','13:50','Schicht')],events);
  assert.deepEqual(findLunchSlot(known,date,{ now, duration: 30 }),{date,time:'12:20',endTime:'12:50',duration:30,following:0});
  assert.equal(findLunchSlot(known,date,{now,after:'13:35'}),null);
  assert.equal(findLunchSlot(known,date,{now:new Date('2026-11-28T13:01:00Z')}),null);
});

test('the chat understands lunch dates and requested duration', () => {
  assert.deepEqual(lunchRequest('Plane morgen 30 Minuten Mittagspause',now), { date, duration:30 });
  assert.deepEqual(lunchRequest('Find mir am 30.11.2026 eine Mittagspause',now),{date:'2026-11-30',duration:45});
  assert.equal(lunchRequest('Arzttermin morgen um 15:30',now),null);
});

test('external calendar permission is explicit and creates a private busy block', async t => {
  const oauth = provider => new URL(authorizationUrl(provider,{client_id:'qa'},'https://example.invalid/callback','digest','challenge',true));
  assert.match(oauth('google').searchParams.get('scope'), /calendar\.events\.owned/);
  assert.match(oauth('microsoft').searchParams.get('scope'), /Calendars\.ReadWrite/);
  const fetch = t.mock.method(global,'fetch',async () => new Response('{}',{status:201}));
  for (const provider of ['google','microsoft']) {
    assert.deepEqual(await createLunchBlock(provider,'qa',date,'12:30','13:15','abcdef'.repeat(10) + 'abcd'),{saved:true});
  }
  const calls = fetch.mock.calls;
  const google = JSON.parse(calls[0].arguments[1].body);
  const ms = JSON.parse(calls[1].arguments[1].body);
  assert.match(calls[0].arguments[0], /primary\/events/);
  assert.equal(google.transparency,'opaque');
  assert.equal(google.visibility,'private');
  assert.equal(ms.showAs,'busy');
  assert.equal(ms.sensitivity,'private');
  assert.equal(ms.attendees,undefined);
});
