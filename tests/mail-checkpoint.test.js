import test from 'node:test';
import assert from 'node:assert/strict';
import { mailWindow,visitMailWindow } from '../supabase/functions/lifecase-connect/mail-poll.js';
import { incomingMailPage,exchange } from '../supabase/functions/lifecase-connect/providers.js';

const start='2026-11-26T20:00:00.000Z';
const now=Date.parse('2026-11-27T07:00:00Z');
const fresh=()=>mailWindow(null,'account',start,now);

test('a 230-message backlog progresses across four daily checks, even after the first 60 have been seen',async()=>{
  const all=Array.from({length:230},(_,i)=>i+1);
  const read=new Set();
  let last=null,run=0;
  do {
    const cp=mailWindow(last,'account',start,now+run*4*3600000);
    assert.equal(cp.through,new Date(now).toISOString());
    const status=await visitMailWindow(cp,async({cursor})=>{
      const offset=Number(cursor || 0);const rows=all.slice(offset,offset+24);
      return {rows,next:offset+24<all.length?String(offset+24):''};
    },async rows=>{for (const id of rows) {assert.ok(!read.has(id));read.add(id);}return true;});
    last={checkpoint:cp,status,checked_at:new Date(now).toISOString()};run++;
    assert.ok(run<5);
  } while (!last.checkpoint.complete);
  assert.equal(read.size,230);assert.equal(run,3);
  const next=mailWindow(last,'account',start,now+24*3600000);
  assert.equal(Date.parse(next.from),now-2*3600000);
  assert.equal(mailWindow(last,'other',start,now+24*3600000).from,start);
});

test('a partial page is retried, and stale tokens restart the same frozen date window',async()=>{
  const cp=fresh();cp.cursor='later';
  assert.equal(await visitMailWindow(cp,async()=>({rows:[1],next:'next'}),async()=>false),'partial');
  assert.equal(cp.cursor,'later');
  assert.equal(await visitMailWindow(cp,async()=>{throw Object.assign(new Error(),{status:410});},()=>{}),'partial');
  assert.equal(cp.cursor,'');assert.equal(cp.complete,false);assert.equal(cp.through,new Date(now).toISOString());
  const later=mailWindow({checkpoint:cp},'account','2026-11-28T09:00:00Z',now+86400000*2);
  assert.equal(later.from,'2026-11-28T09:00:00.000Z');
});

test('mail providers use their returned continuation, including opaque Graph skip tokens',async t=>{
  let called='';
  const next='https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?%24skiptoken=opaque%2Bnext';
  t.mock.method(globalThis,'fetch',async url=>{called=String(url);return Response.json(called.includes('gmail')?
    {messages:[{id:'item'}],nextPageToken:'new-token'}:{value:[{id:'item'}],'@odata.nextLink':next});});
  const from=new Date(start),to=new Date(now);
  const google=await incomingMailPage('google','synthetic',from,to,24,'opaque');
  assert.equal(google.next,'new-token');assert.equal(new URL(called).searchParams.get('pageToken'),'opaque');
  assert.match(new URL(called).searchParams.get('q'),/before:/);
  const ms=await incomingMailPage('microsoft','synthetic',from,to,24);
  assert.match(new URL(called).searchParams.get('$filter'),/ and receivedDateTime lt /);
  await incomingMailPage('microsoft','synthetic',from,to,24,ms.next);assert.equal(called,next);
});

test('a temporary refresh outage keeps the existing account recoverable',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  await assert.rejects(exchange('microsoft',{}, {grant_type:'refresh_token'},'synthetic',true,true),e=>e.status===503);
});
