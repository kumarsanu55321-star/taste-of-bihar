-- Additive campaign administration, public winners and sponsor coupon redemption.
-- Existing spin, coupon and participant records are retained.
alter table public.campaign_control
  add column if not exists sponsor_approved boolean not null default false,
  add column if not exists discount_50_approved boolean not null default false,
  add column if not exists discount_30_approved boolean not null default false,
  add column if not exists discount_20_approved boolean not null default false,
  add column if not exists coupon_issuance_paused boolean not null default false,
  add column if not exists minimum_bill_amount numeric(10,2),
  add column if not exists maximum_discount_amount numeric(10,2);

alter table public.reward_coupons
  add column if not exists discount_percent smallint,
  add column if not exists sponsor_name_snapshot text,
  add column if not exists expires_at_snapshot timestamptz,
  add column if not exists terms_snapshot text,
  add column if not exists minimum_bill_amount_snapshot numeric(10,2),
  add column if not exists maximum_discount_amount_snapshot numeric(10,2);

alter table public.reward_coupons drop constraint if exists reward_coupon_code_format;
alter table public.reward_coupons add constraint reward_coupon_code_format
  check (code ~ '^([A-F0-9]{24}|[A-F0-9]{32})$');

update public.reward_coupons c
set discount_percent = case c.coupon_type
  when 'fifty_primary' then 50 when 'fifty_free_bonus' then 50
  when 'thirty' then 30 when 'twenty' then 20 else 0 end,
  sponsor_name_snapshot = coalesce(c.sponsor_name_snapshot, cc.sponsor_name),
  expires_at_snapshot = coalesce(c.expires_at_snapshot, cc.coupon_expiry),
  terms_snapshot = coalesce(c.terms_snapshot, cc.coupon_terms),
  minimum_bill_amount_snapshot = coalesce(c.minimum_bill_amount_snapshot, cc.minimum_bill_amount),
  maximum_discount_amount_snapshot = coalesce(c.maximum_discount_amount_snapshot, cc.maximum_discount_amount)
from public.campaign_control cc
where cc.singleton;

create table if not exists public.campaign_admin_allowlist (
  email text primary key check (email = lower(btrim(email)) and email like '%@gmail.com'),
  added_at timestamptz not null default now()
);
insert into public.campaign_admin_allowlist(email)
values ('littichokha2k26.45@gmail.com')
on conflict (email) do nothing;

create table if not exists public.restaurant_owner_allowlist (
  email text primary key check (email = lower(btrim(email)) and email like '%@gmail.com'),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id)
);

create table if not exists public.campaign_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.redemption_audit (
  id bigint generated always as identity primary key,
  coupon_id bigint not null references public.reward_coupons(id),
  staff_id uuid not null references auth.users(id),
  action text not null check (action in ('redeemed')),
  created_at timestamptz not null default now()
);
create index if not exists redemption_audit_coupon_idx on public.redemption_audit(coupon_id, created_at desc);
create index if not exists redemption_audit_staff_idx on public.redemption_audit(staff_id, created_at desc);

alter table public.campaign_admin_allowlist enable row level security;
alter table public.restaurant_owner_allowlist enable row level security;
alter table public.campaign_admin_audit enable row level security;
alter table public.redemption_audit enable row level security;
revoke all on public.campaign_admin_allowlist, public.restaurant_owner_allowlist, public.campaign_admin_audit, public.redemption_audit from anon, authenticated;

create or replace function public.is_campaign_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_admin_allowlist a
    join auth.users u on u.id = (select auth.uid())
    where a.email = lower(u.email) and u.email_confirmed_at is not null
      and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
  );
$$;

create or replace function public.is_restaurant_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_owner_allowlist o
    join auth.users u on u.id = (select auth.uid())
    where o.email = lower(u.email) and u.email_confirmed_at is not null
      and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
      and not exists(select 1 from public.campaign_admin_allowlist a where a.email = lower(u.email))
  );
