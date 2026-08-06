import { isOwner } from './state.js';
import { $, $$, toast } from './utils.js';
import { guard, wireSignOut } from './auth.js';
import { wireChangePassword } from './account.js';
import { renderDashboard, renderStaffQueue } from './dashboard.js';
import { renderOrders, openOrder } from './orders.js';
import { renderProducts } from './products.js';
import { renderCategories } from './categories.js';
import { renderOffers } from './offers.js';
import { renderCoupons } from './coupons.js';
import { renderCustomers } from './customers.js';
import { renderBanners } from './banners.js';
import { renderReports } from './reports.js';
import { renderHours } from './hours.js';
import { renderSettings } from './settings.js';
import { renderStaff } from './staff.js';
import { renderNotifications, initRealtime, resetLiveCounter } from './notifications.js';
import { renderImageGuide } from './image-guide.js';

// ownerOnly: true means staff cannot open this view even by editing the URL
// hash or clicking a stray button — show() below refuses it outright. This
// is the UI-side half of the permission model; the real enforcement is the
// RLS policies in supabase/permissions.sql, which staff's Supabase session
// cannot bypass regardless of what the admin UI shows or hides.
// Staff land on a dedicated order queue instead of the owner's mixed
// metrics dashboard — nothing to do there but move orders forward, so
// nothing else competes for attention.
const VIEWS = {
  dashboard: { title: 'Dashboard', staffTitle: 'Order Queue', render: root => (isOwner() ? renderDashboard(root) : renderStaffQueue(root)), ownerOnly: false },
  orders: { title: 'Orders', render: renderOrders, ownerOnly: false },
  products: { title: 'Products', render: renderProducts, ownerOnly: false },
  categories: { title: 'Categories', render: renderCategories, ownerOnly: false },
  customers: { title: 'Customers', render: renderCustomers, ownerOnly: true },
  offers: { title: 'Offers', render: renderOffers, ownerOnly: true },
  coupons: { title: 'Coupons', render: renderCoupons, ownerOnly: true },
  reports: { title: 'Reports', render: renderReports, ownerOnly: true },
  hours: { title: 'Business Hours', render: renderHours, ownerOnly: false },
  banners: { title: 'Banners', render: renderBanners, ownerOnly: true },
  notifications: { title: 'Notifications', render: renderNotifications, ownerOnly: false },
  staff: { title: 'Staff Management', render: renderStaff, ownerOnly: true },
  settings: { title: 'Settings', render: renderSettings, ownerOnly: true },
  'image-guide': { title: 'Image Guide', render: renderImageGuide, ownerOnly: false },
};

async function show(view) {
  if (VIEWS[view].ownerOnly && !isOwner()) {
    toast('Only the owner account can open this.', 'error');
    view = 'dashboard';
  }
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('[data-title]').textContent = (!isOwner() && VIEWS[view].staffTitle) || VIEWS[view].title;
  const target = $('[data-content]');
  target.innerHTML = '';
  await VIEWS[view].render(target);
  if (view === 'orders' || view === 'dashboard') resetLiveCounter();
}

function wireNav() {
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) show(nav.dataset.view);
    const openOrderTrigger = event.target.closest('[data-open-order]');
    if (openOrderTrigger) openOrder(openOrderTrigger.dataset.openOrder, () => show('orders'));
    // The dialog's × button used to be a plain submit button inside a
    // <form method="dialog"> — clicking it triggered the SAME save handler
    // as the real submit button (openForm() intercepts all submits), and if
    // any required field was still empty, the browser's own validation
    // silently blocked it before anything happened at all. It needs to just
    // close, never submit.
    if (event.target.closest('[data-dialog-cancel]')) $('[data-admin-dialog]').close();
  });
}

function applyRoleVisibility() {
  if (isOwner()) return;
  $$('[data-view]').forEach(button => {
    if (VIEWS[button.dataset.view]?.ownerOnly) button.hidden = true;
  });
}

async function boot() {
  wireNav();
  wireSignOut();
  wireChangePassword();
  applyRoleVisibility();
  initRealtime();
  await show('dashboard');
}

guard(boot);
