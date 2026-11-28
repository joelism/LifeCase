import { detectAppointments } from './appointment-intake.js';
import { incomingMailPage, messageDetail } from './providers.js';

const hour = 3600000;
const swissDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', dateStyle: 'short' });
const pageSize = 24;
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

function finish(result) {
  if (result.error) throw new Error('LifeCase mail database is not available');
  return result.data;
}

export async function pollRules(service, loadLink, owner = '') {
  const base = service.from('lifecase_mail_rules').select('user_id,enabled_at').eq('enabled', true).order('user_id');
  const rules = finish(await (owner ? base.eq('user_id', owner) : base.limit(30)));
  let checked = 0;
  let saved = 0;
  let suggested = 0;
  let failed = 0;
  for (const rule of rules) {
    const results = await Promise.all(['microsoft', 'google'].map(provider => pollProvider(service, loadLink, rule, provider)));
    for (const result of results) {
      if (!result) continue;
      checked += result.checked;
      saved += result.saved;
      suggested += result.suggested;
      if (result.status !== 'ok') failed++;
    }
  }
  return { checked, saved, suggested, failed, enabled: rules.length > 0 };
}

// Freeze both ends of a scan. Messages arriving while a backlog is being processed
// belong to the next window. Keep the provider cursor until its whole page is handled.
export function mailWindow(last, account, enabledAt, now) {
  const cp=last?.checkpoint;
  const same=cp?.account===account && cp.enabledAt===enabledAt;
  if (same && cp.through && cp.from && !cp.complete) return {...cp};
  const previous=same && cp.complete ? Date.parse(cp.through) : !cp && last?.status==='ok' ? Date.parse(last.checked_at) : 0;
  const lower=Math.max(Date.parse(enabledAt), previous ? previous-2*hour : now-168*hour);
  return {account,enabledAt,from:new Date(lower).toISOString(), through:new Date(Math.max(now,lower)).toISOString(),cursor:'',complete:false};
}

export async function visitMailWindow(window, list, consume, now = Date.now) {
  const started=now();
  for (let page=0; page<4 && now()-started<40000; page++) {
    let result;
    try { result=await list(window); }
    catch (e) {
      if (window.cursor && e.status===410) { window.cursor=''; return 'partial'; }
      throw e;
    }
    if (!await consume(result.rows)) return 'partial';
    if (!result.next) { window.complete=true; window.cursor=''; return 'ok'; }
    if (result.next===window.cursor) throw new Error('Repeated mailbox cursor');
    window.cursor=result.next;
  }
  return 'partial';
}

async function pollProvider(service, loadLink, rule, provider) {
  const user = rule.user_id;
  const summary = { user_id:user, provider, checked_at:new Date().toISOString(), status:'ok', checked:0, saved:0, suggested:0 };
  const connected = finish(await service.rpc('lifecase_connection_vault', {p_action:'status',p_owner:user,p_provider:provider}));
  if (!connected?.connected) return null;
  const table=()=>service.from('lifecase_mail_runs');
  const last=finish(await table().select('checked_at,status,checkpoint').eq('user_id',user).eq('provider',provider).maybeSingle());
  // On a temporary refresh failure, retain the last successful scan boundary.
  try {
    const link=await loadLink(user,provider);
    const window=mailWindow(last, await sha(link.account), rule.enabled_at, Date.parse(summary.checked_at));
    summary.checkpoint=window;
    summary.status=await visitMailWindow(window,
      w=>incomingMailPage(provider,link.tokens.access,new Date(w.from),new Date(w.through),pageSize,w.cursor),
      async items=>{
        if (!items.length) return true;
        const rows=await Promise.all(items.map(async item=>({...item,fingerprint:await sha([provider,link.account,item.id].join('\u0000'))})));
        const seen=finish(await service.from('lifecase_mail_seen').select('fingerprint').eq('user_id',user)
          .eq('provider',provider).in('fingerprint',rows.map(r=>r.fingerprint)));
        const done=new Set(seen.map(r=>r.fingerprint));
        const pending=rows.filter(r=>!done.has(r.fingerprint));
        let complete=true;
        for (let offset=0;offset<pending.length;offset+=4) {
          const outcomes=await Promise.allSettled(pending.slice(offset,offset+4).map(async({id,fingerprint})=>{
            let mail;
            try { mail=await messageDetail(provider,link.tokens.access,id,false); }
            catch(error) { if (error.status===404) return; throw error; }
            const received=new Date(mail.date);
            if (received < new Date(window.from) || received >= new Date(window.through)) return;
            const candidates=detectAppointments({subject:mail.subject,body:mail.text,reference:received});
            const relevant=candidates.filter(c=>c.date>=swissDay.format(new Date()));
            const result=finish(await service.rpc('lifecase_store_mail_intake',{p_owner:user,p_provider:provider,p_fingerprint:fingerprint,p_candidates:relevant}));
            summary.checked++; summary.saved+=result.saved; summary.suggested+=result.suggested;
          }));
          if (outcomes.some(r=>r.status==='rejected')) complete=false;
        }
        return complete;
      });
  } catch { summary.status='failed'; }
  // A simultaneous manual check may have advanced this window. Never roll it back.
  if (last) finish(await table().update(summary).eq('user_id',user).eq('provider',provider).eq('checked_at',last.checked_at));
  else finish(await table().upsert(summary,{onConflict:'user_id,provider',ignoreDuplicates:true}));
  return summary;
}
