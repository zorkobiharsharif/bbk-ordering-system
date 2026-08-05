import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-session' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: session } = await admin.from('admin_sessions').select('role').eq('token', body.token || '').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (session?.role !== 'owner') return json({ error: 'Only the owner account can manage staff.' }, 403);

    if (body.action === 'list') {
      const { data } = await admin.from('admin_users').select('id,username,role,is_active,last_login_at,created_at').order('created_at');
      return json({ staff: data || [] });
    }

    if (body.action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!username || !body.password) return json({ error: 'Username and password are required.' }, 400);
      if (body.password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);
      const { data: hash } = await admin.rpc('hash_password', { p_password: body.password });
      const { error } = await admin.from('admin_users').insert({ username, password_hash: hash, role: 'staff' });
      if (error) return json({ error: error.message.includes('duplicate') ? 'That username is already taken.' : error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === 'reset_password') {
      if (!body.password || body.password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);
      const { data: target } = await admin.from('admin_users').select('username').eq('id', body.staffId).single();
      const { error } = await admin.rpc('set_admin_password', { p_username: target.username, p_password: body.password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === 'disable' || body.action === 'enable') {
      const { data: target } = await admin.from('admin_users').select('role').eq('id', body.staffId).single();
      if (target?.role === 'owner') return json({ error: 'The owner account cannot be disabled.' }, 400);
      const { error } = await admin.from('admin_users').update({ is_active: body.action === 'enable' }).eq('id', body.staffId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === 'delete') {
      const { data: target } = await admin.from('admin_users').select('role').eq('id', body.staffId).single();
      if (target?.role === 'owner') return json({ error: 'The owner account cannot be deleted.' }, 400);
      const { error } = await admin.from('admin_users').delete().eq('id', body.staffId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: 'Staff management request failed.' }, 500);
  }
});
