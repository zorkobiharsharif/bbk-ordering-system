import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const distance = (a:number,b:number,c:number,d:number) => { const r=6371, x=(c-a)*Math.PI/180, y=(d-b)*Math.PI/180, n=Math.sin(x/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2; return 2*r*Math.asin(Math.sqrt(n)); };
const effectivePrice = (p: { base_price: number; discount_price?: number | null }) => (p.discount_price && Number(p.discount_price) < Number(p.base_price)) ? Number(p.discount_price) : Number(p.base_price);

// Sending a Realtime broadcast via the JS client's channel.send() opens a
// websocket and can silently drop the message if the function returns (and
// the process is torn down) before that connection finishes handshaking —
// exactly the kind of intermittent "sometimes no alert" failure a
// short-lived edge function is prone to. The REST broadcast endpoint is a
// single plain HTTP POST — no connection lifecycle to race.
async function broadcast(topic: string, event: string, payload: unknown) {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')!}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }),
    });
    if (!res.ok) console.error('broadcast failed', res.status, await res.text());
  } catch (broadcastError) { console.error('broadcast failed', broadcastError); }
}

// Same pattern already proven working in isolation (test-push,
// resend-pending-order-alerts) before being wired in here. Every failure
// path — a bad subscription, a VAPID/config problem, anything — is caught
// and logged, never re-thrown, so a push problem can never fail the order
// itself. admin_users!inner + is_active means a disabled account's devices
// stop getting pushed to immediately.
async function sendPushNotifications(db: ReturnType<typeof createClient>, orderId: string, orderNumber: number, codTotal: number) {
  try {
    webpush.setVapidDetails(
      `mailto:${Deno.env.get('VAPID_CONTACT_EMAIL')!}`,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );
    const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth,admin_users!inner(is_active)').eq('admin_users.is_active', true);
    const payload = JSON.stringify({ title: 'New BBK order', body: `#BBK-${orderNumber} · ₹${codTotal} · tap to view`, url: 'index.html', tag: `order-${orderId}` });
    await Promise.all((subs || []).map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (sendError: any) {
        if (sendError?.statusCode === 404 || sendError?.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        else console.error('push send failed', sub.endpoint, sendError?.message || sendError);
      }
    }));
  } catch (pushError) { console.error('push notifications failed', pushError); }
}

// Free, native-app alternative/backup to push — sidesteps the whole
// "browser/OS kills background web push" class of problem, since Telegram
// itself handles delivery. Same fully-defensive shape as sendPushNotifications:
// nothing here can ever fail or delay the order itself.
async function sendTelegramAlerts(db: ReturnType<typeof createClient>, orderNumber: number, codTotal: number) {
  try {
    const { data: settings } = await db.from('business_settings').select('telegram_chat_ids').eq('id', true).single();
    const chatIds: number[] = settings?.telegram_chat_ids || [];
    if (!chatIds.length) return;
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
    const text = `New BBK order #${orderNumber} — ₹${codTotal}. Open the admin app to view/accept it.`;
    await Promise.all(chatIds.map(async chatId => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (!res.ok) console.error('telegram send failed', chatId, await res.text());
      } catch (sendError) { console.error('telegram send failed', chatId, sendError); }
    }));
  } catch (telegramError) { console.error('telegram alerts failed', telegramError); }
}


