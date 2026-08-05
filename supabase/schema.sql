-- ============================================================================
-- BBK platform schema — v2 (fresh install)
-- Run this once, in full, in the Supabase SQL editor on a clean project.
-- Architecture: single-tenant (one restaurant per Supabase project), built so
-- every business rule lives in a table an admin can edit, not in code.
-- After this file: run seed.sql, then storage.sql, then deploy the edge
-- functions in supabase/functions/.
-- ============================================================================

create extension if not exists pgcrypto;

create type public.order_status as enum ('new','address_needs_check','accepted','kitchen','out_for_delivery','delivered','cancelled');
create type public.user_role as enum ('owner','staff');
create type public.offer_type as enum ('percent','flat','free_item','combo');
create type public.offer_item_role as enum ('trigger','reward');
create type public.cake_request_status as enum ('new','quoted','confirmed','rejected','completed');
create type public.override_mode as enum ('none','force_open','force_closed');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'staff',
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  last_address text,
  last_landmark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog: categories (with subcategories via parent_id), products, media,
-- variants and add-ons. Nothing here is BBK-specific — every category,
-- product, variant and add-on is admin-created data, not code.
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text unique not null,
  description text,
  image_url text,
  banner_url text,
  display_order int not null default 0,
  is_active boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);
create index categories_parent_id_idx on public.categories(parent_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  name text not null,
  description text,
  ingredients text,
  base_price numeric(10,2) check(base_price >= 0),
  discount_price numeric(10,2) check(discount_price >= 0),
  prep_time_minutes int,
  product_type text not null default 'standard' check(product_type in ('standard','non_food')),
  is_active boolean not null default true,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  is_bestseller boolean not null default false,
  is_recommended boolean not null default false,
  is_seasonal boolean not null default false,
  is_trending boolean not null default false,
  is_hidden boolean not null default false,
  call_to_order boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_id_idx on public.products(category_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  alt_text text,
  display_order int not null default 0
);

create table public.product_variant_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  is_required boolean not null default false,
  display_order int not null default 0
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_variant_groups(id) on delete cascade,
  name text not null,
  price_adjustment numeric(10,2) not null default 0,
  is_custom_input boolean not null default false,
  is_available boolean not null default true,
  display_order int not null default 0
);

create table public.product_addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_addon_links (
  product_id uuid not null references public.products(id) on delete cascade,
  addon_id uuid not null references public.product_addons(id) on delete cascade,
  primary key(product_id, addon_id)
);

-- ---------------------------------------------------------------------------
-- Custom cake requests — not a priced order until the owner quotes it.
-- ---------------------------------------------------------------------------
create table public.custom_cake_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  customer_name text not null,
  phone text not null,
  name_on_cake text,
  cake_message text,
  delivery_date date,
  delivery_time time,
  notes text,
  reference_image_url text,
  status public.cake_request_status not null default 'new',
  quoted_price numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_cake_requests_status_idx on public.custom_cake_requests(status);

-- ---------------------------------------------------------------------------
-- Promotions: coupons (code-based, customer-entered) and offers (automatic /
-- scheduled, no code needed). offer_items links products for combo / free-item
-- offers (a 'trigger' product in the cart unlocks a 'reward' product/discount).
-- ---------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check(discount_type in ('fixed','percent')),
  discount_value numeric(10,2) not null check(discount_value >= 0),
  min_subtotal numeric(10,2) not null default 0,
  max_discount numeric(10,2),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int,
  customer_limit int not null default 1,
  is_active boolean not null default true
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type public.offer_type not null,
  discount_value numeric(10,2) not null default 0,
  applies_to_category_id uuid references public.categories(id),
  applies_to_product_id uuid references public.products(id),
  min_subtotal numeric(10,2) not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  role public.offer_item_role not null,
  quantity int not null default 1
);

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  title text,
  subtitle text,
  link_url text,
  display_order int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  tracking_token uuid not null default gen_random_uuid() unique,
  customer_id uuid not null references public.customers(id),
  status public.order_status not null default 'new',
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  cod_total numeric(10,2) not null,
  -- set null (not the default no-action) so deleting a coupon/offer later
  -- doesn't get blocked by — or destroy — historical orders that used it;
  -- the order keeps its own discount/subtotal figures regardless.
  coupon_id uuid references public.coupons(id) on delete set null,
  offer_id uuid references public.offers(id) on delete set null,
  address text not null,
  landmark text,
  delivery_notes text,
  latitude numeric,
  longitude numeric,
  distance_km numeric,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_idx on public.orders(status);
create index orders_created_at_idx on public.orders(created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- set null, not the default no-action: order_items already snapshots
  -- product_name/base_price/etc. at order time, so it doesn't need the live
  -- product row to stay meaningful, and a deleted product shouldn't be
  -- permanently un-deletable just because it was once ordered.
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  category_id uuid references public.categories(id),
  base_price numeric(10,2) not null,
  variant_name text,
  variant_price numeric(10,2) not null default 0,
  quantity int not null check(quantity > 0),
  line_total numeric(10,2) not null
);
create index order_items_order_id_idx on public.order_items(order_id);

