-- ============================================================================
-- Adds a Google Maps link to business_settings so the owner can actually
-- change the customer-facing "Get directions" link and address from
-- Settings, instead of it being hardcoded in index.html. Safe to re-run.
-- ============================================================================
alter table public.business_settings add column if not exists maps_link text;

update public.business_settings
set maps_link = 'https://maps.app.goo.gl/KH1SRA5mgphx66aZ6',
    address = coalesce(address, 'Bhaisasur, Kalika Chowk, Bihar Sharif, 803101')
where id = true and maps_link is null;
