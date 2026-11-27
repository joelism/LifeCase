import { pollRules } from './mail-poll.js';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { authorizationUrl, exchange, Failure, listCalendar, listMail, messageDetail, messageFile, profile, providers, revokeGoogle, swissDay } from './providers.js';

const project = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0];
const callback = project + '/functions/v1/lifecase-connect/callback';
const apps = new Map([
  ['https://joelism.github.io', 'https://joelism.github.io/LifeCase/'],
  ['https://lifecase-joel.skippingbookmark.chatgpt.site', 'https://lifecase-joel.skippingbookmark.chatgpt.site/'],
]);
const service = createClient(project, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const baseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

function unwrap(result) {
  if (result.error) throw new Failure(503, 'Die LifeCase-Verbindung ist derzeit nicht verfügbar.');
  return result.data;
}
function vault(action, user, provider, data = {}) {
  return service.rpc('lifecase_connection_vault', { p_action: action, p_owner: user, p_provider: provider, p_data: data }).then(unwrap);
}
const hash = async str => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nonce = () => base64(crypto.getRandomValues(new Uint8Array(32)));
const isConfigured = config => Boolean(config?.client_id?.trim() && config?.client_secret?.trim());
const jsonify = (value, status, headers) => new Response(JSON.stringify(value), {
  status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
});
function toApp(url, status) {
  if (![...apps.values()].includes(url)) return new Response('Ungültige Rücksprungadresse.', { status: 400, headers: baseHeaders });
  const target = new URL(url);
  target.searchParams.set('lcConnection', status);
  return new Response(null, { status: 303, headers: { ...baseHeaders, Location: target.href } });
}

async function authenticate(req) {
  const token = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token || token.length > 16000) throw new Failure(401, 'Melde dich in LifeCase an.');
  const result = await service.auth.getUser(token);
  const user = result.data.user;
  if (result.error || !user) throw new Failure(401, 'Melde dich erneut in LifeCase an.');
  let claims;
  try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw new Failure(401, 'Die Anmeldung konnte nicht geprüft werden.'); }
  if (claims.aal !== 'aal2' || claims.sub !== user.id) throw new Failure(403, 'Bestätige zuerst den zweiten Faktor in LifeCase.');
  return user.id;
}
async function status(user) {
  const entries = await Promise.all(Object.keys(providers).map(async provider => {
    const [config, link] = await Promise.all([vault('config', user, provider), vault('status', user, provider)]);
    return [provider, { available: isConfigured(config), ...link }];
  }));
  return { accounts: Object.fromEntries(entries), callback };
}
async function begin(user, provider, origin) {
  const cfg = await vault('config', user, provider);
  if (!isConfigured(cfg)) throw new Failure(409, 'Die Anbieterregistrierung für LifeCase fehlt.');
  const state = nonce();
  const verifier = nonce();
  unwrap(await service.from('lifecase_oauth_pending').upsert({
    user_id: user, provider, state_hash: hex(await hash(state)), verifier, app_url: apps.get(origin),
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
  }, { onConflict: 'user_id,provider' }));
  return { url: authorizationUrl(provider, cfg, callback, state, base64(await hash(verifier))) };
}
async function callbackRequest(url) {
  const state = url.searchParams.get('state') ?? '';
  if (!/^[\w-]{43}$/.test(state)) return new Response('Ungültige oder abgelaufene LifeCase-Freigabe.', { status: 400, headers: baseHeaders });
  const pending = unwrap(await service.from('lifecase_oauth_pending').delete().eq('state_hash', hex(await hash(state)))
    .gt('expires_at', new Date().toISOString()).select('user_id,provider,verifier,app_url').maybeSingle());
  if (!pending) return new Response('Die LifeCase-Freigabe ist abgelaufen oder wurde bereits verwendet.', { status: 400, headers: baseHeaders });
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096 || url.searchParams.has('error')) return toApp(pending.app_url, 'failed');
  const { user_id: user, provider, verifier, app_url } = pending;
  try {
    const cfg = await vault('config', user, provider);
    if (!isConfigured(cfg)) return toApp(app_url, 'failed');
    const tokens = await exchange(provider, cfg, { grant_type: 'authorization_code', redirect_uri: callback, code, code_verifier: verifier });
    const account = await profile(provider, tokens.access);
    await vault('write', user, provider, { ...account, tokens });
    return toApp(app_url, 'connected');
  } catch {
    return toApp(app_url, 'failed');
  }
}
async function activeLink(user, provider) {
  const link = await vault('read', user, provider);
  if (!link) throw new Failure(409, 'Verbinde das Konto zuerst in LifeCase.');
  if (link.tokens.expires > Date.now() + 70000) return link;
  const cfg = await vault('config', user, provider);
  if (!isConfigured(cfg)) throw new Failure(409, 'Die Anbieterregistrierung für LifeCase fehlt.');
  let tokens;
  try {
    tokens = await exchange(provider, cfg, { grant_type: 'refresh_token', refresh_token: link.tokens.refresh }, link.tokens.refresh);
  } catch (error) {
    const newer = await vault('read', user, provider);
    if (newer && newer.revision !== link.revision && newer.tokens.expires > Date.now()) return newer;
    throw error;
  }
  const saved = await vault('refresh', user, provider, { revision: link.revision, tokens });
  if (saved) return { ...link, tokens };
  const newer = await vault('read', user, provider);
  if (!newer) throw new Failure(409, 'Das Konto wurde getrennt.');
  if (newer.account !== link.account) throw new Failure(409, 'Das Konto wurde neu verbunden. Lade die Ansicht erneut.');
  return newer;
}
async function disconnect(user, provider) {
  const link = await vault('read', user, provider);
  await vault('remove', user, provider);
  if (provider === 'google' && link?.tokens.refresh) await revokeGoogle(link.tokens.refresh).catch(() => {});
  return { disconnected: true };
}
function arg(values, key, limit, required = false) {
  const value = values[key] ?? '';
  if (typeof value !== 'string' || value.length > limit || (required && !value) || /[\u0000-\u001f]/.test(value)) {
    throw new Failure(400, 'Die LifeCase-Anfrage enthält ungültige Angaben.');
  }
  return value;
}
function calendarDay(values, key) {
  const day = arg(values, key, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
    throw new Failure(400, 'Ungültiges Kalenderdatum.');
  }
  return day;
}

