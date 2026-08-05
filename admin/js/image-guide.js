const SPECS = [
  { name: 'Product photo', size: '1200 × 900 px', ratio: '4:3', where: 'Products → Add/Edit product → Photos', tip: 'One dish, well-lit, filling the frame. No white borders — the photo is cropped to a rounded card, not padded.' },
  { name: 'Category photo', size: '800 × 800 px', ratio: '1:1 (square)', where: 'Categories → Add/Edit category', tip: 'A single representative item, centered — this shows small, so keep it simple.' },
  { name: 'Category / offer banner', size: '1600 × 700 px', ratio: '16:7 (wide)', where: 'Categories → Banner photo, Offers', tip: 'Keep important text/food centered — the sides may crop on narrow phone screens.' },
  { name: 'Homepage banner', size: '1600 × 700 px', ratio: '16:7 (wide)', where: 'Banners', tip: 'The first active banner also becomes the homepage hero photo automatically.' },
  { name: 'Logo', size: '500 × 500 px', ratio: '1:1, PNG, transparent background', where: 'Replaces assets/bbk-logo.jpg directly (not an admin upload yet)', tip: 'Transparent PNG so it sits cleanly inside the circular frame used in the header and admin sidebar.' },
];

export async function renderImageGuide(root) {
  root.innerHTML = `
    <section class="panel">
      <h2>Image size guide</h2>
      <p class="hint">Use these exact sizes when preparing photos — every upload field on the site expects one of these. Uploading the right size means no stretching, no odd crops, no white borders.</p>
      <div class="image-guide-grid">
        ${SPECS.map(s => `
          <article class="image-guide-card">
            <div class="image-guide-swatch" data-ratio="${s.ratio.includes('1:1') ? 'square' : 'wide'}"><span>${s.ratio}</span></div>
            <div class="image-guide-body">
              <b>${s.name}</b>
              <strong>${s.size}</strong>
              <small>${s.where}</small>
              <p>${s.tip}</p>
            </div>
          </article>`).join('')}
      </div>
    </section>`;
}