$$;
revoke all on function public.is_campaign_admin() from public, anon, authenticated;
revoke all on function public.is_restaurant_owner() from public, anon, authenticated;

create or replace function public.get_campaign_public_settings()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'paused', c.paused or c.coupon_issuance_paused,
    'sponsor_approved', c.sponsor_approved,
    'sponsor_name', case when c.sponsor_approved then c.sponsor_name else null end,
    'discount_50_approved', c.sponsor_approved and c.discount_50_approved,
    'discount_30_approved', c.sponsor_approved and c.discount_30_approved,
    'discount_20_approved', c.sponsor_approved and c.discount_20_approved and c.twenty_percent_approved,
    'expiry', case when c.sponsor_approved then c.coupon_expiry else null end,
    'minimum_bill_amount', c.minimum_bill_amount,
    'maximum_discount_amount', c.maximum_discount_amount,
    'terms', case when c.sponsor_approved then c.coupon_terms else null end
  ) from public.campaign_control c where c.singleton;
$$;

create or replace function public.get_public_winners()
returns table(display_name text, reward_id text, won_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.display_name, s.reward_id, s.created_at
  from public.spin_results s where s.reward_id <> 'miss' order by s.created_at desc;
$$;
revoke all on function public.get_campaign_public_settings() from public;
revoke all on function public.get_public_winners() from public;
grant execute on function public.get_campaign_public_settings() to anon, authenticated;
grant execute on function public.get_public_winners() to anon, authenticated;

create or replace function public.get_my_spin()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'reward_id', s.reward_id,
    'coupon_code', main_coupon.code,
    'bonus_fifty_coupon_code', bonus_coupon.code,
    'coupon', case when main_coupon.id is null then null else jsonb_build_object(
      'code', main_coupon.code, 'coupon_type', main_coupon.coupon_type,
      'discount_percent', main_coupon.discount_percent, 'sponsor_name', main_coupon.sponsor_name_snapshot,
      'expiry', main_coupon.expires_at_snapshot, 'terms', main_coupon.terms_snapshot,
      'minimum_bill_amount', main_coupon.minimum_bill_amount_snapshot,
      'maximum_discount_amount', main_coupon.maximum_discount_amount_snapshot,
      'status', case when main_coupon.redeemed_at is null then 'issued' else 'redeemed' end
    ) end,
    'bonus_coupon', case when bonus_coupon.id is null then null else jsonb_build_object(
      'code', bonus_coupon.code, 'coupon_type', bonus_coupon.coupon_type,
      'discount_percent', bonus_coupon.discount_percent, 'sponsor_name', bonus_coupon.sponsor_name_snapshot,
      'expiry', bonus_coupon.expires_at_snapshot, 'terms', bonus_coupon.terms_snapshot,
      'minimum_bill_amount', bonus_coupon.minimum_bill_amount_snapshot,
      'maximum_discount_amount', bonus_coupon.maximum_discount_amount_snapshot,
      'status', case when bonus_coupon.redeemed_at is null then 'issued' else 'redeemed' end
    ) end,
    'sponsor_name', coalesce(main_coupon.sponsor_name_snapshot, bonus_coupon.sponsor_name_snapshot),
    'expiry', coalesce(main_coupon.expires_at_snapshot, bonus_coupon.expires_at_snapshot),
    'terms', coalesce(main_coupon.terms_snapshot, bonus_coupon.terms_snapshot)
  )
  from public.spin_results s
  left join lateral (
    select c.* from public.reward_coupons c where c.spin_id=s.id and c.coupon_type <> 'fifty_free_bonus' order by c.id limit 1
  ) main_coupon on true
  left join lateral (
    select c.* from public.reward_coupons c where c.spin_id=s.id and c.coupon_type = 'fifty_free_bonus' order by c.id limit 1
  ) bonus_coupon on true
  where s.participant_id=(select auth.uid()) and (auth.jwt() -> 'app_metadata' ->> 'provider')='google';
$$;

