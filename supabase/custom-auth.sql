-- ============================================================================
-- BBK custom lightweight authentication — replaces Supabase Auth entirely
-- for the admin panel. Run this AFTER schema.sql, seed.sql, storage.sql and
-- permissions.sql are already installed.
--
-- Why: Supabase Auth's own sign-in flow was unreliable in this deployment's
-- browser environment. This removes that dependency completely — no
-- auth.users rows, no Supabase session, no email. Just a username/password
-- table, bcrypt-hashed passwords (via Postgres's own pgcrypto — the same
-- battle-tested hashing algorithm bcrypt uses, no external library needed),
-- and a random session token the browser carries as a custom request
-- header. Every existing RLS policy already calls only is_admin()/
-- is_owner() — redefining those two functions here re-points ALL existing
-- authorization at the new session mechanism without touching a single
-- policy.
-- ============================================================================

-- pgcrypto's crypt()/gen_salt() (used below) live in Supabase's `extensions`
-- schema, not `public` — this is idempotent whether or not schema.sql's
-- earlier `create extension if not exists pgcrypto` already ran.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role public.user_role not null default 'staff',
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token text primary key,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists admin_sessions_expires_at_idx on public.admin_sessions(expires_at);

-- No public policies at all on either table — every read/write goes through
-- the edge functions below using the service-role key. The browser never
-- talks to these two tables directly.
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Password verification / change — SECURITY DEFINER so the edge functions
-- (running as service role) can call these without the tables needing any
-- public grants. crypt()/gen_salt('bf') is pgcrypto's bcrypt implementation.
-- ---------------------------------------------------------------------------
create or replace function public.verify_admin_login(p_username text, p_password text)
returns table(user_id uuid, role public.user_role)
language sql security definer set search_path = public, extensions as $$
  select id, role from public.admin_users
  where username = p_username and is_active and password_hash = crypt(p_password, password_hash)
$$;

create or replace function public.set_admin_password(p_username text, p_password text)
returns void language sql security definer set search_path = public, extensions as $$
  update public.admin_users set password_hash = crypt(p_password, gen_salt('bf')) where username = p_username
$$;

-- Used when creating a brand-new staff account (there's no existing row to
-- UPDATE yet, so admin-manage-staff hashes the password here, then inserts
-- the row itself).
create or replace function public.hash_password(p_password text) returns text
language sql security definer set search_path = public, extensions as $$
  select crypt(p_password, gen_salt('bf'))
$$;

-- ---------------------------------------------------------------------------
-- Session-aware replacements for is_admin()/is_owner(). PostgREST exposes
-- every request header to Postgres as the `request.headers` GUC (JSON
-- text) — the browser sends its session token as `x-admin-session` on
-- every request (wired in admin/js/state.js), and these functions look it
-- up here instead of relying on auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.current_session_token() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-admin-session', '')
$$;

create or replace function public.current_admin_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select s.role from public.admin_sessions s
  where s.token = public.current_session_token() and s.expires_at > now()
  limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.current_admin_role() is not null
$$;

create or replace function public.is_owner() returns boolean
language sql stable as $$
  select public.current_admin_role() = 'owner'
$$;

-- ---------------------------------------------------------------------------
-- The staff price-change guard (permissions.sql) read auth.uid() directly —
-- point it at the same session mechanism.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_staff_product_limits() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_admin_role() = 'staff' and (
    new.name is distinct from old.name or
    new.category_id is distinct from old.category_id or
    new.description is distinct from old.description or
    new.ingredients is distinct from old.ingredients or
    new.base_price is distinct from old.base_price or
    new.discount_price is distinct from old.discount_price or
    new.prep_time_minutes is distinct from old.prep_time_minutes or
    new.product_type is distinct from old.product_type or
    new.is_active is distinct from old.is_active or
    new.is_featured is distinct from old.is_featured or
    new.is_bestseller is distinct from old.is_bestseller or
    new.is_recommended is distinct from old.is_recommended or
    new.is_seasonal is distinct from old.is_seasonal or
    new.is_trending is distinct from old.is_trending or
    new.call_to_order is distinct from old.call_to_order or
    new.display_order is distinct from old.display_order
  ) then
    raise exception 'Staff accounts can only change product availability, not other product details.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Who changed this" columns pointed at profiles(id)/auth.users — repoint
-- them at admin_users instead. The old `profiles` table is left in place,
-- unused, rather than dropped, to avoid any risk to data you might still
-- want to look at.
-- ---------------------------------------------------------------------------
-- set null, not the default no-action: deleting a staff account shouldn't be
-- permanently blocked just because they once updated an order's status.
alter table public.order_status_history drop constraint if exists order_status_history_changed_by_fkey;
alter table public.order_status_history add constraint order_status_history_changed_by_fkey
  foreign key (changed_by) references public.admin_users(id) on delete set null;

alter table public.inventory_adjustments drop constraint if exists inventory_adjustments_changed_by_fkey;
alter table public.inventory_adjustments add constraint inventory_adjustments_changed_by_fkey
  foreign key (changed_by) references public.admin_users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Seed the two starter accounts. CHANGE THESE PASSWORDS after your first
-- login (Staff Management -> change password, once you're in) — these are
-- the same defaults used during setup, not meant to stay in place.
-- ---------------------------------------------------------------------------
insert into public.admin_users (username, password_hash, role) values
  ('owner', crypt('Owner@123', gen_salt('bf')), 'owner'),
  ('staff', crypt('Staff@123', gen_salt('bf')), 'staff')
on conflict (username) do nothing;
