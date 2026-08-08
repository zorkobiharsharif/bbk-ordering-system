-- Web Push subscriptions for the admin/owner/staff PWA. Run once in the
-- Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per device that has enabled notifications. admin_user_id links it
-- to whoever's logged in; ON DELETE CASCADE means deleting a staff account
-- automatically removes their devices too. Disabling (not deleting) an
-- account doesn't touch this table — the send logic in create-order joins
-- to admin_users and filters on is_active, so a disabled account's devices
-- stop receiving pushes immediately without needing a delete.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Same is_admin()-gated pattern as the rest of the admin panel's tables —
-- the browser subscribes/unsubscribes directly via the x-admin-session
-- header, no dedicated edge function needed for that part. The actual
-- sending (in create-order) uses the service-role key and bypasses RLS
-- entirely, same as every other write that function already does.
drop policy if exists "admins manage push subscriptions" on public.push_subscriptions;
create policy "admins manage push subscriptions" on public.push_subscriptions for all using (public.is_admin()) with check (public.is_admin());
