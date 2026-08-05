import { db, isOwner } from './state.js';
import { $, money, todayISO, toast, friendlyError } from './utils.js';
import { openOrder, STATUS_LABEL, STATUS_FLOW, advanceOrderStatus } from './orders.js';

function orderRow(o) {
  return `<article class="admin-row">
    <div><b>#BBK-${o.order_number}</b><small>${o.customers?.name || ''}</small></div>
    <div><small>${o.customers?.phone || ''}</small><small>₹${money(o.cod_total)}</small></div>
    <button data-open-order="${o.id}">${o.status === 'new' ? 'Open' : 'Check address'}</button>
  </article>`;
}

function orderingTogglePanel(orderingOn) {
  return `<section class="panel ordering-toggle-panel">
    <div>
      <b>Online ordering</b>
      <small>${orderingOn ? 'Customers can browse and place orders right now.' : 'The customer website shows "We\'re currently closed" — nobody can order.'}</small>
    </div>
    <div class="ordering-toggle-control">
      <span class="ordering-status-pill ${orderingOn ? 'is-open' : 'is-closed'}">${orderingOn ? 'Open' : 'Closed'}</span>
      <button type="button" data-toggle-ordering data-on="${orderingOn}" class="ordering-toggle ${orderingOn ? 'is-on' : 'is-off'}">
        ${orderingOn ? 'Turn OFF (close the site)' : 'Turn ON (open the site)'}
      </button>
    </div>
  </section>`;
}

function wireOrderingToggle(root, onChanged) {
  $('[data-toggle-ordering]', root)?.addEventListener('click', async event => {
    const btn = event.currentTarget;
    const nextOn = btn.dataset.on !== 'true';
    btn.disabled = true;
    const { error } = await db.from('business_settings').update({ ordering_enabled: nextOn }).eq('id', true);
    btn.disabled = false;
    if (error) { toast(friendlyError(error), 'error'); return; }
    toast(nextOn ? 'Online ordering turned ON.' : 'Online ordering turned OFF.');
    onChanged();
  });
}

export async function renderDashboard(root) {
  const day = todayISO();
  const [{ data: delivered }, { data: pending }, { data: settings }] = await Promise.all([
    db.from('orders').select('cod_total,status').eq('status', 'delivered').gte('created_at', day),
    db.from('orders').select('id,order_number,status,cod_total,customers(name,phone)').in('status', ['new', 'address_needs_check']).order('created_at', { ascending: false }).limit(5),
    db.from('business_settings').select('ordering_enabled').eq('id', true).single(),
  ]);
  const sales = (delivered || []).reduce((n, x) => n + Number(x.cod_total), 0);
  const orderingOn = Boolean(settings?.ordering_enabled);

  root.innerHTML = `
    ${orderingTogglePanel(orderingOn)}
    <div class="cards" data-metrics></div>
    <section class="panel">
      <div class="panel-head"><h2>Orders needing action</h2><button data-view="orders">Open orders</button></div>
      <div data-recent-orders></div>
    </section>`;

  wireOrderingToggle(root, () => renderDashboard(root));

  const metrics = [
    // Revenue is business performance data, hidden from staff — the cash
    // amount on an individual order (needed to collect COD) still shows in
    // Orders/Dashboard's order rows, that's an operational detail, not this.
    ...(isOwner() ? [['Delivered today', `₹${money(sales)}`]] : []),
    ['Delivered orders', delivered?.length || 0],
    ['Needs action', pending?.length || 0],
  ];
  $('[data-metrics]', root).innerHTML = metrics.map(([label, value]) => `<article class="card"><span>${label}</span><b>${value}</b></article>`).join('');

  $('[data-recent-orders]', root).innerHTML = (pending || []).length
    ? pending.map(orderRow).join('')
    : '<p class="hint">No orders need action right now.</p>';
}

// Staff's home screen — deliberately just the order queue and the
// ordering on/off switch, nothing else competing for attention (no revenue
// numbers, no other metrics). Each card has one big "next step" button so
// the common case (move an order forward) never needs the detail dialog.
function queueCard(o) {
  const step = STATUS_FLOW[o.status];
  return `<article class="queue-card">
    <div class="queue-card-top">
      <b>#BBK-${o.order_number}</b>
      <span class="status ${o.status}">${STATUS_LABEL[o.status]}</span>
    </div>
    <p>${o.customers?.name || ''} · ${o.customers?.phone || ''} · ₹${money(o.cod_total)}</p>
    <div class="queue-card-actions">
      <button type="button" data-view-order="${o.id}">View details</button>
      ${step ? `<button type="button" class="button primary wide" data-advance-order="${o.id}" data-advance-status="${step.next}">${step.label} &rarr;</button>` : ''}
    </div>
  </article>`;
}

export async function renderStaffQueue(root) {
  const { data: settings } = await db.from('business_settings').select('ordering_enabled').eq('id', true).single();
  const orderingOn = Boolean(settings?.ordering_enabled);

  root.innerHTML = `
    ${orderingTogglePanel(orderingOn)}
    <section class="panel">
      <div class="panel-head"><h2>Orders needing action</h2><button type="button" data-refresh-queue title="Reload the list">&#8635; Refresh</button></div>
      <div class="queue-list" data-queue-list></div>
    </section>`;

  wireOrderingToggle(root, () => renderStaffQueue(root));

  const load = async () => {
    const { data } = await db.from('orders')
      .select('id,order_number,status,cod_total,customers(name,phone)')
      .in('status', ['new', 'address_needs_check', 'accepted', 'kitchen', 'out_for_delivery'])
      .order('created_at', { ascending: true }); // oldest first — first in, first out for the kitchen
    $('[data-queue-list]', root).innerHTML = (data || []).length
      ? data.map(queueCard).join('')
      : '<div class="empty-state"><b>All caught up</b><span>No orders need action right now.</span></div>';
  };

  $('[data-refresh-queue]', root).addEventListener('click', () => { toast('Queue refreshed.'); load(); });
  root.addEventListener('click', async event => {
    const view = event.target.closest('[data-view-order]');
    if (view) { openOrder(view.dataset.viewOrder, load); return; }
    const advance = event.target.closest('[data-advance-order]');
    if (advance) {
      advance.disabled = true;
      const { error } = await advanceOrderStatus(advance.dataset.advanceOrder, advance.dataset.advanceStatus);
      if (error) { toast(friendlyError(error), 'error'); advance.disabled = false; return; }
      toast(`Order marked ${STATUS_LABEL[advance.dataset.advanceStatus].toLowerCase()}.`);
      load();
    }
  });

  await load();
}
