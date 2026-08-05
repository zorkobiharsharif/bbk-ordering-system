import { db, isOwner } from './state.js';
import { $, openForm, toast, uploadPublicImage, badge, imageHint, checkImageRatio, friendlyError } from './utils.js';

async function loadCategories() {
  const { data } = await db.from('categories').select('*').order('display_order');
  return data || [];
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function renderCategories(root) {
  if (!isOwner()) return renderCategoriesStaff(root);

  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Categories</h2><button data-new-category>Add category</button></div>
      <p class="hint">Subcategories are just a category with a parent — pick one when creating it.</p>
      <div data-category-list></div>
    </section>`;

  const load = async () => {
    const categories = await loadCategories();
    const byId = Object.fromEntries(categories.map(c => [c.id, c]));
    const { data: products } = await db.from('products').select('category_id,is_available');
    const stockByCategory = {};
    (products || []).forEach(p => {
      const s = stockByCategory[p.category_id] || (stockByCategory[p.category_id] = { total: 0, available: 0 });
      s.total += 1; if (p.is_available) s.available += 1;
    });

    $('[data-category-list]', root).innerHTML = categories.map(c => {
      const stock = stockByCategory[c.id];
      // A confirmation toast alone (from the bulk buttons below) disappears
      // in a few seconds — this stays on screen so it's obvious at a glance
      // whether a whole category got left out of stock by mistake.
      const stockNote = !stock ? '<small class="hint">No products yet</small>'
        : stock.available === 0 ? `<small class="stock-note stock-note-out">All ${stock.total} out of stock</small>`
        : stock.available === stock.total ? `<small class="stock-note stock-note-in">All ${stock.total} in stock</small>`
        : `<small class="stock-note stock-note-partial">${stock.available} of ${stock.total} in stock</small>`;
      return `
      <article class="admin-row">
        <div><b>${c.name}</b><small>${c.parent_id ? `Sub-category of ${byId[c.parent_id]?.name || '—'}` : 'Top level'}</small></div>
        <div>${badge(c.is_active && c.is_available ? 'Visible' : 'Hidden', c.is_active && c.is_available ? 'good' : 'muted')}<small>Order ${c.display_order}</small>${stockNote}</div>
        <div class="row-actions">
          <button data-edit-category="${c.id}">Edit</button>
          <button class="stock-out" data-stock-out-category="${c.id}">Mark all out of stock</button>
          <button class="stock-in" data-stock-in-category="${c.id}">Restore all stock</button>
        </div>
      </article>`;
    }).join('') || '<p class="hint">No categories yet.</p>';
  };

  $('[data-new-category]', root)?.addEventListener('click', () => categoryForm(null, load));
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-category]');
    const stockOut = event.target.closest('[data-stock-out-category]');
    const stockIn = event.target.closest('[data-stock-in-category]');
    if (edit) {
      const categories = await loadCategories();
      categoryForm(categories.find(c => c.id === edit.dataset.editCategory), load);
    }
    if (stockOut || stockIn) {
      const categoryId = (stockOut || stockIn).dataset.stockOutCategory || (stockOut || stockIn).dataset.stockInCategory;
      const available = Boolean(stockIn);
      const label = available ? 'restore stock on every item' : 'mark every item out of stock';
      if (!confirm(`Are you sure you want to ${label} in this category?`)) return;
      const { error } = await db.from('products').update({ is_available: available }).eq('category_id', categoryId);
      if (error) toast(friendlyError(error), 'error'); else { toast(`Category items ${available ? 'restored' : 'marked out of stock'}. Check the Products page to see each item's status.`); load(); }
    }
  });

  await load();
}

// Staff's Categories view — big cards, two big bulk-stock buttons each, no
// editing (adding/renaming/deleting a category is owner-only, RLS-enforced).
function categoryStockCard(c, stock) {
  const stockNote = !stock ? 'No products yet'
    : stock.available === 0 ? `All ${stock.total} out of stock`
    : stock.available === stock.total ? `All ${stock.total} in stock`
    : `${stock.available} of ${stock.total} in stock`;
  return `<article class="stock-card">
    <div class="stock-card-top">
      <b>${c.name}</b>
      <span class="status ${stock && stock.available === 0 ? 'out-of-stock' : ''}">${stockNote}</span>
    </div>
    <div class="stock-card-actions">
      <button type="button" class="button danger wide" data-stock-out-category="${c.id}">Mark all out of stock</button>
      <button type="button" class="button success wide" data-stock-in-category="${c.id}">Restore all stock</button>
    </div>
  </article>`;
}

