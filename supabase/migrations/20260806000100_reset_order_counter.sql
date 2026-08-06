-- Reset the order-number counter after clearing all QA/test orders, so the
-- client's first real order is #1 instead of continuing from wherever
-- testing left off. Run once in the Supabase Dashboard: SQL Editor -> New
-- query -> paste -> Run. Safe to run only now, right after the orders table
-- was emptied — running this later with real orders present would just
-- change future numbering, not touch existing rows.
alter table public.orders alter column order_number restart with 1;