create or replace function public.spin_once(p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
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
  v_control public.campaign_control%rowtype;
begin
  if v_uid is null or v_provider is distinct from 'google' then raise exception using errcode='28000', message='google_authentication_required'; end if;
  if char_length(v_name) not between 1 and 32 or v_name !~ '^[[:alnum:] .''-]+$' then
    raise exception using errcode='22023', message='invalid_display_name';
  end if;
  perform pg_advisory_xact_lock(hashtext('parivartan-2k26-lucky-spin'));
  select * into v_existing from public.spin_results where participant_id=v_uid;
  if found then return public.get_my_spin(); end if;

  delete from public.spin_attempts where attempted_at < v_now-interval '1 day';
  if (select count(*) from public.spin_attempts where participant_id=v_uid and attempted_at>v_now-interval '10 minutes') >= 10 then
    raise exception using errcode='P0001', message='rate_limited';
  end if;
  insert into public.spin_attempts(participant_id) values(v_uid);

  select * into v_control from public.campaign_control where singleton;
  if v_control.paused or v_control.coupon_issuance_paused or not v_control.sponsor_approved then
    raise exception using errcode='P0001', message='campaign_paused';
  end if;
  select 5-count(*) filter(where reward_id='free'),
         100-count(*) filter(where reward_id='fifty'),
         200-count(*) filter(where reward_id='thirty'),
         12-count(*) filter(where reward_id='miss')
    into v_free,v_fifty,v_thirty,v_miss from public.spin_results;
  if v_free>0 and v_control.discount_50_approved then v_options:=array_append(v_options,'free'); end if;
  if v_fifty>0 and v_control.discount_50_approved then v_options:=array_append(v_options,'fifty'); end if;
  if v_thirty>0 and v_control.discount_30_approved then v_options:=array_append(v_options,'thirty'); end if;
  if v_miss>0 then v_options:=array_append(v_options,'miss'); end if;
  if cardinality(v_options)=0 then
    if not (v_control.discount_20_approved and v_control.twenty_percent_approved) then
      raise exception using errcode='P0001', message='no_approved_reward_available';
    end if;
    v_reward:='twenty';
  else
    v_reward:=v_options[1+floor(random()*cardinality(v_options))::integer];
  end if;

  insert into public.spin_results(participant_id,display_name,reward_id) values(v_uid,v_name,v_reward) returning id into v_spin_id;
  if v_reward='free' then
    v_coupon:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    insert into public.reward_coupons(code,owner_id,spin_id,coupon_type,discount_percent) values(v_coupon,v_uid,v_spin_id,'free_plate',0);
    v_bonus:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    insert into public.reward_coupons(code,owner_id,spin_id,coupon_type,discount_percent,sponsor_name_snapshot,
      expires_at_snapshot,terms_snapshot,minimum_bill_amount_snapshot,maximum_discount_amount_snapshot)
    values(v_bonus,v_uid,v_spin_id,'fifty_free_bonus',50,v_control.sponsor_name,v_control.coupon_expiry,
      v_control.coupon_terms,v_control.minimum_bill_amount,v_control.maximum_discount_amount);
  elsif v_reward in ('fifty','thirty','twenty') then
    v_coupon:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    insert into public.reward_coupons(code,owner_id,spin_id,coupon_type,discount_percent,sponsor_name_snapshot,
      expires_at_snapshot,terms_snapshot,minimum_bill_amount_snapshot,maximum_discount_amount_snapshot)
    values(v_coupon,v_uid,v_spin_id,
      case v_reward when 'fifty' then 'fifty_primary' when 'thirty' then 'thirty' else 'twenty' end,
      case v_reward when 'fifty' then 50 when 'thirty' then 30 else 20 end,
      v_control.sponsor_name,v_control.coupon_expiry,v_control.coupon_terms,
      v_control.minimum_bill_amount,v_control.maximum_discount_amount);
  end if;
  return public.get_my_spin();
end;
$$;

create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_data jsonb;
begin
  if not public.is_campaign_admin() then raise exception using errcode='42501', message='admin_access_denied'; end if;
  select jsonb_build_object(
    'total_participants',(select count(*) from public.spin_results),
    'completed_spins',(select count(*) from public.spin_results),
    'spins',coalesce((select jsonb_agg(jsonb_build_object('display_name',s.display_name,'reward_id',s.reward_id,'created_at',s.created_at,
      'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'coupon_type',c.coupon_type,'discount_percent',c.discount_percent,
      'issued_at',c.issued_at,'expires_at',c.expires_at_snapshot,'redeemed_at',c.redeemed_at) order by c.issued_at)
      from public.reward_coupons c where c.spin_id=s.id),'[]'::jsonb)) order by s.created_at desc) from public.spin_results s),'[]'::jsonb),
    'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'coupon_type',c.coupon_type,'discount_percent',c.discount_percent,
      'sponsor_name',c.sponsor_name_snapshot,'expires_at',c.expires_at_snapshot,'issued_at',c.issued_at,'redeemed_at',c.redeemed_at)
      order by c.issued_at desc) from public.reward_coupons c),'[]'::jsonb),
    'owners',coalesce((select jsonb_agg(jsonb_build_object('email',o.email,'added_at',o.added_at) order by o.added_at desc)
      from public.restaurant_owner_allowlist o),'[]'::jsonb),
    'settings',(select to_jsonb(c)-'singleton' from public.campaign_control c where c.singleton),
    'recent_redemptions',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'coupon_type',c.coupon_type,
      'display_name',s.display_name,'redeemed_at',c.redeemed_at) order by c.redeemed_at desc)
      from public.reward_coupons c join public.spin_results s on s.id=c.spin_id where c.redeemed_at is not null),'[]'::jsonb),
    'audit_logs',coalesce((select jsonb_agg(log_row order by log_row.created_at desc) from (
      select a.action,a.detail,a.created_at,u.email as actor_email from public.campaign_admin_audit a
      left join auth.users u on u.id=a.actor_id
      union all
      select 'coupon_redeemed'::text,jsonb_build_object('coupon_id',r.coupon_id),r.created_at,u.email
      from public.redemption_audit r left join auth.users u on u.id=r.staff_id
    ) log_row),'[]'::jsonb)
  ) into v_data;
  return v_data;