async function renderCategoriesStaff(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Categories</h2></div>
      <p class="hint">Mark a whole category in or out of stock at once. Adding, editing and deleting categories is owner-only.</p>
      <div class="stock-grid" data-category-list></div>
    </section>`;

  const load = async () => {
    const categories = await loadCategories();
    const { data: products } = await db.from('products').select('category_id,is_available');
    const stockByCategory = {};
    (products || []).forEach(p => {
      const s = stockByCategory[p.category_id] || (stockByCategory[p.category_id] = { total: 0, available: 0 });
      s.total += 1; if (p.is_available) s.available += 1;
    });
    $('[data-category-list]', root).innerHTML = categories.map(c => categoryStockCard(c, stockByCategory[c.id])).join('') || '<p class="hint">No categories yet.</p>';
  };

  root.addEventListener('click', async event => {
    const stockOut = event.target.closest('[data-stock-out-category]');
    const stockIn = event.target.closest('[data-stock-in-category]');
    if (!stockOut && !stockIn) return;
    const categoryId = (stockOut || stockIn).dataset.stockOutCategory || (stockOut || stockIn).dataset.stockInCategory;
    const available = Boolean(stockIn);
    const label = available ? 'restore stock on every item' : 'mark every item out of stock';
    if (!confirm(`Are you sure you want to ${label} in this category?`)) return;
    const { error } = await db.from('products').update({ is_available: available }).eq('category_id', categoryId);
    if (error) toast(friendlyError(error), 'error'); else { toast(`Category items ${available ? 'restored' : 'marked out of stock'}.`); load(); }
  });

  await load();
}

async function categoryForm(category, reload) {
  const all = (await loadCategories()).filter(c => c.id !== category?.id);
  const parentOptions = `<option value="">— none (top level) —</option>` + all.map(c => `<option value="${c.id}" ${category?.parent_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('');

  openForm(`
    <h2 class="form-title">${category ? 'Edit' : 'Add'} category</h2>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${category?.name || ''}"></label>
      <label>Parent category<select name="parent_id">${parentOptions}</select></label>
      <label>Display order<input type="number" name="display_order" value="${category?.display_order ?? 0}"></label>
      <label class="full">Description<input name="description" value="${category?.description || ''}"></label>
      <label class="full">Image<input type="file" name="image_file" accept="image/*">${imageHint(800, 800, 'square')}</label>
      ${category?.image_url ? `<img src="${category.image_url}" class="thumb full">` : ''}
      <label class="full">Banner image (shown behind this category's heading)<input type="file" name="banner_file" accept="image/*">${imageHint(1600, 700, 'wide')}</label>
      ${category?.banner_url ? `<img src="${category.banner_url}" class="thumb full">` : ''}
      <label><input type="checkbox" name="is_active" ${category?.is_active !== false ? 'checked' : ''}> Active</label>
      <label><input type="checkbox" name="is_available" ${category?.is_available !== false ? 'checked' : ''}> Visible to customers</label>
    </div>
    <button>${category ? 'Save' : 'Create'} category</button>
    ${category ? '<button type="button" class="danger" data-delete-category>Delete category</button>' : ''}
  `, async form => {
    const values = Object.fromEntries(new FormData(form));
    const record = {
      name: values.name.trim(),
      parent_id: values.parent_id || null,
      display_order: Number(values.display_order) || 0,
      description: values.description || null,
      is_active: form.is_active.checked,
      is_available: form.is_available.checked,
    };
    if (!category) record.slug = `${slugify(values.name)}-${Date.now().toString(36)}`;
    if (form.image_file.files[0] && await checkImageRatio(form.image_file.files[0], 800, 800)) record.image_url = await uploadPublicImage(db, form.image_file.files[0], 'categories');
    if (form.banner_file.files[0] && await checkImageRatio(form.banner_file.files[0], 1600, 700)) record.banner_url = await uploadPublicImage(db, form.banner_file.files[0], 'categories');

    const result = category ? db.from('categories').update(record).eq('id', category.id) : db.from('categories').insert(record);
    const { error } = await result;
    if (error) throw error;
    toast(`Category ${category ? 'updated' : 'created'}.`);
    reload();
  });

  $('[data-delete-category]')?.addEventListener('click', async () => {
    // A category can't be deleted while it still has products (every product
    // needs a category) — check first and say exactly why, instead of
    // surfacing the database's raw foreign-key error.
    const { count } = await db.from('products').select('id', { count: 'exact', head: true }).eq('category_id', category.id);
    if (count) return toast(`Can't delete "${category.name}" — it still has ${count} product${count === 1 ? '' : 's'}. Move or delete ${count === 1 ? 'it' : 'them'} first (in Products).`, 'error');
    if (!confirm(`Delete "${category.name}"? This cannot be undone.`)) return;
    const { error } = await db.from('categories').delete().eq('id', category.id);
    if (error) return toast(friendlyError(error), 'error');
    $('[data-admin-dialog]').close();
    toast('Category deleted.');
    reload();
  });
}
