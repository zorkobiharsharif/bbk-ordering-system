import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const effectivePrice = (p: { base_price: number; discount_price?: number | null }) => (p.discount_price && Number(p.discount_price) < Number(p.base_price)) ? Number(p.discount_price) : Number(p.base_price);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { code, lines } = await request.json();
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const ids = [...new Set((lines || []).map((l: any) => l.productId))];
    const { data: products } = await db.from('products').select('id,base_price,discount_price,product_variant_groups(id,product_variants(id,price_adjustment)),product_addon_links(product_addons(id,price))').in('id', ids);

    // Re-derive the subtotal server-side the same way create-order does
    // (effective price + variant + add-ons), instead of trusting whatever
    // the client sends — this is only a preview, but it must match what
    // create-order will actually charge, or the discount shown here would
    // be wrong and the min-subtotal eligibility check could pass/fail
    // incorrectly.
    const subtotal = (lines || []).reduce((n: number, l: any) => {
      const product: any = products?.find((p: any) => p.id === l.productId);
      if (!product) return n;
      const variant = product.product_variant_groups.flatMap((g: any) => g.product_variants).find((v: any) => v.id === l.variant?.id);
      const addons = (l.addons || []).map((a: any) => product.product_addon_links.map((x: any) => x.product_addons).find((x: any) => x?.id === a.id)).filter(Boolean);
      const unit = effectivePrice(product) + Number(variant?.price_adjustment || 0) + addons.reduce((s: number, a: any) => s + Number(a.price), 0);
      return n + unit * Number(l.quantity || 0);
    }, 0);

    const { data: coupon } = await db.from('coupons').select('*').eq('code', String(code || '').toUpperCase()).eq('is_active', true).maybeSingle();
    const now = new Date();
    if (!coupon || subtotal < Number(coupon.min_subtotal) || (coupon.starts_at && new Date(coupon.starts_at) > now) || (coupon.ends_at && new Date(coupon.ends_at) < now)) throw new Error('Invalid coupon');
    let discount = coupon.discount_type === 'percent' ? subtotal * Number(coupon.discount_value) / 100 : Number(coupon.discount_value);
    if (coupon.max_discount) discount = Math.min(discount, Number(coupon.max_discount));
    return new Response(JSON.stringify({ code: coupon.code, discount }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid coupon' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
