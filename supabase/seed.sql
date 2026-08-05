-- ============================================================================
-- BBK starter catalog — run once, after schema.sql, on a fresh project.
--
-- Pricing note: every Cake, Pastry and Birthday Item below is inserted with
-- base_price = 0 and is_active = false. That is a deliberate "draft, not
-- published yet" state, not a fake price — is_active is the publish gate
-- (the public read policy requires is_active), so these products are
-- completely invisible to customers until you set a real price in
-- Admin -> Products and switch Published on. (is_available is the separate
-- *stock* toggle — an out-of-stock published product still shows to
-- customers as "Sold out" rather than disappearing; it just doesn't apply
-- to drafts, since drafts aren't shown at all.)
-- Burgers already have real prices from the design brief and are published
-- and in stock immediately. Snacks and Beverages are seeded as empty
-- categories only, per instruction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (id, name, slug, display_order) values
  ('10000000-0000-0000-0000-000000000001','Burgers','burgers',1),
  ('10000000-0000-0000-0000-000000000002','Cakes','eggless-cakes',2),
  ('10000000-0000-0000-0000-000000000003','Pastries','pastries',3),
  ('10000000-0000-0000-0000-000000000004','Birthday Items','birthday-items',4),
  ('10000000-0000-0000-0000-000000000005','Snacks','snacks',5),
  ('10000000-0000-0000-0000-000000000006','Beverages','beverages',6)
on conflict (id) do nothing;

insert into public.category_hours (category_id, opens_at, closes_at, is_always_open) values
  ('10000000-0000-0000-0000-000000000001','15:00','22:00', false), -- Burgers
  ('10000000-0000-0000-0000-000000000002','10:00','22:00', false), -- Cakes
  ('10000000-0000-0000-0000-000000000003','10:00','22:00', false), -- Pastries (bakery hours)
  ('10000000-0000-0000-0000-000000000004','00:00','23:59', true),  -- Birthday Items
  ('10000000-0000-0000-0000-000000000005','00:00','23:59', true),  -- Snacks
  ('10000000-0000-0000-0000-000000000006','00:00','23:59', true)   -- Beverages
on conflict (category_id) do nothing;
-- Pastries/Snacks/Beverages/Birthday-Items hours are a starting default —
-- edit any of them in Admin -> Business Hours, per category.

-- ---------------------------------------------------------------------------
-- Burgers — real prices, published and in stock immediately
-- ---------------------------------------------------------------------------
insert into public.products (id, category_id, name, description, base_price, is_active, is_available, is_featured) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cream Cheese Burger','Pure veg BBK burger with creamy cheese flavour.',65,true,true,true),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Cream Burger','Soft, creamy and student-friendly.',50,true,true,true),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Cheese Burger','Simple cheesy bite with BBK taste.',55,true,true,false),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Regular Burger','Classic pure veg burger for everyday cravings.',55,true,true,false),
  ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Paneer Cheese Cream Burger','Paneer, cheese and cream in one filling burger.',85,true,true,true),
  ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','Tandoor Paneer Burger','Tandoori-style paneer flavour in a veg burger.',65,true,true,false),
  ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','Masala Tikki Burger','Spicy tikki burger made for quick evening hunger.',50,true,true,false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cakes — 12 flavours, 100% eggless, draft (unpublished) until priced
-- ---------------------------------------------------------------------------
insert into public.products (id, category_id, name, description, base_price, is_active, is_available) values
  ('20000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000002','Strawberry Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000102','10000000-0000-0000-0000-000000000002','Strawberry Jelly Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000002','Chocolate Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000104','10000000-0000-0000-0000-000000000002','Chocolate Chips Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000105','10000000-0000-0000-0000-000000000002','Chocolate Truffle Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000106','10000000-0000-0000-0000-000000000002','Butterscotch Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000107','10000000-0000-0000-0000-000000000002','Buttery Crunch Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000108','10000000-0000-0000-0000-000000000002','Black Forest Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000109','10000000-0000-0000-0000-000000000002','Chocolate Marble Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000110','10000000-0000-0000-0000-000000000002','Pineapple Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000002','Oreo Chocolate Cake','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000112','10000000-0000-0000-0000-000000000002','White Forest Cake','100% eggless.',0,false,true)
