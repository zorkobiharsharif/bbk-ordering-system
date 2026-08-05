import { db, isOwner } from './state.js';
import { $, money, openForm, toast, uploadPublicImage, badge, imageHint, checkImageRatio, friendlyError } from './utils.js';

const FLAGS = [
  ['is_featured', 'Featured'], ['is_bestseller', 'Best seller'], ['is_recommended', 'Recommended'],
  ['is_seasonal', 'Seasonal'], ['is_trending', 'Trending'], ['is_hidden', 'Hidden'],
];

async function loadCategories() {
  const { data } = await db.from('categories').select('id,name,parent_id').order('display_order');
  return data || [];
}

function needsPricing(p) {
  return Number(p.base_price) === 0 && !p.is_active;
}

export async function renderProducts(root) {
  if (!isOwner()) return renderProductsStaff(root);

  const categories = await loadCategories();
  const categoryFilterOptions = `<option value="all">All categories</option>` + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Products</h2>${isOwner() ? '<button data-new-product>Add product</button>' : ''}</div>
      ${isOwner() ? '' : '<p class="hint">You can view products and mark them in/out of stock. Pricing, publishing and deleting are owner-only.</p>'}
      <div class="export-row">
        <input type="search" data-product-search placeholder="Search products…" class="search-box">
        <select data-product-category-filter>${categoryFilterOptions}</select>
      </div>
      <div data-product-list></div>
    </section>`;

  const categoryOrder = Object.fromEntries(categories.map((c, i) => [c.id, i]));

  const load = async () => {
    const { data } = await db.from('products').select('id,name,category_id,base_price,discount_price,is_available,is_active,is_hidden,categories(name)').order('name');
    const term = $('[data-product-search]', root).value.trim().toLowerCase();
    const categoryFilter = $('[data-product-category-filter]', root).value;
    const rows = (data || [])
      .filter(p => p.name.toLowerCase().includes(term))
      .filter(p => categoryFilter === 'all' || p.category_id === categoryFilter)
      // Grouped by category (in the same order they're arranged in Categories),
      // alphabetical within each category.
      .sort((a, b) => (categoryOrder[a.category_id] ?? 99) - (categoryOrder[b.category_id] ?? 99) || a.name.localeCompare(b.name));

    let lastCategory = null;
    const html = rows.map(p => {
      const categoryName = p.categories?.name || 'Uncategorised';
      const header = categoryName !== lastCategory ? `<h3 class="sub">${categoryName}</h3>` : '';
      lastCategory = categoryName;
      return `${header}<article class="admin-row">
        <div><b>${p.name}</b><small>${categoryName}</small></div>
        <div>
          ${needsPricing(p) ? badge('Price not set', 'warn') : (() => { const disc = p.discount_price && Number(p.discount_price) < Number(p.base_price); return `<small>₹${money(disc ? p.discount_price : p.base_price)}${disc ? ` <s>₹${money(p.base_price)}</s>` : ''}</small>`; })()}
          ${!p.is_active ? badge('Draft', 'warn') : p.is_hidden ? badge('Hidden', 'muted') : p.is_available ? badge('Available', 'good') : badge('Out of stock', 'error')}
        </div>
        <div class="row-actions">
          ${isOwner()
            ? `<button data-edit-product="${p.id}">Edit</button><button data-duplicate-product="${p.id}">Duplicate</button><button class="danger" data-delete-product="${p.id}">Delete</button>`
            : `<button class="${p.is_available ? 'stock-out' : 'stock-in'}" data-toggle-stock="${p.id}" data-available="${p.is_available}">${p.is_available ? 'Mark out of stock' : 'Restore stock'}</button>`}
        </div>
      </article>`;
    }).join('');
    $('[data-product-list]', root).innerHTML = html || '<p class="hint">Add BBK’s first real menu item.</p>';
  };

  $('[data-new-product]', root)?.addEventListener('click', () => productForm(null, load));
  $('[data-product-search]', root).addEventListener('input', load);
  $('[data-product-category-filter]', root).addEventListener('change', load);
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-product]');
    const dup = event.target.closest('[data-duplicate-product]');
    const del = event.target.closest('[data-delete-product]');
    const toggleStock = event.target.closest('[data-toggle-stock]');
    if (edit) { const { data } = await db.from('products').select('*').eq('id', edit.dataset.editProduct).single(); productForm(data, load); }
    if (toggleStock) {
      const nextAvailable = toggleStock.dataset.available !== 'true';
      const { error } = await db.from('products').update({ is_available: nextAvailable }).eq('id', toggleStock.dataset.toggleStock);
      if (error) toast(friendlyError(error), 'error'); else { toast(nextAvailable ? 'Marked in stock.' : 'Marked out of stock.'); load(); }
    }
    if (dup) {
      const { data: original } = await db.from('products').select('*').eq('id', dup.dataset.duplicateProduct).single();
      const clone = { ...original, name: `${original.name} (copy)` };
      delete clone.id; delete clone.created_at; delete clone.updated_at;
      const { error } = await db.from('products').insert(clone);
      if (error) toast(friendlyError(error), 'error'); else { toast('Product duplicated.'); load(); }
    }
    if (del) {
      if (!confirm('Delete this product? This cannot be undone.')) return;
      const { error } = await db.from('products').delete().eq('id', del.dataset.deleteProduct);
      if (error) toast(friendlyError(error), 'error'); else { toast('Product deleted.'); load(); }
    }
  });

  await load();
}

// Staff's Products view — kitchen-friendly: large cards, one big stock
// toggle each, no pricing/editing clutter (owner-only, enforced by RLS
// regardless of what this UI shows). Same search/filter as the owner view,
// just without the dense multi-column table.
function stockCard(p) {
  const categoryName = p.categories?.name || 'Uncategorised';
  return `<article class="stock-card">
    <div class="stock-card-top">
      <b>${p.name}</b>
      <span class="status ${p.is_available ? '' : 'out-of-stock'}">${p.is_available ? 'In stock' : 'Out of stock'}</span>
    </div>
    <small>${categoryName}</small>
    <button type="button" class="button ${p.is_available ? 'danger' : 'success'} wide" data-toggle-stock="${p.id}" data-available="${p.is_available}">
      ${p.is_available ? 'Mark out of stock' : 'Restore stock'}
    </button>
  </article>`;
}

async function renderProductsStaff(root) {
  const categories = await loadCategories();
  const categoryFilterOptions = `<option value="all">All categories</option>` + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Products</h2></div>
      <p class="hint">Tap an item to mark it in or out of stock. Pricing, photos and details are owner-only.</p>
      <div class="export-row">
        <input type="search" data-product-search placeholder="Search products…" class="search-box">
        <select data-product-category-filter>${categoryFilterOptions}</select>
      </div>
      <div class="stock-grid" data-product-list></div>
    </section>`;

  const load = async () => {
    const { data } = await db.from('products').select('id,name,category_id,is_available,categories(name)').order('name');
    const term = $('[data-product-search]', root).value.trim().toLowerCase();
    const categoryFilter = $('[data-product-category-filter]', root).value;
    const rows = (data || [])
      .filter(p => p.name.toLowerCase().includes(term))
      .filter(p => categoryFilter === 'all' || p.category_id === categoryFilter);
    $('[data-product-list]', root).innerHTML = rows.map(stockCard).join('') || '<div class="empty-state"><b>No products found</b><span>Try a different search or category.</span></div>';
  };

  $('[data-product-search]', root).addEventListener('input', load);
  $('[data-product-category-filter]', root).addEventListener('change', load);
  root.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-toggle-stock]');
    if (!toggle) return;
    const nextAvailable = toggle.dataset.available !== 'true';
    toggle.disabled = true;
    const { error } = await db.from('products').update({ is_available: nextAvailable }).eq('id', toggle.dataset.toggleStock);
    if (error) { toast(friendlyError(error), 'error'); toggle.disabled = false; return; }
    toast(nextAvailable ? 'Marked in stock.' : 'Marked out of stock.');
    load();
  });

  await load();
}

