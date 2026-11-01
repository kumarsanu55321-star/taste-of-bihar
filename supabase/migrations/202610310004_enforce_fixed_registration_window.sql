-- Enforce the published Parivartan 2K26 registration window in PostgreSQL.
-- Apply after 202610310002_contest_registration_and_draw.sql.
-- This replaces existing RPC bodies only; it does not drop data or objects.

begin;

create or replace function public.contest_get_status()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with campaign_clock as (
    select pg_catalog.clock_timestamp() as value
  )
  select pg_catalog.jsonb_build_object(
    'server_time', campaign_clock.value,
    'registration_state', case
      when s.registration_state = 'closed'
        or campaign_clock.value >= '2026-11-04 18:00:00+05:30'::timestamptz then 'closed'
      when campaign_clock.value < '2026-11-02 12:00:00+05:30'::timestamptz then 'setup'
      else 'open'
    end,
    'registration_deadline_passed', campaign_clock.value >= '2026-11-04 18:00:00+05:30'::timestamptz,
    'registration_opened_at', '2026-11-02 12:00:00+05:30'::timestamptz,
    'registration_closed_at', s.registration_closed_at,
    'registration_deadline', '2026-11-04 18:00:00+05:30'::timestamptz,
    'sponsor_confirmed', s.sponsor_confirmed,
    'sponsor', case when s.sponsor_confirmed then pg_catalog.jsonb_build_object(
      'name', s.sponsor_name,
      'image_url', s.sponsor_image_url,
      'website', s.sponsor_website,
      'description', s.sponsor_description,
      'offer_message', s.sponsor_offer_message,
      'terms', s.sponsor_terms
    ) else null end
  )
  from public.contest_settings as s
  cross join campaign_clock
  where s.singleton;
$$;

create or replace function public.contest_register(
  p_display_name text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_registration public.contest_registrations%rowtype;
  v_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_state text;
  v_now timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'google_authentication_required';
  end if;
  if p_confirm is distinct from true then
    raise exception using errcode = '22023', message = 'explicit_registration_confirmation_required';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 40
     or v_name !~ '^[[:alnum:] .''-]+$' then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;

  select * into v_user
  from auth.users
  where id = (select auth.uid());

  if not found
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_user.email, ''))) !~ '^[^@[:space:]]+@gmail[.]com$'
     or v_user.email_confirmed_at is null
     or not (
       pg_catalog.lower(coalesce(v_user.raw_app_meta_data ->> 'provider', '')) = 'google'
       or coalesce(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
     ) then
    raise exception using errcode = '28000', message = 'gmail_google_account_required';
  end if;

  -- Return this authenticated user's existing row before applying the time window,
  -- so an already registered participant gets a stable result after closing.
  select * into v_registration
  from public.contest_registrations
  where participant_id = (select auth.uid());
  if found then
    return pg_catalog.jsonb_build_object(
      'registered', true,
      'already_registered', true,
      'id', v_registration.id,
      'display_name', v_registration.display_name,
      'registered_at', v_registration.registered_at
    );
  end if;

  select registration_state into v_state
  from public.contest_settings
  where singleton
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_state = 'closed' then
    raise exception using errcode = 'P0001', message = 'contest_registration_closed';
  end if;
  if v_now < '2026-11-02 12:00:00+05:30'::timestamptz then
    raise exception using errcode = 'P0001', message = 'contest_registration_not_started';
  end if;
  if v_now >= '2026-11-04 18:00:00+05:30'::timestamptz then
    raise exception using errcode = 'P0001', message = 'contest_registration_closed';
  end if;

  insert into public.contest_registrations(participant_id, display_name)
  values ((select auth.uid()), v_name)
  on conflict (participant_id) do nothing
  returning * into v_registration;

  if not found then
    select * into v_registration
    from public.contest_registrations
    where participant_id = (select auth.uid());
    return pg_catalog.jsonb_build_object(
      'registered', true,
      'already_registered', true,
      'id', v_registration.id,
      'display_name', v_registration.display_name,
      'registered_at', v_registration.registered_at
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'registered', true,
    'already_registered', false,
    'id', v_registration.id,
    'display_name', v_registration.display_name,
    'registered_at', v_registration.registered_at
  );
end;
$$;

alter table public.contest_registrations
  alter column registered_at set default current_timestamp;

revoke all on function public.contest_get_status() from public, anon, authenticated;
revoke all on function public.contest_register(text, boolean) from public, anon, authenticated;
grant execute on function public.contest_get_status() to anon, authenticated;
grant execute on function public.contest_register(text, boolean) to authenticated;

commit;
