import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { username, password } = await request.json();
    if (!username?.trim() || !password) return json({ error: 'Enter a username and password.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.rpc('verify_admin_login', { p_username: username.trim().toLowerCase(), p_password: password });
    if (error) throw error;
    if (!data?.length) return json({ error: 'Incorrect username or password.' }, 401);

    const { user_id, role } = data[0];
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
    const { error: sessionError } = await admin.from('admin_sessions').insert({ token, admin_user_id: user_id, role, expires_at: expiresAt });
    if (sessionError) throw sessionError;
    await admin.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('id', user_id);

    return json({ token, role, userId: user_id, username: username.trim().toLowerCase(), expiresAt });
  } catch (error) {
    console.error(error);
    return json({ error: 'Could not sign in. Please try again.' }, 500);
  }
});
