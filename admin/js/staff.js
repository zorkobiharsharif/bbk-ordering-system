import { db, getSession } from './state.js';
import { $, openForm, toast, badge, edgeFunctionErrorMessage, friendlyError, loadingRow } from './utils.js';

async function callStaffFunction(payload) {
  const { data, error } = await db.functions.invoke('admin-manage-staff', { body: { ...payload, token: getSession()?.token } });
  if (error) throw new Error(await edgeFunctionErrorMessage(error, 'Request failed.'));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function renderStaff(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Staff accounts</h2><button data-new-staff>Add staff account</button></div>
      <p class="hint">Staff can view and act on orders and product availability. They cannot see reports, pricing, coupons, offers or settings — enforced at the database level, not just hidden here.</p>
      <div data-staff-list>${loadingRow()}</div>
    </section>
    <section class="panel">
      <h2>Recent staff activity</h2>
      <p class="hint">Order status changes, most recent first.</p>
      <div data-activity-list>${loadingRow()}</div>
    </section>`;

  const load = async () => {
    $('[data-staff-list]', root).innerHTML = loadingRow();
    try {
      const { staff } = await callStaffFunction({ action: 'list' });
      $('[data-staff-list]', root).innerHTML = staff.map(s => `
        <article class="admin-row">
          <div><b>${s.username}</b><small>${s.role}</small></div>
          <div><small>${s.last_login_at ? `Last login ${new Date(s.last_login_at).toLocaleString('en-IN')}` : 'Never signed in'}</small></div>
          ${s.is_active ? badge('Active', 'good') : badge('Disabled', 'error')}
          <div class="row-actions">
            ${s.role === 'staff' ? `
              <button data-reset-password="${s.id}">Reset password</button>
              <button data-toggle-staff="${s.id}" data-active="${s.is_active}">${s.is_active ? 'Disable' : 'Enable'}</button>
              <button class="danger" data-delete-staff="${s.id}">Delete</button>` : ''}
          </div>
        </article>`).join('');
    } catch (error) {
      $('[data-staff-list]', root).innerHTML = `<p class="hint">${error.message}</p>`;
    }
  };

  const loadActivity = async () => {
    const { data } = await db.from('order_status_history').select('status,created_at,orders(order_number),admin_users(username)').order('created_at', { ascending: false }).limit(25);
    $('[data-activity-list]', root).innerHTML = (data || []).map(h => `<div class="history-row"><span>${new Date(h.created_at).toLocaleString('en-IN')}</span><b>${h.admin_users?.username || 'System'}</b><small>#BBK-${h.orders?.order_number ?? '—'} → ${h.status}</small></div>`).join('') || '<p class="hint">No activity yet.</p>';
  };

  $('[data-new-staff]', root).addEventListener('click', () => staffForm(load));
  root.addEventListener('click', async event => {
    const reset = event.target.closest('[data-reset-password]');
    const toggle = event.target.closest('[data-toggle-staff]');
    const del = event.target.closest('[data-delete-staff]');
    if (reset) resetPasswordForm(reset.dataset.resetPassword, load);
    if (toggle) {
      try {
        await callStaffFunction({ action: toggle.dataset.active === 'true' ? 'disable' : 'enable', staffId: toggle.dataset.toggleStaff });
        toast('Staff account updated.');
        load();
      } catch (error) { toast(friendlyError(error), 'error'); }
    }
    if (del) {
      if (!confirm('Delete this staff account? This cannot be undone.')) return;
      try {
        await callStaffFunction({ action: 'delete', staffId: del.dataset.deleteStaff });
        toast('Staff account deleted.');
        load();
      } catch (error) { toast(friendlyError(error), 'error'); }
    }
  });

  await Promise.all([load(), loadActivity()]);
}

function staffForm(reload) {
  openForm(`
    <h2 class="form-title">Add staff account</h2>
    <div class="form-grid">
      <label class="full">Username<input name="username" required pattern="[a-z0-9_.\\-]+" title="Lowercase letters, numbers, . _ - only"></label>
      <label class="full">Temporary password<input type="text" name="password" required minlength="6" placeholder="At least 6 characters"></label>
    </div>
    <button>Create account</button>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    await callStaffFunction({ action: 'create', username: v.username, password: v.password });
    toast('Staff account created.');
    reload();
  });
}

function resetPasswordForm(staffId, reload) {
  openForm(`
    <h2 class="form-title">Reset password</h2>
    <div class="form-grid">
      <label class="full">New password<input type="text" name="password" required minlength="6" placeholder="At least 6 characters"></label>
    </div>
    <button>Reset password</button>
  `, async form => {
    const password = new FormData(form).get('password');
    await callStaffFunction({ action: 'reset_password', staffId, password });
    toast('Password reset.');
    reload();
  });
}