const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMinutesIST = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
};
const isOpen = (hours: { opens_at: string; closes_at: string; is_always_open: boolean }, nowMin: number) => {
  if (hours.is_always_open) return true;
  const open = toMinutes(hours.opens_at), close = toMinutes(hours.closes_at);
  return close > open ? (nowMin >= open && nowMin < close) : (nowMin >= open || nowMin < close);
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json(); const customer = body.customer || {}, lines = body.lines || [];
    // GPS location is mandatory (business requirement) — address/landmark is
    // now a supplementary note the customer may leave for the rider, not a
    // substitute for a real location. A request with no lat/long is rejected
    // outright rather than falling back to the old "address_needs_check"
    // manual-review status.
    if (!/^[0-9]{10}$/.test(customer.phone || '') || !customer.name?.trim() || !Array.isArray(lines) || !lines.length) return json({ error: 'Please enter your name, phone and order.' }, 400);
    if (!body.location?.latitude || !body.location?.longitude) return json({ error: 'Please share your location to place the order.' }, 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settings } = await db.from('business_settings').select('*').eq('id', true).single();
    if (!settings?.ordering_enabled) return json({ error: 'Online ordering is currently closed. Please call BBK.' }, 400);
    if (settings.manual_override === 'force_closed') return json({ error: 'BBK is closed right now. Please call to order.' }, 400);

    const ids = [...new Set(lines.map((l:any) => l.productId))];
    const { data: products } = await db.from('products').select('id,name,category_id,base_price,discount_price,is_active,is_available,product_variant_groups(id,product_variants(id,name,price_adjustment,is_available)),product_addon_links(product_addons(id,name,price,is_available))').in('id', ids);
    if (!products || products.length !== ids.length) return json({ error: 'One or more menu items are no longer available.' }, 400);

    if (settings.manual_override !== 'force_open') {
      const categoryIds = [...new Set(products.map((p: any) => p.category_id))];
      const { data: hours } = await db.from('category_hours').select('category_id,opens_at,closes_at,is_always_open,categories(name)').in('category_id', categoryIds);
      const nowMin = nowMinutesIST();
      const closed = (hours || []).find((h: any) => !isOpen(h, nowMin));
      if (closed) return json({ error: `${closed.categories?.name || 'This category'} isn't taking orders right now (opens ${closed.opens_at.slice(0,5)}).` }, 400);
    }

    let subtotal = 0; const verified:any[] = [];
    for (const line of lines) {
      const product:any = products.find((p:any) => p.id === line.productId); if (!product?.is_active || !product.is_available || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) return json({ error: 'Please review item availability and quantity.' }, 400);
      const variant = product.product_variant_groups.flatMap((g:any) => g.product_variants).find((v:any) => v.id === line.variant?.id && v.is_available);
      const addons = (line.addons || []).map((a:any) => product.product_addon_links.map((x:any) => x.product_addons).find((x:any) => x?.id === a.id && x.is_available)).filter(Boolean);
      const unit = effectivePrice(product) + Number(variant?.price_adjustment || 0) + addons.reduce((n:number,a:any) => n + Number(a.price), 0); subtotal += unit * line.quantity;
      verified.push({ product, variant, addons, quantity: line.quantity, unit });
    }
    // Automatic offers (percent/flat, no code needed) — best one wins rather
    // than stacking multiple, to keep this predictable for a small business.
    // free_item/combo were removed — only percent/flat exist now.
    let offer: any = null, offerDiscount = 0;
    {
      const now = new Date();
      const { data: offers } = await db.from('offers').select('*').eq('is_active', true).in('type', ['percent', 'flat']);
      for (const o of offers || []) {
        if (o.starts_at && new Date(o.starts_at) > now) continue;
        if (o.ends_at && new Date(o.ends_at) < now) continue;
        const eligibleSubtotal = verified.filter(l => (!o.applies_to_product_id || l.product.id === o.applies_to_product_id) && (!o.applies_to_category_id || l.product.category_id === o.applies_to_category_id)).reduce((n, l) => n + l.unit * l.quantity, 0);
        if (eligibleSubtotal <= 0 || eligibleSubtotal < Number(o.min_subtotal)) continue;
        const candidateDiscount = o.type === 'percent' ? eligibleSubtotal * Number(o.discount_value) / 100 : Math.min(Number(o.discount_value), eligibleSubtotal);
        if (candidateDiscount > offerDiscount) { offerDiscount = candidateDiscount; offer = o; }
      }
    }
    let coupon:any = null, discount = offerDiscount;
    if (body.coupon) { const { data } = await db.from('coupons').select('*').eq('code', String(body.coupon).toUpperCase()).eq('is_active', true).maybeSingle(); coupon = data; const now = new Date(); if (!coupon || (coupon.starts_at && new Date(coupon.starts_at)>now) || (coupon.ends_at && new Date(coupon.ends_at)<now) || subtotal < Number(coupon.min_subtotal)) return json({ error: 'This coupon is not valid for this order.' },400); let couponDiscount = coupon.discount_type === 'percent' ? subtotal * Number(coupon.discount_value) / 100 : Number(coupon.discount_value); if (coupon.max_discount) couponDiscount = Math.min(couponDiscount, Number(coupon.max_discount)); discount += couponDiscount; }
    discount = Math.min(discount, subtotal);
    const status = 'new';
    const distanceKm = distance(Number(settings.restaurant_latitude),Number(settings.restaurant_longitude),Number(body.location.latitude),Number(body.location.longitude));
    if (distanceKm > 5) return json({ error: 'This location is beyond 5 km. Please call BBK.' },400);
    const min = distanceKm > 3 ? 300 : 100; if (subtotal < min) return json({ error: `Minimum order is ₹${min} in this area.` },400);
    const addressNote = (customer.address || '').trim() || null;
    const { data: savedCustomer, error: customerError } = await db.from('customers').upsert({ name: customer.name.trim(), phone: customer.phone, last_address: addressNote, last_landmark: customer.landmark || null }, { onConflict: 'phone' }).select().single(); if (customerError) throw customerError;
    const { data: order, error: orderError } = await db.from('orders').insert({ customer_id:savedCustomer.id,status,subtotal,discount,cod_total:subtotal-discount,coupon_id:coupon?.id || null,offer_id:offer?.id || null,address:addressNote,landmark:customer.landmark || null,delivery_notes:customer.notes || null,latitude:body.location.latitude,longitude:body.location.longitude,distance_km:distanceKm }).select().single(); if (orderError) throw orderError;
    for (const line of verified) {
      const { data:item, error } = await db.from('order_items').insert({ order_id:order.id,product_id:line.product.id,product_name:line.product.name,category_id:line.product.category_id,base_price:line.product.base_price,variant_name:line.variant?.name || null,variant_price:line.variant?.price_adjustment || 0,quantity:line.quantity,line_total:line.unit*line.quantity }).select().single(); if(error) throw error;
      if(line.addons.length) await db.from('order_item_addons').insert(line.addons.map((a:any)=>({order_item_id:item.id,addon_name:a.name,addon_price:a.price})));
    }
    await db.from('order_status_history').insert({ order_id:order.id,status });

    // Reduce stock for any product that has inventory tracking turned on. Not
    // every product is stock-tracked (inventory row is opt-in per product in
    // Admin -> Inventory), so a missing row just means "not tracked" — skip it.
    for (const line of verified) {
      try {
        const { data: stock } = await db.from('inventory').select('product_id,quantity').eq('product_id', line.product.id).maybeSingle();
        if (stock && stock.quantity !== null) {
          const nextQuantity = Math.max(0, Number(stock.quantity) - line.quantity);
          await db.from('inventory').update({ quantity: nextQuantity }).eq('product_id', line.product.id);
          await db.from('inventory_adjustments').insert({ product_id: line.product.id, quantity_change: -line.quantity, reason: 'order', note: `Order #${order.order_number}` });
        }
      } catch (stockError) { console.error('inventory update failed', stockError); }
    }

    const itemText = verified.map(l => `• ${l.product.name}${l.variant ? ` (${l.variant.name})` : ''}${l.addons.length ? ` + ${l.addons.map((a:any)=>a.name).join(', ')}` : ''} × ${l.quantity}`).join('\n'); const hasGps = body.location?.latitude && body.location?.longitude; const gpsLines = hasGps ? `Latitude: ${body.location.latitude}\nLongitude: ${body.location.longitude}\nMap: https://www.google.com/maps?q=${body.location.latitude},${body.location.longitude}` : 'GPS location: Not shared'; const message = `BBK ORDER #${order.order_number}\n\nCustomer: ${customer.name}\nPhone: ${customer.phone}\nAddress note: ${addressNote || '-'}\nLandmark: ${customer.landmark || '-'}\n${gpsLines}\n\nItems:\n${itemText}\n\nSubtotal: ₹${subtotal}\n${offer ? `Offer applied: ${offer.name}\n` : ''}Discount: ₹${discount}\nCOD total: ₹${subtotal-discount}\nCash to collect: ₹${subtotal-discount}\n\nDelivery note: ${customer.notes || '-'}`;

    // Admin "new order" notifications can't use postgres_changes here: that
    // relies on RLS (is_admin()), which in turn reads the x-admin-session
    // HTTP header via PostgREST's request.headers — a mechanism the Realtime
    // websocket protocol never populates, so is_admin() always evaluates
    // false for a realtime subscriber and RLS silently blocks every admin
    // from ever receiving the event. A Broadcast message sent from here
    // (service-role, no RLS involved) sidesteps that entirely. Only a
    // rounded amount and order number go out — no customer PII.
    await broadcast('orders-live', 'new_order', { orderId: order.id, orderNumber: order.order_number, codTotal: subtotal - discount });
    // Reaches devices even with the admin app fully closed — the broadcast
    // above only reaches an already-open tab. Fully defensive internally
    // (see sendPushNotifications) — cannot fail or delay the order itself.
    await sendPushNotifications(db, order.id, order.order_number, subtotal - discount);
    await sendTelegramAlerts(db, order.order_number, subtotal - discount);

    return json({ orderNumber: order.order_number, trackingToken: order.tracking_token, whatsappUrl: `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(message)}` });
  } catch (error) { console.error(error); return json({ error: 'We could not create the order. Please call BBK.' }, 500); }
});
