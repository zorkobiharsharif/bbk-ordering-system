import { db, state, isOwner } from './state.js';
import { $, money, openForm, toast, friendlyError } from './utils.js';

export async function renderSettings(root) {
  const [{ data: settings }, { data: rules }] = await Promise.all([
    db.from('business_settings').select('*').eq('id', true).single(),
    db.from('delivery_rules').select('*').order('min_km'),
  ]);

  root.innerHTML = `
    <section class="panel">
      <h2>Restaurant</h2>
      <form data-settings-form>
        <div class="form-grid">
          <label>Restaurant name<input name="restaurant_name" value="${settings.restaurant_name}"></label>
          <label>Established year<input type="number" name="established_year" value="${settings.established_year}"></label>
          <label class="full">Address<input name="address" value="${settings.address || ''}"></label>
          <label class="full">Google Maps link (shown as "Get directions")<input name="maps_link" value="${settings.maps_link || ''}" placeholder="https://maps.app.goo.gl/..."></label>
          <label>WhatsApp number (with country code)<input name="whatsapp_number" value="${settings.whatsapp_number}"></label>
          <label>Latitude<input type="number" step="0.0000001" name="restaurant_latitude" value="${settings.restaurant_latitude}"></label>
          <label>Longitude<input type="number" step="0.0000001" name="restaurant_longitude" value="${settings.restaurant_longitude}"></label>
          <label class="check"><input type="checkbox" name="ordering_enabled" ${settings.ordering_enabled ? 'checked' : ''}> Online ordering is on</label>
          <label class="check"><input type="checkbox" name="custom_cake_enabled" ${settings.custom_cake_enabled ? 'checked' : ''}> Custom cake requests are on</label>
        </div>
        <button>Save settings</button>
        ${!isOwner() ? '<p class="hint">Only the owner account can save changes here.</p>' : ''}
      </form>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Delivery rules</h2><button data-new-rule>Add rule</button></div>
      <p class="hint">Distance is measured from the restaurant's latitude/longitude above.</p>
      <div data-rule-list></div>
    </section>
    <section class="panel">
      <h2>Image sizes</h2>
      <p class="hint">Full sizes for every photo on the site now live on their own page — see <button type="button" class="link-nav" data-view="image-guide">Image Guide</button> in the sidebar.</p>
    </section>`;

  $('[data-settings-form]', root).addEventListener('submit', async event => {
    event.preventDefault();
    if (!isOwner()) return toast('Only the owner can change settings.', 'error');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const { error } = await db.from('business_settings').update({
      restaurant_name: values.restaurant_name, established_year: Number(values.established_year),
      address: values.address || null, maps_link: values.maps_link || null, whatsapp_number: values.whatsapp_number,
      restaurant_latitude: Number(values.restaurant_latitude), restaurant_longitude: Number(values.restaurant_longitude),
      ordering_enabled: form.ordering_enabled.checked, custom_cake_enabled: form.custom_cake_enabled.checked,
    }).eq('id', true);
    if (error) toast(friendlyError(error), 'error'); else toast('Settings saved.');
  });

  const loadRules = async () => {
    const { data } = await db.from('delivery_rules').select('*').order('min_km');
    $('[data-rule-list]', root).innerHTML = (data || []).map(r => `
      <article class="admin-row">
        <div><b>${r.min_km}–${r.max_km} km</b><small>Min order ₹${money(r.minimum_subtotal)}</small></div>
        <div class="row-actions">
          <button data-edit-rule="${r.id}">Edit</button>
          <button class="danger" data-delete-rule="${r.id}">Delete</button>
        </div>
      </article>`).join('') || '<p class="hint">No delivery rules — every order will be treated as out of range.</p>';
  };

  $('[data-new-rule]', root).addEventListener('click', () => ruleForm(null, loadRules));
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-rule]');
    const del = event.target.closest('[data-delete-rule]');
    if (edit) { const { data } = await db.from('delivery_rules').select('*').eq('id', edit.dataset.editRule).single(); ruleForm(data, loadRules); }
    if (del) { if (!confirm('Delete this delivery rule?')) return; await db.from('delivery_rules').delete().eq('id', del.dataset.deleteRule); loadRules(); }
  });

  await loadRules();
}

async function ruleForm(rule, reload) {
  openForm(`
    <h2 class="form-title">${rule ? 'Edit' : 'Add'} delivery rule</h2>
    <div class="form-grid">
      <label>From (km)<input type="number" min="0" step="0.1" name="min_km" required value="${rule?.min_km ?? 0}"></label>
      <label>To (km)<input type="number" min="0" step="0.1" name="max_km" required value="${rule?.max_km ?? ''}"></label>
      <label class="full">Minimum order (₹)<input type="number" min="0" name="minimum_subtotal" required value="${rule?.minimum_subtotal ?? 0}"></label>
      <label class="check"><input type="checkbox" name="is_active" ${rule?.is_active !== false ? 'checked' : ''}> Active</label>
    </div>
    <button>${rule ? 'Save' : 'Add'} rule</button>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    const record = { min_km: Number(v.min_km), max_km: Number(v.max_km), minimum_subtotal: Number(v.minimum_subtotal), is_active: form.is_active.checked };
    const result = rule ? await db.from('delivery_rules').update(record).eq('id', rule.id) : await db.from('delivery_rules').insert(record);
    if (result.error) throw result.error;
    toast('Delivery rule saved.');
    reload();
  });
}
