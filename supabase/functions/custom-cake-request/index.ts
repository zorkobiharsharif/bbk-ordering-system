import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// See create-order's broadcast() for why this is a plain REST POST rather
// than channel.send() over a websocket the function might tear down before
// the message actually goes out.
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

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json();
    const name = String(body.customerName || '').trim();
    const phone = String(body.phone || '').trim();
    const deliveryDate = body.deliveryDate ? String(body.deliveryDate) : null;

    if (!name || !/^[0-9]{10}$/.test(phone) || !deliveryDate) {
      return json({ error: 'Please share your name, a 10-digit phone number and the delivery date.' }, 400);
    }
    if (new Date(deliveryDate) < new Date(new Date().toDateString())) {
      return json({ error: 'Delivery date cannot be in the past.' }, 400);
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settings } = await db.from('business_settings').select('custom_cake_enabled,whatsapp_number').eq('id', true).single();
    if (!settings?.custom_cake_enabled) return json({ error: 'Custom cake requests are paused right now. Please call BBK.' }, 400);

    if (body.productId) {
      const { data: product } = await db.from('products').select('id').eq('id', body.productId).eq('is_active', true).maybeSingle();
      if (!product) return json({ error: 'The selected cake flavour is no longer available.' }, 400);
    }

    const { data: requestRow, error } = await db.from('custom_cake_requests').insert({
      product_id: body.productId || null,
      customer_name: name,
      phone,
      name_on_cake: body.nameOnCake ? String(body.nameOnCake).slice(0, 100) : null,
      cake_message: body.cakeMessage ? String(body.cakeMessage).slice(0, 300) : null,
      delivery_date: deliveryDate,
      delivery_time: body.deliveryTime || null,
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
      reference_image_url: body.referenceImageUrl || null,
    }).select().single();
    if (error) throw error;

    // Same reasoning as create-order's broadcast: RLS can't be satisfied over
    // the Realtime websocket connection with this app's custom auth, so the
    // admin app can never receive postgres_changes here — a service-role
    // Broadcast sidesteps that. Only name + delivery date go out, no phone.
    await broadcast('cake-requests-live', 'new_cake_request', { customerName: name, deliveryDate });

    const message = `BBK CUSTOM CAKE REQUEST\n\nName: ${name}\nPhone: ${phone}\nDelivery date: ${deliveryDate}${body.deliveryTime ? ` at ${body.deliveryTime}` : ''}\nName on cake: ${body.nameOnCake || '-'}\nMessage on cake: ${body.cakeMessage || '-'}\nNotes: ${body.notes || '-'}\n\nWe will confirm the price and details on WhatsApp shortly.`;
    return json({
      requestId: requestRow.id,
      whatsappUrl: `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(message)}`,
    });
  } catch (error) {
    console.error(error);
    return json({ error: 'We could not submit your custom cake request. Please call BBK.' }, 500);
  }
});
