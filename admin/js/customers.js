import { db } from './state.js';
import { $, money, dateLabel, openForm, badge, loadingRow } from './utils.js';

export async function renderCustomers(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Customers</h2></div>
      <input type="search" data-customer-search placeholder="Search by name or phone…" class="search-box">
      <div data-customer-list>${loadingRow()}</div>
    </section>`;

  const [{ data: customers }, { data: orders }] = await Promise.all([
    db.from('customers').select('*').order('name'),
    db.from('orders').select('customer_id,cod_total,status,created_at').eq('status', 'delivered'),
  ]);

  const stats = {};
  (orders || []).forEach(o => {
    const s = stats[o.customer_id] || (stats[o.customer_id] = { total: 0, count: 0, last: null });
    s.total += Number(o.cod_total); s.count += 1;
    if (!s.last || o.created_at > s.last) s.last = o.created_at;
  });

  const render = () => {
    const term = $('[data-customer-search]', root).value.trim().toLowerCase();
    const rows = (customers || []).filter(c => c.name.toLowerCase().includes(term) || c.phone.includes(term));
    $('[data-customer-list]', root).innerHTML = rows.map(c => {
      const s = stats[c.id] || { total: 0, count: 0, last: null };
      return `<article class="admin-row">
        <div><b>${c.name}</b><small>${c.phone}</small></div>
        <div><small>₹${money(s.total)} spent</small><small>${s.last ? dateLabel(s.last) : 'No delivered orders'}</small></div>
        ${s.count > 1 ? badge('Repeat customer', 'good') : badge('New', 'muted')}
        <button data-view-customer="${c.id}">View</button>
      </article>`;
    }).join('') || '<p class="hint">No customers match.</p>';
  };
  $('[data-customer-search]', root).addEventListener('input', render);
  root.addEventListener('click', async event => {
    const view = event.target.closest('[data-view-customer]');
    if (view) customerDetail(view.dataset.viewCustomer);
  });
  render();
}

async function customerDetail(customerId) {
  const [{ data: customer }, { data: items }, { data: delivered }] = await Promise.all([
    db.from('customers').select('*').eq('id', customerId).single(),
    db.from('order_items').select('product_name,quantity,orders!inner(customer_id,status)').eq('orders.customer_id', customerId).eq('orders.status', 'delivered'),
    db.from('orders').select('cod_total').eq('customer_id', customerId).eq('status', 'delivered'),
  ]);
  const counts = {};
  (items || []).forEach(i => { counts[i.product_name] = (counts[i.product_name] || 0) + i.quantity; });
  const favourite = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const totalSpent = (delivered || []).reduce((n, o) => n + Number(o.cod_total), 0);

  // Read-only view — no submit button, so this deliberately skips openForm()'s
  // save-flow callback. The dialog's own × (data-dialog-cancel, wired once in
  // main.js) is already the standard way every other dialog closes; a bespoke
  // second "Close" button here would just be a redundant second path to the
  // same thing.
  openForm(`
    <h2 class="form-title">${customer.name}</h2>
    <p class="hint">${customer.phone}</p>
    <div class="customer-stats">
      <div class="customer-stat"><span>Total spent</span><b>₹${money(totalSpent)}</b></div>
      <div class="customer-stat"><span>Delivered orders</span><b>${delivered?.length || 0}</b></div>
      <div class="customer-stat"><span>Favourite item</span><b>${favourite}</b></div>
    </div>
    <div class="customer-detail-row">
      <b>Address on file</b>
      <span>${customer.last_address || 'No address on file'}${customer.last_landmark ? ` · ${customer.last_landmark}` : ''}</span>
    </div>
  `, async () => {});
}
