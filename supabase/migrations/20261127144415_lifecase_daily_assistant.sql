create unique index lifecase_calendar_intake_key on public.lifecase_records(user_id, (fields->>'intakeKey'))
where section = 'Kalender' and fields ? 'intakeKey';

create table public.lifecase_mail_rules (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  automatic boolean not null default true,
  -- Start reading only after this date. A trigger owns the timestamp.
  enabled_at timestamptz not null default now()
);
alter table public.lifecase_mail_rules enable row level security;
revoke all on public.lifecase_mail_rules from public, anon, authenticated;
grant select on public.lifecase_mail_rules to authenticated;
grant insert (enabled, automatic), update (enabled, automatic) on public.lifecase_mail_rules to authenticated;
grant select on public.lifecase_mail_rules to service_role;
create policy lifecase_mail_rules_owner on public.lifecase_mail_rules for all to authenticated
using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2')
with check ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

create function lifecase_private.stamp_mail_rule() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.enabled and not old.enabled) then new.enabled_at := clock_timestamp(); end if;
  return new;
end;
$$;
revoke all on function lifecase_private.stamp_mail_rule() from public, anon, authenticated;
create trigger lifecase_mail_rule_stamp before insert or update on public.lifecase_mail_rules
for each row execute function lifecase_private.stamp_mail_rule();

create table public.lifecase_mail_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  checked_at timestamptz not null,
  status text not null check (status in ('ok','partial','failed')),
  checked integer not null default 0 check (checked >= 0),
  saved integer not null default 0 check (saved >= 0),
  suggested integer not null default 0 check (suggested >= 0),
  primary key (user_id, provider)
);
alter table public.lifecase_mail_runs enable row level security;
revoke all on public.lifecase_mail_runs from public, anon, authenticated;
grant select on public.lifecase_mail_runs to authenticated;
grant select, insert, update on public.lifecase_mail_runs to service_role;
create policy lifecase_mail_run_owner on public.lifecase_mail_runs for select to authenticated
using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

create table public.lifecase_appointment_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  intake_key text not null,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','dismissed','accepted')),
  unique (user_id, intake_key)
);
alter table public.lifecase_appointment_suggestions enable row level security;
revoke all on public.lifecase_appointment_suggestions from public, anon, authenticated;
grant select on public.lifecase_appointment_suggestions to authenticated;
grant update (status) on public.lifecase_appointment_suggestions to authenticated;
create policy lifecase_suggestion_owner on public.lifecase_appointment_suggestions for all to authenticated
using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2')
with check ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

create table public.lifecase_mail_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  fingerprint text not null check (length(fingerprint) = 64),
  checked_at timestamptz not null default now(),
  primary key (user_id, provider, fingerprint)
);
alter table public.lifecase_mail_seen enable row level security;
revoke all on public.lifecase_mail_seen from public, anon, authenticated;
grant select, insert, delete on public.lifecase_mail_seen to service_role;

