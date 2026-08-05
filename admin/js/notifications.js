import { db } from './state.js';
import { $, money, toast, friendlyError } from './utils.js';

const SOUND_KEY = 'bbk-admin-sound-enabled';
let unseenCount = 0;

// A short two-tone chime synthesised with the Web Audio API — no audio file
// to host or go missing.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = freq; osc.type = 'sine';
      osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.start(start); osc.stop(start + 0.32);
    });
  } catch { /* Web Audio unavailable — silently skip the sound */ }
}

function soundEnabled() { return localStorage.getItem(SOUND_KEY) !== 'off'; }

function updateBadge() {
  const el = $('[data-live-counter]');
  if (!el) return;
  el.textContent = unseenCount > 0 ? String(unseenCount) : '';
  el.hidden = unseenCount === 0;
}

export function resetLiveCounter() {
  unseenCount = 0;
  updateBadge();
}

// ---------------------------------------------------------------------------
// New-order alert: a new order is easy to miss with a one-shot toast, so this
// keeps chiming every 3s and shows a big on-screen banner until the owner
// either opens the order (orders.js calls acknowledgeOrder on open) or
// accepts it right from the banner. Each order alerts independently — a
// second new order while the first is still unacknowledged just joins the
// same repeating loop rather than starting a second one, and a given order
// can only ever be added to the loop once (Map keyed by order id), so it can
// never chime "twice" for the same order.
// ---------------------------------------------------------------------------
const pendingOrderAlerts = new Map(); // orderId -> { orderNumber, codTotal }
let alertIntervalId = null;

function ensurePopupHost() {
  let host = $('[data-alert-host]');
  if (!host) {
    host = document.createElement('div');
    host.dataset.alertHost = '';
    document.body.append(host);
  }
  return host;
}

function renderAlertPopup() {
  const host = ensurePopupHost();
  const entries = [...pendingOrderAlerts.entries()];
  if (!entries.length) { host.innerHTML = ''; return; }
  const [orderId, order] = entries[0];
  const more = entries.length - 1;
  host.innerHTML = `
    <div class="order-alert-overlay">
      <div class="order-alert-card">
        <div class="order-alert-badge">New order</div>
        <h2>#BBK-${order.orderNumber}</h2>
        <p class="order-alert-amount">₹${money(order.codTotal)}</p>
        ${more > 0 ? `<p class="order-alert-more">+${more} more new order${more > 1 ? 's' : ''} waiting</p>` : ''}
        <div class="order-alert-actions">
          <button type="button" class="button" data-open-order="${orderId}">View order</button>
          <button type="button" class="order-alert-accept" data-alert-accept="${orderId}">Accept order</button>
        </div>
      </div>
    </div>`;
  $('[data-alert-accept]', host).addEventListener('click', async () => {
    const { error } = await db.from('orders').update({ status: 'accepted' }).eq('id', orderId);
    if (error) { toast(friendlyError(error), 'error'); return; }
    await db.from('order_status_history').insert({ status: 'accepted', order_id: orderId });
    toast(`Order #BBK-${order.orderNumber} accepted.`);
    acknowledgeOrder(orderId);
  });
}

function stopAlertLoop() {
  if (alertIntervalId) { clearInterval(alertIntervalId); alertIntervalId = null; }
}

function startAlertLoop() {
  if (alertIntervalId) return; // already running
  if (soundEnabled()) playChime();
  alertIntervalId = setInterval(() => {
    if (!pendingOrderAlerts.size) { stopAlertLoop(); return; }
    if (soundEnabled()) playChime();
  }, 3000);
}

export function acknowledgeOrder(orderId) {
  if (!pendingOrderAlerts.has(orderId)) return;
  pendingOrderAlerts.delete(orderId);
  renderAlertPopup();
  if (!pendingOrderAlerts.size) stopAlertLoop();
}

let realtimeStarted = false;

export function initRealtime() {
  // db.channel('orders-live') returns the SAME channel object if this is
  // called again with that name (the client caches channels by topic), and
  // Supabase throws if you call .on() on a channel that's already
  // subscribed. boot() can legitimately run more than once per page load
  // (e.g. an existing session auto-restoring, then the login form also
  // being submitted), so this has to be safe to call repeatedly.
  if (realtimeStarted) return;
  realtimeStarted = true;

  // Broadcast, not postgres_changes: RLS (is_admin()) can't be satisfied over
  // the Realtime websocket connection since it depends on the x-admin-session
  // HTTP header, which only exists for PostgREST requests — see create-order
  // for the full explanation. create-order publishes this broadcast itself
  // with service-role, after saving the order.
  db.channel('orders-live')
    .on('broadcast', { event: 'new_order' }, ({ payload }) => {
      unseenCount += 1;
      updateBadge();
      toast(`New order — ₹${money(payload.codTotal)}`, 'ok');
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('New BBK order', { body: `#BBK-${payload.orderNumber} · ₹${money(payload.codTotal)} · tap to view` });
      }
      if (payload.orderId && !pendingOrderAlerts.has(payload.orderId)) {
        pendingOrderAlerts.set(payload.orderId, { orderNumber: payload.orderNumber, codTotal: payload.codTotal });
        renderAlertPopup();
        startAlertLoop();
      }
    })
    .subscribe();

  db.channel('cake-requests-live')
    .on('broadcast', { event: 'new_cake_request' }, ({ payload }) => {
      unseenCount += 1;
      updateBadge();
      if (soundEnabled()) playChime();
      toast(`New custom cake request — ${payload.customerName}`, 'ok');
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('New BBK cake request', { body: `${payload.customerName} · tap Cake Requests to view` });
      }
    })
    .subscribe();
}

export async function renderNotifications(root) {
  const permission = window.Notification ? Notification.permission : 'unsupported';
  root.innerHTML = `
    <section class="panel">
      <h2>Browser notifications</h2>
      <p class="hint">Fires a desktop notification the instant a new order is saved, as long as this admin tab (or browser) stays open.</p>
      <p>Status: <b>${permission}</b></p>
      ${permission === 'granted' ? '' : '<button data-request-permission>Enable browser notifications</button>'}
    </section>
    <section class="panel">
      <h2>Notification sound</h2>
      <p class="hint">New orders keep chiming every few seconds — and show a big on-screen alert — until you open or accept them, so one can't slip by unnoticed.</p>
      <label class="check"><input type="checkbox" data-sound-toggle ${soundEnabled() ? 'checked' : ''}> Play a sound when a new order arrives</label>
      <button type="button" data-test-sound>Test sound</button>
    </section>
    <section class="panel">
      <h2>Recent activity</h2>
      <div data-activity-log></div>
    </section>`;

  $('[data-request-permission]', root)?.addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? 'Notifications enabled.' : 'Permission not granted.', result === 'granted' ? 'ok' : 'error');
    renderNotifications(root);
  });
  $('[data-sound-toggle]', root).addEventListener('change', event => {
    localStorage.setItem(SOUND_KEY, event.target.checked ? 'on' : 'off');
  });
  $('[data-test-sound]', root).addEventListener('click', playChime);

  const { data: history } = await db.from('order_status_history').select('status,created_at,orders(order_number)').order('created_at', { ascending: false }).limit(20);
  $('[data-activity-log]', root).innerHTML = (history || []).map(h => `<div class="history-row"><span>${new Date(h.created_at).toLocaleString('en-IN')}</span><b>#BBK-${h.orders?.order_number ?? '—'}</b><small>${h.status}</small></div>`).join('') || '<p class="hint">No activity yet.</p>';
}
