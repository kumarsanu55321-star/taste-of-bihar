-- Stage 2: add the Gmail Google-authenticated contest alongside the legacy
-- Lucky Spin schema. Legacy campaign objects are intentionally not dropped.

-- Keep this campaign's administrator allowlist restricted to the one approved
-- Google account before any of the new administrative RPCs can be used.
delete from public.campaign_admin_allowlist
where email <> 'littichokha2k26.45@gmail.com';
insert into public.campaign_admin_allowlist(email)
values ('littichokha2k26.45@gmail.com')
on conflict (email) do nothing;

create table public.contest_settings (
  singleton boolean primary key default true check (singleton),
  registration_state text not null default 'setup'
    check (registration_state in ('setup', 'open', 'closed')),
  registration_opened_at timestamptz,
  registration_closed_at timestamptz,
  registration_deadline timestamptz,
  sponsor_confirmed boolean not null default false,
  sponsor_confirmed_at timestamptz,
  sponsor_confirmed_by uuid references auth.users(id) on delete restrict,
  sponsor_name text,
  sponsor_image_url text,
  sponsor_website text,
  sponsor_description text,
  sponsor_offer_message text,
  sponsor_terms text,
  updated_at timestamptz not null default now(),
  check ((registration_state = 'closed') = (registration_closed_at is not null)),
  check ((sponsor_confirmed_at is not null) = sponsor_confirmed),
  check ((sponsor_confirmed_by is not null) = sponsor_confirmed)
);

insert into public.contest_settings(singleton) values (true);

create table public.contest_registrations (
  id bigint generated always as identity primary key,
  participant_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40)
    check (display_name ~ '^[[:alnum:] .''-]+$'),
  registered_at timestamptz not null default clock_timestamp()
);
create index contest_registrations_registered_idx
  on public.contest_registrations(registered_at, id);

create table public.contest_draws (
  singleton boolean primary key default true check (singleton),
  id uuid not null unique default extensions.gen_random_uuid(),
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  participant_count integer not null check (participant_count >= 5)
);

create table public.contest_draw_winners (
  draw_id uuid not null references public.contest_draws(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  registration_id bigint not null unique references public.contest_registrations(id) on delete restrict,
  collected boolean not null default false,
  collected_at timestamptz,
  collected_by uuid references auth.users(id) on delete restrict,
  check ((collected_at is not null) = collected),
  check (collected_by is null or collected),
  primary key (draw_id, position)
);

create table public.contest_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('registration_opened', 'registration_closed', 'registration_deadline_updated', 'sponsor_updated', 'winners_drawn', 'winners_published', 'winner_prize_collected')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index contest_admin_audit_created_idx
  on public.contest_admin_audit(created_at desc);

alter table public.contest_settings enable row level security;
alter table public.contest_registrations enable row level security;
alter table public.contest_draws enable row level security;
alter table public.contest_draw_winners enable row level security;
alter table public.contest_admin_audit enable row level security;

revoke all on public.contest_settings, public.contest_registrations,
  public.contest_draws, public.contest_draw_winners, public.contest_admin_audit
  from public, anon, authenticated;
revoke all on sequence public.contest_registrations_id_seq,
  public.contest_admin_audit_id_seq from public, anon, authenticated;

create or replace function public.contest_get_status()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_state', case
      when s.registration_state = 'open'
       and s.registration_deadline is not null
       and clock_timestamp() >= s.registration_deadline then 'closed'
      else s.registration_state
    end,
    'registration_deadline_passed',
      s.registration_deadline is not null and clock_timestamp() >= s.registration_deadline,
    'registration_opened_at', s.registration_opened_at,
    'registration_closed_at', s.registration_closed_at,
    'registration_deadline', s.registration_deadline,
    'sponsor_confirmed', s.sponsor_confirmed,
    'sponsor', case when s.sponsor_confirmed then jsonb_build_object(
      'name', s.sponsor_name,
      'image_url', s.sponsor_image_url,
      'website', s.sponsor_website,
      'description', s.sponsor_description,
      'offer_message', s.sponsor_offer_message,
      'terms', s.sponsor_terms
    ) else null end
  )
  from public.contest_settings s
  where s.singleton;
