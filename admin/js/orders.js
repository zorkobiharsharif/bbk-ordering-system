import { db, state } from './state.js';
import { $, $$, money, openForm, toast, dateLabel, friendlyError, todayStartIST } from './utils.js';
import { exportCSV } from './export.js';
import { acknowledgeOrder } from './notifications.js';

export const STATUS_LABEL = { new: 'New', address_needs_check: 'Check address', accepted: 'Accepted', kitchen: 'In kitchen', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

// The one-tap "next step" for each status — deliberately only ever offers
// the single obvious next action, not a menu of every possible status, so
// there's nothing to mis-tap. Editing to a non-adjacent status (or
// cancelling) is still possible via the "change status manually" fallback
// in openOrder(), it's just not the default path.
export const STATUS_FLOW = {
  new: { next: 'accepted', label: 'Accept order' },
  address_needs_check: { next: 'accepted', label: 'Accept order' },
  accepted: { next: 'kitchen', label: 'Send to kitchen' },
  kitchen: { next: 'out_for_delivery', label: 'Mark out for delivery' },
  out_for_delivery: { next: 'delivered', label: 'Mark delivered' },
};

export async function advanceOrderStatus(orderId, nextStatus) {
  const { error } = await db.from('orders').update({ status: nextStatus }).eq('id', orderId);
  if (error) return { error };
  await db.from('order_status_history').insert({ order_id: orderId, status: nextStatus, changed_by: state.profile.id });
  return {};
}

// Date included (not just time) — Cancelled and All orders still span
// multiple days, where a bare time like "10:45 pm" doesn't say which day.
const formatOrderTime = iso => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

function orderRow(o) {
  return `<article class="admin-row">
    <div><b>#BBK-${o.order_number}</b><small>${o.customers?.name || ''}</small></div>
    <div><small>${o.customers?.phone || ''}</small><small>₹${money(o.cod_total)} · ${formatOrderTime(o.created_at)}</small></div>
    <span class="status ${o.status}">${STATUS_LABEL[o.status]}</span>
    <button data-open-order="${o.id}">View</button>
  </article>`;
}

// Today-only on every tab except Cancelled and All orders — those two stay
// full history since they're exactly the "look up any past order" tabs
// (customer disputes, reports, etc.); Export CSV also still covers
// historical data regardless of what's on screen right now.
const STATUS_FILTERS = [
  ['new,address_needs_check', 'Needs action', true],
  ['accepted', 'Accepted', true],
  ['kitchen', 'In kitchen', true],
  ['out_for_delivery', 'Out for delivery', true],
  ['delivered', 'Delivered', true],
  ['cancelled', 'Cancelled', false],
  ['new,address_needs_check,accepted,kitchen,out_for_delivery,delivered,cancelled', 'All orders', false],
];

export async function renderOrders(root) {
  root.innerHTML = `
    <section class="panel order-filter-bar">
      <div class="filter-chip-row" data-order-filter>
        ${STATUS_FILTERS.map(([value, label, todayOnly], i) => `<button type="button" class="filter-chip ${i === 0 ? 'active' : ''}" data-value="${value}" data-today-only="${todayOnly}">${label}</button>`).join('')}
      </div>
      <div class="order-filter-row">
        <label class="filter-label">Search<input type="search" data-order-search placeholder="Order #, name or phone…"></label>
        <button type="button" data-refresh-orders title="Reload the list">&#8635; Refresh</button>
        <button type="button" data-export-orders>Export CSV</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Orders</h2></div>
      <div data-order-list></div>
    </section>`;

  let activeStatuses = STATUS_FILTERS[0][0];
  let activeTodayOnly = STATUS_FILTERS[0][2];
  let lastOrders = [];
  const load = async () => {
    const statuses = activeStatuses.split(',');
    let query = db.from('orders').select('id,order_number,status,cod_total,discount,address,created_at,customers(name,phone)').in('status', statuses);
    if (activeTodayOnly) query = query.gte('created_at', todayStartIST());
    const { data } = await query.order('created_at', { ascending: false });
    const term = $('[data-order-search]', root).value.trim().toLowerCase();
    lastOrders = (data || []).filter(o => !term
      || String(o.order_number).includes(term)
      || (o.customers?.name || '').toLowerCase().includes(term)
      || (o.customers?.phone || '').includes(term));
    $('[data-order-list]', root).innerHTML = lastOrders.map(orderRow).join('') || '<p class="hint">No orders in this view.</p>';
  };
  $('[data-order-filter]', root).addEventListener('click', event => {
    const chip = event.target.closest('[data-value]');
    if (!chip) return;
    activeStatuses = chip.dataset.value;
    activeTodayOnly = chip.dataset.todayOnly === 'true';
    $$('.filter-chip', root).forEach(b => b.classList.toggle('active', b === chip));
    load();
  });
  $('[data-order-search]', root).addEventListener('input', load);
  $('[data-refresh-orders]', root).addEventListener('click', () => { toast('Orders refreshed.'); load(); });
  $('[data-export-orders]', root).addEventListener('click', () => {
    if (!lastOrders.length) return toast('Nothing to export in this view.', 'error');
    const rows = lastOrders.map(o => ({
      order: `BBK-${o.order_number}`,
      status: STATUS_LABEL[o.status],
      customer: o.customers?.name || '',
      phone: o.customers?.phone || '',
      address: o.address || '',
      total: money(o.cod_total),
      discount: money(o.discount),
      date: dateLabel(o.created_at),
    }));
    exportCSV(rows, [
      { key: 'order', label: 'Order' }, { key: 'status', label: 'Status' }, { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' }, { key: 'total', label: 'Total (₹)' },
      { key: 'discount', label: 'Discount (₹)' }, { key: 'date', label: 'Date' },
    ], `bbk-orders-${new Date().toISOString().slice(0, 10)}`);
  });
  await load();
}

export async function openOrder(id, onUpdated) {
  // Opening an order counts as acknowledging it — stops the repeating new-order alert.
  acknowledgeOrder(id);
  const { data: o } = await db.from('orders').select('*,customers(name,phone),order_items(*,order_item_addons(*))').eq('id', id).single();
  const itemLines = o.order_items.map(i => `${i.product_name} × ${i.quantity}${i.variant_name ? ` (${i.variant_name})` : ''}${i.order_item_addons.length ? ` + ${i.order_item_addons.map(a => a.addon_name).join(', ')}` : ''}`);
  const itemsBlock = `
    <div class="order-items">
      <b>Items (${o.order_items.length})</b>
      ${itemLines.map(line => `<div class="order-item-row">${line}</div>`).join('')}
    </div>`;
  const statusOptions = ['accepted', 'kitchen', 'out_for_delivery', 'delivered', 'cancelled'].map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');
  const mapUrl = o.latitude != null && o.longitude != null ? `https://www.google.com/maps?q=${o.latitude},${o.longitude}` : null;

  // One plain-text block with everything a delivery rider needs — this is
  // deliberately real page text (not hidden inside an <input> value), so a
  // normal drag-select-and-copy picks up the GPS link along with everything
  // else instead of silently skipping it. The WhatsApp button sends the
  // exact same text with zero copy/paste needed at all.
  const deliveryMessage = [
    `Order #BBK-${o.order_number}`,
    `${o.customers.name} - ${o.customers.phone}`,
    [o.address, o.landmark].filter(Boolean).join(', ') || 'No address note left — GPS pin below',
    mapUrl ? `${mapUrl} (${Number(o.distance_km).toFixed(1)} km away)` : 'No GPS shared — confirm the address with the customer',
    '',
    ...itemLines,
    '',
    `COD Rs ${money(o.cod_total)}`,
  ].join('\n');

  const deliveryBlock = `
    <div class="delivery-block">
      <p class="hint">Drag-select the text below to copy it, or send it straight to your delivery rider on WhatsApp.</p>
      <pre class="delivery-text">${deliveryMessage}</pre>
      <div class="delivery-actions">
        <button type="button" class="button" data-copy-delivery="${encodeURIComponent(deliveryMessage)}">Copy all</button>
        <a href="https://wa.me/?text=${encodeURIComponent(deliveryMessage)}" target="_blank" rel="noopener" class="button primary">Send to WhatsApp &rarr;</a>
      </div>
    </div>`;

  const step = STATUS_FLOW[o.status];

  openForm(`
    <h2 class="form-title">Order #BBK-${o.order_number}</h2>
    ${deliveryBlock}
    ${itemsBlock}
    <p><b>COD ₹${money(o.cod_total)}</b>${o.discount ? ` <small>(₹${money(o.discount)} discount applied)</small>` : ''}</p>
    <div class="status-action">
      <span class="status ${o.status}">${STATUS_LABEL[o.status]}</span>
      ${step
        ? `<button type="button" class="button primary wide" data-advance-status="${step.next}">${step.label} &rarr;</button>`
        : `<p class="hint">This order is ${STATUS_LABEL[o.status].toLowerCase()} — nothing more to do here.</p>`}
    </div>
    <details class="status-more">
      <summary>Change to a different status</summary>
      <label>Status<select name="status">${statusOptions}</select></label>
      <label class="full" data-cancel-reason-wrap hidden>Cancellation reason<input name="cancelled_reason" placeholder="e.g. customer unreachable"></label>
      <button>Update to selected status</button>
    </details>
  `, async form => {
    const status = new FormData(form).get('status');
    const patch = { status };
    if (status === 'cancelled') patch.cancelled_reason = form.cancelled_reason?.value || null;
    const { error } = await db.from('orders').update(patch).eq('id', o.id);
    if (error) throw error;
    await db.from('order_status_history').insert({ order_id: o.id, status, changed_by: state.profile.id });
    toast('Order updated.');
    onUpdated?.();
  });

  const select = $('[data-admin-form] select[name="status"]');
  const reasonWrap = $('[data-cancel-reason-wrap]');
  const syncReason = () => { reasonWrap.hidden = select.value !== 'cancelled'; };
  select.addEventListener('change', syncReason);
  syncReason();

  const advanceBtn = $('[data-advance-status]');
  advanceBtn?.addEventListener('click', async () => {
    advanceBtn.disabled = true;
    const { error } = await advanceOrderStatus(o.id, advanceBtn.dataset.advanceStatus);
    if (error) { toast(friendlyError(error), 'error'); advanceBtn.disabled = false; return; }
    toast(`Order marked ${STATUS_LABEL[advanceBtn.dataset.advanceStatus].toLowerCase()}.`);
    $('[data-admin-dialog]').close();
    onUpdated?.();
  });

  const copyBtn = $('[data-copy-delivery]');
  copyBtn?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(decodeURIComponent(copyBtn.dataset.copyDelivery)); toast('Copied — paste it to the delivery rider.'); }
    catch { toast('Could not copy automatically — drag-select the text above and copy it manually.', 'error'); }
  });
}
