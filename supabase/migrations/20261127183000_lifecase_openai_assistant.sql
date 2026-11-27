create table lifecase_internal.assistant_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null
);

-- The verified app owner is configured alongside the Sites service credential in Vault.
create function public.lifecase_assistant_access(p_owner uuid, p_charge boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  service_token text;
  used_count integer;
  hour_start timestamptz := date_trunc('hour', clock_timestamp());
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'lifecase_openai_owner' and trim(decrypted_secret) = p_owner::text
  ) then
    return jsonb_build_object('available', false);
  end if;
  if not p_charge then
    return jsonb_build_object('available', exists (
      select 1 from vault.secrets where name = 'lifecase_studio_service'
    ));
  end if;

  select trim(decrypted_secret) into service_token
    from vault.decrypted_secrets where name = 'lifecase_studio_service';
  if coalesce(service_token, '') = '' then
    return jsonb_build_object('available', false);
  end if;

  insert into lifecase_internal.assistant_usage as usage (user_id, window_start, requests)
    values (p_owner, hour_start, 1)
    on conflict (user_id) do update
      set window_start = excluded.window_start,
          requests = case when usage.window_start = excluded.window_start then usage.requests + 1 else 1 end
      where usage.window_start < excluded.window_start or
        (usage.window_start = excluded.window_start and usage.requests < 60)
    returning requests into used_count;
  if used_count is null then
    return jsonb_build_object('available', true, 'limited', true);
  end if;
  return jsonb_build_object('available', true, 'service_token', service_token);
end;
$$;

revoke all on function public.lifecase_assistant_access(uuid, boolean) from public, anon, authenticated;
grant execute on function public.lifecase_assistant_access(uuid, boolean) to service_role;
