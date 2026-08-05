-- ============================================================================
-- BBK storage buckets — run after schema.sql.
--
-- bbk-public         : product/category/banner photos. Public read, admin-only write.
-- bbk-cake-references: customer-uploaded "what should the cake look like" photos
--                      for custom cake requests. NOT public — only admins can read
--                      them back; anyone can upload (no login required to submit
--                      a custom cake request), capped at 5MB, images only.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bbk-public', 'bbk-public', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bbk-cake-references', 'bbk-cake-references', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "public read bbk-public" on storage.objects for select using (bucket_id = 'bbk-public');
create policy "admins write bbk-public" on storage.objects for insert with check (bucket_id = 'bbk-public' and public.is_admin());
create policy "admins update bbk-public" on storage.objects for update using (bucket_id = 'bbk-public' and public.is_admin());
create policy "admins delete bbk-public" on storage.objects for delete using (bucket_id = 'bbk-public' and public.is_admin());

create policy "anyone upload cake reference" on storage.objects for insert with check (bucket_id = 'bbk-cake-references');
create policy "admins read cake references" on storage.objects for select using (bucket_id = 'bbk-cake-references' and public.is_admin());
create policy "admins delete cake references" on storage.objects for delete using (bucket_id = 'bbk-cake-references' and public.is_admin());
