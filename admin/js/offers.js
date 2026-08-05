import { db } from './state.js';
import { $, money, openForm, toast, badge, toLocalInputValue, fromLocalInputValue, loadingRow } from './utils.js';

const TYPE_LABEL = { percent: 'Percentage off', flat: 'Flat amount off' };

function isLive(o) {
  const now = new Date();
  return o.is_active && (!o.starts_at || new Date(o.starts_at) <= now) && (!o.ends_at || new Date(o.ends_at) >= now);
}

export async function renderOffers(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Offers</h2><button data-new-offer>Create offer</button></div>
      <p class="hint">Automatic, no code entry needed — coupons (code-based) are managed separately.</p>
      <div data-offer-list>${loadingRow()}</div>
    </section>`;

  const load = async () => {
    const { data } = await db.from('offers').select('*,categories(name),products(name)').order('display_order');
    $('[data-offer-list]', root).innerHTML = (data || []).map(o => `
      <article class="admin-row">
        <div><b>${o.name}</b><small>${TYPE_LABEL[o.type] || o.type}${o.categories ? ` · ${o.categories.name}` : ''}${o.products ? ` · ${o.products.name}` : ''}</small></div>
        <div>${isLive(o) ? badge('Live', 'good') : badge(o.is_active ? 'Scheduled' : 'Paused', o.is_active ? 'warn' : 'muted')}<small>${o.type === 'percent' ? `${o.discount_value}%` : `₹${money(o.discount_value)}`}</small></div>
        <div class="row-actions">
          <button data-edit-offer="${o.id}">Edit</button>
          <button class="danger" data-delete-offer="${o.id}">Delete</button>
        </div>
      </article>`).join('') || '<p class="hint">No offers created yet.</p>';
  };

  $('[data-new-offer]', root).addEventListener('click', () => offerForm(null, load));
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-offer]');
    const del = event.target.closest('[data-delete-offer]');
    if (edit) { const { data } = await db.from('offers').select('*').eq('id', edit.dataset.editOffer).single(); offerForm(data, load); }
    if (del) { if (!confirm('Delete this offer?')) return; await db.from('offers').delete().eq('id', del.dataset.deleteOffer); load(); }
  });

  await load();
}

async function offerForm(offer, reload) {
  const [{ data: categories }, { data: products }] = await Promise.all([
    db.from('categories').select('id,name').order('name'),
    db.from('products').select('id,name,category_id').order('name'),
  ]);
  const categoryOptions = `<option value="">— all categories —</option>` + (categories || []).map(c => `<option value="${c.id}" ${offer?.applies_to_category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('');

  // "Applies to product" used to list every product regardless of the
  // category picked above — you could end up with e.g. category = Burgers
  // + product = a cake, a combination that can never match any cart line
  // (a product can't be in two categories at once), so the offer would
  // silently never apply. This keeps the product list scoped to whichever
  // category is currently selected, so that combination can't happen.
  const productOptionsFor = categoryId => `<option value="">— all products${categoryId ? ' in this category' : ''} —</option>` +
    (products || []).filter(p => !categoryId || p.category_id === categoryId).map(p => `<option value="${p.id}" ${offer?.applies_to_product_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('');

  openForm(`
    <h2 class="form-title">${offer ? 'Edit' : 'Create'} offer</h2>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${offer?.name || ''}"></label>
      <label class="full">Description<input name="description" value="${offer?.description || ''}"></label>
      <label>Type<select name="type">${Object.entries(TYPE_LABEL).map(([v, l]) => `<option value="${v}" ${offer?.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Value (% or ₹)<input type="number" min="0" step="0.01" name="discount_value" value="${offer?.discount_value ?? 0}"></label>
      <label>Applies to category<select name="applies_to_category_id">${categoryOptions}</select></label>
      <label>Applies to product<select name="applies_to_product_id">${productOptionsFor(offer?.applies_to_category_id || '')}</select><small class="hint">Narrowed to the category above, if one is picked.</small></label>
      <label>Minimum subtotal (₹)<input type="number" min="0" name="min_subtotal" value="${offer?.min_subtotal ?? 0}"></label>
      <label>Starts<input type="datetime-local" name="starts_at" value="${toLocalInputValue(offer?.starts_at)}"></label>
      <label>Ends<input type="datetime-local" name="ends_at" value="${toLocalInputValue(offer?.ends_at)}"></label>
      <label class="check"><input type="checkbox" name="is_active" ${offer?.is_active !== false ? 'checked' : ''}> Active</label>
    </div>
    <button>${offer ? 'Save' : 'Create'} offer</button>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    const record = {
      name: v.name.trim(), description: v.description || null, type: v.type,
      discount_value: Number(v.discount_value) || 0,
      applies_to_category_id: v.applies_to_category_id || null,
      applies_to_product_id: v.applies_to_product_id || null,
      min_subtotal: Number(v.min_subtotal) || 0,
      starts_at: fromLocalInputValue(v.starts_at), ends_at: fromLocalInputValue(v.ends_at),
      is_active: form.is_active.checked,
    };
    const result = offer ? await db.from('offers').update(record).eq('id', offer.id) : await db.from('offers').insert(record);
    if (result.error) throw result.error;
    toast(`Offer ${offer ? 'updated' : 'created'}.`);
    reload();
  });

  $('[data-admin-form] select[name="applies_to_category_id"]').addEventListener('change', event => {
    // Switching category invalidates whatever product was picked under the
    // old one — rebuild the list rather than leave a now-mismatched product
    // silently selected.
    $('[data-admin-form] select[name="applies_to_product_id"]').innerHTML = productOptionsFor(event.target.value);
  });
}
