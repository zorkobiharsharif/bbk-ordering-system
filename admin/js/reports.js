import { db } from './state.js';
import { $, money, todayISO, daysAgoISO, loadingRow } from './utils.js';
import { exportCSV, exportExcel, exportPDF } from './export.js';

function endOfDay(dateStr) { return `${dateStr}T23:59:59`; }

function bindExport(container, rows, columns, title, filename) {
  container.querySelector('[data-export="csv"]')?.addEventListener('click', () => exportCSV(rows, columns, filename));
  container.querySelector('[data-export="xlsx"]')?.addEventListener('click', () => exportExcel(rows, columns, filename));
  container.querySelector('[data-export="pdf"]')?.addEventListener('click', () => exportPDF(title, rows, columns, filename));
}

function table(rows, columns) {
  return `<table class="report-table"><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>${columns.map(c => `<td>${r[c.key] ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="hint">No data in this range.</td></tr>`}</tbody></table>`;
}

export async function renderReports(root) {
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Reports</h2>
        <div class="report-range">
          <button type="button" data-preset="today">Today</button>
          <button type="button" data-preset="yesterday">Yesterday</button>
          <button type="button" data-preset="week">This week</button>
          <button type="button" data-preset="month">This month</button>
          <button type="button" data-preset="year">This year</button>
          <input type="date" data-from><input type="date" data-to>
          <button data-run-report>Run</button>
        </div>
      </div>
      <p class="hint">Cancelled orders are always excluded from revenue and average order value.</p>
    </section>
    <div data-report-body></div>`;

  $('[data-from]', root).value = todayISO();
  $('[data-to]', root).value = todayISO();

  $('[data-preset]', root).parentElement.addEventListener('click', event => {
    const preset = event.target.closest('[data-preset]');
    if (!preset) return;
    const to = todayISO();
    const ranges = { today: [todayISO(), to], yesterday: [daysAgoISO(1), daysAgoISO(1)], week: [daysAgoISO(7), to], month: [daysAgoISO(30), to], year: [daysAgoISO(365), to] };
    const [from, until] = ranges[preset.dataset.preset];
    $('[data-from]', root).value = from; $('[data-to]', root).value = until;
    run();
  });
  $('[data-run-report]', root).addEventListener('click', run);

  async function run() {
    const from = $('[data-from]', root).value, to = $('[data-to]', root).value;
    const body = $('[data-report-body]', root);
    body.innerHTML = loadingRow('Crunching numbers…');

    const [
      { data: delivered }, { data: cancelled }, { data: items },
      { data: customerOrders }, { data: coupons },
    ] = await Promise.all([
      db.from('orders').select('cod_total,distance_km').eq('status', 'delivered').gte('created_at', from).lte('created_at', endOfDay(to)),
      db.from('orders').select('cod_total,cancelled_reason').eq('status', 'cancelled').gte('created_at', from).lte('created_at', endOfDay(to)),
      db.from('order_items').select('product_name,category_id,quantity,line_total,categories(name),orders!inner(status,created_at)').eq('orders.status', 'delivered').gte('orders.created_at', from).lte('orders.created_at', endOfDay(to)),
      db.from('orders').select('customer_id,cod_total,customers(name,phone)').eq('status', 'delivered').gte('created_at', from).lte('created_at', endOfDay(to)),
      db.from('orders').select('discount,coupon_id,coupons(code)').eq('status', 'delivered').not('coupon_id', 'is', null).gte('created_at', from).lte('created_at', endOfDay(to)),
    ]);

    const revenue = (delivered || []).reduce((n, o) => n + Number(o.cod_total), 0);
    const avgOrder = delivered?.length ? revenue / delivered.length : 0;
    const cancelledValue = (cancelled || []).reduce((n, o) => n + Number(o.cod_total), 0);
    const distances = (delivered || []).map(o => o.distance_km).filter(d => d != null);
    const avgDistance = distances.length ? distances.reduce((a, b) => a + Number(b), 0) / distances.length : null;

    const byCategory = {};
    const byItem = {};
    (items || []).forEach(i => {
      const catName = i.categories?.name || 'Uncategorised';
      byCategory[catName] = byCategory[catName] || { category: catName, revenue: 0, quantity: 0 };
      byCategory[catName].revenue += Number(i.line_total); byCategory[catName].quantity += i.quantity;
      byItem[i.product_name] = byItem[i.product_name] || { product: i.product_name, revenue: 0, quantity: 0 };
      byItem[i.product_name].revenue += Number(i.line_total); byItem[i.product_name].quantity += i.quantity;
    });
    const categoryRows = Object.values(byCategory).sort((a, b) => b.revenue - a.revenue).map(r => ({ ...r, revenue: money(r.revenue) }));
    const itemRowsAll = Object.values(byItem).sort((a, b) => b.quantity - a.quantity);
    const topItems = itemRowsAll.slice(0, 10).map(r => ({ ...r, revenue: money(r.revenue) }));
    const leastItems = itemRowsAll.slice(-10).reverse().map(r => ({ ...r, revenue: money(r.revenue) }));

    const spendByCustomer = {};
    (customerOrders || []).forEach(o => {
      const s = spendByCustomer[o.customer_id] || (spendByCustomer[o.customer_id] = { name: o.customers?.name || '—', phone: o.customers?.phone || '—', orders: 0, total: 0 });
      s.orders += 1; s.total += Number(o.cod_total);
    });
    const customerRows = Object.values(spendByCustomer).sort((a, b) => b.total - a.total).map(r => ({ ...r, total: money(r.total) }));
    const repeatCount = Object.values(spendByCustomer).filter(c => c.orders > 1).length;

    const couponUsage = {};
    (coupons || []).forEach(o => {
      const code = o.coupons?.code || 'Unknown';
      couponUsage[code] = couponUsage[code] || { code, uses: 0, discount: 0 };
      couponUsage[code].uses += 1; couponUsage[code].discount += Number(o.discount);
    });
    const couponRows = Object.values(couponUsage).map(r => ({ ...r, discount: money(r.discount) }));

    body.innerHTML = `
      <section class="panel"><div class="cards">
        ${[['Revenue (delivered only)', `₹${money(revenue)}`], ['Delivered orders', delivered?.length || 0], ['Average order value', `₹${money(avgOrder)}`],
          ['Cancelled orders', `${cancelled?.length || 0} (₹${money(cancelledValue)} not counted)`], ['Avg delivery distance', avgDistance != null ? `${avgDistance.toFixed(1)} km` : '—'], ['Repeat customers', repeatCount]]
          .map(([label, value]) => `<article class="card"><span>${label}</span><b>${value}</b></article>`).join('')}
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Category sales</h2><div class="export-row" data-export-cat><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="pdf">PDF</button></div></div>${table(categoryRows, [{ key: 'category', label: 'Category' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue (₹)' }])}</section>
      <section class="panel"><div class="panel-head"><h2>Top selling items</h2><div class="export-row" data-export-top><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="pdf">PDF</button></div></div>${table(topItems, [{ key: 'product', label: 'Product' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue (₹)' }])}</section>
      <section class="panel"><div class="panel-head"><h2>Least selling items</h2><div class="export-row" data-export-least><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="pdf">PDF</button></div></div>${table(leastItems, [{ key: 'product', label: 'Product' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue (₹)' }])}</section>
      <section class="panel"><div class="panel-head"><h2>Customer report</h2><div class="export-row" data-export-cust><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="pdf">PDF</button></div></div>${table(customerRows, [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'orders', label: 'Orders' }, { key: 'total', label: 'Total spent (₹)' }])}</section>
      <section class="panel"><div class="panel-head"><h2>Coupon report</h2><div class="export-row" data-export-coup><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="pdf">PDF</button></div></div>${table(couponRows, [{ key: 'code', label: 'Code' }, { key: 'uses', label: 'Times used' }, { key: 'discount', label: 'Total discount (₹)' }])}</section>
    `;

    bindExport(body.querySelector('[data-export-cat]'), categoryRows, [{ key: 'category', label: 'Category' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue' }], 'Category sales', `bbk-category-sales-${from}-${to}`);
    bindExport(body.querySelector('[data-export-top]'), topItems, [{ key: 'product', label: 'Product' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue' }], 'Top selling items', `bbk-top-items-${from}-${to}`);
    bindExport(body.querySelector('[data-export-least]'), leastItems, [{ key: 'product', label: 'Product' }, { key: 'quantity', label: 'Units sold' }, { key: 'revenue', label: 'Revenue' }], 'Least selling items', `bbk-least-items-${from}-${to}`);
    bindExport(body.querySelector('[data-export-cust]'), customerRows, [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'orders', label: 'Orders' }, { key: 'total', label: 'Total spent' }], 'Customer report', `bbk-customers-${from}-${to}`);
    bindExport(body.querySelector('[data-export-coup]'), couponRows, [{ key: 'code', label: 'Code' }, { key: 'uses', label: 'Times used' }, { key: 'discount', label: 'Total discount' }], 'Coupon report', `bbk-coupons-${from}-${to}`);
  }

  await run();
}
