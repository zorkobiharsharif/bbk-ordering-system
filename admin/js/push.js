import { db, getSession } from './state.js';

// Public key only — safe to ship in client code, it's what the browser
// uses to create a subscription. The matching private key never leaves
// the server; it's a Supabase Edge Function secret used only by
// create-order to sign outgoing push messages.
const VAPID_PUBLIC_KEY = 'BIfiljNILcEvPwLWCQzyOcZY3Wn8WOhRf7mw5TVgDeovVGy-6N2ZU3kgaHnyx9VhnTX8Fc28t8JbF8V-35o1ViM';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register('sw.js');
}

export async function subscribeToPush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported on this browser.');
  const registration = await registerServiceWorker();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  const session = getSession();
  const { error } = await db.from('push_subscriptions').upsert({
    admin_user_id: session.userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return subscription;
}

// Called on sign-out — a device that's logged out should stop getting
// order alerts meant for whoever's actually on duty, not keep pinging
// forever just because it was subscribed once. Best-effort: sign-out
// should never get stuck waiting on this or fail because of it.
export async function unsubscribeFromPush() {
  try {
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration('sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  } catch { /* best-effort cleanup, never block sign-out on this */ }
}