end;
$$;

create or replace function public.admin_update_sponsor_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_approved boolean;
begin
  if not public.is_campaign_admin() then raise exception using errcode='42501', message='admin_access_denied'; end if;
  if nullif(btrim(p_settings->>'sponsor_name'),'') is not null and char_length(p_settings->>'sponsor_name')>120 then
    raise exception using errcode='22023', message='invalid_sponsor_name';
  end if;
  if nullif(p_settings->>'minimum_bill_amount','') is not null and (p_settings->>'minimum_bill_amount')::numeric<0 then
    raise exception using errcode='22023', message='invalid_minimum_bill_amount';
  end if;
  if nullif(p_settings->>'maximum_discount_amount','') is not null and (p_settings->>'maximum_discount_amount')::numeric<0 then
    raise exception using errcode='22023', message='invalid_maximum_discount_amount';
  end if;
  v_approved:=coalesce((p_settings->>'sponsor_approved')::boolean,false);
  if v_approved and (nullif(btrim(p_settings->>'sponsor_name'),'') is null
      or nullif(p_settings->>'coupon_expiry','') is null or nullif(btrim(p_settings->>'coupon_terms'),'') is null) then
    raise exception using errcode='22023', message='sponsor_approval_requires_name_expiry_terms';
  end if;
  update public.campaign_control set
    sponsor_name=nullif(btrim(p_settings->>'sponsor_name'),''),
    sponsor_approved=v_approved,
    discount_50_approved=coalesce((p_settings->>'discount_50_approved')::boolean,false),
    discount_30_approved=coalesce((p_settings->>'discount_30_approved')::boolean,false),
    discount_20_approved=coalesce((p_settings->>'discount_20_approved')::boolean,false),
    twenty_percent_approved=coalesce((p_settings->>'discount_20_approved')::boolean,false),
    coupon_expiry=nullif(p_settings->>'coupon_expiry','')::timestamptz,
    minimum_bill_amount=nullif(p_settings->>'minimum_bill_amount','')::numeric,
    maximum_discount_amount=nullif(p_settings->>'maximum_discount_amount','')::numeric,
    coupon_terms=nullif(btrim(p_settings->>'coupon_terms'),'')
  where singleton;
  insert into public.campaign_admin_audit(actor_id,action,detail) values(auth.uid(),'sponsor_settings_updated',
    jsonb_build_object('sponsor_approved',v_approved,'discount_50_approved',(p_settings->>'discount_50_approved')::boolean,
      'discount_30_approved',(p_settings->>'discount_30_approved')::boolean,'discount_20_approved',(p_settings->>'discount_20_approved')::boolean));
  return public.admin_get_dashboard();
