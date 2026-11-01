-- Google-authenticated, one-spin-per-account campaign allocation.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.campaign_control (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  twenty_percent_approved boolean not null default false,
  sponsor_name text,
  coupon_expiry timestamptz,
  coupon_terms text
);
insert into public.campaign_control(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.spin_results (
  id bigint generated always as identity primary key,
  participant_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  reward_id text not null check (reward_id in ('free','fifty','thirty','twenty','miss')),
  created_at timestamptz not null default now()
);

create table if not exists public.reward_coupons (
  id bigint generated always as identity primary key,
  code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  spin_id bigint not null references public.spin_results(id) on delete cascade,
  coupon_type text not null check (coupon_type in ('free_plate','fifty_primary','fifty_free_bonus','thirty','twenty')),
  issued_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id),
  constraint reward_coupon_code_format check (code ~ '^[A-F0-9]{32}$')
);
create index if not exists reward_coupons_owner_idx on public.reward_coupons(owner_id);

create table if not exists public.spin_attempts (
  participant_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists spin_attempts_recent_idx on public.spin_attempts(participant_id, attempted_at desc);

alter table public.campaign_control enable row level security;
alter table public.spin_results enable row level security;
alter table public.reward_coupons enable row level security;
alter table public.spin_attempts enable row level security;
revoke all on public.campaign_control, public.spin_results, public.reward_coupons, public.spin_attempts from anon, authenticated;
grant select on public.spin_results, public.reward_coupons to authenticated;
create policy "participants can read their spin" on public.spin_results for select to authenticated using (participant_id = (select auth.uid()));
create policy "participants can read their coupons" on public.reward_coupons for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.get_my_spin()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reward_id', s.reward_id,
    'coupon_code', (select c.code from public.reward_coupons c where c.spin_id = s.id and c.coupon_type <> 'fifty_free_bonus' order by c.id limit 1),
    'bonus_fifty_coupon_code', (select c.code from public.reward_coupons c where c.spin_id = s.id and c.coupon_type = 'fifty_free_bonus' limit 1),
    'sponsor_name', (select cc.sponsor_name from public.campaign_control cc where cc.singleton),
    'expiry', (select cc.coupon_expiry::text from public.campaign_control cc where cc.singleton),
    'terms', (select cc.coupon_terms from public.campaign_control cc where cc.singleton)
  )
  from public.spin_results s
  where s.participant_id = (select auth.uid())
    and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google';
$$;

create or replace function public.spin_once(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_provider text := auth.jwt() -> 'app_metadata' ->> 'provider';
  v_existing public.spin_results%rowtype;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_reward text;
  v_spin_id bigint;
  v_coupon text;
  v_bonus text;
  v_now timestamptz := now();
  v_free integer;
  v_fifty integer;
  v_thirty integer;
  v_miss integer;
  v_options text[] := array[]::text[];
begin
  if v_uid is null or v_provider is distinct from 'google' then raise exception using errcode = '28000', message = 'google_authentication_required'; end if;
  if char_length(v_name) not between 1 and 32 or v_name !~ '^[[:alnum:] .''-]+$' then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;
  perform pg_advisory_xact_lock(hashtext('parivartan-2k26-lucky-spin'));

  select * into v_existing from public.spin_results where participant_id = v_uid;
  if found then return public.get_my_spin(); end if;

  delete from public.spin_attempts where attempted_at < v_now - interval '1 day';
  if (select count(*) from public.spin_attempts where participant_id = v_uid and attempted_at > v_now - interval '10 minutes') >= 10 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  insert into public.spin_attempts(participant_id) values (v_uid);
  if exists(select 1 from public.campaign_control where singleton and paused) then
    raise exception using errcode = 'P0001', message = 'campaign_paused';
  end if;

  select 5 - count(*) filter (where reward_id = 'free'),
         100 - count(*) filter (where reward_id = 'fifty'),
         200 - count(*) filter (where reward_id = 'thirty'),
         12 - count(*) filter (where reward_id = 'miss')
    into v_free, v_fifty, v_thirty, v_miss from public.spin_results;
  if v_free > 0 then v_options := array_append(v_options, 'free'); end if;
  if v_fifty > 0 then v_options := array_append(v_options, 'fifty'); end if;
  if v_thirty > 0 then v_options := array_append(v_options, 'thirty'); end if;
  if v_miss > 0 then v_options := array_append(v_options, 'miss'); end if;
  if cardinality(v_options) = 0 then
    if not exists(select 1 from public.campaign_control where singleton and twenty_percent_approved and sponsor_name is not null) then
      raise exception using errcode = 'P0001', message = 'twenty_percent_sponsor_not_configured';
    end if;
    v_reward := 'twenty';
  else
    v_reward := v_options[1 + floor(random() * cardinality(v_options))::integer];
  end if;

  insert into public.spin_results(participant_id, display_name, reward_id)
    values (v_uid, v_name, v_reward) returning id into v_spin_id;
  if v_reward in ('free','fifty','thirty','twenty') then
    v_coupon := upper(encode(extensions.gen_random_bytes(16), 'hex'));
    insert into public.reward_coupons(code, owner_id, spin_id, coupon_type)
    values (v_coupon, v_uid, v_spin_id,
      case v_reward when 'free' then 'free_plate' when 'fifty' then 'fifty_primary' when 'thirty' then 'thirty' else 'twenty' end);
  end if;
  if v_reward = 'free' then
    v_bonus := upper(encode(extensions.gen_random_bytes(16), 'hex'));
    insert into public.reward_coupons(code, owner_id, spin_id, coupon_type)
    values (v_bonus, v_uid, v_spin_id, 'fifty_free_bonus');
  end if;
  return jsonb_build_object(
    'reward_id', v_reward,
    'coupon_code', v_coupon,
    'bonus_fifty_coupon_code', v_bonus,
    'sponsor_name', (select sponsor_name from public.campaign_control where singleton),
    'expiry', (select coupon_expiry::text from public.campaign_control where singleton),
    'terms', (select coupon_terms from public.campaign_control where singleton)
  );
end;
$$;

revoke all on function public.get_my_spin() from public, anon;
revoke all on function public.spin_once(text) from public, anon;
grant execute on function public.get_my_spin() to authenticated;
grant execute on function public.spin_once(text) to authenticated;
