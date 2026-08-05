# BBK direct ordering platform

## What is included

- **Customer site**: dynamic menu (categories, subcategories, variants, add-ons), cake weight options, a custom cake request flow, coupon entry, COD, location-aware delivery rules, business-hours-aware ordering, sold-out states, and WhatsApp handoff.
- **Admin portal**: Dashboard (with a big, hard-to-miss ordering on/off switch), Orders (with CSV export), Products (grouped by category), Categories (including bulk "mark whole category out of stock"), Custom Cake Requests, Customers, Offers, Coupons, Reports (with CSV/Excel/PDF export), Business Hours, Banners, Image Manager, Notifications (live order counter, sound, browser alerts via Supabase Realtime) and Settings — all as real per-feature modules in `admin/js/`, no build step.
- **Supabase**: schema, RLS policies, storage buckets and secure Edge Functions (`create-order`, `custom-cake-request`, `validate-coupon`) that re-verify price, stock, coupons, delivery distance and business hours server-side — the client is never trusted for any of that.
- **Authentication**: a custom, lightweight username/password system — **not Supabase Auth**. Passwords are bcrypt-hashed in a plain `admin_users` table (via Postgres's own `pgcrypto`), sessions are random tokens in `admin_sessions`, and the browser sends its token as a request header the database checks on every call. One shared sign-in page at `/owner` (an old `/staff` URL still works — it just redirects there) — what you can see and do depends on your account's role, not which URL you used to sign in.

## Launch setup — run these in order

1. Create a Supabase project.
2. In the SQL Editor, run, in order:
   1. [`supabase/schema.sql`](supabase/schema.sql) — tables, RLS, triggers, Realtime.
   2. [`supabase/seed.sql`](supabase/seed.sql) — starter categories and products. **Read the note at the top of that file**: Cakes, Pastries and Birthday Items are seeded as unpublished drafts with no price (never a guessed number) — they won't appear on the site until you set a real price and switch them on on in Admin → Products. Burgers are real and live immediately. Snacks and Beverages are empty categories, ready for you to fill in.
   3. [`supabase/storage.sql`](supabase/storage.sql) — the `bbk-public` (product/category/banner photos) and `bbk-cake-references` (customer-uploaded cake reference photos) buckets and their policies.
   4. [`supabase/permissions.sql`](supabase/permissions.sql) — splits owner vs. staff database permissions (staff can't reach pricing, coupons, offers, reports, settings, banners or category management even via a direct API call, not just a hidden button).
   5. [`supabase/custom-auth.sql`](supabase/custom-auth.sql) — the login system itself: `admin_users`/`admin_sessions` tables, password hashing, and session-aware versions of the permission checks from step 4. Seeds two starter accounts: username `owner` / password `Owner@123`, and username `staff` / password `Staff@123`. **Change both immediately after your first login** (there's a "Change password" button in the admin sidebar).
3. Deploy the Edge Functions with the Supabase CLI: `create-order`, `custom-cake-request`, `validate-coupon`, `admin-login`, `admin-logout`, `admin-change-password`, `admin-manage-staff`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to every Edge Function by Supabase — you do not need to set them yourself, and Supabase will refuse to let you override them manually.
4. Add the project URL and **public anon key** to [`js/config.js`](js/config.js). Never add a service-role key here.
5. Sign in at `/owner` with the seeded credentials above, change the passwords, and from there the **owner** can create/disable/delete further staff accounts directly from Admin → Staff Management — no SQL needed for that going forward.
6. In the admin portal:
   - **Categories**: adjust Snacks/Beverages, add any more you need.
   - **Products**: set real prices for Cakes/Pastries/Birthday Items and switch **Published** on for each once ready. Use **Manage variants & add-ons** on each cake to price every weight option (500 gm through 4 Pound, plus Custom Weight for bespoke orders).
   - **Business Hours**: confirm or adjust the per-category schedule seeded for you.
   - **Settings**: confirm WhatsApp number, restaurant coordinates, and whether custom cake requests are on.
7. Upload real BBK photos through each product/category/banner's own edit screen (or the Image Manager for a general library) — nothing here should stay a placeholder once photos exist.
8. Deploy this folder to Vercel over HTTPS (required for browser location access).

## Required real images

- Hero burger: 1600 × 1000 px desktop; 1080 × 1350 px mobile.
- Product image: 1200 × 900 px landscape.
- Cake banner: 1600 × 1000 px.
- Offer banner: 1600 × 700 px.

## Important WhatsApp note

A saved customer order (or custom cake request) opens WhatsApp with a complete ready-to-send message to BBK. The customer must tap **Send**. Automatic customer-side WhatsApp updates need an approved WhatsApp Business API provider and would be a separate, later integration — the in-browser admin notifications (sound + browser notification + live counter) cover the owner-facing "someone just ordered" alert today without one.
