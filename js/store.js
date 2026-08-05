window.BBKStore = (() => {
  const key = 'bbk-order-v2';
  let state = JSON.parse(localStorage.getItem(key) || '{"lines":[],"coupon":null}');
  const save = () => localStorage.setItem(key, JSON.stringify(state));
  return {
    get: () => structuredClone(state),
    add(line) { const existing = state.lines.find(x => x.key === line.key); if (existing) existing.quantity += line.quantity; else state.lines.push(line); save(); },
    change(key, amount) { const line = state.lines.find(x => x.key === key); if (!line) return; line.quantity += amount; state.lines = state.lines.filter(x => x.quantity > 0); save(); },
    coupon(coupon) { state.coupon = coupon; save(); },
    clear() { state = { lines: [], coupon: null }; save(); }
  };
})();