$$;

create or replace function public.contest_get_winners()
returns table(display_name text, position smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.display_name, w.position
  from public.contest_draw_winners w
  join public.contest_registrations r on r.id = w.registration_id
  join public.contest_draws d on d.id = w.draw_id
  where d.singleton and d.published_at is not null
  order by w.position;
$$;

create or replace function public.contest_get_my_registration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_registration public.contest_registrations%rowtype;
begin
  select * into v_user from auth.users where id = (select auth.uid());
  if not found
     or lower(btrim(coalesce(v_user.email, ''))) !~ '^[^@[:space:]]+@gmail[.]com$'
     or v_user.email_confirmed_at is null
     or not (
    lower(coalesce(v_user.raw_app_meta_data ->> 'provider', '')) = 'google'
    or coalesce(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
  ) then
    raise exception using errcode = '28000', message = 'google_authentication_required';
  end if;

  select * into v_registration
  from public.contest_registrations
  where participant_id = (select auth.uid());

  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_registration.id,
    'display_name', v_registration.display_name,
    'registered_at', v_registration.registered_at
  );
end;
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
  v_name text := btrim(coalesce(p_display_name, ''));
  v_state text;
  v_deadline timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'google_authentication_required';
  end if;
  if p_confirm is distinct from true then
    raise exception using errcode = '22023', message = 'explicit_registration_confirmation_required';
  end if;
  if char_length(v_name) not between 1 and 40 or v_name !~ '^[[:alnum:] .''-]+$' then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;

  select * into v_user from auth.users where id = (select auth.uid());
  if not found
     or lower(btrim(coalesce(v_user.email, ''))) !~ '^[^@[:space:]]+@gmail[.]com$'
     or v_user.email_confirmed_at is null
     or not (
       lower(coalesce(v_user.raw_app_meta_data ->> 'provider', '')) = 'google'
       or coalesce(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
     ) then
    raise exception using errcode = '28000', message = 'gmail_google_account_required';
  end if;

  select registration_state, registration_deadline into v_state, v_deadline
  from public.contest_settings where singleton for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;

  select * into v_registration
  from public.contest_registrations
  where participant_id = (select auth.uid());
  if found then
    return jsonb_build_object(
      'registered', true,
      'already_registered', true,
      'id', v_registration.id,
      'display_name', v_registration.display_name,
      'registered_at', v_registration.registered_at
    );
  end if;
  if v_state <> 'open' then
    raise exception using errcode = 'P0001', message = 'contest_registration_closed';
  end if;
  if v_deadline is not null and clock_timestamp() >= v_deadline then
    raise exception using errcode = 'P0001', message = 'contest_registration_deadline_passed';
  end if;

  insert into public.contest_registrations(participant_id, display_name)
  values ((select auth.uid()), v_name)
  returning * into v_registration;

  return jsonb_build_object(
    'registered', true,
    'already_registered', false,
    'id', v_registration.id,
    'display_name', v_registration.display_name,
    'registered_at', v_registration.registered_at
  );
end;
$$;

create or replace function public.admin_get_contest_dashboard()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings public.contest_settings%rowtype;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  select * into v_settings from public.contest_settings where singleton;
  return jsonb_build_object(
    'registration_state', v_settings.registration_state,
    'registration_opened_at', v_settings.registration_opened_at,
    'registration_closed_at', v_settings.registration_closed_at,
    'registration_deadline', v_settings.registration_deadline,
    'registration_deadline_expired',
      v_settings.registration_deadline is not null and clock_timestamp() >= v_settings.registration_deadline,
    'registration_count', (select count(*) from public.contest_registrations),
    'sponsor_confirmed', v_settings.sponsor_confirmed,
    'sponsor_confirmed_at', v_settings.sponsor_confirmed_at,
    'sponsor', jsonb_build_object(
      'name', v_settings.sponsor_name,
      'image_url', v_settings.sponsor_image_url,
      'website', v_settings.sponsor_website,
      'description', v_settings.sponsor_description,
      'offer_message', v_settings.sponsor_offer_message,
      'terms', v_settings.sponsor_terms
    ),
    'draw', (select jsonb_build_object(
      'selected_at', d.selected_at,
      'selected_by', d.selected_by,
      'published_at', d.published_at,
      'participant_count', d.participant_count,
      'winners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', w.position,
          'display_name', r.display_name,
          'registered_at', r.registered_at,
          'collected', w.collected,
          'collected_at', w.collected_at,
          'collected_by', w.collected_by
        ) order by w.position)
        from public.contest_draw_winners w
        join public.contest_registrations r on r.id = w.registration_id
        where w.draw_id = d.id
      ), '[]'::jsonb)
    ) from public.contest_draws d where d.singleton)
  );
