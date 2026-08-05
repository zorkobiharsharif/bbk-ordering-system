import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { token, targetUsername, newPassword } = await request.json();
    if (!newPassword || newPassword.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: session } = await admin.from('admin_sessions').select('role, admin_user_id, admin_users(username)').eq('token', token || '').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!session) return json({ error: 'Your session has expired. Please sign in again.' }, 401);

    // Owners can change anyone's password (including their own). Staff can
    // only change their own.
    const isSelf = (session as any).admin_users?.username === targetUsername;
    if (session.role !== 'owner' && !isSelf) return json({ error: 'Only the owner can change another account\'s password.' }, 403);

    const { error } = await admin.rpc('set_admin_password', { p_username: targetUsername, p_password: newPassword });
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ error: 'Could not change the password. Please try again.' }, 500);
  }
});
