-- Keep the existing email allowlist and admin RPC checks, but verify Google from
-- the trusted auth.users metadata so linked Google identities are not rejected
-- because the JWT's primary provider claim is stale or set to another provider.
insert into public.campaign_admin_allowlist(email)
values ('littichokha2k26.45@gmail.com')
on conflict (email) do nothing;

create or replace function public.is_campaign_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_admin_allowlist a
    join auth.users u on u.id = (select auth.uid())
    where a.email = lower(btrim(u.email))
      and u.email_confirmed_at is not null
      and (
        lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'google'
        or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
  );
$$;

create or replace function public.is_restaurant_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_owner_allowlist o
    join auth.users u on u.id = (select auth.uid())
    where o.email = lower(btrim(u.email))
      and u.email_confirmed_at is not null
      and (
        lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'google'
        or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
      and not exists (
        select 1
        from public.campaign_admin_allowlist a
        where a.email = lower(btrim(u.email))
      )
  );
$$;

revoke all on function public.is_campaign_admin() from public, anon, authenticated;
revoke all on function public.is_restaurant_owner() from public, anon, authenticated;