end;
$$;

create or replace function public.admin_set_campaign_state(p_paused boolean,p_coupon_issuance_paused boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_campaign_admin() then raise exception using errcode='42501', message='admin_access_denied'; end if;
  update public.campaign_control set paused=p_paused,coupon_issuance_paused=p_coupon_issuance_paused where singleton;
  insert into public.campaign_admin_audit(actor_id,action,detail) values(auth.uid(),'campaign_state_updated',
    jsonb_build_object('paused',p_paused,'coupon_issuance_paused',p_coupon_issuance_paused));
  return public.admin_get_dashboard();
end;
$$;

create or replace function public.admin_set_restaurant_owner(p_email text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_email text:=lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_campaign_admin() then raise exception using errcode='42501', message='admin_access_denied'; end if;
  if v_email !~ '^[^@[:space:]]+@gmail[.]com$' then raise exception using errcode='22023', message='gmail_account_required'; end if;
  if exists(select 1 from public.campaign_admin_allowlist a where a.email=v_email) then
    raise exception using errcode='22023', message='administrator_cannot_be_added_as_restaurant_owner';
  end if;
  if p_enabled then
    insert into public.restaurant_owner_allowlist(email,added_by) values(v_email,auth.uid()) on conflict(email) do nothing;
  else
    delete from public.restaurant_owner_allowlist where email=v_email;
  end if;
  insert into public.campaign_admin_audit(actor_id,action,detail)
    values(auth.uid(),case when p_enabled then 'restaurant_owner_added' else 'restaurant_owner_removed' end,jsonb_build_object('email',v_email));
  return public.admin_get_dashboard();
end;
$$;

create or replace function public.owner_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_restaurant_owner() then raise exception using errcode='42501', message='restaurant_owner_access_denied'; end if;
  return jsonb_build_object(
    'daily_redemptions',(select count(*) from public.redemption_audit where staff_id=auth.uid() and created_at>=date_trunc('day',now())),
    'redemptions',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'coupon_type',c.coupon_type,
      'discount_percent',c.discount_percent,'redeemed_at',c.redeemed_at,'sponsor_name',c.sponsor_name_snapshot)
      order by c.redeemed_at desc) from public.reward_coupons c where c.redeemed_by=auth.uid()),'[]'::jsonb)
  );
end;
$$;

