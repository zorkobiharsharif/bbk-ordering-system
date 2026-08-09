// Runs on a schedule (pg_cron, every 1 minute — see the migration) rather
// than being called from the app. Re-pushes an alert for every order still
// sitting unhandled, so staff/owner can't miss one just because they didn't
// notice or acted on the first push. Stops on its own two ways: an order
// naturally drops out of this query the moment its status changes away
// from "new"/"address_needs_check" (accepted, cancelled, etc.), and the
// 20-minute cutoff below stops nagging a phone nobody's actually checking
// (e.g. after hours) instead of pushing forever.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const cors = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: pending, error: pendingError } = await db
      .from('orders')
      .select('id,order_number,cod_total,created_at')
      .in('status', ['new', 'address_needs_check'])
      .gte('created_at', new Date(Date.now() - 20 * 60 * 1000).toISOString());
    if (pendingError) return json({ step: 'fetch_pending', error: pendingError.message }, 500);
    if (!pending || !pending.length) return json({ resent: 0 });

    webpush.setVapidDetails(
      `mailto:${Deno.env.get('VAPID_CONTACT_EMAIL')!}`,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );
    const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth,admin_users!inner(is_active)').eq('admin_users.is_active', true);

    let resent = 0;
    for (const order of pending) {
      const payload = JSON.stringify({
        title: 'BBK order still waiting',
        body: `#BBK-${order.order_number} · ₹${order.cod_total} · not yet accepted`,
        url: 'index.html',
        tag: `order-${order.id}`,
      });
      await Promise.all((subs || []).map(async (sub: any) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          resent++;
        } catch (sendError: any) {
          if (sendError?.statusCode === 404 || sendError?.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          else console.error('resend push failed', sub.endpoint, sendError?.message || sendError);
        }
      }));
    }
    return json({ resent, pendingOrders: pending.length });
  } catch (outerError: any) {
    console.error(outerError);
    return json({ error: outerError?.message || String(outerError) }, 500);
  }
});