end;
$$;

drop function if exists public.admin_list_contest_registrations(text, integer, integer);
create function public.admin_list_contest_registrations(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(id bigint, display_name text, email text, registered_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  return query
  select r.id, r.display_name, u.email::text, r.registered_at
  from public.contest_registrations r
  join auth.users u on u.id = r.participant_id
  where nullif(btrim(coalesce(p_search, '')), '') is null
     or r.display_name ilike '%' || btrim(p_search) || '%'
     or u.email ilike '%' || btrim(p_search) || '%'
  order by r.registered_at desc, r.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_set_contest_registration_deadline(p_deadline timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  select registration_state into v_state
  from public.contest_settings where singleton for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;
  if v_state = 'closed' then
    raise exception using errcode = 'P0001', message = 'contest_registration_already_closed';
  end if;
  if p_deadline is not null and p_deadline <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'registration_deadline_must_be_in_future';
  end if;

  update public.contest_settings
  set registration_deadline = p_deadline, updated_at = clock_timestamp()
  where singleton;
  insert into public.contest_admin_audit(actor_id, action, detail)
  values ((select auth.uid()), 'registration_deadline_updated', jsonb_build_object('deadline', p_deadline));
  return public.admin_get_contest_dashboard();
end;
$$;

create or replace function public.admin_set_contest_registration_open(p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  if p_open is null then
    raise exception using errcode = '22023', message = 'registration_state_required';
  end if;

  select registration_state into v_state
  from public.contest_settings where singleton for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;

  if p_open then
    if v_state = 'closed' then
      raise exception using errcode = 'P0001', message = 'contest_registration_cannot_reopen';
    end if;
    if exists (
      select 1 from public.contest_settings
      where singleton and registration_deadline is not null
        and clock_timestamp() >= registration_deadline
    ) then
      raise exception using errcode = 'P0001', message = 'contest_registration_deadline_passed';
    end if;
    if v_state = 'setup' then
      update public.contest_settings
      set registration_state = 'open', registration_opened_at = clock_timestamp(), updated_at = clock_timestamp()
      where singleton;
      insert into public.contest_admin_audit(actor_id, action)
      values ((select auth.uid()), 'registration_opened');
    end if;
  else
    if v_state = 'open' then
      update public.contest_settings
      set registration_state = 'closed', registration_closed_at = clock_timestamp(), updated_at = clock_timestamp()
      where singleton;
      insert into public.contest_admin_audit(actor_id, action)
      values ((select auth.uid()), 'registration_closed');
    elsif v_state = 'setup' then
      update public.contest_settings
      set registration_state = 'closed', registration_closed_at = clock_timestamp(), updated_at = clock_timestamp()
      where singleton;
      insert into public.contest_admin_audit(actor_id, action)
      values ((select auth.uid()), 'registration_closed');
    end if;
  end if;
  return public.admin_get_contest_dashboard();
end;
$$;

create or replace function public.admin_update_contest_sponsor(p_sponsor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmed boolean := coalesce((p_sponsor ->> 'confirmed')::boolean, false);
  v_name text := nullif(btrim(p_sponsor ->> 'name'), '');
  v_image text := nullif(btrim(p_sponsor ->> 'image_url'), '');
  v_website text := nullif(btrim(p_sponsor ->> 'website'), '');
  v_description text := nullif(btrim(p_sponsor ->> 'description'), '');
  v_offer text := nullif(btrim(p_sponsor ->> 'offer_message'), '');
  v_terms text := nullif(btrim(p_sponsor ->> 'terms'), '');
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  if p_sponsor is null or jsonb_typeof(p_sponsor) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_sponsor_configuration';
  end if;
  if char_length(coalesce(v_name, '')) > 160
     or char_length(coalesce(v_image, '')) > 1000
     or char_length(coalesce(v_website, '')) > 1000
     or char_length(coalesce(v_description, '')) > 2000
     or char_length(coalesce(v_offer, '')) > 1000
     or char_length(coalesce(v_terms, '')) > 4000 then
    raise exception using errcode = '22023', message = 'sponsor_field_too_long';
  end if;
  if v_image is not null and v_image !~* '^https://[^[:space:]]+$' then
    raise exception using errcode = '22023', message = 'sponsor_image_requires_https_url';
  end if;
  if v_website is not null and v_website !~* '^https://[^[:space:]]+$' then
    raise exception using errcode = '22023', message = 'sponsor_website_requires_https_url';
  end if;
  if v_confirmed and (
    v_name is null or v_image is null or v_website is null
    or v_description is null or v_offer is null or v_terms is null
  ) then
    raise exception using errcode = '22023', message = 'confirmed_partnership_requires_all_sponsor_details';
  end if;

  update public.contest_settings
  set sponsor_confirmed = v_confirmed,
      sponsor_confirmed_at = case when v_confirmed then clock_timestamp() else null end,
      sponsor_confirmed_by = case when v_confirmed then (select auth.uid()) else null end,
      sponsor_name = v_name,
      sponsor_image_url = v_image,
      sponsor_website = v_website,
      sponsor_description = v_description,
      sponsor_offer_message = v_offer,
      sponsor_terms = v_terms,
      updated_at = clock_timestamp()
  where singleton;

  insert into public.contest_admin_audit(actor_id, action, detail)
  values ((select auth.uid()), 'sponsor_updated', jsonb_build_object('confirmed', v_confirmed));
  return public.admin_get_contest_dashboard();
end;
$$;

create or replace function public.admin_draw_contest_winners()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_count integer;
  v_draw_id uuid;
  v_selected_at timestamptz := clock_timestamp();
  v_position smallint := 0;
  v_row record;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;

  select registration_state into v_state
  from public.contest_settings where singleton for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;
  if v_state <> 'closed' then
    raise exception using errcode = 'P0001', message = 'contest_registration_must_be_closed';
  end if;
  if exists (select 1 from public.contest_draws where singleton) then
    raise exception using errcode = 'P0001', message = 'contest_draw_already_completed';
  end if;

  select count(*) into v_count from public.contest_registrations;
  if v_count < 5 then
    raise exception using errcode = 'P0001', message = 'at_least_five_registrations_required';
  end if;

  insert into public.contest_draws(singleton, selected_by, selected_at, participant_count)
  values (true, (select auth.uid()), v_selected_at, v_count)
  returning id into v_draw_id;

  for v_row in
    select r.id
    from public.contest_registrations r
    order by extensions.gen_random_bytes(32), r.id
    limit 5
  loop
    v_position := v_position + 1;
    insert into public.contest_draw_winners(draw_id, position, registration_id)
    values (v_draw_id, v_position, v_row.id);
  end loop;

  if v_position <> 5 then
    raise exception using errcode = 'P0001', message = 'contest_draw_incomplete';
  end if;

  insert into public.contest_admin_audit(actor_id, action, detail)
  values ((select auth.uid()), 'winners_drawn', jsonb_build_object(
    'draw_id', v_draw_id,
    'winner_count', v_position,
    'participant_count', v_count,
    'selected_at', v_selected_at
  ));
  return public.admin_get_contest_dashboard();
end;
$$;

create or replace function public.admin_publish_contest_winners()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published_at timestamptz;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  perform 1 from public.contest_settings where singleton for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_configured';
  end if;
  update public.contest_draws
  set published_at = coalesce(published_at, clock_timestamp())
  where singleton
  returning published_at into v_published_at;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_draw_not_completed';
  end if;
  insert into public.contest_admin_audit(actor_id, action, detail)
  values ((select auth.uid()), 'winners_published', jsonb_build_object('published_at', v_published_at));
  return public.admin_get_contest_dashboard();
end;
$$;

create or replace function public.admin_mark_winner_collected(p_registration_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner public.contest_draw_winners%rowtype;
  v_name text;
begin
  if not public.is_campaign_admin() then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  update public.contest_draw_winners
  set collected = true,
      collected_at = coalesce(collected_at, clock_timestamp()),
      collected_by = coalesce(collected_by, (select auth.uid()))
  where registration_id = p_registration_id
  returning * into v_winner;
  if not found then
    raise exception using errcode = 'P0002', message = 'contest_winner_not_found';
  end if;
  select r.display_name into v_name
  from public.contest_registrations r where r.id = v_winner.registration_id;
  insert into public.contest_admin_audit(actor_id, action, detail)
  values ((select auth.uid()), 'winner_prize_collected', jsonb_build_object(
    'registration_id', v_winner.registration_id,
    'collected_at', v_winner.collected_at
  ));
  return jsonb_build_object(
    'registration_id', v_winner.registration_id,
    'display_name', v_name,
    'collected', v_winner.collected,
    'collected_at', v_winner.collected_at
  );
end;
$$;

revoke all on function public.contest_get_status() from public;
revoke all on function public.contest_get_winners() from public;
revoke all on function public.contest_get_my_registration() from public, anon;
revoke all on function public.contest_register(text, boolean) from public, anon;
revoke all on function public.admin_get_contest_dashboard() from public, anon;
revoke all on function public.admin_list_contest_registrations(text, integer, integer) from public, anon;
revoke all on function public.admin_set_contest_registration_open(boolean) from public, anon;
revoke all on function public.admin_set_contest_registration_deadline(timestamptz) from public, anon;
revoke all on function public.admin_update_contest_sponsor(jsonb) from public, anon;
revoke all on function public.admin_draw_contest_winners() from public, anon;
revoke all on function public.admin_publish_contest_winners() from public, anon;
revoke all on function public.admin_mark_winner_collected(bigint) from public, anon;

grant execute on function public.contest_get_status() to anon, authenticated;
grant execute on function public.contest_get_winners() to anon, authenticated;
grant execute on function public.contest_get_my_registration() to authenticated;
grant execute on function public.contest_register(text, boolean) to authenticated;
grant execute on function public.admin_get_contest_dashboard() to authenticated;
grant execute on function public.admin_list_contest_registrations(text, integer, integer) to authenticated;
grant execute on function public.admin_set_contest_registration_open(boolean) to authenticated;
grant execute on function public.admin_set_contest_registration_deadline(timestamptz) to authenticated;
grant execute on function public.admin_update_contest_sponsor(jsonb) to authenticated;
grant execute on function public.admin_draw_contest_winners() to authenticated;
grant execute on function public.admin_publish_contest_winners() to authenticated;
grant execute on function public.admin_mark_winner_collected(bigint) to authenticated;
