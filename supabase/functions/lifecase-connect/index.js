import { deliverReminders, managePush } from './push-reminders.js';
import { pollRules } from './mail-poll.js';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { authorizationUrl, createMailDraft, createLunchBlock, driveOriginal, exchange, Failure, listDriveFiles, listCalendar, listMail, messageDetail, messageFile, profile, providers, revokeGoogle, swissDay } from './providers.js';

const project = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0];
const studioAssistant = 'https://charakter-studio.skippingbookmark.chatgpt.site/api/lifecase/assistant';
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
    const stored = provider !== 'drive' && link?.connected ? await vault('read', user, provider) : null;
    return [provider, { available: isConfigured(config), ...link, accountRef: stored?.account || '', calendarWrite: stored?.tokens?.calendarWrite === true, mailDrafts: stored?.tokens?.mailDrafts === true }];
  }));
  return { accounts: Object.fromEntries(entries), callback };
}
async function begin(user, provider, origin, grant = '') {
  const cfg = await vault('config', user, provider);
  if (!isConfigured(cfg)) throw new Failure(409, 'Die Anbieterregistrierung für LifeCase fehlt.');
  const existing = grant ? await vault('read', user, provider) : null;
  const write = grant === 'calendar' || Boolean(existing?.tokens.calendarWrite);
  const drafts = grant === 'drafts' || Boolean(existing?.tokens.mailDrafts);
  const state = (drafts ? (write ? 'b3_' : 'm3_') : write ? 'w2_' : 'r2_') + nonce().slice(3);
  const verifier = nonce();
  unwrap(await service.from('lifecase_oauth_pending').upsert({
    user_id: user, provider, state_hash: hex(await hash(state)), verifier, app_url: apps.get(origin),
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
  }, { onConflict: 'user_id,provider' }));
  return { url: authorizationUrl(provider, cfg, callback, state, base64(await hash(verifier)), write, drafts) };
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
    const write = /^(w2|b3)_/.test(state) && provider !== 'drive';
    const drafts = /^(m3|b3)_/.test(state) && provider !== 'drive';
    const tokens = await exchange(provider, cfg, { grant_type: 'authorization_code', redirect_uri: callback, code, code_verifier: verifier }, '', write, drafts);
    if ((write && !tokens.calendarWrite) || (drafts && !tokens.mailDrafts)) return toApp(app_url, 'failed');
    const account = await profile(provider, tokens.access);
    await vault('write', user, provider, { ...account, tokens });
    return toApp(app_url, provider === 'drive' ? 'drive-connected' : 'connected');
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
    tokens = await exchange(provider, cfg, { grant_type: 'refresh_token', refresh_token: link.tokens.refresh }, link.tokens.refresh, link.tokens.calendarWrite === true, link.tokens.mailDrafts === true);
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
  if (provider !== 'microsoft' && link?.tokens.refresh) {
    const other = await vault('status', user, provider === 'drive' ? 'google' : 'drive');
    if (!other?.connected) await revokeGoogle(link.tokens.refresh).catch(() => {});
  }
  return { disconnected: true };
}
async function askStudio(req, config, values) {
  let result;
  try {
    result = await fetch(studioAssistant, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(32000),
      headers: {
        'Content-Type': 'application/json',
        'OAI-Sites-Authorization': 'Bearer ' + config.service_token,
        'X-LifeCase-Session': req.headers.get('authorization').slice(7),
      },
      body: JSON.stringify(values.action === 'assistant-briefing' ? { briefing: values.briefing } : values.action === 'assistant-reading' ? { reading: values.reading } :
        { messages: values.messages, lastDate: values.lastDate, intentVersion: values.intentVersion, sleepDate: values.sleepDate }),
    });
  } catch {
    throw new Failure(503, 'Die Verbindung zum OpenAI-Assistenten ist gerade unterbrochen.');
  }
  const output = await result.json().catch(() => null);
  if (!result.ok || !output?.action) throw new Failure(result.status === 400 || result.status === 422 ? 422 : 503,
    output?.problem || 'Die Verbindung zum OpenAI-Assistenten ist gerade nicht verfügbar.');
  return output;
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
  const scheduledMail = url.pathname.endsWith('/poll-mail');
  const scheduledPush = url.pathname.endsWith('/push-reminders');
  if ((scheduledMail || scheduledPush) && req.method === 'POST') {
    const proof = req.headers.get('x-lifecase-job') || '';
    if (!/^[0-9a-f]{64}$/.test(proof)) return jsonify({ problem: 'Zugriff verweigert.' }, 401, baseHeaders);
    try {
      const permitted = unwrap(await service.rpc('lifecase_mail_job_ok', { p_token: proof }));
      if (!permitted) return jsonify({ problem: 'Zugriff verweigert.' }, 401, baseHeaders);
      return jsonify(scheduledMail ? await pollRules(service, activeLink) : await deliverReminders(service), 200, baseHeaders);
    } catch {
      return jsonify({ problem: 'Geplante LifeCase-Aufgabe fehlgeschlagen.' }, 503, baseHeaders);
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
    if (body.length > 20000) throw new Failure(413, 'Die LifeCase-Anfrage ist zu gross.');
    let values;
    try { values = JSON.parse(body); } catch { throw new Failure(400, 'Ungültige LifeCase-Anfrage.'); }
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Failure(400, 'Ungültige LifeCase-Anfrage.');
    const { action, provider } = values;
    if (['assistant-status', 'assistant', 'assistant-briefing', 'assistant-reading'].includes(action)) {
      const config = unwrap(await service.rpc('lifecase_assistant_access', { p_owner: user, p_charge: action !== 'assistant-status' }));
      if (action === 'assistant-status') return jsonify({ available: config?.available === true }, 200, headers);
      if (!config?.available) throw new Failure(409, 'OpenAI ist für dieses LifeCase-Konto noch nicht aktiviert.');
      if (config.limited) throw new Failure(429, 'Das Chatlimit für diese Stunde ist erreicht.');
      return jsonify(await askStudio(req, config, values), 200, headers);
    }
    if (action === 'status') return jsonify(await status(user), 200, headers);
    if (['push-public-key','push-subscribe','push-unsubscribe'].includes(action)) return jsonify(await managePush(service, user, action, values), 200, headers);
    if (action === 'check-mail') return jsonify(await pollRules(service, activeLink, user), 200, headers);
    if (typeof provider !== 'string' || !Object.hasOwn(providers, provider)) throw new Failure(400, 'Unbekannte Verbindung.');
    if (action === 'start') return jsonify(await begin(user, provider, origin), 200, headers);
    if (action === 'start-calendar-write' && provider !== 'drive') return jsonify(await begin(user, provider, origin, 'calendar'), 200, headers);
    if (action === 'start-mail-drafts' && provider !== 'drive') return jsonify(await begin(user, provider, origin, 'drafts'), 200, headers);
    if (action === 'disconnect') return jsonify(await disconnect(user, provider), 200, headers);
    if (provider === 'drive') {
      if (!['drive-list', 'drive-file'].includes(action)) throw new Failure(400, 'Unbekannte Drive-Aktion.');
      const link = await activeLink(user, provider);
      const folder = arg(values, 'folder', 150);
      if (folder && !/^[\w-]+$/.test(folder)) throw new Failure(400, 'Ungültiger Drive-Ordner.');
      if (action === 'drive-list') return jsonify(await listDriveFiles(link.tokens.access, folder, arg(values, 'query', 160), arg(values, 'cursor', 2048)), 200, headers);
      const id = arg(values, 'id', 150, true);
      if (!/^[\w-]+$/.test(id)) throw new Failure(400, 'Ungültige Drive-Datei.');
      const bytes = await driveOriginal(link.tokens.access, id);
      return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
    }
    if (!['calendar', 'mail', 'detail', 'file', 'mail-draft', 'block-lunch'].includes(action)) throw new Failure(400, 'Unbekannte LifeCase-Aktion.');
    const link = await activeLink(user, provider);
    if (values.account && values.account !== link.account) throw new Failure(409, 'Das Postfach wurde gewechselt. Suche die Nachricht erneut.');
    const access = link.tokens.access;
    if (action === 'mail-draft') {
      if (!link.tokens.mailDrafts) throw new Failure(403, 'Erlaube unter Verbindungen zuerst E-Mail-Entwürfe für dieses Konto.');
      if (values.account !== link.account) throw new Failure(409, 'Das Konto wurde gewechselt. Prüfe den Absender erneut.');
      return jsonify(await createMailDraft(provider, access, values), 200, headers);
    }
    if (action === 'block-lunch') {
      if (!link.tokens.calendarWrite) throw new Failure(403, 'Erlaube LifeCase zuerst das Blockieren im gewählten Kalender.');
      const day = calendarDay(values, 'date');
      const from = arg(values, 'time', 5, true);
      const until = arg(values, 'endTime', 5, true);
      const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      const nowDay = swissDay(new Date());
      const format = /^1[2-4]:[0-5]\d$/;
      const toMinutes = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));
      if (!format.test(from) || !format.test(until) || until > '14:00' || toMinutes(until) - toMinutes(from) < 15 ||
          day < nowDay || (day === nowDay && from <= localTime) || Date.parse(day) - Date.parse(nowDay) > 370 * 86400000) {
        throw new Failure(400, 'Dieses Zeitfenster kann nicht mehr blockiert werden.');
      }
      const key = hex(await hash([user, provider, link.account, day, from, until].join('|')));
      return jsonify(await createLunchBlock(provider, access, day, from, until, key), 200, headers);
    }
    if (action === 'calendar') {
      const from = calendarDay(values, 'from');
      const through = calendarDay(values, 'through');
      if (through < from || Date.parse(through) - Date.parse(from) > 60 * 86400000) throw new Failure(400, 'Wähle einen Zeitraum bis zu 61 Tagen.');
      return jsonify({ events: await listCalendar(provider, access, from, through) }, 200, headers);
    }
    if (action === 'mail') {
      const from=values.from ? calendarDay(values,'from') : '';
      const through=values.through ? calendarDay(values,'through') : '';
      if (from && through && from>through) throw new Failure(400,'Prüfe den Zeitraum.');
      return jsonify(await listMail(provider,access,arg(values,'query',160),arg(values,'cursor',2048),from,through),200,headers);
    }
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
