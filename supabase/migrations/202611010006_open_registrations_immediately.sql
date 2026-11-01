-- Open Parivartan 2K26 registrations immediately while retaining the existing
-- server-enforced closing deadline of 4 November 2026 at 6:00 PM Asia/Kolkata.
-- Apply after 202610310005_account_free_gmail_registration.sql.

begin;

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
      when campaign_clock.current_time < '2026-11-04 18:00:00+05:30'::timestamptz then 'open'
      else 'closed'
    end,
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
  v_now timestamptz;
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

  -- Read the database clock immediately before the write and enforce the
  -- closing boundary using the same absolute IST instant as the status RPC.
  v_now := pg_catalog.clock_timestamp();
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

-- Preserve the existing public status and account-free registration access.
revoke all on function public.contest_get_status() from public, anon, authenticated;
revoke all on function public.contest_register(text, text, boolean) from public, anon, authenticated;
grant execute on function public.contest_get_status() to anon;
grant execute on function public.contest_register(text, text, boolean) to anon;

commit;
