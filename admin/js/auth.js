import { db, state, getSession, clearSession } from './state.js';
import { $ } from './utils.js';

// This page (admin/index.html) has no login form of its own any more —
// unauthenticated visitors are sent to /owner/ or /staff/, which are the
// only places a session token gets created. Whether the token is still
// valid *for real* is decided by the database on every actual data
// request (is_admin()/is_owner() check admin_sessions server-side); this
// local expiry check is just so an expired/tampered token shows the login
// page immediately instead of a broken, empty dashboard.
export function guard(onReady) {
  const session = getSession();
  if (!session?.token || !session.expiresAt || new Date(session.expiresAt) <= new Date()) {
    clearSession();
    location.href = '/owner/';
    return;
  }
  state.profile = { id: session.userId, username: session.username, role: session.role };
  $('[data-app]').hidden = false;
  $('[data-date]').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  onReady();
}

export function wireSignOut() {
  document.addEventListener('click', async event => {
    if (!event.target.closest('[data-signout]')) return;
    const session = getSession();
    clearSession();
    try { await db.functions.invoke('admin-logout', { body: { token: session?.token } }); } catch { /* best-effort */ }
    location.href = '/owner/';
  });
}
