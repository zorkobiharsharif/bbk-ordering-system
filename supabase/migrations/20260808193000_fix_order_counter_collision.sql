-- Orders #1-20 already exist (real orders placed since the last cleanup).
-- The earlier "restart with 1" migration got re-applied by a second
-- `supabase db push` run and reset the counter back to 1, colliding with
-- those existing order numbers and making every new order fail with a
-- unique-constraint violation. This moves it past the real data instead.
alter table public.orders alter column order_number restart with 21;
