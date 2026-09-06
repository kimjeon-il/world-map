const overlaps = (a, b) => !(a.right + 3 < b.left || b.right + 3 < a.left || a.bottom + 3 < b.top || b.bottom + 3 < a.top);

// Decorate already placed labels: flags must never evict an existing name.
export function layoutCountryFlags(placed, { zoom, enabled, flagUrl, isCountry }) {
  const flags = new Map();
  if (!enabled || zoom < 1.8) return flags;
  const boxes = placed.map(item => ({ ...item.box }));
  placed.forEach((item, index) => {
    if (item.sourceType !== 'country' || !isCountry(item.source)) return;
    const url = flagUrl(item.source);
    if (!url) return;
    const box = { ...boxes[index], left: boxes[index].left - 12, right: boxes[index].right + 12 };
    if (boxes.some((other, otherIndex) => otherIndex !== index && overlaps(box, other))) return;
    boxes[index] = box;
    flags.set(String(item.source.id), { url, width: 18, height: 12, gap: 5 });
  });
  return flags;
}
