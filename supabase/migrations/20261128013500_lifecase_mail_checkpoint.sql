-- Only the service role can write runs; each owner can see their own sync status.
alter table public.lifecase_mail_runs add column if not exists checkpoint jsonb;