create function lifecase_private.store_mail_intake(p_owner uuid, p_provider text, p_fingerprint text, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected_rule public.lifecase_mail_rules%rowtype;
  item jsonb;
  item_day date;
  item_start text;
  item_end text;
  item_title text;
  item_location text;
  item_key text;
  item_note text;
  initial_sub text;
  affected int;
  saved int := 0;
  suggested int := 0;
begin
  if p_owner is null or p_provider not in ('google','microsoft') or p_fingerprint !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) > 20 then
    raise exception 'Invalid LifeCase mail intake';
  end if;
  select * into selected_rule from public.lifecase_mail_rules where user_id = p_owner and enabled;
  if not found then return jsonb_build_object('saved', 0, 'suggested', 0); end if;
  insert into public.lifecase_mail_seen(user_id,provider,fingerprint) values (p_owner,p_provider,p_fingerprint) on conflict do nothing;
  if not found then return jsonb_build_object('saved', 0, 'suggested', 0); end if;
  for item in select value from jsonb_array_elements(p_candidates) loop
    item_day := (item->>'date')::date;
    item_start := coalesce(item->>'time', '');
    item_end := coalesce(item->>'endTime', '');
    if item_day is null or item_day not between (clock_timestamp() at time zone 'Europe/Zurich')::date and
        (clock_timestamp() at time zone 'Europe/Zurich')::date + 370
        or item_start !~ '^(|([01][0-9]|2[0-3]):[0-5][0-9])$'
        or item_end !~ '^(|([01][0-9]|2[0-3]):[0-5][0-9])$' or (item_end <> '' and item_end <= item_start) then
      continue;
    end if;
    item_title := left(coalesce(nullif(btrim(item->>'title'), ''), 'Termin aus E-Mail'), 250);
    item_location := left(coalesce(item->>'location',''), 250);
    item_note := left(coalesce(item->>'evidence',''), 400);
    item_key := 'mail:' || p_provider || ':' || p_fingerprint || ':' || item_day::text || ':' || item_start;
    if exists (select 1 from public.lifecase_records
        where user_id = p_owner and section = 'Kalender' and
        (fields->>'intakeKey' = item_key or (
          archived_at is null and fields->>'date' = item_day::text and coalesce(fields->>'time','') = item_start and
          lower(btrim(fields->>'title')) = lower(btrim(item_title)) and coalesce(fields->>'kind','Termin') = 'Termin'
        ))) then continue; end if;
    if selected_rule.automatic and item->>'automatic' = 'true' and item_start <> '' and jsonb_array_length(p_candidates) = 1 then
      -- Keep the existing record audit trigger active for the explicitly enrolled owner.
      initial_sub := current_setting('request.jwt.claim.sub', true);
      perform set_config('request.jwt.claim.sub', p_owner::text, true);
      insert into public.lifecase_records(user_id,section,fields)
        values (p_owner,'Kalender',jsonb_build_object('title',item_title,'date',item_day,'time',item_start,'endTime',item_end,'kind','Termin',
          'status','Offen','location',item_location,'notes',item_note,'intakeKey',item_key,'intakeSource',p_provider))
        on conflict do nothing;
      get diagnostics affected = row_count;
      perform set_config('request.jwt.claim.sub', coalesce(initial_sub,''), true);
      saved := saved + affected;
    else
      insert into public.lifecase_appointment_suggestions(user_id,provider,intake_key,details)
        values (p_owner,p_provider,item_key,jsonb_build_object('title',item_title,'date',item_day,'time',item_start,'endTime',item_end,
          'location',item_location,'evidence',item_note,'reason',left(coalesce(item->>'reviewReason',''),150)))
        on conflict do nothing;
      get diagnostics affected = row_count;
      suggested := suggested + affected;
    end if;
  end loop;
  return jsonb_build_object('saved',saved,'suggested',suggested);
end;
$$;
revoke all on function lifecase_private.store_mail_intake(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function lifecase_private.store_mail_intake(uuid,text,text,jsonb) to service_role;

create function public.lifecase_store_mail_intake(p_owner uuid,p_provider text,p_fingerprint text,p_candidates jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select lifecase_private.store_mail_intake(p_owner,p_provider,p_fingerprint,p_candidates);
$$;
revoke all on function public.lifecase_store_mail_intake(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.lifecase_store_mail_intake(uuid,text,text,jsonb) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lifecase_mail_job_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'lifecase_mail_job_token');
  end if;
end;
$$;
create function lifecase_private.verify_mail_job(p_token text) returns boolean language sql security definer set search_path = '' as $$
  select length(p_token) = 64 and exists (select 1 from vault.decrypted_secrets
    where name = 'lifecase_mail_job_token' and decrypted_secret = p_token);
$$;
revoke all on function lifecase_private.verify_mail_job(text) from public, anon, authenticated;
grant execute on function lifecase_private.verify_mail_job(text) to service_role;

create function public.lifecase_mail_job_ok(p_token text) returns boolean language sql security invoker set search_path = '' as $$
  select lifecase_private.verify_mail_job(p_token);
$$;
revoke all on function public.lifecase_mail_job_ok(text) from public, anon, authenticated;
grant execute on function public.lifecase_mail_job_ok(text) to service_role;

create function lifecase_private.schedule_mail_poll() returns void language plpgsql security definer set search_path = '' as $$
begin
  if extract(hour from clock_timestamp() at time zone 'Europe/Zurich') not in (8,14,20) then return; end if;
  delete from public.lifecase_mail_seen where checked_at < clock_timestamp() - interval '45 days';
  if not exists (select 1 from public.lifecase_mail_rules r join lifecase_private.connections c using(user_id) where r.enabled) then return; end if;
  perform net.http_post(url := 'https://gmulchykvjxkbpcfnspg.supabase.co/functions/v1/lifecase-connect/poll-mail',
    headers := jsonb_build_object('Content-Type','application/json','X-LifeCase-Job',
      (select decrypted_secret from vault.decrypted_secrets where name = 'lifecase_mail_job_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end;
$$;
revoke all on function lifecase_private.schedule_mail_poll() from public, anon, authenticated;
select cron.schedule('lifecase-mail-zurich-08-14-20', '0 6,7,12,13,18,19 * * *', 'select lifecase_private.schedule_mail_poll()');
