-- Normalize the verified Google account email against the existing admin allowlist.
-- This migration reuses the existing table and server-side admin RPC checks.
insert into public.campaign_admin_allowlist(email)
values (lower(btrim('littichokha2k26.45@gmail.com')))
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
      and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
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
      and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
      and not exists (
        select 1
        from public.campaign_admin_allowlist a
        where a.email = lower(btrim(u.email))
      )
  );
$$;

revoke all on function public.is_campaign_admin() from public, anon, authenticated;
revoke all on function public.is_restaurant_owner() from public, anon, authenticated;
