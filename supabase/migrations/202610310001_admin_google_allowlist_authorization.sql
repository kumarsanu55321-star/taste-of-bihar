-- A trusted Google identity plus the exact allowlisted email is sufficient for
-- this admin account; Google OAuth can authenticate even when the separate
-- email_confirmed_at field is unset. Keep both identity and allowlist checks.
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
      and (
        lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'google'
        or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
  );
$$;

revoke all on function public.is_campaign_admin() from public, anon, authenticated;
