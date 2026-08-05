import { db } from './state.js';
import { $, $$, money, dateLabel, openForm, toast, badge, friendlyError } from './utils.js';

const STATUS_LABEL = { new: 'New', quoted: 'Quoted', confirmed: 'Confirmed', rejected: 'Rejected', completed: 'Completed' };
const STATUS_TONE = { new: 'warn', quoted: 'info', confirmed: 'info', rejected: 'error', completed: 'good' };

// Same one-tap idea as orders.js: only the single obvious next step, not a
// menu of every status. "new" needs a price before it can move to "quoted",
// so that step keeps the quoted-price field visible above the button.
const STATUS_FLOW = {
  new: { next: 'quoted', label: 'Send quote' },
  quoted: { next: 'confirmed', label: 'Mark confirmed' },
  confirmed: { next: 'completed', label: 'Mark completed' },
};

const REQUEST_FILTERS = [
  ['new,quoted', 'Needs a reply'],
  ['confirmed', 'Confirmed'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['new,quoted,confirmed,completed,rejected', 'All requests'],
];

export async function renderCakeRequests(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Custom cake requests</h2><button type="button" data-refresh-requests title="Reload the list">&#8635; Refresh</button></div>
      <div class="filter-chip-row" data-request-filter>
        ${REQUEST_FILTERS.map(([value, label], i) => `<button type="button" class="filter-chip ${i === 0 ? 'active' : ''}" data-value="${value}">${label}</button>`).join('')}
      </div>
      <div data-request-list></div>
    </section>`;

  let activeStatuses = REQUEST_FILTERS[0][0];
  const load = async () => {
    const statuses = activeStatuses.split(',');
    const { data } = await db.from('custom_cake_requests').select('*').in('status', statuses).order('created_at', { ascending: false });
    $('[data-request-list]', root).innerHTML = (data || []).map(r => `
      <article class="admin-row">
        <div><b>${r.customer_name}</b><small>${r.phone}</small></div>
        <div><small>For ${r.delivery_date ? dateLabel(r.delivery_date) : 'date not set'}</small><small>${r.name_on_cake || 'No name on cake'}</small></div>
        ${badge(STATUS_LABEL[r.status] || r.status, STATUS_TONE[r.status])}
        <button data-open-request="${r.id}">Open</button>
      </article>`).join('') || '<p class="hint">Nothing in this view.</p>';
  };
  $('[data-request-filter]', root).addEventListener('click', event => {
    const chip = event.target.closest('[data-value]');
    if (!chip) return;
    activeStatuses = chip.dataset.value;
    $$('.filter-chip', root).forEach(b => b.classList.toggle('active', b === chip));
    load();
  });
  $('[data-refresh-requests]', root).addEventListener('click', () => { toast('Requests refreshed.'); load(); });
  root.addEventListener('click', event => {
    const open = event.target.closest('[data-open-request]');
    if (open) requestDetail(open.dataset.openRequest, load);
  });
  await load();
}

async function updateRequestStatus(id, status, quotedPrice) {
  const patch = { status };
  if (quotedPrice !== undefined) patch.quoted_price = quotedPrice;
  const { error } = await db.from('custom_cake_requests').update(patch).eq('id', id);
  return { error };
}

async function requestDetail(id, reload) {
  const { data: r } = await db.from('custom_cake_requests').select('*').eq('id', id).single();
  let imageHtml = '';
  if (r.reference_image_url) {
    const { data: signed } = await db.storage.from('bbk-cake-references').createSignedUrl(r.reference_image_url, 3600);
    if (signed) imageHtml = `<img src="${signed.signedUrl}" class="thumb full">`;
  }

  const step = STATUS_FLOW[r.status];
  const statusOptions = ['new', 'quoted', 'confirmed', 'rejected', 'completed'].map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');

  openForm(`
    <h2 class="form-title">${r.customer_name}</h2>
    <p>${r.phone} · delivery ${r.delivery_date ? dateLabel(r.delivery_date) : '—'}${r.delivery_time ? ` at ${r.delivery_time}` : ''}</p>
    <p><b>Name on cake:</b> ${r.name_on_cake || '—'}</p>
    <p><b>Message:</b> ${r.cake_message || '—'}</p>
    <p><b>Notes:</b> ${r.notes || '—'}</p>
    ${imageHtml}
    <label>Quoted price (₹)<input type="number" min="0" step="0.01" name="quoted_price" value="${r.quoted_price ?? ''}" data-quote-input></label>
    <div class="status-action">
      <span class="status ${r.status}">${STATUS_LABEL[r.status]}</span>
      ${step
        ? `<button type="button" class="button primary wide" data-advance-status="${step.next}">${step.label} &rarr;</button>`
        : `<p class="hint">This request is ${STATUS_LABEL[r.status].toLowerCase()} — nothing more to do here.</p>`}
    </div>
    ${r.status !== 'rejected' && r.status !== 'completed' ? '<button type="button" class="link-button danger" data-reject-request>Reject this request</button>' : ''}
    <details class="status-more">
      <summary>Change to a different status</summary>
      <label>Status<select name="status">${statusOptions}</select></label>
      <button>Update to selected status</button>
    </details>
  `, async form => {
    const v = Object.fromEntries(new FormData(form));
    const { error } = await updateRequestStatus(id, v.status, v.quoted_price ? Number(v.quoted_price) : null);
    if (error) throw error;
    toast('Request updated.');
    reload();
  });

  const advanceBtn = $('[data-advance-status]');
  advanceBtn?.addEventListener('click', async () => {
    const nextStatus = advanceBtn.dataset.advanceStatus;
    // "Send quote" needs a real price before it can move forward — the
    // request can't usefully be "quoted" with no quote in it.
    const priceInput = $('[data-quote-input]');
    const price = priceInput.value ? Number(priceInput.value) : null;
    if (nextStatus === 'quoted' && !price) { toast('Enter a quoted price first.', 'error'); priceInput.focus(); return; }
    advanceBtn.disabled = true;
    const { error } = await updateRequestStatus(id, nextStatus, price !== null ? price : undefined);
    if (error) { toast(friendlyError(error), 'error'); advanceBtn.disabled = false; return; }
    toast(`Request marked ${STATUS_LABEL[nextStatus].toLowerCase()}.`);
    $('[data-admin-dialog]').close();
    reload();
  });

  $('[data-reject-request]')?.addEventListener('click', async () => {
    if (!confirm('Reject this cake request?')) return;
    const { error } = await updateRequestStatus(id, 'rejected');
    if (error) { toast(friendlyError(error), 'error'); return; }
    toast('Request rejected.');
    $('[data-admin-dialog]').close();
    reload();
  });
}
