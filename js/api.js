window.BBKApi = (() => {
  const configured = () => Boolean(BBK_CONFIG.supabaseUrl && BBK_CONFIG.supabaseAnonKey && window.supabase);
  // A single, memoized client — calling createClient() again on every
  // menu()/createOrder()/coupon()/etc. call spins up a second GoTrueClient
  // sharing the same localStorage auth key, which the Supabase SDK itself
  // warns is undefined behavior. One instance for the page's lifetime.
  let instance = null;
  const client = () => {
    if (!configured()) return null;
    if (!instance) instance = window.supabase.createClient(BBK_CONFIG.supabaseUrl, BBK_CONFIG.supabaseAnonKey);
    return instance;
  };

  // supabase-js's FunctionsHttpError exposes the failed response as
  // `error.context`, a real Response whose `.body` is a ReadableStream, not
  // a string — `JSON.parse(error.context.body)` always throws
  // ("Unexpected token 'o', \"[object Rea\"...") because it's stringifying
  // the stream object itself, never the text. The response body can only be
  // read once, so this must be the one place every call site reads it.
  async function edgeFunctionErrorMessage(error, fallback) {
    try {
      const text = await error.context?.text?.();
      return text ? JSON.parse(text).error || fallback : fallback;
    } catch {
      return fallback;
    }
  }

  async function menu() {
    if (!configured()) throw new Error('Menu is not connected yet. Please call BBK.');
    const db = client();
    const [{ data: categories, error: categoryError }, { data: products, error: productError }, { data: settings }, { data: offers }, { data: banners }] = await Promise.all([
      db.from('categories').select('id,name,slug,parent_id,image_url,banner_url,display_order,category_hours(opens_at,closes_at,is_always_open)').eq('is_active', true).order('display_order'),
      db.from('products').select('id,name,description,base_price,discount_price,category_id,is_available,is_featured,is_bestseller,is_recommended,is_seasonal,is_trending,call_to_order,product_type,categories(name),product_images(url,alt_text,display_order),product_variant_groups(id,name,is_required,product_variants(id,name,price_adjustment,is_custom_input,is_available)),product_addon_links(product_addons(id,name,price,is_available))').eq('is_active', true).order('display_order'),
      db.from('business_settings').select('ordering_enabled,manual_override,custom_cake_enabled,whatsapp_number,restaurant_name,established_year,address,maps_link').eq('id', true).single(),
      db.from('offers').select('id,name,type,discount_value,applies_to_category_id,applies_to_product_id,min_subtotal,starts_at,ends_at').eq('is_active', true).in('type', ['percent', 'flat']),
      db.from('banners').select('id,image_url,title,subtitle,link_url,display_order').order('display_order'),
    ]);
    if (categoryError || productError) throw new Error('Menu is temporarily unavailable.');
    const products2 = (products || []).map(p => ({ ...p, category: p.categories }));
    return { categories: categories || [], products: products2, settings: settings || null, offers: offers || [], banners: banners || [] };
  }

  async function createOrder(payload) {
    if (!configured()) throw new Error('Ordering is not connected yet. Please call BBK.');
    const { data, error } = await client().functions.invoke('create-order', { body: payload });
    if (error) throw new Error(await edgeFunctionErrorMessage(error, 'We could not place your order. Please call BBK.'));
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function coupon(code, lines) {
    if (!configured()) throw new Error('Coupons will work after BBK connects Supabase.');
    const { data, error } = await client().functions.invoke('validate-coupon', { body: { code: (code || '').toUpperCase(), lines } });
    if (error) throw new Error(await edgeFunctionErrorMessage(error, 'Invalid coupon.'));
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function uploadCakeReference(file) {
    if (!configured() || !file) return null;
    const path = `${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`;
    const { error } = await client().storage.from('bbk-cake-references').upload(path, file);
    if (error) return null;
    return path;
  }

  async function customCakeRequest(payload) {
    if (!configured()) throw new Error('Custom cake requests are not connected yet. Please call BBK.');
    const { data, error } = await client().functions.invoke('custom-cake-request', { body: payload });
    if (error) throw new Error(await edgeFunctionErrorMessage(error, 'We could not submit your request. Please call BBK.'));
    if (data?.error) throw new Error(data.error);
    return data;
  }

  // So admin changes (ordering on/off, an item going out of stock, a price
  // edit) show up for a customer already browsing, without them having to
  // reload the page. `products`/`categories`/`business_settings` all have
  // public RLS read policies with a plain column condition (not this app's
  // custom admin-session auth), so — unlike the admin panel's own realtime
  // notifications — postgres_changes works fine here for an anonymous
  // visitor. Callback fires on any relevant change; callers decide what to
  // re-fetch.
  function subscribeToMenuChanges(onChange) {
    if (!configured()) return () => {};
    const db = client();
    const channel = db.channel('customer-menu-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_settings' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'category_hours' }, onChange)
      .subscribe();
    return () => db.removeChannel(channel);
  }

  return { menu, createOrder, coupon, uploadCakeReference, customCakeRequest, subscribeToMenuChanges, configured };
})();
