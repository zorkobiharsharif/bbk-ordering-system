-- QA audit fixes (2026-08-06)
-- Run this once in the Supabase Dashboard: Project -> SQL Editor -> New query -> paste -> Run.

-- 1. GPS is now mandatory at checkout and the address field is an optional
--    supplementary note (see js/app.js checkout flow and
--    supabase/functions/create-order/index.ts). This NOT NULL constraint
--    predates that change and rejects any order where the customer left the
--    now-optional address field blank, even though they shared a valid GPS
--    location. Without this, real orders fail with a generic 500 error.
alter table public.orders alter column address drop not null;

-- 2. "Disable" on a staff account (Admin -> Staff Management) only sets
--    admin_users.is_active = false, but current_admin_role() — used by every
--    is_admin()/is_owner() RLS check — never looked at that flag, only at
--    session expiry. Result: a disabled staff member's already-open session
--    kept working normally until it naturally expired (up to a week), even
--    though "Delete" correctly revoked access immediately via cascade. This
--    widens the check to also require the account still be active.
create or replace function public.current_admin_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select s.role from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.token = public.current_session_token() and s.expires_at > now() and u.is_active
  limit 1
$$;
