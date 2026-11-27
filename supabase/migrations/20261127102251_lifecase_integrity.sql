begin;

alter table public.lifecase_records
  add column updated_at timestamptz not null default now(),
  add column revision integer not null default 1,
  add column archived_at timestamptz,
  add constraint lifecase_records_owner_id unique (user_id, id);
alter table public.lifecase_records
  add constraint lifecase_fields_object check (jsonb_typeof(fields) = 'object') not valid,
  add constraint lifecase_section_length check (char_length(section) between 1 and 50) not valid;
create index lifecase_records_owner_active on public.lifecase_records(user_id, created_at desc, id);
alter table public.lifecase_records enable row level security;
revoke all on public.lifecase_records from public, anon, authenticated;
grant select on public.lifecase_records to authenticated;
grant insert (section, fields) on public.lifecase_records to authenticated;
grant update (fields, archived_at) on public.lifecase_records to authenticated;
create policy lifecase_verified_session on public.lifecase_records as restrictive
  for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false')
  with check ((select auth.jwt()->>'aal') = 'aal2' and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');

create table public.lifecase_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  revision integer not null,
  changed_at timestamptz not null default clock_timestamp(),
  action text not null check (action in ('created','updated','archived','restored','file_added')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  foreign key (user_id, record_id) references public.lifecase_records(user_id,id) on delete cascade
);
create index lifecase_history_record on public.lifecase_history(user_id, record_id, id desc);
alter table public.lifecase_history enable row level security;
revoke all on public.lifecase_history from public, anon, authenticated;
grant select on public.lifecase_history to authenticated;
create policy lifecase_history_read on public.lifecase_history for select to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

create table public.lifecase_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  record_id uuid not null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 0 and 26214400),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  path text generated always as (user_id::text || '/' || id::text || '/original') stored,
  reserved_at timestamptz not null default now(),
  uploaded_at timestamptz,
  foreign key (user_id, record_id) references public.lifecase_records(user_id,id) on delete cascade
);
create index lifecase_files_record on public.lifecase_files(user_id, record_id);
create unique index lifecase_files_path on public.lifecase_files(path);
alter table public.lifecase_files enable row level security;
revoke all on public.lifecase_files from public, anon, authenticated;
grant select on public.lifecase_files to authenticated;
grant insert (id, record_id, original_name, size_bytes, mime_type, sha256) on public.lifecase_files to authenticated;
grant update (uploaded_at) on public.lifecase_files to authenticated;

create policy lifecase_files_owner on public.lifecase_files for all to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2')
  with check ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