create or replace function public.owner_validate_coupon(p_code text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_coupon public.reward_coupons%rowtype; v_status text;
begin
  if not public.is_restaurant_owner() then raise exception using errcode='42501', message='restaurant_owner_access_denied'; end if;
  select * into v_coupon from public.reward_coupons
    where code=upper(regexp_replace(btrim(coalesce(p_code,'')),'^PARIVARTAN2K26:','','i'));
  if not found or v_coupon.coupon_type not in ('free_plate','fifty_primary','fifty_free_bonus','thirty','twenty') then
    return jsonb_build_object('status','invalid');
  end if;
  v_status:=case when v_coupon.redeemed_at is not null then 'redeemed'
    when v_coupon.expires_at_snapshot is not null and v_coupon.expires_at_snapshot<=now() then 'expired'
    when v_coupon.coupon_type='free_plate' then 'valid'
    when v_coupon.sponsor_name_snapshot is null then 'unconfigured' else 'valid' end;
  return jsonb_build_object('status',v_status,'code',v_coupon.code,'coupon_type',v_coupon.coupon_type,'discount_percent',v_coupon.discount_percent,
    'sponsor_name',v_coupon.sponsor_name_snapshot,'expiry',v_coupon.expires_at_snapshot,'terms',v_coupon.terms_snapshot,
    'minimum_bill_amount',v_coupon.minimum_bill_amount_snapshot,'maximum_discount_amount',v_coupon.maximum_discount_amount_snapshot);
end;
$$;

create or replace function public.owner_redeem_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_coupon public.reward_coupons%rowtype; v_code text;
begin
  if not public.is_restaurant_owner() then raise exception using errcode='42501', message='restaurant_owner_access_denied'; end if;
  v_code:=upper(regexp_replace(btrim(coalesce(p_code,'')),'^PARIVARTAN2K26:','','i'));
  select * into v_coupon from public.reward_coupons where code=v_code for update;
  if not found or v_coupon.coupon_type not in ('free_plate','fifty_primary','fifty_free_bonus','thirty','twenty') then return jsonb_build_object('status','invalid'); end if;
  if v_coupon.redeemed_at is not null then return jsonb_build_object('status','redeemed'); end if;
  if v_coupon.expires_at_snapshot is not null and v_coupon.expires_at_snapshot<=now() then return jsonb_build_object('status','expired'); end if;
  if v_coupon.coupon_type<>'free_plate' and v_coupon.sponsor_name_snapshot is null then return jsonb_build_object('status','unconfigured'); end if;
  update public.reward_coupons set redeemed_at=now(),redeemed_by=auth.uid() where id=v_coupon.id and redeemed_at is null;
  if not found then return jsonb_build_object('status','redeemed'); end if;
  insert into public.redemption_audit(coupon_id,staff_id,action) values(v_coupon.id,auth.uid(),'redeemed');
  return jsonb_build_object('status','redeemed_now','coupon_type',v_coupon.coupon_type,'discount_percent',v_coupon.discount_percent,
    'sponsor_name',v_coupon.sponsor_name_snapshot,'expiry',v_coupon.expires_at_snapshot);
end;
$$;

revoke all on function public.get_my_spin() from public, anon;
revoke all on function public.spin_once(text) from public, anon;
revoke all on function public.is_campaign_admin() from public, anon, authenticated;
revoke all on function public.is_restaurant_owner() from public, anon, authenticated;
revoke all on function public.admin_get_dashboard() from public, anon;
revoke all on function public.admin_update_sponsor_settings(jsonb) from public, anon;
revoke all on function public.admin_set_campaign_state(boolean,boolean) from public, anon;
revoke all on function public.admin_set_restaurant_owner(text,boolean) from public, anon;
revoke all on function public.owner_get_dashboard() from public, anon;
revoke all on function public.owner_validate_coupon(text) from public, anon;
revoke all on function public.owner_redeem_coupon(text) from public, anon;
grant execute on function public.get_my_spin() to authenticated;
grant execute on function public.spin_once(text) to authenticated;
grant execute on function public.admin_get_dashboard() to authenticated;
grant execute on function public.admin_update_sponsor_settings(jsonb) to authenticated;
grant execute on function public.admin_set_campaign_state(boolean,boolean) to authenticated;
grant execute on function public.admin_set_restaurant_owner(text,boolean) to authenticated;
grant execute on function public.owner_get_dashboard() to authenticated;
grant execute on function public.owner_validate_coupon(text) to authenticated;
grant execute on function public.owner_redeem_coupon(text) to authenticated;