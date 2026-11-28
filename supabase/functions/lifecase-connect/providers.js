const graph = 'https://graph.microsoft.com/v1.0/';
const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const driveApi = 'https://www.googleapis.com/drive/v3/';
const folderType = 'application/vnd.google-apps.folder';
const googleCalendar = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const googleCalendars = 'https://www.googleapis.com/calendar/v3/calendars/';
const zone = 'Europe/Zurich';
const local = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeZoneDay = date => local.format(new Date(date)).slice(0, 10);
const dateIso = value => new Date(value).toISOString();
const maximumFile = 10 * 1024 * 1024;

export const providers = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly' },
  drive: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.readonly' },
  microsoft: { authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    scope: 'offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.Read' },
};

export class Failure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function withQuery(base, data) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(data)) if (value !== '') url.searchParams.set(key, String(value));
  return url.toString();
}
const request = (url, settings) => fetch(url, { ...settings, redirect: 'error', signal: AbortSignal.timeout(12000) });
async function providerRequest(url, access, headers = {}) {
  const response = await request(url, { headers: { Authorization: 'Bearer ' + access, ...headers } });
  if (response.ok) return response;
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) throw new Failure(403, 'Der Anbieter hat den Zugriff abgelehnt. Verbinde das Konto erneut.');
  if (response.status === 404) throw new Failure(404, 'Der Eintrag ist beim Anbieter nicht mehr verfügbar.');
  if (response.status === 429) throw new Failure(429, 'Der Anbieter begrenzt die Abfragen. Versuche es in Kürze erneut.');
  throw new Failure(502, 'Der Anbieter konnte die Anfrage nicht verarbeiten.');
}
const getJson = async (url, access, headers) => (await providerRequest(url, access, headers)).json();
const getGraph = (url, access, headers) => getJson(url, access, { Prefer: 'IdType="ImmutableId"', ...headers });
const identity = value => encodeURIComponent(value);
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), letter => letter.charCodeAt(0));

