-- ============================================================================
-- BBK owner/staff permission split — run once, after schema.sql/seed.sql/
-- storage.sql are already installed. Safe to re-run (drops + recreates its
-- own policies/trigger only; touches no tables, no data).
--
-- Why this exists: schema.sql's is_admin() treats "owner" and "staff" as the
-- same thing — any signed-in admin profile gets full database access. That
-- was fine before staff accounts existed. Now that the product requires
-- "staff must never reach owner-only data or actions, even via a direct API
-- call" — not just a hidden button — that's a real permission bug, not a
-- redesign, so it's fixed here rather than left as a UI-only restriction.
-- ============================================================================

-- is_owner()/is_admin() are NOT redefined here — custom-auth.sql (run after
-- this file) is the one true definition, session-token based. An older
-- auth.uid()-based version used to live here; re-running that after
-- custom-auth.sql would silently break every permission check in the app,
-- so it's gone for good rather than left as a landmine for a future re-run.

-- ---------------------------------------------------------------------------
-- Owner-only tables: catalog structure, pricing config, promotions, business
-- rules, and financial-adjacent data. Staff has no access at all here —
-- dropping the old "admins manage X" policy removes staff's access too,
-- since it's replaced by an owner-scoped one.
-- ---------------------------------------------------------------------------
drop policy if exists "admins manage categories" on public.categories;
drop policy if exists "owner manage categories" on public.categories;
create policy "owner manage categories" on public.categories for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage images" on public.product_images;
drop policy if exists "owner manage images" on public.product_images;
create policy "owner manage images" on public.product_images for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage variant groups" on public.product_variant_groups;
drop policy if exists "owner manage variant groups" on public.product_variant_groups;
create policy "owner manage variant groups" on public.product_variant_groups for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage variants" on public.product_variants;
drop policy if exists "owner manage variants" on public.product_variants;
create policy "owner manage variants" on public.product_variants for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage addons" on public.product_addons;
drop policy if exists "owner manage addons" on public.product_addons;
create policy "owner manage addons" on public.product_addons for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage addon links" on public.product_addon_links;
drop policy if exists "owner manage addon links" on public.product_addon_links;
create policy "owner manage addon links" on public.product_addon_links for all using (public.is_owner()) with check (public.is_owner());

-- Cake requests: staff handles these day to day same as orders (view, quote,
-- update status). An earlier version of this file narrowed this to
-- owner-only ("owner manage cake requests") — drop that back to the shared
-- admin policy so staff has full access again.
drop policy if exists "owner manage cake requests" on public.custom_cake_requests;
drop policy if exists "admins manage cake requests" on public.custom_cake_requests;
create policy "admins manage cake requests" on public.custom_cake_requests for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage coupons" on public.coupons;
drop policy if exists "owner manage coupons" on public.coupons;
create policy "owner manage coupons" on public.coupons for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage offers" on public.offers;
drop policy if exists "owner manage offers" on public.offers;
create policy "owner manage offers" on public.offers for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage offer items" on public.offer_items;
drop policy if exists "owner manage offer items" on public.offer_items;
create policy "owner manage offer items" on public.offer_items for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage banners" on public.banners;
drop policy if exists "owner manage banners" on public.banners;
create policy "owner manage banners" on public.banners for all using (public.is_owner()) with check (public.is_owner());

-- Business settings: staff may flip online ordering on/off and the manual
-- open/closed override (the same "is BBK taking orders right now" lever as
-- the dashboard switch) — everything else here (restaurant name, address,
-- WhatsApp number, coordinates, custom-cake toggle) stays owner-only, same
-- pattern as enforce_staff_product_limits() below.
drop policy if exists "owner manage settings" on public.business_settings;
drop policy if exists "admins manage settings" on public.business_settings;
create policy "admins manage settings" on public.business_settings for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.enforce_staff_settings_limits() returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_role public.user_role;
begin
  caller_role := public.current_admin_role();
  if caller_role = 'staff' and (
    new.restaurant_name is distinct from old.restaurant_name or
    new.established_year is distinct from old.established_year or
    new.address is distinct from old.address or
    new.maps_link is distinct from old.maps_link or
    new.whatsapp_number is distinct from old.whatsapp_number or
    new.restaurant_latitude is distinct from old.restaurant_latitude or
    new.restaurant_longitude is distinct from old.restaurant_longitude or
    new.custom_cake_enabled is distinct from old.custom_cake_enabled
  ) then
    raise exception 'Staff accounts can only change online ordering and the open/closed override, not other settings.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_staff_settings_limits on public.business_settings;
create trigger trg_enforce_staff_settings_limits before update on public.business_settings for each row execute function public.enforce_staff_settings_limits();

drop policy if exists "admins manage category hours" on public.category_hours;
drop policy if exists "owner manage category hours" on public.category_hours;
create policy "owner manage category hours" on public.category_hours for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "admins manage delivery rules" on public.delivery_rules;
drop policy if exists "owner manage delivery rules" on public.delivery_rules;
create policy "owner manage delivery rules" on public.delivery_rules for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Products: staff needs to see everything (to know what to mark sold out)
-- and toggle availability, but must not create, delete, or re-price. RLS
-- policies can't restrict individual columns, so INSERT/DELETE are
-- owner-only, and a trigger blocks staff from changing any column except
-- is_available/is_hidden on UPDATE.
-- ---------------------------------------------------------------------------
drop policy if exists "admins manage products" on public.products;
drop policy if exists "admins select products" on public.products;
drop policy if exists "admins update products" on public.products;
drop policy if exists "owner insert products" on public.products;
drop policy if exists "owner delete products" on public.products;
create policy "admins select products" on public.products for select using (public.is_admin());
create policy "admins update products" on public.products for update using (public.is_admin()) with check (public.is_admin());
create policy "owner insert products" on public.products for insert with check (public.is_owner());
create policy "owner delete products" on public.products for delete using (public.is_owner());

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

drop trigger if exists trg_enforce_staff_product_limits on public.products;
create trigger trg_enforce_staff_product_limits before update on public.products for each row execute function public.enforce_staff_product_limits();

-- ---------------------------------------------------------------------------
-- Profiles: every admin can already read their own row (schema.sql). Owner
-- additionally needs to read/manage every profile for Staff Management.
-- ---------------------------------------------------------------------------
drop policy if exists "owner manage all profiles" on public.profiles;
create policy "owner manage all profiles" on public.profiles for all using (public.is_owner()) with check (public.is_owner());

-- orders, order_items, order_item_addons, order_status_history, inventory,
-- inventory_adjustments and customers are intentionally left on the shared
-- is_admin() policies from schema.sql — staff needs these to accept, kitchen,
-- deliver and stock-manage orders day to day.