-- Reserve the metadata first, then upload the original once. The legacy read policy
-- also keeps pre-existing LifeCase originals accessible to their owner.
create policy lifecase_storage_verified on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'lifecase-private' or (
    (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt()->>'aal') = 'aal2'
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false'))
  with check (bucket_id <> 'lifecase-private' or (
    (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt()->>'aal') = 'aal2'
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false'));
update storage.buckets set file_size_limit = least(coalesce(file_size_limit,26214400),26214400)
  where id = 'lifecase-private' and not public;
alter policy lifecase_file_insert on storage.objects
  with check (bucket_id = 'lifecase-private' and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.lifecase_files f where f.path = name and f.uploaded_at is null));

-- These restrictive policies only affect LifeCase and continue to protect originals
-- if another feature later introduces a general storage write policy.
create policy lifecase_original_no_update on storage.objects as restrictive for update to public
  using (bucket_id <> 'lifecase-private') with check (bucket_id <> 'lifecase-private');
create policy lifecase_original_no_delete on storage.objects as restrictive for delete to public
  using (bucket_id <> 'lifecase-private');
create policy lifecase_storage_no_anon on storage.objects as restrictive for all to anon
  using (bucket_id <> 'lifecase-private') with check (bucket_id <> 'lifecase-private');

create schema if not exists lifecase_internal;
revoke all on schema lifecase_internal from public, anon, authenticated;

create function lifecase_internal.stamp_record() returns trigger
language plpgsql set search_path = '' as $$
declare link_id uuid;
declare link_kind text;
declare name text;
begin
  foreach name in array array['caseIds','personIds','documentIds','relatedIds'] loop
    if new.fields ? name then
      if jsonb_typeof(new.fields->name) <> 'array' or jsonb_array_length(new.fields->name) > 100 then
        raise exception 'Invalid LifeCase links';
      end if;
      for link_id in select value::uuid from jsonb_array_elements_text(new.fields->name) loop
        select section into link_kind from public.lifecase_records
          where id = link_id and user_id = new.user_id and id <> new.id;
        if link_kind is null or (name = 'caseIds' and link_kind <> 'Fälle')
          or (name = 'personIds' and link_kind <> 'Personen')
          or (name = 'documentIds' and link_kind not in ('Dokumente','Beweismittel')) then
          raise exception 'Invalid LifeCase link';
        end if;
      end loop;
    end if;
  end loop;
  if new.fields ? 'Dateipfad' and
    (tg_op = 'INSERT' or old.fields->'Dateipfad' is distinct from new.fields->'Dateipfad'
      or old.fields->'Dateiname' is distinct from new.fields->'Dateiname'
      or old.fields->'SHA256' is distinct from new.fields->'SHA256') then
    raise exception 'Legacy file data is immutable';
  end if;
  if tg_op = 'UPDATE' then
    if old.fields ? 'Dateipfad' and not new.fields ? 'Dateipfad' then
      raise exception 'Legacy file data is immutable';
    end if;
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
    if old.archived_at is distinct from new.archived_at and new.archived_at is not null then
      new.archived_at := new.updated_at;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function lifecase_internal.stamp_record() from public, anon, authenticated;
create trigger lifecase_stamp before insert or update on public.lifecase_records
  for each row execute function lifecase_internal.stamp_record();

create function lifecase_internal.audit_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare operation text;
declare previous jsonb;
begin
  if auth.uid() is distinct from new.user_id then
    raise exception 'Invalid LifeCase owner';
  end if;
  if tg_op = 'INSERT' then
    operation := 'created';
  else
    previous := to_jsonb(old) - 'user_id';
    operation := case
      when old.archived_at is null and new.archived_at is not null then 'archived'
      when old.archived_at is not null and new.archived_at is null then 'restored'
      else 'updated'
    end;
  end if;
  insert into public.lifecase_history(user_id,record_id,revision,action,before_snapshot,after_snapshot)
    values (new.user_id,new.id,new.revision,operation,previous,to_jsonb(new) - 'user_id');
  return new;
end;
$$;
revoke all on function lifecase_internal.audit_record() from public, anon, authenticated;
create trigger lifecase_audit after insert or update on public.lifecase_records
  for each row execute function lifecase_internal.audit_record();

create function lifecase_internal.finalize_file() returns trigger
language plpgsql set search_path = '' as $$
declare object_size text;
begin
  if auth.uid() is distinct from old.user_id then
    raise exception 'Invalid LifeCase owner';
  end if;
  if old.uploaded_at is not null or new.uploaded_at is null then
    raise exception 'LifeCase original files are immutable';
  end if;
  select o.metadata->>'size' into object_size from storage.objects o
    where o.bucket_id = 'lifecase-private' and o.name = old.path;
  if object_size is null or object_size::bigint <> old.size_bytes then
    raise exception 'LifeCase original file is missing or has a different size';
  end if;
  new.uploaded_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function lifecase_internal.finalize_file() from public, anon, authenticated;
create trigger lifecase_finalize before update on public.lifecase_files
  for each row execute function lifecase_internal.finalize_file();

create function lifecase_internal.audit_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from new.user_id then
    raise exception 'Invalid LifeCase owner';
  end if;
  insert into public.lifecase_history(user_id,record_id,revision,action,after_snapshot)
    select new.user_id,new.record_id,r.revision,'file_added',to_jsonb(new) - 'user_id'
    from public.lifecase_records r where r.id = new.record_id and r.user_id = new.user_id;
  return new;
end;
$$;
revoke all on function lifecase_internal.audit_file() from public, anon, authenticated;
create trigger lifecase_file_audit after update on public.lifecase_files
  for each row execute function lifecase_internal.audit_file();

commit;
