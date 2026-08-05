import { db } from './state.js';
import { $, openForm, toast, uploadPublicImage, badge, toLocalInputValue, fromLocalInputValue, imageHint, checkImageRatio, loadingRow } from './utils.js';

function isLive(b) {
  const now = new Date();
  return b.is_active && (!b.starts_at || new Date(b.starts_at) <= now) && (!b.ends_at || new Date(b.ends_at) >= now);
}

export async function renderBanners(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Banners</h2><button data-new-banner>Add banner</button></div>
      <p class="hint">Shown on the homepage in display-order, within their active window.</p>
      <div data-banner-list>${loadingRow()}</div>
    </section>`;

  const load = async () => {
    const { data } = await db.from('banners').select('*').order('display_order');
    $('[data-banner-list]', root).innerHTML = (data || []).map(b => `
      <article class="admin-row">
        <img src="${b.image_url}" class="thumb-sm">
        <div><b>${b.title || '(no title)'}</b><small>Order ${b.display_order}</small></div>
        ${isLive(b) ? badge('Live', 'good') : badge('Off', 'muted')}
        <div class="row-actions">
          <button data-edit-banner="${b.id}">Edit</button>
          <button class="danger" data-delete-banner="${b.id}">Delete</button>
        </div>
      </article>`).join('') || '<p class="hint">No banners yet.</p>';
  };

  $('[data-new-banner]', root).addEventListener('click', () => bannerForm(null, load));
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-banner]');
    const del = event.target.closest('[data-delete-banner]');
    if (edit) { const { data } = await db.from('banners').select('*').eq('id', edit.dataset.editBanner).single(); bannerForm(data, load); }
    if (del) { if (!confirm('Delete this banner?')) return; await db.from('banners').delete().eq('id', del.dataset.deleteBanner); load(); }
  });

  await load();
}

async function bannerForm(banner, reload) {
  openForm(`
    <h2 class="form-title">${banner ? 'Edit' : 'Add'} banner</h2>
    <div class="form-grid">
      <label class="full">Image ${banner ? '(leave empty to keep current)' : ''}<input type="file" name="image_file" accept="image/*" ${banner ? '' : 'required'}>${imageHint(1600, 700, 'wide')}</label>
      ${banner?.image_url ? `<img src="${banner.image_url}" class="thumb full">` : ''}
      <label class="full">Title<input name="title" value="${banner?.title || ''}"></label>
      <label class="full">Subtitle<input name="subtitle" value="${banner?.subtitle || ''}"></label>
      <label class="full">Link (optional)<input name="link_url" value="${banner?.link_url || ''}"></label>
      <label>Display order<input type="number" name="display_order" value="${banner?.display_order ?? 0}"></label>
      <label>Starts<input type="datetime-local" name="starts_at" value="${toLocalInputValue(banner?.starts_at)}"></label>
      <label>Ends<input type="datetime-local" name="ends_at" value="${toLocalInputValue(banner?.ends_at)}"></label>
      <label class="check"><input type="checkbox" name="is_active" ${banner?.is_active !== false ? 'checked' : ''}> Active</label>
    </div>
    <button>${banner ? 'Save' : 'Create'} banner</button>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    const record = {
      title: v.title || null, subtitle: v.subtitle || null, link_url: v.link_url || null,
      display_order: Number(v.display_order) || 0,
      starts_at: fromLocalInputValue(v.starts_at), ends_at: fromLocalInputValue(v.ends_at),
      is_active: form.is_active.checked,
    };
    if (form.image_file.files[0] && await checkImageRatio(form.image_file.files[0], 1600, 700)) record.image_url = await uploadPublicImage(db, form.image_file.files[0], 'banners');
    const result = banner ? await db.from('banners').update(record).eq('id', banner.id) : await db.from('banners').insert(record);
    if (result.error) throw result.error;
    toast(`Banner ${banner ? 'updated' : 'created'}.`);
    reload();
  });
}
