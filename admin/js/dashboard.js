import { db, isOwner } from './state.js';
import { $, money, todayISO, todayStartIST, toast, friendlyError } from './utils.js';
import { openOrder, STATUS_LABEL, STATUS_FLOW, advanceOrderStatus } from './orders.js';

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

const formatOrderTime = iso => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

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

// Shared by both the owner Dashboard's "Needs action" widget and staff's
// full-screen queue — one big "next step" button per card (from
// STATUS_FLOW) so the common case never needs the detail dialog, and
// enough visual separation (status badge, clear amount) to scan a list of
// these at a glance instead of hunting through dense text.
function queueCard(o) {
  const step = STATUS_FLOW[o.status];
  return `<article class="queue-card">
    <div class="queue-card-top">
      <b>#BBK-${o.order_number}</b>
      <span class="status ${o.status}">${STATUS_LABEL[o.status]}</span>
    </div>
    <div class="queue-card-body">
      <span class="queue-card-amount">₹${money(o.cod_total)}</span>
      <span class="queue-card-customer">${o.customers?.name || ''} · ${o.customers?.phone || ''}</span>
      <span class="queue-card-time">${formatOrderTime(o.created_at)}</span>
    </div>
    <div class="queue-card-actions">
      <button type="button" data-view-order="${o.id}">View details</button>
      ${step ? `<button type="button" class="button primary wide" data-advance-order="${o.id}" data-advance-status="${step.next}">${step.label} &rarr;</button>` : ''}
    </div>
  </article>`;
}

// Both the owner Dashboard widget and staff's full queue reload on the same
// realtime signal (see notifications.js), instead of only the unseen-count
// badge updating while the visible list quietly goes stale until someone
// taps Refresh or navigates away and back.
function wireLiveReload(root, reload) {
  const handler = () => { if (root.isConnected && root.querySelector('[data-queue-list], [data-recent-orders]')) reload(); };
  document.addEventListener('bbk:new-order', handler);
}

function wireQueueActions(root, load) {
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
}

export async function renderDashboard(root) {
  const day = todayISO();
  const [{ data: delivered }, { data: settings }] = await Promise.all([
    db.from('orders').select('cod_total,status').eq('status', 'delivered').gte('created_at', day),
    db.from('business_settings').select('ordering_enabled').eq('id', true).single(),
  ]);
  const sales = (delivered || []).reduce((n, x) => n + Number(x.cod_total), 0);
  const orderingOn = Boolean(settings?.ordering_enabled);

  root.innerHTML = `
    ${orderingTogglePanel(orderingOn)}
    <div class="cards" data-metrics></div>
    <section class="panel">
      <div class="panel-head"><h2>Orders needing action</h2><button type="button" data-refresh-queue title="Reload the list">&#8635; Refresh</button></div>
      <div class="queue-list" data-recent-orders></div>
    </section>`;

  wireOrderingToggle(root, () => renderDashboard(root));

  // Only today's brand-new orders — an order that's sat unhandled since
  // yesterday needs chasing down on the full Orders page, not silently
  // aging on the home screen forever; this widget is for "what's new today".
  const load = async () => {
    const { data: pending } = await db.from('orders')
      .select('id,order_number,status,cod_total,created_at,customers(name,phone)')
      .in('status', ['new', 'address_needs_check'])
      .gte('created_at', todayStartIST())
      .order('created_at', { ascending: false });
    $('[data-metrics]', root).innerHTML = [
      // Revenue is business performance data, hidden from staff — the cash
      // amount on an individual order (needed to collect COD) still shows in
      // Orders/Dashboard's order rows, that's an operational detail, not this.
      ...(isOwner() ? [['Delivered today', `₹${money(sales)}`]] : []),
      ['Delivered orders', delivered?.length || 0],
      ['Needs action', pending?.length || 0],
    ].map(([label, value]) => `<article class="card"><span>${label}</span><b>${value}</b></article>`).join('');
    $('[data-recent-orders]', root).innerHTML = (pending || []).length
      ? pending.map(queueCard).join('')
      : '<div class="empty-state"><b>All caught up</b><span>No orders need action today.</span></div>';
  };

  $('[data-refresh-queue]', root).addEventListener('click', () => { toast('Refreshed.'); load(); });
  wireQueueActions(root, load);
  wireLiveReload(root, load);
  await load();
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

  // Today's orders only (see renderDashboard above for why), most recent
  // first — was oldest-first, which meant the queue always opened on
  // whatever's been sitting longest instead of what just came in.
  const load = async () => {
    const { data } = await db.from('orders')
      .select('id,order_number,status,cod_total,created_at,customers(name,phone)')
      .in('status', ['new', 'address_needs_check', 'accepted', 'kitchen', 'out_for_delivery'])
      .gte('created_at', todayStartIST())
      .order('created_at', { ascending: false });
    $('[data-queue-list]', root).innerHTML = (data || []).length
      ? data.map(queueCard).join('')
      : '<div class="empty-state"><b>All caught up</b><span>No orders need action today.</span></div>';
  };

  $('[data-refresh-queue]', root).addEventListener('click', () => { toast('Queue refreshed.'); load(); });
  wireQueueActions(root, load);
  wireLiveReload(root, load);
  await load();
}