on conflict (id) do nothing;

-- Every cake gets the same weight ladder: 500 gm / 1 / 1.5 / 2 / 3 / 4 Pound / Custom Weight.
-- price_adjustment is 0 (unset) on every step — set each weight's real price in
-- Admin -> Products -> [cake] -> Manage variants & add-ons once you have a price list.
do $$
declare
  cake record;
  grp_id uuid;
begin
  for cake in select id from public.products where category_id = '10000000-0000-0000-0000-000000000002' loop
    insert into public.product_variant_groups (id, product_id, name, is_required, display_order)
    values (gen_random_uuid(), cake.id, 'Weight', true, 1)
    returning id into grp_id;

    insert into public.product_variants (group_id, name, price_adjustment, is_custom_input, display_order) values
      (grp_id, '500 gm', 0, false, 1),
      (grp_id, '1 Pound', 0, false, 2),
      (grp_id, '1.5 Pound', 0, false, 3),
      (grp_id, '2 Pound', 0, false, 4),
      (grp_id, '3 Pound', 0, false, 5),
      (grp_id, '4 Pound', 0, false, 6),
      (grp_id, 'Custom Weight', 0, true, 7);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Pastries — single-serve, no weight variants, draft until priced
-- ---------------------------------------------------------------------------
insert into public.products (id, category_id, name, description, base_price, is_active, is_available) values
  ('20000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000003','Red Velvet Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000202','10000000-0000-0000-0000-000000000003','Chocolate Chips Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000203','10000000-0000-0000-0000-000000000003','Chocolate Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000204','10000000-0000-0000-0000-000000000003','Black Forest Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000205','10000000-0000-0000-0000-000000000003','Milk Badam Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000206','10000000-0000-0000-0000-000000000003','Badam Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000207','10000000-0000-0000-0000-000000000003','Butterscotch Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000208','10000000-0000-0000-0000-000000000003','Cup Cake Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000209','10000000-0000-0000-0000-000000000003','Chocolate Bell Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000210','10000000-0000-0000-0000-000000000003','Chocolate Lava Pastry','100% eggless.',0,false,true),
  ('20000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000003','Varakat Rasmalai Pastry','100% eggless.',0,false,true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Birthday Items — non-food party supplies, no veg badge, no weight variants,
-- draft until priced
-- ---------------------------------------------------------------------------
insert into public.products (id, category_id, name, description, base_price, is_active, is_available, product_type) values
  ('20000000-0000-0000-0000-000000000301','10000000-0000-0000-0000-000000000004','Party Popper',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000302','10000000-0000-0000-0000-000000000004','Party Balloons',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000303','10000000-0000-0000-0000-000000000004','Candles',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000304','10000000-0000-0000-0000-000000000004','Party Spray',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000305','10000000-0000-0000-0000-000000000004','Happy Birthday Card',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000306','10000000-0000-0000-0000-000000000004','Number Candle',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000307','10000000-0000-0000-0000-000000000004','Number Balloons',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000308','10000000-0000-0000-0000-000000000004','Happy Birthday Balloons',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000309','10000000-0000-0000-0000-000000000004','Girl Cap',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000310','10000000-0000-0000-0000-000000000004','Boy Cap',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000004','Girl Crown',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000312','10000000-0000-0000-0000-000000000004','Birthday Boy King Crown',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000313','10000000-0000-0000-0000-000000000004','Sparkle Candles',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000314','10000000-0000-0000-0000-000000000004','Annaprashan Items',null,0,false,true,'non_food'),
  ('20000000-0000-0000-0000-000000000315','10000000-0000-0000-0000-000000000004','Triangle Candles',null,0,false,true,'non_food')
on conflict (id) do nothing;

-- Snacks and Beverages: categories only, no starter items (by your instruction).
