alter table public.lifecase_oauth_pending drop constraint lifecase_oauth_pending_provider_check;
alter table public.lifecase_oauth_pending add check (provider in ('google','microsoft','drive'));
alter table lifecase_private.connections drop constraint connections_provider_check;
alter table lifecase_private.connections add check (provider in ('google','microsoft','drive'));

create or replace function lifecase_private.connection_vault(p_action text, p_owner uuid, p_provider text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prefix text := 'lifecase_' || case when p_provider = 'drive' then 'google' else p_provider end;
  config jsonb;
  link lifecase_private.connections%rowtype;
  secret uuid;
begin
  if p_owner is null or p_provider is null or p_provider not in ('google', 'microsoft', 'drive') then
    raise exception 'Invalid LifeCase connection' using errcode = '22023';
  end if;
  if p_action = 'config' then
    select jsonb_object_agg(right(name, case when name like '%client_id' then 9 else 13 end), decrypted_secret)
      into config from vault.decrypted_secrets
      where name in (prefix || '_client_id', prefix || '_client_secret');
    return coalesce(config, '{}'::jsonb);
  end if;
  if p_action in ('write', 'refresh', 'remove') then
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_provider || ':lifecase', 0));
  end if;
  select * into link from lifecase_private.connections where user_id = p_owner and provider = p_provider;
  if p_action = 'status' then
    return jsonb_build_object('connected', link.user_id is not null, 'email', coalesce(link.email, ''));
  elsif p_action = 'read' then
    if link.user_id is null then return null; end if;
    return (select jsonb_build_object('account', link.account_id, 'revision', link.revision, 'tokens', decrypted_secret::jsonb)
      from vault.decrypted_secrets where id = link.secret_id);
  elsif p_action = 'remove' then
    delete from lifecase_private.connections where user_id = p_owner and provider = p_provider;
    delete from public.lifecase_oauth_pending where user_id = p_owner and provider = p_provider;
    return 'true'::jsonb;
  elsif p_action = 'refresh' then
    if link.revision is null or link.revision::text is distinct from p_data->>'revision' then return 'false'::jsonb; end if;
    perform vault.update_secret(link.secret_id, (p_data->'tokens')::text);
    update lifecase_private.connections set revision = gen_random_uuid() where user_id = p_owner and provider = p_provider;
    return 'true'::jsonb;
  elsif p_action = 'write' then
    if link.user_id is null then
      select vault.create_secret((p_data->'tokens')::text) into secret;
      insert into lifecase_private.connections (user_id, provider, secret_id, account_id, email)
        values (p_owner, p_provider, secret, p_data->>'account', p_data->>'email');
    else
      perform vault.update_secret(link.secret_id, (p_data->'tokens')::text);
      update lifecase_private.connections set account_id = p_data->>'account', email = p_data->>'email',
        revision = gen_random_uuid() where user_id = p_owner and provider = p_provider;
    end if;
    return 'true'::jsonb;
  end if;
  raise exception 'Unknown LifeCase operation' using errcode = '22023';
end;
$$;

create table public.lifecase_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.lifecase_push_devices enable row level security;
revoke all on public.lifecase_push_devices from public, anon, authenticated;
grant select, insert, update, delete on public.lifecase_push_devices to service_role;

create table public.lifecase_push_sent (
  device_id uuid not null references public.lifecase_push_devices(id) on delete cascade,
  record_id uuid not null references public.lifecase_records(id) on delete cascade,
  expiry date not null,
  sent_at timestamptz not null default now(),
  primary key (device_id, record_id, expiry)
);
alter table public.lifecase_push_sent enable row level security;
revoke all on public.lifecase_push_sent from public, anon, authenticated;
grant select, insert, update, delete on public.lifecase_push_sent to service_role;

