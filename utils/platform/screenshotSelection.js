export const selectPrimaryMonitor = (monitors = []) => {
  if (!Array.isArray(monitors)) return null;
  return monitors.find((m) => m?.isPrimary || m?.is_primary || m?.primary) || monitors[0] || null;
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pickFirstNum = (values) => {
  for (const v of values) {
    const n = toNum(v);
    if (n != null) return n;
  }
  return null;
};

const monitorBounds = (m) => {
  if (!m || typeof m !== 'object') return null;
  const x = pickFirstNum([m.x, m.left, m.positionX, m.position_x, m?.position?.x, m?.bounds?.x]);
  const y = pickFirstNum([m.y, m.top, m.positionY, m.position_y, m?.position?.y, m?.bounds?.y]);
  const width = pickFirstNum([m.width, m.w, m?.size?.width, m?.bounds?.width]);
  const height = pickFirstNum([m.height, m.h, m?.size?.height, m?.bounds?.height]);
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
};

const containsPoint = (b, px, py) => px >= b.x && py >= b.y && px < (b.x + b.width) && py < (b.y + b.height);

const sizeCloseness = (targetW, targetH, w, h) => {
  if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) return 0;
  const denom = Math.max(targetW + targetH, 1);
  const diff = Math.abs(targetW - w) + Math.abs(targetH - h);
  const ratio = 1 - Math.min(1, diff / denom);
  return Math.max(0, ratio) * 40;
};

export const selectMonitorForCapture = (monitors = [], viewport = {}) => {
  if (!Array.isArray(monitors) || monitors.length === 0) return null;
  if (monitors.length === 1) return monitors[0] || null;

  const primary = selectPrimaryMonitor(monitors);

  const screenX = toNum(viewport.screenX);
  const screenY = toNum(viewport.screenY);
  const innerW = toNum(viewport.innerWidth);
  const innerH = toNum(viewport.innerHeight);
  const dpr = (() => {
    const n = toNum(viewport.devicePixelRatio);
    return n && n > 0 ? n : 1;
  })();

  let best = null;
  let bestScore = -Infinity;

  for (const m of monitors) {
    const b = monitorBounds(m);
    let score = 0;

    if (m === primary) score += 5;

    if (b) {
      if (screenX != null && screenY != null) {
        if (containsPoint(b, screenX, screenY)) {
          score += 100;
        } else {
          const dx = Math.max(0, b.x - screenX, screenX - (b.x + b.width));
          const dy = Math.max(0, b.y - screenY, screenY - (b.y + b.height));
          score -= Math.hypot(dx, dy) / 100;
        }
      }

      // Compare in both native and CSS-space to handle inconsistent plugin units.
      score += sizeCloseness(innerW || 0, innerH || 0, b.width, b.height);
      score += sizeCloseness((innerW || 0) * dpr, (innerH || 0) * dpr, b.width, b.height);
      score += sizeCloseness(innerW || 0, innerH || 0, b.width / dpr, b.height / dpr);
    }

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return best || primary || monitors[0] || null;
};