function scopeFor(provider, write, drafts = false) {
  let scope = providers[provider].scope;
  if (drafts && provider === 'google') scope += ' https://www.googleapis.com/auth/gmail.compose';
  if (drafts && provider === 'microsoft') scope = scope.replace('/Mail.Read', '/Mail.ReadWrite');
  if (write && provider === 'google') scope += ' https://www.googleapis.com/auth/calendar.events.owned';
  if (write && provider === 'microsoft') scope = scope.replace('/Calendars.Read', '/Calendars.ReadWrite');
  return scope;
}
function hasWriteScope(provider, scope) {
  const scopes = String(scope || '').toLowerCase().split(/\s+/);
  return provider === 'google' ? scopes.includes('https://www.googleapis.com/auth/calendar.events.owned') ||
    scopes.includes('https://www.googleapis.com/auth/calendar.events') || scopes.includes('https://www.googleapis.com/auth/calendar') :
    provider === 'microsoft' && scopes.some(item => item.split('/').at(-1) === 'calendars.readwrite');
}
export function authorizationUrl(provider, cfg, callback, state, challenge, write = false, drafts = false) {
  return withQuery(providers[provider].authorize, {
    client_id: cfg.client_id, redirect_uri: callback, response_type: 'code', scope: scopeFor(provider, write, drafts),
    code_challenge: challenge, code_challenge_method: 'S256', state,
    ...(provider !== 'microsoft' ? { access_type: 'offline', prompt: 'consent select_account' } : { prompt: 'select_account' }),
  });
}
export async function exchange(provider, cfg, params, oldRefresh = '', write = false, drafts = false) {
  const requestFields = { client_id: cfg.client_id, client_secret: cfg.client_secret, ...params };
  if (provider === 'microsoft') requestFields.scope = scopeFor(provider, write, drafts);
  const response = await request(providers[provider].token, {
    method: 'POST', body: new URLSearchParams(requestFields), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429 || response.status >= 500) throw new Failure(503, 'Das Konto konnte gerade nicht aktualisiert werden. Versuche es später erneut.');
    throw new Failure(403, 'Die Freigabe ist abgelaufen oder ungültig. Verbinde das Konto erneut.');
  }
  const data = await response.json();
  const refresh = data.refresh_token || oldRefresh;
  if (!data.access_token || !refresh) throw new Failure(403, 'Die Freigabe enthält keinen dauerhaften Kontozugriff.');
  return { access: data.access_token, refresh, expires: Date.now() + Number(data.expires_in || 3600) * 1000,
    mailDrafts: drafts && (data.scope ? data.scope.toLowerCase().split(/\s+/).some(scope => provider === 'google' ?
      ['https://www.googleapis.com/auth/gmail.compose','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(scope) :
      scope.split('/').at(-1) === 'mail.readwrite') : params.grant_type === 'refresh_token'),
    calendarWrite: write && (data.scope ? hasWriteScope(provider, data.scope) : params.grant_type === 'refresh_token') };
}
export async function profile(provider, access) {
  if (provider === 'drive') {
    const { user } = await getJson(withQuery(driveApi + 'about', { fields: 'user(emailAddress,permissionId)' }), access);
    if (!user?.emailAddress) throw new Failure(502, 'Das Drive-Konto konnte nicht gelesen werden.');
    return { account: user.emailAddress.toLowerCase(), email: user.emailAddress };
  }
  if (provider === 'google') {
    const data = await getJson(gmail + 'profile', access);
    if (!data.emailAddress) throw new Failure(502, 'Das Google-Konto konnte nicht gelesen werden.');
    return { account: data.emailAddress.toLowerCase(), email: data.emailAddress };
  }
  const data = await getGraph(withQuery(graph + 'me', { $select: 'id,mail,userPrincipalName' }), access);
  if (!data.id) throw new Failure(502, 'Das Microsoft-Konto konnte nicht gelesen werden.');
  return { account: data.id, email: data.mail || data.userPrincipalName || 'Microsoft-Konto' };
}
export async function revokeGoogle(token) {
  const response = await request('https://oauth2.googleapis.com/revoke', { method: 'POST',
    body: new URLSearchParams({ token }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  await response.body?.cancel();
}
const mimeHeader = (payload, header) => payload?.headers?.find(entry => entry.name.toLowerCase() === header)?.value || '';
function googleMessage(row) {
  return { id: row.id, replyAddress: mimeHeader(row.payload, 'reply-to') || mimeHeader(row.payload,'from'), subject: mimeHeader(row.payload, 'subject') || '(Ohne Betreff)', sender: mimeHeader(row.payload, 'from'),
    date: dateIso(Number(row.internalDate)), hasAttachments: Boolean(row.payload?.parts?.some(part => part.filename)) };
}
const msFields = 'id,subject,from,replyTo,receivedDateTime,hasAttachments';
function microsoftMessage(row) {
  const address = row.from?.emailAddress;
  return { id: row.id, replyAddress: row.replyTo?.length ? row.replyTo.map(item=>item.emailAddress?.address).join(', ') : address?.address || '', subject: row.subject || '(Ohne Betreff)', sender: [address?.name, address?.address].filter(Boolean).join(' · '),
    date: dateIso(row.receivedDateTime), hasAttachments: Boolean(row.hasAttachments) };
}
function microsoftSkip(url) {
  if (!url) return '';
  const point = new URL(url);
  if (point.origin !== 'https://graph.microsoft.com') return '';
  return point.searchParams.get('$skip') || point.searchParams.get('$skiptoken') || '';
}
// UTC instant corresponding to 00:00 in Zurich. Both candidate offsets cover DST transitions.
function boundary(day, next = false) {
  const utc = Date.parse(day+'T00:00:00Z') + (next ? 86400000 : 0);
  const hourly = new Date(utc - 3600000);
  return local.format(hourly).endsWith('00:00') ? hourly : new Date(utc - 7200000);
}

export async function listMail(provider, access, query, cursor, from = '', through = '') {
  const count = 15;
  if (provider === 'google') {
    const q = [query, from && 'after:'+(boundary(from).getTime()/1000-1), through && 'before:'+boundary(through,true).getTime()/1000].filter(Boolean).join(' ');
    const data = await getJson(withQuery(gmail + 'messages', { maxResults: count, labelIds: query ? '' : 'INBOX', q, pageToken: cursor }), access);
    const rows = await Promise.all((data.messages ?? []).map(({ id }) => getJson(withQuery(gmail + 'messages/' + identity(id), {
      format: 'metadata', fields: 'id,internalDate,payload(headers)',
    }), access)));
    return { rows: rows.map(googleMessage), next: data.nextPageToken || '' };
  }
  const base = graph + (query ? 'me/messages' : 'me/mailFolders/inbox/messages');
  const range=[from && 'receivedDateTime ge '+boundary(from).toISOString(),through && 'receivedDateTime lt '+boundary(through,true).toISOString()].filter(Boolean).join(' and ');
  const rangedSearch=Boolean(range && query);
  const filters = { $top: rangedSearch ? 50 : count, $select: msFields+(rangedSearch?',bodyPreview':''), $orderby: !query || range ? 'receivedDateTime desc' : '',
    $filter:range, $search: query && !range ? '"'+query.replace(/["\\]/g,' ')+'"' : '' };
  const rows=[];
  let next=cursor;
  let pages=0;
  do {
    if (next) filters[/^\d+$/.test(next) ? '$skip' : '$skiptoken']=next;
    const data=await getGraph(withQuery(base,filters),access);
    const matches=(data.value ?? []).filter(row=>!rangedSearch || query.toLowerCase().split(/\s+/).every(term=>
      [row.subject,row.from?.emailAddress?.name,row.from?.emailAddress?.address,row.bodyPreview].join(' ').toLowerCase().includes(term)));
    rows.push(...matches.map(microsoftMessage));
    const previous=next;
    next=microsoftSkip(data['@odata.nextLink']);
    if (previous===next) next='';
    pages++;
  } while (rangedSearch && next && rows.length<count && pages<4);
  return {rows, next, partial:Boolean(rangedSearch && next)};

}
function textOnly(html) {
  return String(html ?? '').replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, match => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[match])
    .replace(/\n{3,}/g, '\n\n').trim();
}
function mimeParts(part) {
  return part ? [part, ...(part.parts ?? []).flatMap(mimeParts)] : [];
}
function gmailFileId(part, index) {
  return part.partId || '#' + index;
}
async function googleBody(row, access) {
  const parts = mimeParts(row.payload);
  const chosen = parts.find(part => part.mimeType === 'text/plain' && !part.filename && (part.body?.data || part.body?.attachmentId)) ||
    parts.find(part => part.mimeType === 'text/html' && !part.filename && (part.body?.data || part.body?.attachmentId));
  if (!chosen) return row.snippet || '';
  let bytes = chosen.body.data;
  if (!bytes && chosen.body.size <= maximumFile) {
    const data = await getJson(gmail + 'messages/' + identity(row.id) + '/attachments/' + identity(chosen.body.attachmentId), access);
    bytes = data.data;
  }
  if (!bytes) return row.snippet || '';
  const type = mimeHeader(chosen, 'content-type');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] || 'utf-8';
  let decoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  const body = decoder.decode(decode(bytes));
  return chosen.mimeType === 'text/html' ? textOnly(body) : body;
}
export async function messageDetail(provider, access, id, includeAttachments = true) {
  if (provider === 'google') {
    const row = await getJson(withQuery(gmail + 'messages/' + identity(id), { format: 'full' }), access);
    return { ...googleMessage(row), text: (await googleBody(row, access)).slice(0, 24000), attachments: (includeAttachments ? mimeParts(row.payload) : [])
      .flatMap((part, index) => part.filename ? [{ id: gmailFileId(part, index), name: part.filename, size: Number(part.body?.size ?? 0) }] : []) };
  }
  const base = graph + 'me/messages/' + identity(id);
  const row = await getGraph(withQuery(base, { $select: msFields + ',body' }), access, { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' });
  const attachments = row.hasAttachments && includeAttachments ? await getGraph(withQuery(base + '/attachments', { $select: 'id,name,size,isInline', $top: 80 }), access) : null;
  return { ...microsoftMessage(row), text: (row.body?.contentType === 'html' ? textOnly(row.body.content) : (row.body?.content || '')).slice(0, 24000),
    attachments: (attachments?.value ?? []).filter(item => item['@odata.type'] !== '#microsoft.graph.referenceAttachment')
      .map(item => ({ id: item.id, name: item.name || 'Anhang', size: Number(item.size ?? 0) })) };
}
function checkedFile(bytes) {
  if (bytes.length > maximumFile) throw new Failure(413, 'Diese Originaldatei ist grösser als 10 MB.');
  return bytes;
}
async function readBinary(response, limit = maximumFile, label = '10 MB') {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Failure(413, 'Diese Originaldatei ist grösser als ' + label + '.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Failure(413, 'Diese Originaldatei ist grösser als ' + label + '.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function messageFile(provider, access, id, attachment) {
  if (provider === 'microsoft') {
    const suffix = attachment ? '/attachments/' + identity(attachment) + '/$value' : '/$value';
    return readBinary(await providerRequest(graph + 'me/messages/' + identity(id) + suffix, access, { Prefer: 'IdType="ImmutableId"' }));
  }
  const base = gmail + 'messages/' + identity(id);
  if (!attachment) {
    const meta = await getJson(withQuery(base, { format: 'minimal', fields: 'sizeEstimate' }), access);
    if (meta.sizeEstimate > maximumFile) throw new Failure(413, 'Diese Originalnachricht ist grösser als 10 MB.');
    const { raw } = await getJson(withQuery(base, { format: 'raw', fields: 'raw' }), access);
    return checkedFile(decode(raw));
  }
  const { payload } = await getJson(withQuery(base, { format: 'full', fields: 'payload' }), access);
  const part = mimeParts(payload).find((entry, index) => entry.filename && gmailFileId(entry, index) === attachment);
  if (!part) throw new Failure(404, 'Der Anhang ist nicht mehr verfügbar.');
  if (part.body?.size > maximumFile) throw new Failure(413, 'Dieser Anhang ist grösser als 10 MB.');
  const data = part.body?.attachmentId ? await getJson(base + '/attachments/' + identity(part.body.attachmentId), access) : part.body;
  return checkedFile(decode(data?.data || ''));
}
function localDayAndTime(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const parts = local.format(date).split(' ');
  return { date: parts[0], time: parts[1] };
}
const daysAfter = (day, amount) => new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
const msDate = part => part?.dateTime ? (/Z$|[+-]\d{2}:\d{2}$/.test(part.dateTime) ? part.dateTime : part.dateTime + 'Z') : '';
function calendarEvent(provider, entry, calendarId) {
  const google = provider === 'google';
  if (google ? entry.status === 'cancelled' : entry.isCancelled) return null;
  const allDay = google ? Boolean(entry.start?.date) : Boolean(entry.isAllDay);
  const startStamp = google ? entry.start?.dateTime : msDate(entry.start);
  const endStamp = google ? entry.end?.dateTime : msDate(entry.end);
  const start = allDay ? { date: google ? entry.start.date : entry.start?.dateTime?.slice(0, 10), time: '' } : localDayAndTime(startStamp);
  if (!start?.date) return null;
  const exclusive = allDay ? (google ? entry.end?.date : entry.end?.dateTime?.slice(0, 10)) : '';
  const endDate = exclusive ? daysAfter(exclusive, -1) : (endStamp ? localDayAndTime(new Date(Date.parse(endStamp) - 1))?.date : start.date);
  return { provider, id: calendarId + ':' + entry.id, title: (google ? entry.summary : entry.subject) || '(Ohne Titel)',
    date: start.date, time: start.time, endTime: allDay ? '' : localDayAndTime(endStamp)?.time || '',
    timeEndDate: allDay ? '' : localDayAndTime(endStamp)?.date || '',
    busy: google ? entry.transparency !== 'transparent' : entry.showAs !== 'free',
    lifeCasePause: (google ? entry.summary : entry.subject) === 'Mittagspause',
    endDate: endDate && endDate >= start.date ? endDate : start.date, allDay,
    location: (google ? entry.location : entry.location?.displayName) || '' };
}
async function pages(first, provider, access, itemsKey, maximum = 8) {
  const output = [];
  let url = first;
  for (let page = 0; url && page < maximum; page++) {
    const data = provider === 'microsoft' ? await getGraph(url, access, { Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"' }) : await getJson(url, access);
    output.push(...(data[itemsKey] ?? []));
    if (provider === 'microsoft') {
      const next = data['@odata.nextLink'];
      url = next && new URL(next).origin === 'https://graph.microsoft.com' ? next : '';
    } else {
      url = data.nextPageToken ? withQuery(first, { pageToken: data.nextPageToken }) : '';
    }
  }
  if (url) throw new Failure(422, 'Zu viele Termine für diesen Zeitraum. Kalenderquelle reduzieren oder Zeitraum wechseln.');
  return output;
}
export async function listCalendar(provider, access, from, through) {
  // Fetch a buffer around the Swiss day boundaries. Filter after converting time zones.
  const lower = daysAfter(from, -1) + 'T00:00:00Z';
  const upper = daysAfter(through, 2) + 'T00:00:00Z';
  const google = provider === 'google';
  const calendars = await pages(google ? withQuery(googleCalendar, { maxResults: 100, showHidden: false }) :
    withQuery(graph + 'me/calendars', { $select: 'id,name', $top: 80 }), provider, access, google ? 'items' : 'value', 3);
  const enabled = google ? calendars.filter(calendar => calendar.selected || calendar.primary) : calendars;
  if (enabled.length > 30) throw new Failure(422, 'Dieses Konto hat zu viele Kalender für die gemeinsame Ansicht.');
  const all = [];
  for (let offset = 0; offset < enabled.length; offset += 5) {
    const results = await Promise.all(enabled.slice(offset, offset + 5).map(async ({ id }) => {
      const url = google ? withQuery(googleCalendars + identity(id) + '/events',
        { timeMin: lower, timeMax: upper, singleEvents: true, showDeleted: false, maxResults: 100, fields: 'nextPageToken,items(id,status,summary,location,start,end,transparency)' }) :
        withQuery(graph + 'me/calendars/' + identity(id) + '/calendarView', { startDateTime: lower, endDateTime: upper,
          $select: 'id,subject,start,end,location,isAllDay,isCancelled,showAs', $top: 100 });
      const events = await pages(url, provider, access, google ? 'items' : 'value');
      return events.map(event => calendarEvent(provider, event, id)).filter(event => event && event.date <= through && event.endDate >= from);
    }));
    all.push(...results.flat());
  }
  return all;
}
export const swissDay = timeZoneDay;

export async function incomingMailPage(provider, access, since, through, limit, cursor = '') {
  const google = provider === 'google';
  const base = google ? gmail + 'messages' : graph + 'me/mailFolders/inbox/messages';
  const url = google ? withQuery(base, {
    labelIds: 'INBOX', q: 'after:'+(Math.floor(since.getTime()/1000)-1) + (through ? ' before:'+Math.ceil(through.getTime()/1000) : ''),
    maxResults:limit, pageToken:cursor, fields:'messages(id),nextPageToken',
  }) : cursor || withQuery(base, {
    $top:limit, $select:'id,receivedDateTime', $orderby:'receivedDateTime asc',
    $filter:'receivedDateTime ge '+since.toISOString()+(through ? ' and receivedDateTime lt '+through.toISOString() : ''),
  });
  if (!google && cursor) {
    const next = new URL(cursor);
    if (next.origin !== 'https://graph.microsoft.com' || next.username || next.password ||
        !next.pathname.startsWith('/v1.0/') || !next.pathname.endsWith('/messages')) throw new Failure(410,'Die Mailprüfung beginnt diese Seite erneut.');
  }
  const response = await request(url, {headers:{Authorization:'Bearer '+access, ...(!google ? {Prefer:'IdType="ImmutableId"'} : {})}});
  if (!response.ok) {
    await response.body?.cancel();
    throw new Failure(cursor && [400,404,410].includes(response.status) ? 410 : response.status, 'Die Posteingangsseite ist gerade nicht verfügbar.');
  }
  const data=await response.json();
  const rows=google ? data.messages : data.value;
  if (rows !== undefined && !Array.isArray(rows) || !google && !Array.isArray(rows)) throw new Failure(502,'Die Posteingangsseite ist unvollständig.');
  return { rows:(rows ?? []).map(r=>google ? {id:r.id} : {id:r.id,date:r.receivedDateTime}),
    next:(google ? data.nextPageToken : data['@odata.nextLink']) || '' };
}

function driveQueryText(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function listDriveFiles(access, folder, query, cursor) {
  const supported = "(mimeType = 'application/pdf' or mimeType contains 'image/' or mimeType = '" + folderType + "')";
  const conditions = ["trashed = false", supported];
  if (query) conditions.push("name contains '" + driveQueryText(query) + "'");
  else conditions.push("'" + (folder || 'root') + "' in parents");
  const rows = await getJson(withQuery(driveApi + 'files', {
    q: conditions.join(' and '), pageSize: 50, pageToken: cursor, orderBy: 'folder,name_natural',
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,capabilities(canDownload))',
    spaces: 'drive',
  }), access);
  return { rows: (rows.files ?? []).map(item => ({
    id: item.id, name: item.name, mime: item.mimeType, size: Number(item.size || 0),
    date: item.modifiedTime, folder: item.mimeType === folderType, canDownload: item.capabilities?.canDownload !== false,
  })), next: rows.nextPageToken || '' };
}

export async function driveOriginal(access, id) {
  const url = driveApi + 'files/' + identity(id);
  const info = await getJson(withQuery(url, { fields: 'id,mimeType,size,trashed,capabilities(canDownload)' }), access);
  if (info.trashed || !['application/pdf'].includes(info.mimeType) && !info.mimeType?.startsWith('image/')) {
    throw new Failure(415, 'Wähle ein PDF oder Bild aus Drive.');
  }
  if (info.capabilities?.canDownload === false) throw new Failure(403, 'Google Drive erlaubt das Herunterladen dieser Datei nicht.');
  if (Number(info.size) > 20 * 1024 * 1024) throw new Failure(413, 'Diese Originaldatei ist grösser als 20 MB.');
  return readBinary(await providerRequest(withQuery(url, { alt: 'media' }), access), 20 * 1024 * 1024, '20 MB');
}

export async function createLunchBlock(provider, access, day, time, endTime, key) {
  const google = provider === 'google';
  const timezone = google ? 'Europe/Zurich' : 'W. Europe Standard Time';
  const timestamp = clock => ({ dateTime: day + 'T' + clock + ':00', timeZone: timezone });
  const title = 'Mittagspause';
  const target = google ? withQuery(googleCalendars + 'primary/events', { sendUpdates: 'none' }) : graph + 'me/calendar/events';
  const fields = { start: timestamp(time), end: timestamp(endTime) };
  const transactionId = [key.slice(0,8),key.slice(8,12),'4'+key.slice(13,16),'a'+key.slice(17,20),key.slice(20,32)].join('-');
  const data = google ? { ...fields, id: key, summary: title, transparency: 'opaque', visibility: 'private', reminders: { useDefault: false } } :
    { ...fields, subject: title, showAs: 'busy', sensitivity: 'private', isReminderOn: false, transactionId };
  const response = await request(target, { method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
    body: JSON.stringify(data) });
  if (response.ok) { await response.body?.cancel(); return { saved: true }; }
  await response.body?.cancel();
  if (google && response.status === 409) {
    const existing = await getJson(googleCalendars + 'primary/events/' + identity(key), access);
    if (existing.summary === title && existing.status !== 'cancelled') return { saved: true };
  }
  if (response.status === 401 || response.status === 403) throw new Failure(403, 'Die Kalender-Schreibfreigabe fehlt oder ist abgelaufen.');
  throw new Failure(502, 'Der Kalenderanbieter hat die Mittagspause nicht bestätigt.');
}

export async function createMailDraft(provider, access, { to, subject, body, replyId = '' }) {
  if (!['google','microsoft'].includes(provider) || typeof replyId !== 'string' || replyId.length > 1024 || /[\u0000-\u001f]/.test(replyId) || typeof to !== 'string' || to.length > 254 ||
      !/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(to) || typeof subject !== 'string' ||
      !subject.trim() || subject.length > 250 || /[\u0000-\u001f\u007f]/.test(subject + to) ||
      typeof body !== 'string' || !body.trim() || body.length > 10000) {
    throw new Failure(400, 'Prüfe Empfängeradresse, Betreff und Nachricht.');
  }
  const encode = text => btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
  // Fold encoded words between Unicode code points, not within a UTF-8 sequence.
  const words = Array.from(subject).reduce((parts, char) => {
    if (new TextEncoder().encode(parts.at(-1) + char).length > 42) parts.push('');
    parts[parts.length - 1] += char;
    return parts;
  }, ['']);
  const google = provider === 'google';
  const threadHeaders=[];
  let threadId='';
  if (replyId && google) {
    const original=await getJson(withQuery(gmail+'messages/'+identity(replyId),{format:'metadata'}),access);
    const msgId=mimeHeader(original.payload,'message-id').trim();
    if (original.threadId && /^<[^<>\s]{1,220}>$/.test(msgId)) {
      threadId=original.threadId;
      const refs=(mimeHeader(original.payload,'references').match(/<[^<>\s]{1,220}>/g) || []).slice(-8);
      threadHeaders.push('In-Reply-To: '+msgId,'References: '+[...refs,msgId].join('\r\n '));
    }
  }
  const mime = [...threadHeaders,'To: ' + to, 'Subject: ' + words.map(part=>'=?UTF-8?B?' + encode(part) + '?=').join('\r\n '),
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
    encode(body).match(/.{1,76}/g).join('\r\n')].join('\r\n');
  const draft = google ? { message: { ...(threadId ? {threadId} : {}), raw: encode(mime).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') } } :
    { subject, body: { contentType:'Text', content:body }, toRecipients:[{emailAddress:{address:to}}] };
  const target=google ? gmail+'drafts' : graph+'me/messages'+(replyId ? '/'+identity(replyId)+'/createReply' : '');
  const payload=!google && replyId ? {message:draft} : draft;
  const response = await request(target, {
    method:'POST', headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'}, body:JSON.stringify(payload),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Failure(response.status === 403 ? 403 : 502, response.status === 403 ?
      'Der Anbieter hat das Erstellen des Entwurfs abgelehnt. Prüfe die Freigabe unter Verbindungen.' :
      'Der Anbieter hat den Entwurf nicht bestätigt. Prüfe den Entwurfsordner, bevor du es erneut versuchst.');
  }
  const data = await response.json();
  if (!data?.id) throw new Failure(502, 'Prüfe den Entwurfsordner. Eine Bestätigung fehlt.');
  return { saved:true };
}
