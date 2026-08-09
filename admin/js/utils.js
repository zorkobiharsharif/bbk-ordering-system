export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const money = value => new Intl.NumberFormat('en-IN').format(Math.round(value || 0));
export const dateLabel = iso => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const daysAgoISO = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
// The real start of "today" in IST, as an exact UTC instant — todayISO()
// above slices at UTC midnight, which is 5:30am IST, so for the first
// ~5.5 hours of every IST day it silently means "yesterday". Shifting the
// clock forward by the IST offset before reading the date components (then
// shifting the resulting midnight back) gives the correct IST day boundary
// regardless of what time zone the browser/server itself is in.
export function todayStartIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const istMidnightAsUTC = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  return new Date(istMidnightAsUTC - IST_OFFSET_MS).toISOString();
}

// One shared loading placeholder — several list/report pages used to show
// nothing at all while their first fetch was in flight (a blank panel reads
// as broken, not "working"), and a couple showed a bare "Loading…" with no
// visual cue at all. Same spinner + text everywhere now.
export const loadingRow = (text = 'Loading…') => `<div class="loading-row"><span class="spinner"></span>${text}</div>`;

// <input type="datetime-local"> has no timezone of its own — its value is a
// plain "YYYY-MM-DDTHH:mm" string. Slicing a stored UTC ISO string straight
// into that field (the old approach) shows/saves the wrong wall-clock time
// for anyone not in UTC: for IST (UTC+5:30), an offer/coupon/banner meant to
// "start now" got saved ~5.5 hours in the future, so it sat as "Scheduled"
// for hours instead of going live immediately. `new Date(...)` treats a
// timezone-less string as *local* time (per spec), so round-tripping through
// it here does the conversion correctly in both directions.
export function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInputValue(value) {
  return value ? new Date(value).toISOString() : null;
}

// See js/api.js's edgeFunctionErrorMessage for the full explanation:
// error.context is a Response whose .body is a stream, not a string —
// JSON.parse(error.context.body) always throws instead of reading the
// actual error message.
export async function edgeFunctionErrorMessage(error, fallback) {
  try {
    const text = await error.context?.text?.();
    return text ? JSON.parse(text).error || fallback : fallback;
  } catch {
    return fallback;
  }
}

// Turns raw Postgres/JS errors (foreign key codes, "duplicate key value
// violates unique constraint...", "Unexpected token", network failures) into
// something a non-technical owner/staff member can actually act on. The
// original error always still goes to console.error for our own debugging.
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  console.error(error);
  const message = String(error?.message || error || '');
  if (error?.code === '23503' || /foreign key constraint/i.test(message)) return "This is linked to other records, so it can't be changed right now.";
  if (error?.code === '23505' || /duplicate key/i.test(message)) return 'That already exists — try a different name or code.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "Couldn't connect. Check your internet and try again.";
  if (/unexpected token|json/i.test(message)) return fallback;
  return message && message.length < 100 && !/[{}<>]/.test(message) ? message : fallback;
}

export function toast(message, tone = 'ok') {
  let host = $('[data-toast-host]');
  if (!host) { host = document.createElement('div'); host.dataset.toastHost = ''; host.className = 'toast-host'; document.body.append(host); }
  const node = document.createElement('div');
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  host.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => { node.classList.remove('show'); setTimeout(() => node.remove(), 250); }, 3200);
}

export function openForm(html, onSubmit, { wide = false } = {}) {
  const dialog = $('[data-admin-dialog]'), form = $('[data-admin-form]');
  dialog.classList.toggle('wide', wide);
  $('[data-admin-form-body]').innerHTML = html;
  // openForm() is sometimes called again on an already-open dialog (e.g. the
  // variants/add-ons and offer-items sub-editors re-render themselves after
  // every add/remove) — showModal() throws on an already-open <dialog>, so
  // only call it the first time.
  if (!dialog.open) dialog.showModal();
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) button.disabled = true;
    try {
      await onSubmit(form);
      dialog.close();
    } catch (error) {
      toast(friendlyError(error, 'Could not save.'), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };
  return dialog;
}

export function confirmAction(message) {
  return window.confirm(message);
}

export function badge(text, tone = 'default') {
  return `<span class="badge badge-${tone}">${text}</span>`;
}

export async function uploadPublicImage(db, file, folder = 'general') {
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`;
  const { error } = await db.storage.from('bbk-public').upload(path, file, { upsert: false });
  if (error) throw error;
  return db.storage.from('bbk-public').getPublicUrl(path).data.publicUrl;
}

// Small "Recommended: W × H px" caption to put under every image field, so
// nobody has to guess (or upload something that ends up cropped oddly).
export function imageHint(width, height, note = '') {
  return `<small class="image-hint">Recommended: ${width} × ${height} px${note ? ` · ${note}` : ''}</small>`;
}

// Reads the file's real pixel dimensions and, if its aspect ratio is well
// off the recommended one, asks before uploading — a warning, not a hard
// block, since a restaurant owner's only available photo of a dish is still
// better than no photo. Resolves true to proceed, false to cancel.
export function checkImageRatio(file, width, height) {
  return new Promise(resolve => {
    const targetRatio = width / height;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const actualRatio = img.naturalWidth / img.naturalHeight;
      const offBy = Math.abs(actualRatio - targetRatio) / targetRatio;
      if (offBy < 0.15) return resolve(true);
      resolve(confirm(`This image is ${img.naturalWidth} × ${img.naturalHeight} px. The recommended size here is ${width} × ${height} px — a different shape than this photo, so it may end up cropped oddly. Upload it anyway?`));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(true); }; // can't read it — don't block the upload over that
    img.src = url;
  });
}
