import { db } from './state.js';
import { $, money, openForm, toast, badge, toLocalInputValue, fromLocalInputValue, friendlyError, loadingRow } from './utils.js';

function couponStatus(c) {
  if (!c.is_active) return ['Paused', 'muted'];
  const now = new Date();
  if (c.starts_at && new Date(c.starts_at) > now) return ['Scheduled', 'warn'];
  // Distinct from "Paused" (muted/grey, same tone) — expired is a dead end
  // (the end date has passed, re-activating won't help), paused is a
  // reversible owner choice. Red makes that difference visible at a glance.
  if (c.ends_at && new Date(c.ends_at) < now) return ['Expired', 'error'];
  return ['Live', 'good'];
}

export async function renderCoupons(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Coupons</h2><button data-new-coupon>Create coupon</button></div>
      <div data-coupon-list>${loadingRow()}</div>
    </section>`;

  const load = async () => {
    const { data } = await db.from('coupons').select('*').order('code');
    $('[data-coupon-list]', root).innerHTML = (data || []).map(c => `
      <article class="admin-row">
        <div><b>${c.code}</b><small>${c.discount_type === 'percent' ? `${c.discount_value}%` : `₹${money(c.discount_value)}`} off</small></div>
        <div><small>Min ₹${money(c.min_subtotal)}</small><small>${c.ends_at ? `Ends ${new Date(c.ends_at).toLocaleDateString('en-IN')}` : 'No expiry'}</small></div>
        ${badge(...couponStatus(c))}
        <div class="row-actions">
          <button data-edit-coupon="${c.id}">Edit</button>
          <button data-toggle-coupon="${c.id}" data-active="${c.is_active}">${c.is_active ? 'Pause' : 'Activate'}</button>
          <button class="danger" data-delete-coupon="${c.id}">Delete</button>
        </div>
      </article>`).join('') || '<p class="hint">No coupons created yet.</p>';
  };

  $('[data-new-coupon]', root).addEventListener('click', () => couponForm(null, load));
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-coupon]');
    const toggle = event.target.closest('[data-toggle-coupon]');
    const del = event.target.closest('[data-delete-coupon]');
    if (edit) { const { data } = await db.from('coupons').select('*').eq('id', edit.dataset.editCoupon).single(); couponForm(data, load); }
    if (toggle) { await db.from('coupons').update({ is_active: toggle.dataset.active !== 'true' }).eq('id', toggle.dataset.toggleCoupon); load(); }
    if (del) {
      if (!confirm('Delete this coupon? This cannot be undone.')) return;
      const { error } = await db.from('coupons').delete().eq('id', del.dataset.deleteCoupon);
      if (error) toast(friendlyError(error), 'error'); else { toast('Coupon deleted.'); load(); }
    }
  });

  await load();
}

async function couponForm(coupon, reload) {
  openForm(`
    <h2 class="form-title">${coupon ? 'Edit' : 'Create'} coupon</h2>
    <div class="form-grid">
      <label>Code<input name="code" required value="${coupon?.code || ''}" ${coupon ? 'readonly' : ''}></label>
      <label>Discount type<select name="discount_type"><option value="fixed" ${coupon?.discount_type === 'fixed' ? 'selected' : ''}>₹ off</option><option value="percent" ${coupon?.discount_type === 'percent' ? 'selected' : ''}>Percent</option></select></label>
      <label>Discount<input name="discount_value" type="number" min="0" step="0.01" required value="${coupon?.discount_value ?? ''}"></label>
      <label>Max discount (₹, optional)<input name="max_discount" type="number" min="0" value="${coupon?.max_discount ?? ''}"></label>
      <label>Minimum subtotal<input name="min_subtotal" type="number" min="0" value="${coupon?.min_subtotal ?? 0}" required></label>
      <label>Usage limit (total, optional)<input name="usage_limit" type="number" min="1" value="${coupon?.usage_limit ?? ''}"></label>
      <label>Per-customer limit<input name="customer_limit" type="number" min="1" value="${coupon?.customer_limit ?? 1}" required></label>
      <label>Starts<input type="datetime-local" name="starts_at" value="${toLocalInputValue(coupon?.starts_at)}"></label>
      <label>Ends<input type="datetime-local" name="ends_at" value="${toLocalInputValue(coupon?.ends_at)}"></label>
      <label class="check"><input type="checkbox" name="is_active" ${coupon?.is_active !== false ? 'checked' : ''}> Active</label>
    </div>
    <button>${coupon ? 'Save' : 'Create'} coupon</button>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    const record = {
      discount_type: v.discount_type,
      discount_value: Number(v.discount_value),
      max_discount: v.max_discount ? Number(v.max_discount) : null,
      min_subtotal: Number(v.min_subtotal) || 0,
      usage_limit: v.usage_limit ? Number(v.usage_limit) : null,
      customer_limit: Number(v.customer_limit) || 1,
      starts_at: fromLocalInputValue(v.starts_at),
      ends_at: fromLocalInputValue(v.ends_at),
      is_active: form.is_active.checked,
    };
    if (!coupon) record.code = v.code.toUpperCase().trim();
    const result = coupon ? await db.from('coupons').update(record).eq('id', coupon.id) : await db.from('coupons').insert(record);
    if (result.error) throw result.error;
    toast(`Coupon ${coupon ? 'updated' : 'created'}.`);
    reload();
  });
}