async function productForm(product, reload) {
  const owner = isOwner();
  const categories = await loadCategories();
  const categoryOptions = categories.map(c => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${c.parent_id ? '— ' : ''}${c.name}</option>`).join('');
  const lock = owner ? '' : 'disabled';

  openForm(`
    <h2 class="form-title">${product?.id ? (owner ? 'Edit' : 'View') : 'Add'} product</h2>
    ${owner ? '' : '<p class="hint">Only availability can be changed here — everything else is owner-only.</p>'}
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${product?.name || ''}" ${lock}></label>
      <label>Category<select name="category_id" required ${lock}>${categoryOptions}</select></label>
      <label>Type<select name="product_type" ${lock}><option value="standard" ${product?.product_type !== 'non_food' ? 'selected' : ''}>Food</option><option value="non_food" ${product?.product_type === 'non_food' ? 'selected' : ''}>Non-food item</option></select></label>
      <label>Price (₹)<input type="number" min="0" step="0.01" name="base_price" required value="${product?.base_price ?? 0}" ${lock}></label>
      <label>Discount price (₹, optional)<input type="number" min="0" step="0.01" name="discount_price" value="${product?.discount_price ?? ''}" ${lock}></label>
      <label>Prep time (minutes)<input type="number" min="0" name="prep_time_minutes" value="${product?.prep_time_minutes ?? ''}" ${lock}></label>
      <label class="full">Description<textarea name="description" ${lock}>${product?.description || ''}</textarea></label>
      <label class="full">Ingredients<textarea name="ingredients" ${lock}>${product?.ingredients || ''}</textarea></label>
      ${owner ? `<label class="full">Photos<input type="file" name="images" accept="image/*" multiple>${imageHint(1200, 900, 'landscape, one dish per photo')}</label><div class="full" data-existing-images></div>` : ''}
      <fieldset class="full flags">
        <legend>Tags</legend>
        ${FLAGS.map(([key, label]) => `<label class="check"><input type="checkbox" name="${key}" ${product?.[key] ? 'checked' : ''} ${lock}> ${label}</label>`).join('')}
      </fieldset>
      <label class="check"><input type="checkbox" name="is_active" ${product?.is_active !== false ? 'checked' : ''} ${lock}> Published (visible to customers)</label>
      <label class="check"><input type="checkbox" name="is_available" ${product?.is_available !== false ? 'checked' : ''}> In stock right now</label>
      <label class="check"><input type="checkbox" name="call_to_order" ${product?.call_to_order ? 'checked' : ''} ${lock}> Call-to-order only (no cart button)</label>
    </div>
    <button>${product?.id ? 'Save' : 'Create'} product</button>
    ${owner && product?.id ? '<button type="button" data-manage-variants>Manage variants &amp; add-ons</button>' : ''}
    ${owner && !product?.id ? '<p class="hint">Save the product first, then you can add variants (e.g. cake weights) and add-ons.</p>' : ''}
  `, async form => {
    // Staff-disabled fields are excluded from FormData entirely, so for staff
    // we build the record from is_available alone rather than trusting form
    // values for anything else — matches the DB trigger that would reject
    // any other change anyway (supabase/permissions.sql).
    if (!owner) {
      const { error } = await db.from('products').update({ is_available: form.is_available.checked }).eq('id', product.id);
      if (error) throw error;
      toast('Availability updated.');
      reload();
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    const record = {
      name: values.name.trim(),
      category_id: values.category_id,
      product_type: values.product_type,
      base_price: Number(values.base_price) || 0,
      discount_price: values.discount_price ? Number(values.discount_price) : null,
      prep_time_minutes: values.prep_time_minutes ? Number(values.prep_time_minutes) : null,
      description: values.description || null,
      ingredients: values.ingredients || null,
      is_active: form.is_active.checked,
      is_available: form.is_available.checked,
      call_to_order: form.call_to_order.checked,
      ...Object.fromEntries(FLAGS.map(([key]) => [key, form[key].checked])),
    };
    const result = product?.id ? await db.from('products').update(record).eq('id', product.id).select().single() : await db.from('products').insert(record).select().single();
    if (result.error) throw result.error;
    const savedId = result.data.id;

    const files = [...form.images.files];
    if (files.length) {
      const { data: existing } = await db.from('product_images').select('display_order').eq('product_id', savedId).order('display_order', { ascending: false }).limit(1);
      let order = (existing?.[0]?.display_order ?? -1) + 1;
      for (const file of files) {
        if (!(await checkImageRatio(file, 1200, 900))) continue;
        const url = await uploadPublicImage(db, file, `products/${savedId}`);
        await db.from('product_images').insert({ product_id: savedId, url, display_order: order++ });
      }
    }
    toast(`Product ${product?.id ? 'updated' : 'created'}.`);
    reload();
  });

  if (owner && product?.id) {
    const { data: images } = await db.from('product_images').select('*').eq('product_id', product.id).order('display_order');
    $('[data-existing-images]').innerHTML = (images || []).map(img => `<span class="thumb-wrap"><img src="${img.url}" class="thumb"><button type="button" data-remove-image="${img.id}" title="Remove">&times;</button></span>`).join('');
    $('[data-admin-form]').addEventListener('click', async event => {
      const remove = event.target.closest('[data-remove-image]');
      if (remove) { await db.from('product_images').delete().eq('id', remove.dataset.removeImage); remove.closest('.thumb-wrap').remove(); }
    });
    $('[data-manage-variants]').addEventListener('click', () => variantForm(product));
  }
}

// Note: everything inside the shared admin dialog already lives inside one
// outer <form data-admin-form> (see admin/index.html) — a nested <form> here
// would be dropped by the HTML parser, so "add" rows are plain divs with a
// type="button" trigger, not their own forms.
//
// This dialog re-renders itself after every add/remove (to show the new
// row). openForm() only needs to run once to open the dialog and set its
// body — calling it again on every refresh would re-attach a fresh set of
// click/keydown/change listeners to the same persistent body element on top
// of the old ones (openForm() never removes them), so every button click
// would fire once per previous render and duplicate the action. Listeners
// are wired exactly once here; refresh() only replaces innerHTML.
async function variantForm(product) {
  const dialog = $('[data-admin-dialog]');
  const alreadyOpenForThisProduct = dialog.open && dialog.dataset.variantsFor === product.id;
  dialog.dataset.variantsFor = product.id;

  async function refresh() {
    const [{ data: groups }, { data: allAddons }, { data: linkedAddons }] = await Promise.all([
      db.from('product_variant_groups').select('*,product_variants(*)').eq('product_id', product.id).order('display_order'),
      db.from('product_addons').select('*').order('name'),
      db.from('product_addon_links').select('addon_id').eq('product_id', product.id),
    ]);
    const linkedIds = new Set((linkedAddons || []).map(l => l.addon_id));

    const groupsHtml = (groups || []).map(g => `
      <div class="variant-group" data-group="${g.id}">
        <div class="variant-group-head"><b>${g.name}</b>${g.is_required ? badge('Required', 'muted') : ''}<button type="button" class="danger" data-delete-group="${g.id}">Remove group</button></div>
        ${g.product_variants.sort((a,b) => a.display_order - b.display_order).map(v => `
          <div class="variant-row" data-variant="${v.id}">
            <span>${v.name}${v.is_custom_input ? ' (customer types amount)' : ''}</span>
            <input type="number" step="0.01" data-variant-price="${v.id}" value="${v.price_adjustment}" ${v.is_custom_input ? 'disabled' : ''}>
            <button type="button" data-delete-variant="${v.id}">&times;</button>
          </div>`).join('')}
        <div class="inline-add" data-add-variant="${g.id}">
          <input data-field="name" placeholder="Add option (e.g. 2 Pound)">
          <input type="number" step="0.01" data-field="price_adjustment" placeholder="Price" value="0">
          <button type="button" data-action="add-variant" data-group="${g.id}">Add</button>
        </div>
      </div>`).join('') || '<p class="hint">No variant groups yet (e.g. a "Weight" group for cakes, or "Size" for burgers).</p>';

    $('[data-admin-form-body]').innerHTML = `
      <h2 class="form-title">Variants &amp; add-ons — ${product.name}</h2>
      <h3 class="sub">Variant groups</h3>
      <div data-groups>${groupsHtml}</div>
      <div class="inline-add" data-add-group>
        <input data-field="name" placeholder="New group name (e.g. Weight, Size)">
        <label class="check"><input type="checkbox" data-field="is_required"> Required</label>
        <button type="button" data-action="add-group">Add group</button>
      </div>
      <h3 class="sub">Add-ons available on this product</h3>
      <p class="hint">Add-ons are shared across all products — tick the ones this product offers. Deleting one below removes it everywhere.</p>
      <div class="addon-grid">${(allAddons || []).map(a => `<label class="check addon-check"><input type="checkbox" data-addon-toggle="${a.id}" ${linkedIds.has(a.id) ? 'checked' : ''}> ${a.name} (₹${money(a.price)})<button type="button" class="danger addon-delete" data-delete-addon="${a.id}" title="Delete this add-on everywhere">&times;</button></label>`).join('') || '<p class="hint">No add-ons created yet — create one below.</p>'}</div>
      <div class="inline-add" data-add-addon>
        <input data-field="name" placeholder="New add-on name">
        <input type="number" step="0.01" data-field="price" placeholder="Price" value="0">
        <button type="button" data-action="add-addon">Add add-on</button>
      </div>
      <button type="button" class="button" data-close-variants>Done</button>
    `;
  }

  await refresh();
  dialog.classList.add('wide');
  if (!dialog.open) dialog.showModal();
  if (alreadyOpenForThisProduct) return; // listeners already wired below on the first open

  const body = $('[data-admin-form-body]');
  const fieldValue = (container, name) => container.querySelector(`[data-field="${name}"]`);

  // Every input here sits inside the dialog's one shared <form> (no nested
  // forms allowed), so Enter would otherwise submit-and-close the whole
  // dialog. Inside an .inline-add row, redirect Enter to that row's "Add"
  // button; anywhere else (e.g. a variant price field), just swallow it.
  body.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches('input, select')) return;
    event.preventDefault();
    event.target.closest('.inline-add')?.querySelector('[data-action]')?.click();
  });

  body.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]');
    const delGroup = event.target.closest('[data-delete-group]');
    const delVariant = event.target.closest('[data-delete-variant]');
    const delAddon = event.target.closest('[data-delete-addon]');
    const closeBtn = event.target.closest('[data-close-variants]');
    const toggle = event.target.closest('[data-addon-toggle]');

    if (action?.dataset.action === 'add-group') {
      const row = action.closest('[data-add-group]');
      const name = fieldValue(row, 'name').value.trim();
      if (!name) return toast('Enter a group name.', 'error');
      await db.from('product_variant_groups').insert({ product_id: product.id, name, is_required: fieldValue(row, 'is_required').checked });
      await refresh();
    } else if (action?.dataset.action === 'add-variant') {
      const row = action.closest('[data-add-variant]');
      const name = fieldValue(row, 'name').value.trim();
      if (!name) return toast('Enter an option name.', 'error');
      await db.from('product_variants').insert({ group_id: action.dataset.group, name, price_adjustment: Number(fieldValue(row, 'price_adjustment').value) || 0 });
      await refresh();
    } else if (action?.dataset.action === 'add-addon') {
      const row = action.closest('[data-add-addon]');
      const name = fieldValue(row, 'name').value.trim();
      if (!name) return toast('Enter an add-on name.', 'error');
      const { data: addon, error } = await db.from('product_addons').insert({ name, price: Number(fieldValue(row, 'price').value) || 0 }).select().single();
      if (!error) await db.from('product_addon_links').insert({ product_id: product.id, addon_id: addon.id });
      await refresh();
    } else if (delGroup) { await db.from('product_variant_groups').delete().eq('id', delGroup.dataset.deleteGroup); await refresh(); }
    else if (delVariant) { await db.from('product_variants').delete().eq('id', delVariant.dataset.deleteVariant); await refresh(); }
    else if (delAddon) {
      if (!confirm('Delete this add-on? It will be removed from every product that uses it.')) return;
      await db.from('product_addons').delete().eq('id', delAddon.dataset.deleteAddon);
      await refresh();
    }
    else if (closeBtn) { dialog.close(); dialog.removeAttribute('data-variants-for'); }
    else if (toggle) {
      if (toggle.checked) await db.from('product_addon_links').insert({ product_id: product.id, addon_id: toggle.dataset.addonToggle });
      else await db.from('product_addon_links').delete().eq('product_id', product.id).eq('addon_id', toggle.dataset.addonToggle);
    }
  });
  body.addEventListener('change', async event => {
    const priceInput = event.target.closest('[data-variant-price]');
    if (priceInput) await db.from('product_variants').update({ price_adjustment: Number(priceInput.value) || 0 }).eq('id', priceInput.dataset.variantPrice);
  });
}
