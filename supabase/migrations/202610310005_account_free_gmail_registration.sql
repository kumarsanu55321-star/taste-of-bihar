-- Switch public contest entries from Auth identity to direct Gmail entry.
-- This additive migration preserves Auth users, historical records, and unrelated objects.
-- Review live schema and dependencies before applying. Nothing is run remotely here.

begin;

do $migration$
begin
  if to_regclass('public.contest_registrations') is null then
    create table public.contest_registrations (
      id bigint generated always as identity primary key,
      participant_id uuid unique references auth.users(id) on delete set null,
      display_name text not null,
      registered_at timestamptz not null default clock_timestamp(),
      gmail_address text
    );
  else
    alter table public.contest_registrations add column if not exists gmail_address text;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'contest_registrations'
        and column_name = 'participant_id'
    ) then
      alter table public.contest_registrations alter column participant_id drop not null;
    end if;
  end if;
end;
$migration$;

-- Preserve previous valid registrations by copying their verified Google Gmail.
do $backfill$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contest_registrations'
      and column_name = 'participant_id'
  ) then
    update public.contest_registrations r
    set gmail_address = lower(btrim(u.email))
    from auth.users u
    where u.id = r.participant_id
      and r.gmail_address is null
      and u.email_confirmed_at is not null
      and (
        lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'google'
        or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
      and lower(btrim(coalesce(u.email, ''))) ~ '^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9]+([.-][a-z0-9]+)*)?@gmail[.]com$';
  end if;
end;
$backfill$;

alter table public.contest_registrations
  alter column registered_at set default clock_timestamp();

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contest_registrations'::regclass
      and conname = 'contest_registrations_gmail_format'
  ) then
    alter table public.contest_registrations
      add constraint contest_registrations_gmail_format
      check (
        gmail_address is null
        or (gmail_address = lower(btrim(gmail_address))
          and pg_catalog.char_length(pg_catalog.split_part(gmail_address, '@', 1)) <= 64
          and gmail_address ~ '^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9]+([.-][a-z0-9]+)*)?@gmail[.]com$')
      );
  end if;
end;
$constraint$;

create unique index if not exists contest_registrations_gmail_normalized_uidx
  on public.contest_registrations (
    lower(replace(split_part(split_part(gmail_address, '@', 1), '+', 1), '.', '') || '@gmail.com')
  )
  where gmail_address is not null;

alter table public.contest_registrations enable row level security;
revoke all on public.contest_registrations from public, anon, authenticated;
revoke all on sequence public.contest_registrations_id_seq from public, anon, authenticated;

create or replace function public.contest_get_status()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  with campaign_clock as (
    select pg_catalog.clock_timestamp() as current_time
  )
  select pg_catalog.jsonb_build_object(
    'server_time', campaign_clock.current_time,
    'registration_state', case
      when campaign_clock.current_time < '2026-11-02 12:00:00+05:30'::timestamptz then 'setup'
      when campaign_clock.current_time < '2026-11-04 18:00:00+05:30'::timestamptz then 'open'
      else 'closed'
    end,
    'registration_opened_at', '2026-11-02 12:00:00+05:30'::timestamptz,
    'registration_deadline', '2026-11-04 18:00:00+05:30'::timestamptz,
    'registration_deadline_passed',
      campaign_clock.current_time >= '2026-11-04 18:00:00+05:30'::timestamptz
  )
  from campaign_clock;
$function$;

create or replace function public.contest_register(
  p_display_name text,
  p_gmail text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_gmail text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_gmail, '')));
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_registration public.contest_registrations%rowtype;
begin
  if p_confirm is distinct from true then
    raise exception using errcode = '22023', message = 'registration_confirmation_required';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 40
     or v_name !~ '^[[:alnum:] .''-]+$' then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;
  if pg_catalog.char_length(v_gmail) > 254
     or pg_catalog.char_length(pg_catalog.split_part(v_gmail, '@', 1)) > 64
     or v_gmail !~ '^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9]+([.-][a-z0-9]+)*)?@gmail[.]com$' then
    raise exception using errcode = '22023', message = 'invalid_gmail';
  end if;
  if v_now < '2026-11-02 12:00:00+05:30'::timestamptz then
    raise exception using errcode = 'P0001', message = 'contest_registration_not_started';
  end if;
  if v_now >= '2026-11-04 18:00:00+05:30'::timestamptz then
    raise exception using errcode = 'P0001', message = 'contest_registration_closed';
  end if;

  insert into public.contest_registrations (participant_id, display_name, gmail_address)
  values (null, v_name, v_gmail)
  on conflict (
    (lower(replace(split_part(split_part(gmail_address, '@', 1), '+', 1), '.', '') || '@gmail.com'))
  )
  where gmail_address is not null
  do nothing
  returning * into v_registration;

  if not found then
    -- Keep the response identical so the anonymous RPC cannot be used to
    -- enumerate whether a particular Gmail address is already present.
    return pg_catalog.jsonb_build_object('registered', true);
  end if;

  return pg_catalog.jsonb_build_object('registered', true);
end;
$function$;

-- Disable Auth-based access paths and obsolete admin/draw RPC access. Retain
-- their objects and data for separately reviewed cleanup.
do $revoke_legacy$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.contest_register(text,boolean)',
    'public.contest_get_my_registration()',
    'public.contest_get_winners()'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      execute pg_catalog.format(
        'revoke all on function %s from public, anon, authenticated',
        pg_catalog.to_regprocedure(v_signature)
      );
    end if;
  end loop;
end;
$revoke_legacy$;

do $revoke_admin$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_get_contest_dashboard()',
    'public.admin_list_contest_registrations(text,integer,integer)',
    'public.admin_set_contest_registration_deadline(timestamp with time zone)',
    'public.admin_set_contest_registration_open(boolean)',
    'public.admin_update_contest_sponsor(jsonb)',
    'public.admin_draw_contest_winners()',
    'public.admin_publish_contest_winners()',
    'public.admin_mark_winner_collected(bigint)',
    'public.admin_get_dashboard()',
    'public.admin_update_sponsor_settings(jsonb)',
    'public.admin_set_campaign_state(boolean,boolean)',
    'public.admin_set_restaurant_owner(text,boolean)',
    'public.owner_get_dashboard()',
    'public.owner_validate_coupon(text)',
    'public.owner_redeem_coupon(text)',
    'public.spin_once(text)',
    'public.get_my_spin()',
    'public.get_public_winners()',
    'public.get_campaign_public_settings()'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      execute pg_catalog.format(
        'revoke all on function %s from public, anon, authenticated',
        pg_catalog.to_regprocedure(v_signature)
      );
    end if;
  end loop;
end;
$revoke_admin$;

do $revoke_legacy_tables$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.campaign_control',
    'public.spin_results',
    'public.reward_coupons',
    'public.spin_attempts',
    'public.campaign_admin_allowlist',
    'public.restaurant_owner_allowlist',
    'public.campaign_admin_audit',
    'public.redemption_audit'
  ] loop
    if pg_catalog.to_regclass(v_table) is not null then
      execute pg_catalog.format(
        'revoke all on table %s from public, anon, authenticated',
        pg_catalog.to_regclass(v_table)
      );
    end if;
  end loop;
end;
$revoke_legacy_tables$;

revoke all on function public.contest_get_status() from public, anon, authenticated;
revoke all on function public.contest_register(text, text, boolean) from public, anon, authenticated;
grant execute on function public.contest_get_status() to anon;
grant execute on function public.contest_register(text, text, boolean) to anon;

commit;
