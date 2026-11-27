create table public.lifecase_records (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, section text not null, fields jsonb not null default '{}', created_at timestamptz not null default now());

alter table public.lifecase_records enable row level security;

revoke all on public.lifecase_records from anon, public;

grant select,insert,update,delete on public.lifecase_records to authenticated;

create policy lifecase_owner on public.lifecase_records for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create index lifecase_owner_idx on public.lifecase_records(user_id);

insert into storage.buckets(id,name,public) values ('lifecase-private','lifecase-private',false);

create policy lifecase_file_read on storage.objects for select to authenticated using (bucket_id='lifecase-private' and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy lifecase_file_insert on storage.objects for insert to authenticated with check (bucket_id='lifecase-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
