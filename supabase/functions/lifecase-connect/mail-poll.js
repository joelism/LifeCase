import { detectAppointments } from './appointment-intake.js';
import { listIncomingMail, messageDetail } from './providers.js';

const hour = 3600000;
const swissDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', dateStyle: 'short' });
const pageLimit = 60;
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

async function pollProvider(service, loadLink, rule, provider) {
  const user = rule.user_id;
  const summary = { user_id: user, provider, checked_at: new Date().toISOString(), status: 'ok', checked: 0, saved: 0, suggested: 0 };
  try {
    const connected = finish(await service.rpc('lifecase_connection_vault', { p_action: 'status', p_owner: user, p_provider: provider }));
    if (!connected?.connected) return null;
    const last = finish(await service.from('lifecase_mail_runs').select('checked_at,status').eq('user_id', user).eq('provider', provider).maybeSingle());
    const link = await loadLink(user, provider);
    const since = new Date(Math.max(Date.parse(rule.enabled_at), Date.now() - 168 * hour,
      last?.status === 'ok' ? Date.parse(last.checked_at) - 2 * hour : 0));
    const listed = await listIncomingMail(provider, link.tokens.access, since, pageLimit);
    const rows = await Promise.all(listed.map(async item => ({
      ...item, fingerprint: await sha([provider, link.account, item.id].join('\u0000')),
    })));
    if (rows.length) {
      const seen = finish(await service.from('lifecase_mail_seen').select('fingerprint').eq('user_id', user)
        .eq('provider', provider).in('fingerprint', rows.map(row => row.fingerprint)));
      const lookedAt = new Set(seen.map(row => row.fingerprint));
      const pending = rows.filter(row => !lookedAt.has(row.fingerprint));
      // Work oldest-first so another run can catch up even when mail arrives in bursts.
      pending.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (pending.length > 24 || listed.length === pageLimit) summary.status = 'partial';
      for (let offset = 0; offset < Math.min(pending.length, 24); offset += 4) {
        const results = await Promise.allSettled(pending.slice(offset, Math.min(offset + 4, 24)).map(async ({ id, fingerprint }) => {
          const mail = await messageDetail(provider, link.tokens.access, id, false);
          const received = new Date(mail.date);
          if (received < since) return { saved: 0, suggested: 0 };
          const candidates = detectAppointments({ subject: mail.subject, body: mail.text, reference: received });
          const now = new Date();
          const relevant = candidates.filter(candidate => candidate.date >= swissDay.format(now));
          return finish(await service.rpc('lifecase_store_mail_intake', {
            p_owner: user, p_provider: provider, p_fingerprint: fingerprint, p_candidates: relevant,
          }));
        }));
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            summary.checked++;
            summary.saved += result.value.saved;
            summary.suggested += result.value.suggested;
          } else summary.status = 'partial';
        });
      }
    }
  } catch {
    summary.status = 'failed';
  }
  finish(await service.from('lifecase_mail_runs').upsert(summary, { onConflict: 'user_id,provider' }));
  return summary;
}
