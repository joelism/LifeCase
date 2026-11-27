import { db, get, userError } from './backend.js';

export async function dailyData() {
  const [rules, runs, suggestions] = await Promise.all([
    db.from('lifecase_mail_rules').select('enabled,automatic').maybeSingle(),
    db.from('lifecase_mail_runs').select('provider,checked_at,status,checked,saved,suggested').order('provider'),
    db.from('lifecase_appointment_suggestions').select('id,provider,intake_key,details,created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
  ]);
  return { rules: get(rules) ?? { enabled: false, automatic: true }, runs: get(runs), suggestions: get(suggestions) };
}
export async function setDailyRules(rules) {
  const result = get(await db.from('lifecase_mail_rules').upsert({ enabled: rules.enabled, automatic: rules.automatic })
    .select('enabled,automatic').single());
  return result;
}
export async function decideSuggestion(id, status) {
  const result = get(await db.from('lifecase_appointment_suggestions').update({ status }).eq('id', id)
    .eq('status', 'pending').select('id').maybeSingle());
  if (!result) throw userError('Der Vorschlag wurde bereits bearbeitet.');
}
