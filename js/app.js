(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('en-IN').format(Math.round(value || 0));
  const cart = BBKStore;
  let catalog = { categories: [], products: [], settings: null };
  let activeCategory = 'all';
  let customerLocation = null;
  let categoryOpenMap = {};
  let orderingClosed = false;

  // ---- Business hours (client-side hint only — create-order re-checks this
  // server-side, so the worst a wrong client clock can do is show a slightly
  // stale banner, never let a closed-hours order through). ----
  const toMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const nowMinutesIST = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
  };
  const isWithinHours = hours => {
    if (!hours || hours.is_always_open) return true;
    const now = nowMinutesIST();
    const open = toMinutes(hours.opens_at), close = toMinutes(hours.closes_at);
    return close > open ? (now >= open && now < close) : (now >= open || now < close);
  };

  function computeAvailability() {
    const settings = catalog.settings;
    orderingClosed = !settings?.ordering_enabled || settings?.manual_override === 'force_closed';
    const forceOpen = settings?.manual_override === 'force_open';
    // category_hours.category_id is both primary key and FK to categories —
    // a true 1:1 relationship, so PostgREST embeds it as a single object
    // here, not an array.
    categoryOpenMap = Object.fromEntries(catalog.categories.map(c => [c.id, forceOpen || isWithinHours(c.category_hours)]));

    const banner = $('[data-hours-banner]');
    if (orderingClosed) { banner.hidden = false; banner.textContent = "We're currently closed. Please visit again later, or call BBK directly."; }
    else {
      const closed = catalog.categories.filter(c => !categoryOpenMap[c.id]);
      if (closed.length) { banner.hidden = false; banner.textContent = `${closed.map(c => c.name).join(', ')} ${closed.length > 1 ? "aren't" : "isn't"} taking orders right now.`; }
      else banner.hidden = true;
    }
  }

  function renderBanners(banners) {
    const section = $('[data-promo-banners]');
    if (!banners?.length) { section.hidden = true; return; }
    section.hidden = false;
    section.innerHTML = banners.map(b => {
      const card = `<div class="promo-banner-slide">
        <img src="${b.image_url}" alt="${b.title || 'BBK offer'}" loading="lazy">
        ${b.title || b.subtitle ? `<div class="promo-banner-copy">${b.title ? `<b>${b.title}</b>` : ''}${b.subtitle ? `<span>${b.subtitle}</span>` : ''}</div>` : ''}
      </div>`;
      return b.link_url ? `<a href="${b.link_url}" target="_blank" rel="noopener">${card}</a>` : card;
    }).join('');
  }

  // The hero photo has no dedicated admin upload field — rather than sit
  // empty forever, it borrows the first live banner (already owner-editable
  // in Banners), so the hero looks finished the moment any banner exists.
  // The promo strip below then skips that one banner so it isn't shown twice.
  function renderHeroPhoto(banners) {
    const slot = $('[data-hero-photo]');
    const [hero, ...rest] = banners || [];
    if (hero) slot.innerHTML = `<img src="${hero.image_url}" alt="${hero.title || 'Bittu Burger King'}" loading="eager">`;
    else slot.innerHTML = `<span class="photo-placeholder-icon">\u{1F354}</span><span>BBK HERO PHOTO</span><small>Upload a banner in Admin &rarr; Banners to show it here</small>`;
    return rest;
  }

  // Same idea as the hero photo: the cake band already has an editable image
  // source (the Cakes category's banner/photo in Admin → Categories) — use
  // it instead of leaving a permanent "add a photo later" placeholder.
  function renderCakePhoto(categories) {
    const slot = $('[data-cake-photo]');
    if (!slot) return;
    const cakes = categories.find(c => /cake/i.test(c.name));
    const image = cakes?.banner_url || cakes?.image_url;
    if (image) slot.innerHTML = `<img src="${image}" alt="${cakes.name}" loading="lazy">`;
    else slot.innerHTML = `<span class="photo-placeholder-icon">\u{1F370}</span><span>BBK CAKE PHOTO</span><small>Add a photo to the Cakes category in Admin</small>`;
  }

  function renderContactInfo(settings) {
    if (!settings) return;
    if (settings.address) $('[data-contact-address]').textContent = settings.address;
    if (settings.established_year) $('[data-contact-since]').textContent = `Serving Bihar Sharif since ${settings.established_year}`;
    if (settings.maps_link) $('[data-contact-maps]').href = settings.maps_link;
    if (settings.whatsapp_number) $('[data-contact-whatsapp]').href = `https://wa.me/${settings.whatsapp_number}`;
  }

  function formatTime12h(hhmmss) {
    const [h, m] = hhmmss.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')} ${period}` : `${h12} ${period}`;
  }

  // Was a hardcoded "Burgers: 3 PM-10 PM, Cakes: 10 AM-10 PM" string in the
  // HTML — went stale the moment hours changed in Admin. Groups categories
  // that share the same schedule so it doesn't repeat the same range once
  // per category (e.g. "Cakes, Pastries 10 AM-10 PM").
  function renderHoursSummary(categories) {
    const el = $('[data-contact-hours]');
    if (!el || !categories?.length) return;
    const groups = new Map();
    for (const c of categories) {
      const h = c.category_hours;
      const key = h?.is_always_open ? 'always' : h ? `${h.opens_at}-${h.closes_at}` : 'unset';
      if (!groups.has(key)) groups.set(key, { hours: h, names: [] });
      groups.get(key).names.push(c.name);
    }
    el.textContent = [...groups.values()].map(g => {
      const range = g.hours?.is_always_open ? 'Open 24 hours' : g.hours ? `${formatTime12h(g.hours.opens_at)}–${formatTime12h(g.hours.closes_at)}` : 'Hours not set';
      return `${g.names.join(', ')} ${range}`;
    }).join(' · ');
  }

  // Best-matching automatic offer (percent/flat, no code) — mirrors the
  // server's own selection in create-order so the cart preview matches what
  // actually gets charged, and so the customer can see *why* a discount
  // applied before checkout. Coupons stack on top of this. free_item/combo
  // were removed — only percent/flat exist now.
  function bestOffer(lines) {
    let best = { discount: 0, offer: null };
    const now = new Date();
    for (const offer of catalog.offers || []) {
      if (offer.starts_at && new Date(offer.starts_at) > now) continue;
      if (offer.ends_at && new Date(offer.ends_at) < now) continue;
      const eligible = lines.reduce((sum, line) => {
        const product = catalog.products.find(p => p.id === line.productId);
        if (!product) return sum;
        if (offer.applies_to_product_id && product.id !== offer.applies_to_product_id) return sum;
        if (offer.applies_to_category_id && product.category_id !== offer.applies_to_category_id) return sum;
        return sum + line.unitPrice * line.quantity;
      }, 0);
      if (eligible <= 0 || eligible < Number(offer.min_subtotal)) continue;
      const candidate = offer.type === 'percent' ? eligible * Number(offer.discount_value) / 100 : Math.min(Number(offer.discount_value), eligible);
      if (candidate > best.discount) best = { discount: candidate, offer };
    }
    return best;
  }

  function totals() {
    const state = cart.get();
    const subtotal = state.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const { discount: offerDiscount, offer } = bestOffer(state.lines);
    const couponDiscount = state.coupon?.discount || 0;
    const discount = Math.min(subtotal, offerDiscount + couponDiscount);
    return {
      subtotal,
      discount,
      offerDiscount,
      offer,
      total: Math.max(0, subtotal - discount),
      count: state.lines.reduce((sum, line) => sum + line.quantity, 0)
    };
  }

  function lineKey(product, variant, addons) {
    return [product.id, variant?.id || 'base', ...addons.map(addon => addon.id).sort()].join(':');
  }

  function effectivePrice(product) {
    const hasRealDiscount = product.discount_price && Number(product.discount_price) < Number(product.base_price);
    return Number(hasRealDiscount ? product.discount_price : product.base_price);
  }

  // No real photo uploaded yet — show a clean branded placeholder, not a
  // random unrelated stock photo (a burger card showing a photo of a
  // bicycle would look broken, not "temporary"). A neutral icon + honest
  // "Photo coming soon" reads as intentional and gets replaced the moment
  // a real photo is uploaded in Admin.
  function placeholderIcon(product) {
    if (product.product_type === 'non_food') return '\u{1F381}'; // gift
    return ['Cakes', 'Pastries'].includes(product.category?.name) ? '\u{1F370}' : '\u{1F354}'; // cake / burger
  }

  function productImage(product) {
    const photo = [...(product.product_images || [])].sort((a, b) => a.display_order - b.display_order)[0];
    if (photo) return `<img src="${photo.url}" alt="${photo.alt_text || product.name}" loading="lazy">`;
    return `<span class="photo-placeholder-icon">${placeholderIcon(product)}</span><span>${product.name.toUpperCase()}</span><small>Photo coming soon</small>`;
  }

  function dietBadge(product) {
    if (product.product_type === 'non_food') return '';
    const bakery = ['Cakes', 'Pastries'].includes(product.category?.name);
    return `<span>${bakery ? '100% EGGLESS' : 'PURE VEG'}</span>`;
  }

  function productHasOffer(product) {
    const now = new Date();
    return (catalog.offers || []).some(offer => {
      if (offer.applies_to_product_id && offer.applies_to_product_id !== product.id) return false;
      if (offer.applies_to_category_id && offer.applies_to_category_id !== product.category_id) return false;
      if (offer.starts_at && new Date(offer.starts_at) > now) return false;
      if (offer.ends_at && new Date(offer.ends_at) < now) return false;
      return true;
    });
  }

  function productCard(product) {
    const categoryClosed = !categoryOpenMap[product.category_id];
    const priced = !(Number(product.base_price) === 0 && !product.call_to_order);
    const price = product.call_to_order || !priced
      ? 'Call for price'
      : (product.discount_price && Number(product.discount_price) < Number(product.base_price))
        ? `Rs ${money(product.discount_price)} <s>Rs ${money(product.base_price)}</s>`
        : `Rs ${money(product.base_price)}`;
    const hasVariants = Boolean(product.product_variant_groups?.length);
    const inlineAddons = !hasVariants ? (product.product_addon_links || []).map(l => l.product_addons).filter(a => a?.is_available) : [];
    // A product with variants still needs the dialog (a variant is a real
    // choice with its own price, not an optional extra). A product with
    // ONLY add-ons can skip the dialog entirely — the extras are shown right
    // on the card, matching how customers actually decide ("cheese or no
    // cheese?") without an extra tap to open anything.
    const hasChoices = hasVariants;
    // Only the simple (no-variant, no-addon) case gets an in-card stepper —
    // a product with add-on combinations can have several different lines
    // in the cart at once, so there's no single quantity to show on the card.
    const simpleLine = (!hasChoices && !inlineAddons.length) ? cart.get().lines.find(l => l.key === lineKey(product, null, [])) : null;

    let action;
    if (orderingClosed) action = `<button disabled>Currently closed</button>`;
    else if (categoryClosed) action = `<button disabled>Closed now</button>`;
    else if (!product.is_available) action = `<button disabled>Sold out</button>`;
    else if (product.call_to_order || !priced) action = `<a href="tel:${BBK_CONFIG.whatsappNumber.slice(2)}">Call BBK</a>`;
    else if (simpleLine) action = `<div class="qty-stepper"><button data-change="${simpleLine.key}" data-by="-1" aria-label="Remove one">&minus;</button><b>${simpleLine.quantity}</b><button data-change="${simpleLine.key}" data-by="1" aria-label="Add one">+</button></div>`;
    else if (inlineAddons.length) action = `<button data-inline-add="${product.id}">Add +</button>`;
    else action = `<button data-product="${product.id}">${hasChoices ? 'Choose' : 'Add +'}</button>`;

    const addonsBlock = (inlineAddons.length && !orderingClosed && !categoryClosed && product.is_available)
      ? `<div class="inline-addons">${inlineAddons.map(a => `
          <label><input type="checkbox" data-inline-addon="${a.id}" data-price="${a.price}"> ${a.name} <span>+Rs ${money(a.price)}</span></label>`).join('')}</div>`
      : '';

    return `
      <article class="product-card${!product.is_available || categoryClosed ? ' unavailable' : ''}">
        <div class="product-photo">${productImage(product)}${!product.is_available && !categoryClosed ? '<span class="sold-out-flag">Sold out</span>' : productHasOffer(product) ? '<span class="offer-flag">OFFER</span>' : ''}</div>
        <div class="product-copy">
          <div class="badges">
            ${dietBadge(product)}
            ${product.is_bestseller ? '<span>BEST SELLER</span>' : product.is_featured ? '<span>BBK FAVOURITE</span>' : ''}
            ${product.is_trending ? '<span>TRENDING</span>' : ''}
          </div>
          <h3>${product.name}</h3>
          <p>${product.description || ''}</p>
          ${addonsBlock}
          <div class="product-bottom"><b>${price}</b>${action}</div>
        </div>
      </article>`;
  }

  function addInlineProduct(productId, cardEl) {
    const product = catalog.products.find(p => p.id === productId);
    if (!product) return;
    const checked = [...cardEl.querySelectorAll('[data-inline-addon]:checked')];
    const addons = checked.map(input => ({ id: input.dataset.inlineAddon, name: input.closest('label').textContent.trim().replace(/\s*\+Rs.*$/, ''), price: Number(input.dataset.price) }));
    const unitPrice = effectivePrice(product) + addons.reduce((sum, a) => sum + a.price, 0);
    cart.add({ key: lineKey(product, null, addons), productId: product.id, name: product.name, variant: null, addons, unitPrice, quantity: 1 });
    renderCart();
    renderMenu();
    toastAdded(product.name);
  }

  function renderMenu() {
    const search = $('[data-search]').value.trim().toLowerCase();
    const products = catalog.products.filter(product => {
      const categoryMatch = activeCategory === 'all' || product.category_id === activeCategory;
      const searchMatch = product.name.toLowerCase().includes(search) || (product.description || '').toLowerCase().includes(search);
      return categoryMatch && searchMatch;
    });
    // Featured items pin to the top — a stable sort (guaranteed by the spec
    // since ES2019) keeps each group's existing display_order untouched,
    // it just moves featured ones ahead of the rest.
    products.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0));

    $('[data-menu]').innerHTML = products.length
      ? products.map(productCard).join('')
      : '<div class="empty-menu"><b>No items found.</b><span>Try another search or category.</span></div>';
  }

  function renderCategories() {
    $('[data-category-chips]').innerHTML = [
      `<button class="${activeCategory === 'all' ? 'active' : ''}" data-category="all">Everything</button>`,
      ...catalog.categories.filter(c => catalog.products.some(p => p.category_id === c.id)).map(category => `<button class="${activeCategory === category.id ? 'active' : ''}" data-category="${category.id}">${category.name}</button>`)
    ].join('');
  }

  let lastCartCount = 0;
  function renderCart() {
    const state = cart.get();
    const amount = totals();
    if (amount.count > lastCartCount) {
      $$('[data-count]').forEach(node => {
        node.classList.remove('pulse');
        void node.offsetWidth; // restart the animation even if it's already mid-pulse from a rapid second tap
        node.classList.add('pulse');
      });
    }
    lastCartCount = amount.count;
    $$('[data-count]').forEach(node => { node.textContent = amount.count; });
    $$('[data-subtotal]').forEach(node => { node.textContent = money(amount.subtotal); });
    $$('[data-discount]').forEach(node => { node.textContent = money(amount.discount); });
    $$('[data-total]').forEach(node => { node.textContent = money(amount.total); });

    $('[data-cart-lines]').innerHTML = state.lines.map(line => `
      <article class="cart-line">
        <div>
          <b>${line.name}</b>
          <small>${[line.variant?.name, ...line.addons.map(addon => addon.name)].filter(Boolean).join(' / ') || 'Standard'}</small>
          <strong>Rs ${money(line.unitPrice)} each</strong>
        </div>
        <div class="qty">
          <button data-change="${line.key}" data-by="-1">-</button>
          <b>${line.quantity}</b>
          <button data-change="${line.key}" data-by="1">+</button>
        </div>
      </article>`).join('');

    $('[data-cart-empty]').hidden = Boolean(state.lines.length);
    $('.cart-summary').hidden = !state.lines.length;
    $('.discount').hidden = !amount.discount;

    // A coupon applied on an earlier visit stays in localStorage across
    // reloads, but the input box has no memory of its own — without this,
    // the discount kept applying silently while the box looked empty,
    // which read as "there's no coupon, why is a discount showing?".
    const couponInput = $('[data-coupon]');
    const couponMessage = $('[data-coupon-message]');
    const removeCoupon = $('[data-remove-coupon]');
    if (state.coupon && document.activeElement !== couponInput) {
      couponInput.value = state.coupon.code;
      couponInput.disabled = true;
      couponMessage.textContent = `Coupon ${state.coupon.code} applied: you save Rs ${money(state.coupon.discount)}.`;
      removeCoupon.hidden = false;
    } else if (!state.coupon) {
      couponInput.disabled = false;
      removeCoupon.hidden = true;
    }

    // Make it obvious *why* a discount is applying, before the customer
    // reaches checkout — otherwise a lower total looks like a pricing bug.
    const offerBanner = $('[data-offer-banner]');
    if (amount.offer) {
      const detail = amount.offer.type === 'percent' ? `${amount.offer.discount_value}% OFF` : `Flat Rs ${money(amount.offer.discount_value)} discount`;
      offerBanner.hidden = false;
      offerBanner.innerHTML = `<b>Offer applied — ${amount.offer.name}</b><span>${detail}</span>`;
    } else offerBanner.hidden = true;

    const checkoutBtn = $('[data-checkout]');
    checkoutBtn.disabled = orderingClosed;
    $('[data-closed-notice]').hidden = !orderingClosed;
  }

  function openCart() {
    $('.cart-panel').classList.add('open');
    $('.overlay').classList.add('show');
    $('.cart-panel').setAttribute('aria-hidden', 'false');
  }

  function closeCart() {
    $('.cart-panel').classList.remove('open');
    $('.overlay').classList.remove('show');
    $('.cart-panel').setAttribute('aria-hidden', 'true');
  }

  function toggleMobileNav(forceClose) {
    const toggle = $('[data-mobile-nav-toggle]');
    const nav = $('[data-mobile-nav]');
    const open = forceClose ? false : nav.hidden;
    nav.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function productDetail(product) {
    const variants = product.product_variant_groups?.[0]?.product_variants?.filter(variant => variant.is_available) || [];
    const addons = product.product_addon_links?.map(link => link.product_addons).filter(addon => addon?.is_available) || [];

    return `
      <div class="detail-photo">${productImage(product)}</div>
      <p class="eyebrow">${product.product_type === 'non_food' ? 'Party supply' : ['Cakes', 'Pastries'].includes(product.category?.name) ? '100% Eggless' : 'Pure Veg'}</p>
      <h2>${product.name}</h2>
      <p>${product.description || ''}</p>
      <b class="detail-price">From Rs ${money(effectivePrice(product))}</b>
      ${variants.length ? `<fieldset><legend>${product.product_variant_groups[0].name}</legend>${variants.map((variant, index) => `
        <label class="choice">
          <input type="radio" name="variant" value="${variant.id}" data-custom="${variant.is_custom_input}" ${index === 0 ? 'checked' : ''}>
          ${variant.name}<b>${variant.is_custom_input ? 'Custom quote' : variant.price_adjustment ? `+ Rs ${money(variant.price_adjustment)}` : ''}</b>
        </label>`).join('')}</fieldset>` : ''}
      ${addons.length ? `<fieldset><legend>Add extras</legend>${addons.map(addon => `
        <label class="choice">
          <input type="checkbox" name="addon" value="${addon.id}">
          ${addon.name}<b>+ Rs ${money(addon.price)}</b>
        </label>`).join('')}</fieldset>` : ''}
      <label class="quantity-label" data-quantity-row>Quantity <input type="number" name="quantity" min="1" value="1"></label>
      <button class="button primary wide" value="add" data-add-button>Add to my order</button>
      <button type="button" class="button secondary wide" data-request-quote hidden>This needs a custom quote — request one &rarr;</button>`;
  }

  function showProduct(id) {
    const product = catalog.products.find(item => item.id === id);
    if (!product || product.call_to_order) return;
    $('[data-product-detail]').innerHTML = productDetail(product);
    $('[data-product-form]').dataset.productId = id;
    $('.product-dialog').showModal();
    syncCustomQuoteState();
  }

  function syncCustomQuoteState() {
    const dialog = $('.product-dialog');
    const selected = dialog.querySelector('input[name="variant"]:checked');
    const isCustom = selected?.dataset.custom === 'true';
    dialog.querySelector('[data-add-button]').hidden = isCustom;
    dialog.querySelector('[data-quantity-row]').hidden = isCustom;
    dialog.querySelector('[data-request-quote]').hidden = !isCustom;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const radius = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(a));
  }

  function getLocation() {
    const message = $('[data-location-message]');
    const submit = $('[data-checkout-submit]');
    if (!navigator.geolocation) {
      message.textContent = 'Location is unavailable on this device. Please call BBK to order.';
      return;
    }

    message.textContent = 'Checking your area...';
    // Was reading BBK_CONFIG.restaurantLatitude/Longitude — a value hardcoded
    // in js/config.js at deploy time. Changing the address in Admin →
    // Settings updated the database (and the server-side order validation,
    // which already read it live), but this client-side distance preview
    // never reflected it — the exact "changing lat/long doesn't work" bug.
    // catalog.settings.restaurant_latitude/longitude is the live DB value;
    // BBK_CONFIG stays only as a fallback if that fetch ever fails.
    const restaurantLat = catalog.settings?.restaurant_latitude ?? BBK_CONFIG.restaurantLatitude;
    const restaurantLon = catalog.settings?.restaurant_longitude ?? BBK_CONFIG.restaurantLongitude;
    navigator.geolocation.getCurrentPosition(position => {
      const distanceKm = haversine(restaurantLat, restaurantLon, position.coords.latitude, position.coords.longitude);
      customerLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, distanceKm };
      const subtotal = totals().subtotal;
      const blocked = distanceKm > 5 ? 'This location is beyond 5 km. Please call BBK.'
        : distanceKm > 3 && subtotal < 300 ? 'Minimum order is Rs 300 in this area.'
        : null;
      message.textContent = blocked || `Delivery available - ${distanceKm.toFixed(1)} km from BBK`;
      // A blocked distance/minimum still counts as "location shared" — the
      // customer did their part; submitOrder() re-checks the same distance
      // rule and throws with the same message, so leaving submit enabled
      // here just surfaces that error at submit time instead of dead-ending
      // them at the location button with no way to see the actual reason.
      submit.disabled = false;
      submit.textContent = 'Place order on WhatsApp →';
    }, () => {
      customerLocation = null;
      submit.disabled = true;
      submit.textContent = 'Share location to continue';
      message.textContent = 'Location denied — we need it to deliver accurately. Please allow location access and try again, or call BBK to order.';
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  async function submitOrder(form) {
    const amount = totals();
    if (!amount.count) return;
    if (orderingClosed) throw new Error("We're currently closed. Please visit again later.");
    if (!customerLocation) throw new Error('Please share your location to place the order.');
    if (customerLocation?.distanceKm > 5) throw new Error('This location is beyond 5 km. Please call BBK.');
    if (customerLocation?.distanceKm > 3 && amount.subtotal < 300) throw new Error('Minimum order is Rs 300 in this area.');

    const customer = Object.fromEntries(new FormData(form));
    const payload = {
      customer,
      location: customerLocation,
      lines: cart.get().lines,
      coupon: cart.get().coupon?.code || null
    };
    const order = await BBKApi.createOrder(payload);
    cart.clear();
    renderCart();
    $('.checkout-dialog').close();
    $('[data-whatsapp]').href = order.whatsappUrl;
    $('[data-confirm-title]').textContent = 'One quick step.';
    $('[data-confirm-copy]').textContent = 'Tap the button below and send the ready order message to BBK on WhatsApp.';
    $('.confirmation-dialog').showModal();
  }

  // ---- Custom cake request dialog ----
  function openCakeRequest(productId) {
    if (!catalog.settings?.custom_cake_enabled) return;
    $('[data-cake-request-form]').reset();
    $('[data-cake-request-form]').dataset.productId = productId || '';
    $('.cake-request-dialog').showModal();
  }

  async function submitCakeRequest(form) {
    const values = Object.fromEntries(new FormData(form));
    const fileInput = form.querySelector('input[name="reference_image"]');
    const referenceImageUrl = fileInput?.files[0] ? await BBKApi.uploadCakeReference(fileInput.files[0]) : null;
    const result = await BBKApi.customCakeRequest({
      productId: form.dataset.productId || null,
      customerName: values.customer_name,
      phone: values.phone,
      nameOnCake: values.name_on_cake,
      cakeMessage: values.cake_message,
      deliveryDate: values.delivery_date,
      deliveryTime: values.delivery_time,
      notes: values.notes,
      referenceImageUrl,
    });
    $('.cake-request-dialog').close();
    $('[data-whatsapp]').href = result.whatsappUrl;
    $('[data-confirm-title]').textContent = 'Request sent.';
    $('[data-confirm-copy]').textContent = 'Tap below to send the same details to BBK on WhatsApp — we will confirm the price and details there.';
    $('.confirmation-dialog').showModal();
  }

  function addSimpleProduct(product) {
    // A product with no variants and no add-ons has nothing to choose — the
    // button says "Add +", so it should add immediately, not open the same
    // picker dialog a "Choose" product needs. Only products with a group/
    // add-on to pick from get the dialog (handled by showProduct below).
    cart.add({ key: lineKey(product, null, []), productId: product.id, name: product.name, variant: null, addons: [], unitPrice: effectivePrice(product), quantity: 1 });
    renderCart();
    renderMenu(); // switches this card's "Add +" to a [-] N [+] stepper immediately
    toastAdded(product.name);
  }

  function toastAdded(name) {
    const el = document.createElement('div');
    el.className = 'added-toast';
    el.textContent = `${name} added to your order`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 1800);
  }

  document.addEventListener('click', async event => {
    const product = event.target.closest('[data-product]');
    if (product) {
      const item = catalog.products.find(p => p.id === product.dataset.product);
      if (item && !item.product_variant_groups?.length) addSimpleProduct(item);
      else showProduct(product.dataset.product);
    }

    const inlineAdd = event.target.closest('[data-inline-add]');
    if (inlineAdd) addInlineProduct(inlineAdd.dataset.inlineAdd, inlineAdd.closest('.product-card'));

    const category = event.target.closest('[data-category]');
    if (category) {
      activeCategory = category.dataset.category;
      renderCategories();
      renderMenu();
    }

    if (event.target.closest('[data-open-cart]')) openCart();
    if (event.target.closest('[data-close-cart]')) closeCart();

    if (event.target.closest('[data-mobile-nav-toggle]')) toggleMobileNav();
    else if (event.target.closest('[data-mobile-nav-link]')) toggleMobileNav(true);
    else if (!$('[data-mobile-nav]').hidden && !event.target.closest('[data-mobile-nav]')) toggleMobileNav(true);

    // These used to be plain submit buttons inside <form method="dialog">,
    // sharing the SAME submit handler as each form's real "Add"/"Place
    // order"/"Send request" button — clicking × silently tried to submit
    // the form instead of just closing it, and did nothing at all if a
    // required field was still empty.
    const dialogClose = event.target.closest('.dialog-close');
    if (dialogClose) dialogClose.closest('dialog')?.close();

    const change = event.target.closest('[data-change]');
    if (change) {
      cart.change(change.dataset.change, Number(change.dataset.by));
      renderCart();
      renderMenu(); // a stepper on a product card needs to reflect the new quantity (or revert to "Add +" at zero)
    }

    if (event.target.closest('[data-checkout]')) {
      if (!totals().count || orderingClosed) return;
      closeCart();
      customerLocation = null;
      const submit = $('[data-checkout-submit]');
      submit.disabled = true;
      submit.textContent = 'Share location to continue';
      $('.checkout-dialog').showModal();
      // Auto-request instead of making the customer tap a button first —
      // Android still shows its own native permission popup regardless, this
      // just removes our extra step before that popup appears. Still tied
      // closely enough to the checkout-open tap for browsers to allow it.
      // [data-location] stays in the markup as a manual retry if this gets
      // denied or the browser blocks the automatic request.
      getLocation();
    }

    if (event.target.closest('[data-apply-coupon]')) {
      const code = $('[data-coupon]').value.trim();
      try {
        const coupon = await BBKApi.coupon(code, cart.get().lines);
        cart.coupon(coupon);
        renderCart();
      } catch (error) {
        $('[data-coupon-message]').textContent = error.message;
      }
    }

    if (event.target.closest('[data-remove-coupon]')) {
      cart.coupon(null);
      $('[data-coupon]').value = '';
      $('[data-coupon-message]').textContent = '';
      renderCart();
    }

    if (event.target.closest('[data-location]')) getLocation();
    if (event.target.closest('[data-close-confirm]')) $('.confirmation-dialog').close();
    if (event.target.closest('[data-open-cake-request]')) openCakeRequest();
    if (event.target.closest('[data-request-quote]')) { $('.product-dialog').close(); openCakeRequest($('[data-product-form]').dataset.productId); }
  });

  document.addEventListener('change', event => {
    if (event.target.matches('.product-dialog input[name="variant"]')) syncCustomQuoteState();
  });

  $('[data-search]').addEventListener('input', renderMenu);
  $('[data-product-form]').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const product = catalog.products.find(item => item.id === form.dataset.productId);
    const data = new FormData(form);
    const variant = product.product_variant_groups?.[0]?.product_variants?.find(item => item.id === data.get('variant'));
    if (variant?.is_custom_input) return;
    const addons = [...data.getAll('addon')]
      .map(id => product.product_addon_links.map(link => link.product_addons).find(addon => addon.id === id))
      .filter(Boolean);
    const unitPrice = effectivePrice(product) + (variant?.price_adjustment || 0) + addons.reduce((sum, addon) => sum + addon.price, 0);

    cart.add({
      key: lineKey(product, variant, addons),
      productId: product.id,
      name: product.name,
      variant,
      addons,
      unitPrice,
      quantity: Number(data.get('quantity')) || 1
    });
    $('.product-dialog').close();
    renderCart();
  });

  $('[data-checkout-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await submitOrder(event.currentTarget);
    } catch (error) {
      $('[data-location-message]').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $('[data-cake-request-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await submitCakeRequest(event.currentTarget);
    } catch (error) {
      $('[data-cake-request-message]').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  async function loadCatalogAndRender() {
    try {
      catalog = await BBKApi.menu();
      computeAvailability();
      if (!catalog.settings?.custom_cake_enabled) $('[data-open-cake-request]').hidden = true;
      renderBanners(renderHeroPhoto(catalog.banners));
      renderCakePhoto(catalog.categories);
      renderContactInfo(catalog.settings);
      renderHoursSummary(catalog.categories);
      renderCategories();
      renderMenu();
    } catch (error) {
      $('[data-menu]').innerHTML = '<div class="empty-menu"><b>Menu is temporarily unavailable.</b><span>Please call BBK to order.</span></div>';
    }
    renderCart();
  }

  (async () => {
    await loadCatalogAndRender();

    // Reflect admin changes (ordering on/off, an item marked out of stock, a
    // price change) for anyone already browsing, without them reloading.
    // Several admin edits can land in a burst (e.g. "mark whole category out
    // of stock" touches every product row at once) — debounce so that's one
    // re-render, not a flurry of them.
    let refreshTimer = null;
    BBKApi.subscribeToMenuChanges(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(loadCatalogAndRender, 600);
    });
  })();
})();
