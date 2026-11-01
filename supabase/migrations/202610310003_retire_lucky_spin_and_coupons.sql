-- User-authorized retirement of the legacy Lucky Spin and coupon subsystem.
-- No backup is being taken per explicit user confirmation. This migration
-- leaves Supabase Auth, Google OAuth, the campaign admin allowlist/helper, and
-- the new contest schema intact. Do not add CASCADE: unexpected dependencies
-- should stop this migration for review rather than remove unrelated objects.

drop policy if exists "participants can read their spin" on public.spin_results;
drop policy if exists "participants can read their coupons" on public.reward_coupons;

drop function if exists public.owner_redeem_coupon(text);
drop function if exists public.owner_validate_coupon(text);
drop function if exists public.owner_get_dashboard();
drop function if exists public.admin_set_restaurant_owner(text, boolean);
drop function if exists public.admin_set_campaign_state(boolean, boolean);
drop function if exists public.admin_update_sponsor_settings(jsonb);
drop function if exists public.admin_get_dashboard();
drop function if exists public.get_public_winners();
drop function if exists public.get_campaign_public_settings();
drop function if exists public.spin_once(text);
drop function if exists public.get_my_spin();
drop function if exists public.is_restaurant_owner();

-- Remove legacy redemption audit before the coupon table it references.
drop table if exists public.redemption_audit;
drop table if exists public.campaign_admin_audit;
drop table if exists public.restaurant_owner_allowlist;
drop table if exists public.spin_attempts;
drop table if exists public.reward_coupons;
drop table if exists public.spin_results;
drop table if exists public.campaign_control;

-- is_campaign_admin() and campaign_admin_allowlist are intentionally retained:
-- the new contest admin RPCs use them for server-side authorization.
