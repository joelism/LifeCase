create unique index lifecase_chronicle_chat_intake_key
  on public.lifecase_records (user_id, (fields->>'intakeKey'))
  where section = 'Chronik' and fields->>'intakeSource' = 'LifeCase-Assistent'
    and nullif(fields->>'intakeKey', '') is not null;