Deno.serve(async req => {
  const url = new URL(req.url);
  if (url.pathname.endsWith('/callback') && req.method === 'GET') {
    try { return await callbackRequest(url); }
    catch { return new Response('Die LifeCase-Freigabe konnte nicht abgeschlossen werden.', { status: 503, headers: baseHeaders }); }
  }
  if (url.pathname.endsWith('/poll-mail') && req.method === 'POST') {
    const proof = req.headers.get('x-lifecase-job') || '';
    if (!/^[0-9a-f]{64}$/.test(proof)) return jsonify({ problem: 'Zugriff verweigert.' }, 401, baseHeaders);
    try {
      const permitted = unwrap(await service.rpc('lifecase_mail_job_ok', { p_token: proof }));
      if (!permitted) return jsonify({ problem: 'Zugriff verweigert.' }, 401, baseHeaders);
      return jsonify(await pollRules(service, activeLink), 200, baseHeaders);
    } catch {
      return jsonify({ problem: 'Mailprüfung fehlgeschlagen.' }, 503, baseHeaders);
    }
  }
  const origin = req.headers.get('origin') || '';
  if (!apps.has(origin)) return jsonify({ problem: 'Diese LifeCase-Adresse ist nicht freigegeben.' }, 403, baseHeaders);
  const headers = { ...baseHeaders, 'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return jsonify({ problem: 'Ungültige Methode.' }, 405, headers);
  try {
    const user = await authenticate(req);
    const body = await req.text();
    if (body.length > 8192) throw new Failure(413, 'Die LifeCase-Anfrage ist zu gross.');
    let values;
    try { values = JSON.parse(body); } catch { throw new Failure(400, 'Ungültige LifeCase-Anfrage.'); }
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Failure(400, 'Ungültige LifeCase-Anfrage.');
    const { action, provider } = values;
    if (action === 'status') return jsonify(await status(user), 200, headers);
    if (action === 'check-mail') return jsonify(await pollRules(service, activeLink, user), 200, headers);
    if (typeof provider !== 'string' || !Object.hasOwn(providers, provider)) throw new Failure(400, 'Unbekannte Verbindung.');
    if (action === 'start') return jsonify(await begin(user, provider, origin), 200, headers);
    if (action === 'disconnect') return jsonify(await disconnect(user, provider), 200, headers);
    if (!['calendar', 'mail', 'detail', 'file'].includes(action)) throw new Failure(400, 'Unbekannte LifeCase-Aktion.');
    const link = await activeLink(user, provider);
    const access = link.tokens.access;
    if (action === 'calendar') {
      const from = calendarDay(values, 'from');
      const through = calendarDay(values, 'through');
      if (through < from || Date.parse(through) - Date.parse(from) > 60 * 86400000) throw new Failure(400, 'Wähle einen Zeitraum bis zu 61 Tagen.');
      return jsonify({ events: await listCalendar(provider, access, from, through) }, 200, headers);
    }
    if (action === 'mail') return jsonify(await listMail(provider, access, arg(values, 'query', 160), arg(values, 'cursor', 2048)), 200, headers);
    const id = arg(values, 'id', 1024, true);
    if (action === 'detail') {
      const row = await messageDetail(provider, access, id);
      const key = hex(await hash([provider, link.account, id].join('\u0000')));
      return jsonify({ ...row, key, provider, day: swissDay(row.date) }, 200, headers);
    }
    const attachment = arg(values, 'attachment', 2048);
    const bytes = await messageFile(provider, access, id, attachment);
    return new Response(bytes, { headers: { ...headers, 'Content-Type': attachment ? 'application/octet-stream' : 'message/rfc822' } });
  } catch (error) {
    const known = error instanceof Failure;
    return jsonify({ problem: known ? error.message : 'Die Anfrage konnte beim Anbieter nicht abgeschlossen werden.' }, known ? error.status : 502, headers);
  }
});
