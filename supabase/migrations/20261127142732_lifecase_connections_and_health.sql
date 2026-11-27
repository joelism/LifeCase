create table public.lifecase_health_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null check (day between date '1900-01-01' and date '2200-01-01'),
  metric text not null,
  value numeric(10,2) not null,
  source text not null check (source in ('export', 'healthkit')),
  source_name text not null check (length(source_name) between 1 and 120),
  primary key (user_id, day, metric, source),
  check (value >= 0 and value <= case metric
    when 'steps' then 250000 when 'sleep' then 24 when 'weight' then 1000
    when 'exercise' then 1440 when 'resting' then 400 else -1 end)
);
alter table public.lifecase_health_days enable row level security;
revoke all on public.lifecase_health_days from public, anon, authenticated;
grant select, insert, update, delete on public.lifecase_health_days to authenticated;
create policy lifecase_health_owner on public.lifecase_health_days for all to authenticated
using (user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2')
with check (user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

create unique index lifecase_one_mail_per_dossier on public.lifecase_records (user_id, (fields->>'externalKey'))
where section = 'Beweismittel' and fields ? 'externalKey';

create table public.lifecase_oauth_pending (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  state_hash text unique not null check (length(state_hash) = 64),
  verifier text not null,
  app_url text not null,
  expires_at timestamptz not null,
  primary key (user_id, provider)
);
alter table public.lifecase_oauth_pending enable row level security;
revoke all on public.lifecase_oauth_pending from public, anon, authenticated;
grant select, insert, update, delete on public.lifecase_oauth_pending to service_role;

create schema lifecase_private;
revoke all on schema lifecase_private from public, anon, authenticated;
grant usage on schema lifecase_private to service_role;

create table lifecase_private.connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  secret_id uuid not null,
  account_id text not null,
  email text not null,
  revision uuid not null default gen_random_uuid(),
  primary key (user_id, provider)
);
alter table lifecase_private.connections enable row level security;

create function lifecase_private.remove_connection_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
revoke all on function lifecase_private.remove_connection_secret() from public, anon, authenticated;
create trigger lifecase_remove_oauth_secret after delete on lifecase_private.connections
for each row execute function lifecase_private.remove_connection_secret();

create function lifecase_private.connection_vault(p_action text, p_owner uuid, p_provider text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prefix text := 'lifecase_' || p_provider;
  config jsonb;
  link lifecase_private.connections%rowtype;
  secret uuid;
begin
  if p_owner is null or p_provider is null or p_provider not in ('google', 'microsoft') then
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
revoke all on function lifecase_private.connection_vault(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function lifecase_private.connection_vault(text, uuid, text, jsonb) to service_role;

create function public.lifecase_connection_vault(p_action text, p_owner uuid, p_provider text, p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select lifecase_private.connection_vault(p_action, p_owner, p_provider, p_data);
$$;
revoke all on function public.lifecase_connection_vault(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.lifecase_connection_vault(text, uuid, text, jsonb) to service_role;
