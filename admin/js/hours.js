import { db, state, isOwner } from './state.js';
import { $, toast } from './utils.js';

const toMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function nowMinutesIST() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}
function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${period}` : `${h12} ${period}`;
}
// Same "Open / Closing Soon / Closed" language the customer site shows —
// this is the owner's own preview of it, computed from the same rule.
function liveStatus(h) {
  if (h.is_always_open) return { tone: 'is-open', label: 'Open' };
  const now = nowMinutesIST();
  const open = toMinutes(h.opens_at), close = toMinutes(h.closes_at);
  const isOpenNow = close > open ? (now >= open && now < close) : (now >= open || now < close);
  if (!isOpenNow) return { tone: 'is-closed', label: `Closed · opens ${formatTime(h.opens_at.slice(0, 5))}` };
  const minutesToClose = close > now ? close - now : (close + 1440) - now;
  if (minutesToClose <= 30) return { tone: 'is-soon', label: `Closing soon · ${formatTime(h.closes_at.slice(0, 5))}` };
  return { tone: 'is-open', label: `Open · until ${formatTime(h.closes_at.slice(0, 5))}` };
}

export async function renderHours(root) {
  const [{ data: categories }, { data: settings }] = await Promise.all([
    db.from('categories').select('id,name,category_hours(*)').order('display_order'),
    db.from('business_settings').select('manual_override,ordering_enabled').eq('id', true).single(),
  ]);
  const owner = isOwner();

  root.innerHTML = `
    <section class="panel emergency-panel">
      <div class="emergency-head">
        <span class="emergency-icon">!</span>
        <div><h2>Emergency override</h2><p class="hint">Ignores the schedule below and every clock — use only for something unplanned (burst pipe, festival rush).</p></div>
      </div>
      <select data-override>
        <option value="none" ${settings.manual_override === 'none' ? 'selected' : ''}>Off — follow the normal schedule</option>
        <option value="force_open" ${settings.manual_override === 'force_open' ? 'selected' : ''}>Force everything OPEN right now</option>
        <option value="force_closed" ${settings.manual_override === 'force_closed' ? 'selected' : ''}>Force everything CLOSED right now</option>
      </select>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Daily schedule</h2></div>
      <p class="hint">${owner ? 'Set the times each category opens and closes every day, then press Save.' : 'Only the owner can change these times.'}</p>
      <div data-hours-list></div>
    </section>`;

  $('[data-override]', root).addEventListener('change', async event => {
    const { error } = await db.from('business_settings').update({ manual_override: event.target.value }).eq('id', true);
    if (error) toast('Something went wrong. Please try again.', 'error'); else toast('Override updated.');
  });

  const lock = owner ? '' : 'disabled';
  $('[data-hours-list]', root).innerHTML = categories.map(c => {
    // category_hours.category_id is both primary key and the FK to
    // categories — a true 1:1 relationship, so PostgREST embeds it as a
    // single object here, not an array (unlike a normal one-to-many embed).
    const h = c.category_hours || { opens_at: '09:00', closes_at: '22:00', is_always_open: false };
    const status = liveStatus(h);
    return `<div class="hours-card" data-category="${c.id}">
      <div class="hours-card-top">
        <b>${c.name}</b>
        <span class="status-pill ${status.tone}" data-status-preview>${status.label}</span>
      </div>
      <div class="hours-card-controls">
        <label class="check"><input type="checkbox" data-field="is_always_open" ${h.is_always_open ? 'checked' : ''} ${lock}> Open 24 hours</label>
        <div class="hours-time-row" ${h.is_always_open ? 'hidden' : ''}>
          <input type="time" data-field="opens_at" value="${h.opens_at.slice(0, 5)}" ${lock}>
          <span class="hours-arrow">&rarr;</span>
          <input type="time" data-field="closes_at" value="${h.closes_at.slice(0, 5)}" ${lock}>
        </div>
        ${owner ? `<button type="button" class="button" data-save-hours="${c.id}">Save</button>` : ''}
      </div>
    </div>`;
  }).join('');

  root.addEventListener('change', event => {
    const alwaysOpen = event.target.closest('[data-field="is_always_open"]');
    if (alwaysOpen) {
      const row = alwaysOpen.closest('[data-category]');
      row.querySelector('.hours-time-row').hidden = alwaysOpen.checked;
    }
  });

  root.addEventListener('click', async event => {
    const save = event.target.closest('[data-save-hours]');
    if (!save) return;
    const row = save.closest('[data-category]');
    const record = {
      category_id: save.dataset.saveHours,
      is_always_open: row.querySelector('[data-field="is_always_open"]').checked,
      opens_at: row.querySelector('[data-field="opens_at"]').value || '00:00',
      closes_at: row.querySelector('[data-field="closes_at"]').value || '23:59',
    };
    save.disabled = true;
    const { error } = await db.from('category_hours').upsert(record, { onConflict: 'category_id' });
    save.disabled = false;
    if (error) { toast('Something went wrong. Please try again.', 'error'); return; }
    toast('Hours saved.');
    const preview = row.querySelector('[data-status-preview]');
    const status = liveStatus(record);
    preview.className = `status-pill ${status.tone}`;
    preview.textContent = status.label;
  });
}
