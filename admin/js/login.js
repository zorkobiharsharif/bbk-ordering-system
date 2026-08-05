// Shared by owner/index.html and staff/index.html. Whichever page a person
// lands on is just a label — the account's real role always comes from
// admin_users in the database, so logging in with staff credentials on the
// owner page (or vice versa) still works, and the shared admin app then
// shows exactly what that role is allowed to see.
(() => {
  const db = window.supabase.createClient(BBK_CONFIG.supabaseUrl, BBK_CONFIG.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const form = document.querySelector('[data-login-form]');
  const errorNode = document.querySelector('[data-login-error]');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    // Capture everything synchronously, before any `await` — event.currentTarget
    // stops being valid once the event finishes dispatching, which happens
    // the instant this handler yields at its first await.
    const formEl = event.currentTarget;
    const button = formEl.querySelector('button');
    const values = Object.fromEntries(new FormData(formEl));
    errorNode.textContent = '';
    button.disabled = true;
    try {
      const { data, error } = await db.functions.invoke('admin-login', { body: { username: values.username, password: values.password } });
      if (error) {
        const body = error.context?.body ? await error.context.text?.() ?? error.context.body : null;
        let message = 'Could not sign in. Please try again.';
        try { message = JSON.parse(body)?.error || message; } catch { /* keep default */ }
        errorNode.textContent = message;
        return;
      }
      if (data?.error) { errorNode.textContent = data.error; return; }
      localStorage.setItem('bbk-admin-session', JSON.stringify(data));
      location.href = window.bbkPath('/admin/');
    } catch (err) {
      console.error('Unexpected sign-in error:', err);
      errorNode.textContent = 'Something went wrong signing in. Please try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
