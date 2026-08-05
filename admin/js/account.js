import { db, state, getSession } from './state.js';
import { openForm, toast, edgeFunctionErrorMessage } from './utils.js';

export function wireChangePassword() {
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-change-password]')) return;
    openForm(`
      <h2 class="form-title">Change password</h2>
      <p class="hint">Signed in as <b>${state.profile?.username}</b> (${state.profile?.role}).</p>
      <div class="form-grid">
        <label class="full">New password<input type="text" name="newPassword" required minlength="6" placeholder="At least 6 characters"></label>
      </div>
      <button>Save new password</button>
    `, async form => {
      const newPassword = new FormData(form).get('newPassword');
      const { data, error } = await db.functions.invoke('admin-change-password', {
        body: { token: getSession()?.token, targetUsername: state.profile?.username, newPassword },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error, 'Could not change password.'));
      if (data?.error) throw new Error(data.error);
      toast('Password changed.');
    });
  });
}
