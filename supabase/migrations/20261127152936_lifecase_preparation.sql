create unique index lifecase_one_preparation_per_event
  on public.lifecase_records (user_id, (fields ->> 'subjectKey'))
  where section = 'Vorbereitung' and nullif(fields ->> 'subjectKey', '') is not null;