create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  addon_name text not null,
  addon_price numeric(10,2) not null default 0
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity int,
  low_stock_threshold int,
  is_available boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  quantity_change int not null,
  reason text,
  note text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index inventory_adjustments_product_id_idx on public.inventory_adjustments(product_id);

-- ---------------------------------------------------------------------------
-- Settings: global settings + per-category hours (so hours are data, not
-- hardcoded columns — works for any number of categories, now or later).
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id boolean primary key default true check(id),
  restaurant_name text not null default 'Bittu Burger King',
  established_year int not null default 2010,
  address text,
  ordering_enabled boolean not null default true,
  custom_cake_enabled boolean not null default true,
  manual_override public.override_mode not null default 'none',
  restaurant_latitude numeric not null default 25.1982339,
  restaurant_longitude numeric not null default 85.5243586,
  whatsapp_number text not null default '919288400696',
  updated_at timestamptz not null default now()
);

create table public.category_hours (
  category_id uuid primary key references public.categories(id) on delete cascade,
  opens_at time not null default '00:00',
  closes_at time not null default '23:59',
  is_always_open boolean not null default false
);

create table public.delivery_rules (
  id uuid primary key default gen_random_uuid(),
  min_km numeric not null,
  max_km numeric not null,
  minimum_subtotal numeric(10,2) not null,
  is_active boolean not null default true
);

insert into public.business_settings(id) values(true) on conflict do nothing;
insert into public.delivery_rules(min_km, max_km, minimum_subtotal) values (0,3,100),(3,5,300) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger trg_orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger trg_customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger trg_inventory_updated_at before update on public.inventory for each row execute function public.set_updated_at();
create trigger trg_cake_requests_updated_at before update on public.custom_cake_requests for each row execute function public.set_updated_at();
create trigger trg_settings_updated_at before update on public.business_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime — a table only sends postgres_changes events at all if it's in
-- this publication; RLS alone (checked separately, per-subscriber) isn't
-- enough. orders is for the admin Broadcast-based order alert (see
-- create-order); business_settings/products/categories/category_hours are
-- for the customer site picking up admin changes (ordering on/off, an item
-- going out of stock, a schedule change) live, without a page reload.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.business_settings;
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.category_hours;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variant_groups enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_addons enable row level security;
alter table public.product_addon_links enable row level security;
alter table public.custom_cake_requests enable row level security;
alter table public.coupons enable row level security;
alter table public.offers enable row level security;
alter table public.offer_items enable row level security;
alter table public.banners enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_addons enable row level security;
alter table public.order_status_history enable row level security;
alter table public.customers enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.business_settings enable row level security;
alter table public.category_hours enable row level security;
alter table public.delivery_rules enable row level security;

-- Public (anon) read access — storefront only ever sees active/available rows.
create policy "public read active categories" on public.categories for select using (is_active and is_available);
-- Deliberately does NOT require is_available: an out-of-stock published
-- product should still be visible to customers as "Sold out," not disappear.
-- is_active is the publish/draft gate; is_available is the stock toggle.
create policy "public read active products" on public.products for select using (is_active and not is_hidden);
create policy "public read product images" on public.product_images for select using (true);
create policy "public read variant groups" on public.product_variant_groups for select using (true);
create policy "public read variants" on public.product_variants for select using (is_available);
create policy "public read addons" on public.product_addons for select using (is_available);
create policy "public read addon links" on public.product_addon_links for select using (true);
create policy "public read active offers" on public.offers for select using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()));
create policy "public read offer items" on public.offer_items for select using (true);
create policy "public read active banners" on public.banners for select using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()));
create policy "public read business settings" on public.business_settings for select using (true);
create policy "public read category hours" on public.category_hours for select using (true);
create policy "public read delivery rules" on public.delivery_rules for select using (is_active);

-- Admin (owner/staff) full access
create policy "admins read own profile" on public.profiles for select using (id = auth.uid());
create policy "admins manage categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage images" on public.product_images for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage variant groups" on public.product_variant_groups for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage variants" on public.product_variants for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage addons" on public.product_addons for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage addon links" on public.product_addon_links for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage cake requests" on public.custom_cake_requests for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage coupons" on public.coupons for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage offers" on public.offers for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage offer items" on public.offer_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage banners" on public.banners for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage order items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage item addons" on public.order_item_addons for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage status history" on public.order_status_history for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage customers" on public.customers for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage inventory" on public.inventory for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage inventory adjustments" on public.inventory_adjustments for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage settings" on public.business_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage category hours" on public.category_hours for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage delivery rules" on public.delivery_rules for all using (public.is_admin()) with check (public.is_admin());