create function lifecase_private.push_keys(p_keys jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_keys is not null then perform pg_advisory_xact_lock(hashtextextended('lifecase-push-vapid',0)); end if;
  select decrypted_secret::jsonb into result from vault.decrypted_secrets where name = 'lifecase_push_vapid';
  if result is null and p_keys is not null then
    if (p_keys->>'publicKey') !~ '^[a-zA-Z0-9_-]{87}$' or (p_keys->>'privateKey') !~ '^[a-zA-Z0-9_-]{43}$' then
      raise exception 'Invalid LifeCase push keys';
    end if;
    perform vault.create_secret(p_keys::text, 'lifecase_push_vapid');
    result := p_keys;
  end if;
  return result;
end;
$$;
revoke all on function lifecase_private.push_keys(jsonb) from public, anon, authenticated;
grant execute on function lifecase_private.push_keys(jsonb) to service_role;

create function public.lifecase_push_keys(p_keys jsonb default null) returns jsonb
language sql security invoker set search_path = '' as $$
  select lifecase_private.push_keys(p_keys);
$$;
revoke all on function public.lifecase_push_keys(jsonb) from public, anon, authenticated;
grant execute on function public.lifecase_push_keys(jsonb) to service_role;

create function lifecase_private.due_push() returns table (
  device_id uuid, endpoint text, p256dh text, auth text, record_id uuid, expiry date
) language sql stable security definer set search_path = '' as $$
  with day as (select (now() at time zone 'Europe/Zurich')::date as today)
  select d.id, d.endpoint, d.p256dh, d.auth, r.id, until_date.expiry
  from public.lifecase_push_devices d
  join public.lifecase_records r on r.user_id = d.user_id
  cross join day
  cross join lateral (values (coalesce(nullif(r.fields->>'validUntil',''),r.fields->>'Gültig bis'))) as field(value)
  cross join lateral (values (case when field.value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' and pg_input_is_valid(field.value,'date')
      then field.value::date else null end)) as until_date(expiry)
  where r.archived_at is null and r.section in ('Arztzeugnisse','Rezepte')
    and coalesce(r.fields->>'expiryReminder','month') <> 'off'
    and until_date.expiry >= day.today and (until_date.expiry - interval '1 month')::date <= day.today
    and not exists (select 1 from public.lifecase_push_sent s where s.device_id = d.id and s.record_id = r.id and s.expiry = until_date.expiry)
  order by until_date.expiry, d.id, r.id limit 200;
$$;
revoke all on function lifecase_private.due_push() from public, anon, authenticated;
grant execute on function lifecase_private.due_push() to service_role;

create function public.lifecase_due_push() returns table (
  device_id uuid, endpoint text, p256dh text, auth text, record_id uuid, expiry date
) language sql stable security invoker set search_path = '' as $$
  select * from lifecase_private.due_push();
$$;
revoke all on function public.lifecase_due_push() from public, anon, authenticated;
grant execute on function public.lifecase_due_push() to service_role;

create or replace function lifecase_private.schedule_mail_poll() returns void language plpgsql security definer set search_path = '' as $$
declare
  local_hour int := extract(hour from clock_timestamp() at time zone 'Europe/Zurich');
  job_headers jsonb;
begin
  if local_hour not in (8,12,16,20) then return; end if;
  job_headers := jsonb_build_object('Content-Type','application/json','X-LifeCase-Job',
    (select decrypted_secret from vault.decrypted_secrets where name = 'lifecase_mail_job_token'));
  if exists (select 1 from public.lifecase_mail_rules r join lifecase_private.connections c using(user_id)
             where r.enabled and c.provider in ('google','microsoft')) then
    perform net.http_post(url := 'https://gmulchykvjxkbpcfnspg.supabase.co/functions/v1/lifecase-connect/poll-mail',
      headers := job_headers, body := '{}'::jsonb, timeout_milliseconds := 120000);
  end if;
  if local_hour = 8 then
    delete from public.lifecase_mail_seen where checked_at < clock_timestamp() - interval '45 days';
    if exists (select 1 from public.lifecase_push_devices) then
      perform net.http_post(url := 'https://gmulchykvjxkbpcfnspg.supabase.co/functions/v1/lifecase-connect/push-reminders',
        headers := job_headers, body := '{}'::jsonb, timeout_milliseconds := 75000);
    end if;
  end if;
end;
$$;

select cron.unschedule('lifecase-mail-zurich-08-14-20');
select cron.schedule('lifecase-zurich-08-12-16-20', '0 6,7,10,11,14,15,18,19 * * *', 'select lifecase_private.schedule_mail_poll()');
