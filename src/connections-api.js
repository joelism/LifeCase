import { db, get, userError } from './backend.js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

const endpoint = SUPABASE_URL + '/functions/v1/lifecase-connect';
export async function connection(action, values = {}, binary = false) {
  const { session } = get(await db.auth.getSession());
  if (!session) throw userError('Melde dich erneut in LifeCase an.');
  const response = await fetch(endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...values }),
  });
  if (response.ok) return binary ? response.blob() : response.json();
  const problem = await response.json().catch(() => ({}));
  throw userError(problem.problem || 'Die Verbindung ist zurzeit nicht erreichbar.');
}

export async function healthRows(from, metric = '') {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const query = db.from('lifecase_health_days').select('day,metric,value,source,source_name').gte('day', from);
    if (metric) query.eq('metric', metric);
    const rows = get(await query.order('day', { ascending: false }).order('metric').order('source').range(offset, offset + 499));
    all.push(...rows);
    if (rows.length < 500) return all;
  }
}

export async function writeHealthRows(rows) {
  for (let offset = 0; offset < rows.length; offset += 250) {
    get(await db.from('lifecase_health_days').upsert(rows.slice(offset, offset + 250), { onConflict: 'user_id,day,metric,source' }));
  }
}

export async function clearHealthRows() {
  get(await db.from('lifecase_health_days').delete().gte('day', '1900-01-01'));
}
