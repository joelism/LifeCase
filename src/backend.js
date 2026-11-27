import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { BUCKET, MAX_FILE, sha256 } from './model.js';
import { persistsSession } from './session.js';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storageKey: 'lifecase-auth-v1',
    persistSession: persistsSession(globalThis.location?.hostname, globalThis.navigator?.standalone),
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: { fetch: (input, options) => fetch(input, { ...options, cache: 'no-store' }) },
});
export const get = result => {
  if (result.error) throw result.error;
  return result.data;
};
export function message(error) {
  if (error?.userMessage) return error.userMessage;
  if (!navigator.onLine || /network|fetch/i.test(error?.message ?? '')) return 'Die Verbindung ist unterbrochen. Bitte versuche es erneut.';
  if (/invalid login credentials/i.test(error?.message ?? '')) return 'E-Mail-Adresse oder Passwort ist falsch.';
  if (/otp|invalid code|token has expired/i.test(error?.message ?? '')) return 'Der Sicherheitscode ist ungültig oder abgelaufen. Verwende den nächsten Code.';
  if (error?.status === 429 || error?.statusCode === '429') return 'Zu viele Versuche. Warte kurz und versuche es erneut.';
  if (error?.status === 401 || error?.code === '42501') return 'Der Zugriff wurde verweigert. Prüfe deine Anmeldung.';
  return 'Der Vorgang konnte nicht abgeschlossen werden. Bitte versuche es erneut.';
}
export function userError(text) {
  return Object.assign(new Error(text), { userMessage: text });
}
async function page(table, order, ascending = true) {
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const batch = get(await db.from(table).select('*').order(order, { ascending }).order('id').range(offset, offset + size - 1));
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}
export const records = () => page('lifecase_records', 'created_at', false);
export const files = () => page('lifecase_files', 'reserved_at');
export const history = async id => get(await db.from('lifecase_history').select('*').eq('record_id', id).order('id', { ascending: false }).limit(100));
export async function saveRecord(section, fields, row) {
  if (!row) return get(await db.from('lifecase_records').insert({ section, fields }).select().single());
  return change(row, { fields });
}
async function change(row, patch) {
  const data = get(await db.from('lifecase_records').update(patch).eq('id', row.id)
    .eq('revision', row.revision).select().maybeSingle());
  if (!data) throw userError('Der Eintrag wurde auf einem anderen Gerät geändert. Aktualisiere die Ansicht und speichere erneut.');
  return data;
}
export const archive = (row, archived) => change(row, { archived_at: archived ? new Date().toISOString() : null });

async function finishFile(id) {
  const data = get(await db.from('lifecase_files').update({ uploaded_at: new Date().toISOString() })
    .eq('id', id).is('uploaded_at', null).select().maybeSingle());
  return data ?? get(await db.from('lifecase_files').select().eq('id', id).single());
}
export async function uploadOriginal(row, file, reservation, proposedId) {
  if (file.size > MAX_FILE) throw userError('Eine Originaldatei darf höchstens 25 MB gross sein.');
  if (file.name.length > 255) throw userError('Der Dateiname darf höchstens 255 Zeichen haben.');
  const digest = await sha256(file);
  if (reservation && reservation.sha256 !== digest) throw userError('Wähle dieselbe Originaldatei wie beim ersten Upload.');
  let saved = reservation;
  if (!saved) {
    const attempt = await db.from('lifecase_files').insert({
      ...(proposedId ? { id: proposedId } : {}), record_id: row.id, original_name: file.name, size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream', sha256: digest,
    }).select().single();
    saved = proposedId && attempt.error?.code === '23505' ?
      get(await db.from('lifecase_files').select('*').eq('id', proposedId).single()) : get(attempt);
  }
  if (saved.uploaded_at) return saved;
  const bucket = db.storage.from(BUCKET);
  const result = await bucket.upload(saved.path, file, {
    upsert: false, contentType: 'application/octet-stream', cacheControl: '0',
  });
  if (result.error) {
    // A prior upload may have succeeded even though its response was lost.
    const original = await bucket.download(saved.path);
    if (original.error || await sha256(original.data) !== digest) throw result.error;
  }
  return finishFile(saved.id);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function downloadOriginal(file) {
  const data = get(await db.storage.from(BUCKET).download(file.path));
  if (file.sha256 && await sha256(data) !== file.sha256) throw userError('Die Prüfsumme stimmt nicht überein. Die Datei wurde nicht heruntergeladen.');
  downloadBlob(new Blob([data], { type: 'application/octet-stream' }), file.original_name);
}

export async function saveImportedMail(fields) {
  const result = await db.from('lifecase_records').insert({ section: 'Beweismittel', fields }).select().single();
  if (result.error?.code !== '23505') return get(result);
  return get(await db.from('lifecase_records').select('*').eq('fields->>externalKey', fields.externalKey).single());
}

export async function storeImportedOriginal(row, file) {
  const digest = await sha256(file);
  const existing = get(await db.from('lifecase_files').select('*').eq('record_id', row.id)
    .eq('sha256', digest).eq('original_name', file.name).order('reserved_at').limit(1).maybeSingle());
  if (existing?.uploaded_at) return existing;
  const fingerprint = await sha256(new Blob([JSON.stringify([row.id, file.name, digest])]));
  const proposedId = [fingerprint.slice(0, 8), fingerprint.slice(8, 12), '4' + fingerprint.slice(13, 16),
    'a' + fingerprint.slice(17, 20), fingerprint.slice(20, 32)].join('-');
  return uploadOriginal(row, file, existing, proposedId);
}

export async function findRecord(id) {
  return get(await db.from('lifecase_records').select('*').eq('id', id).single());
}

export async function saveIntakeRecord(fields, section = 'Kalender') {
  const attempt = await db.from('lifecase_records').insert({ section, fields }).select().single();
  if (attempt.error?.code !== '23505') return get(attempt);
  return get(await db.from('lifecase_records').select('*').eq('section', section)
    .eq('fields->>intakeKey', fields.intakeKey).single());
}
