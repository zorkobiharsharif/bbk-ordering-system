// Custom lightweight auth (no Supabase Auth): the browser holds a random
// session token from admin-login in localStorage and sends it on every
// request as the x-admin-session header. The database's is_admin()/
// is_owner() functions (supabase/custom-auth.sql) look that token up in
// admin_sessions to decide what's allowed — RLS enforcement is unchanged,
// only how "who is this" is determined.
const SESSION_KEY = 'bbk-admin-session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export const db = window.supabase.createClient(BBK_CONFIG.supabaseUrl, BBK_CONFIG.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, options = {}) => {
      const session = getSession();
      const headers = new Headers(options.headers || {});
      if (session?.token) headers.set('x-admin-session', session.token);
      return fetch(url, { ...options, headers });
    },
  },
});

export const state = {
  profile: null, // set on load to { id, username, role } from the stored session
};

export function isOwner() {
  return state.profile?.role === 'owner';
}
