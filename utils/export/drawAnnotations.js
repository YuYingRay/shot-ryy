import getStroke from 'perfect-freehand';
import { clamp } from '../core/math';

const TIKTOK_FONT_STACK = 'ui-rounded, "SF Pro Rounded", "SF Pro Text", "Segoe UI Variable", "Segoe UI", Ubuntu, Cantarell, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif';

// ── perfect-freehand helpers ──
function getSvgPathFromStrokePoints(points) {
  if (!points.length) return '';
  const max = points.length - 1;
  const avg = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M ${points[0][0].toFixed(2)},${points[0][1].toFixed(2)} `;
  for (let i = 0; i < max; i++) {
    const mid = avg(points[i], points[i + 1]);
    d += `Q ${points[i][0].toFixed(2)},${points[i][1].toFixed(2)} ${mid[0].toFixed(2)},${mid[1].toFixed(2)} `;
  }
  d += `L ${points[max][0].toFixed(2)},${points[max][1].toFixed(2)} Z`;
  return d;
}

function drawArrowhead(ctx, fromX, fromY, toX, toY, headLength) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headAngle = Math.PI / 5.4;
  const nockDepth = headLength * 0.25;
  const tipX = toX;
  const tipY = toY;
  const leftX = toX - headLength * Math.cos(angle - headAngle);
  const leftY = toY - headLength * Math.sin(angle - headAngle);
  const rightX = toX - headLength * Math.cos(angle + headAngle);
  const rightY = toY - headLength * Math.sin(angle + headAngle);
  const nockX = toX - (headLength - nockDepth) * Math.cos(angle);
  const nockY = toY - (headLength - nockDepth) * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(nockX, nockY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
}

function drawRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const wrapSingleLine = (ctx, line, maxWidthPx) => {
  const s = String(line ?? '');
  if (!maxWidthPx || !isFinite(maxWidthPx)) return [s];
  if (!s) return [''];

  const out = [];
  const words = s.trim().length ? s.split(/\s+/) : [''];
  let current = '';

  const pushCurrent = () => {
    out.push(current);
    current = '';
  };

  const breakLongToken = (token) => {
    const pieces = [];
    let rest = token;
    while (rest.length) {
      let lo = 1;
      let hi = rest.length;
      let best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const part = rest.slice(0, mid);
        const w = ctx.measureText(part).width;
        if (w <= maxWidthPx) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      pieces.push(rest.slice(0, best));
      rest = rest.slice(best);
    }
    return pieces;
  };

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidthPx) {
      current = next;
      continue;
    }

    if (current) pushCurrent();

    if (ctx.measureText(word).width <= maxWidthPx) {
      current = word;
      continue;
    }

    const broken = breakLongToken(word);
    for (let i = 0; i < broken.length; i += 1) {
      const chunk = broken[i];
      if (i === broken.length - 1) {
        current = chunk;
      } else {
        out.push(chunk);
      }
    }
  }

  if (current || !out.length) out.push(current);
  return out;
};

// Module-level cache for text layout computations
const textLayoutCache = new WeakMap();

const computeTextLayout = (ctx, canvas, t) => {
  if (!ctx || !canvas || !t) return null;

  const text = String(t?.value || '').trimEnd();
  if (!text.trim()) return null;

  try {
    const key = [
      canvas.width,
      canvas.height,
      text,
      Number(t.fontSizeRel) || 0,
      Number(t.padXRel) || 0,
      Number(t.padYRel) || 0,
      (typeof t.boxWNorm === 'number' ? t.boxWNorm : 'auto'),
      t.forceCircle ? 'circle' : '',
    ].join('|');

    const perText = textLayoutCache.get(t);
    const cached = perText?.get?.(key);
    if (cached) return cached;

    const minDimPx = Math.max(1, Math.min(canvas.width, canvas.height));

    const fontSize = Math.max(10, Math.round((t.fontSizeRel || 0) * minDimPx));
    const fontWeight = 800;
    const lineH = Math.round(fontSize * 1.12);
    const padX = Math.round((t.padXRel || 0) * minDimPx);
    const padY = Math.round((t.padYRel || 0) * minDimPx);

    const boxWFromUser = (typeof t.boxWNorm === 'number' && isFinite(t.boxWNorm) && t.boxWNorm > 0)
      ? Math.max(60, Math.round(t.boxWNorm * canvas.width))
      : null;

    const contentMaxW = boxWFromUser ? Math.max(20, boxWFromUser - padX * 2) : null;

    ctx.save();
    ctx.font = `${fontWeight} ${fontSize}px ${TIKTOK_FONT_STACK}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const hardLines = text.split(/\r?\n/);
    const lines = [];
    for (const hl of hardLines) {
      const wrapped = wrapSingleLine(ctx, hl, contentMaxW);
      for (const w of wrapped) lines.push(w);
    }
    if (!lines.length) lines.push('');

    let maxLineW = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineW) maxLineW = w;
    }

    let computedBoxW = Math.round(maxLineW + padX * 2);
    let boxW = boxWFromUser ? Math.min(canvas.width, boxWFromUser) : computedBoxW;
    let boxH = Math.round(lines.length * lineH + padY * 2);

    let adjPadX = padX;
    let adjPadY = padY;
    if (t.forceCircle) {
      const dim = Math.max(boxW, boxH);
      adjPadX = Math.round((dim - maxLineW) / 2);
      adjPadY = Math.round((dim - lines.length * lineH) / 2);
      boxW = dim;
      boxH = dim;
    }

    ctx.restore();

    const layout = { lines, boxW, boxH, fontSize, fontWeight, lineH, padX: adjPadX, padY: adjPadY, minDimPx };
    const nextMap = perText instanceof Map ? perText : new Map();
    nextMap.set(key, layout);
    if (!perText) textLayoutCache.set(t, nextMap);
    return layout;
  } catch {
    // Ignore cache failures and fall through to the original computation.
  }

  const minDimPx = Math.max(1, Math.min(canvas.width, canvas.height));

  const fontSize = Math.max(10, Math.round((t.fontSizeRel || 0) * minDimPx));
  const fontWeight = 800;
  const lineH = Math.round(fontSize * 1.12);
  const padX = Math.round((t.padXRel || 0) * minDimPx);
  const padY = Math.round((t.padYRel || 0) * minDimPx);

  const boxWFromUser = (typeof t.boxWNorm === 'number' && isFinite(t.boxWNorm) && t.boxWNorm > 0)
    ? Math.max(60, Math.round(t.boxWNorm * canvas.width))
    : null;

  const contentMaxW = boxWFromUser ? Math.max(20, boxWFromUser - padX * 2) : null;

  ctx.save();
  ctx.font = `${fontWeight} ${fontSize}px ${TIKTOK_FONT_STACK}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const hardLines = text.split(/\r?\n/);
  const lines = [];
  for (const hl of hardLines) {
    const wrapped = wrapSingleLine(ctx, hl, contentMaxW);
    for (const w of wrapped) lines.push(w);
  }
  if (!lines.length) lines.push('');

  let maxLineW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineW) maxLineW = w;
  }

  let computedBoxW = Math.round(maxLineW + padX * 2);
  let boxW = boxWFromUser ? Math.min(canvas.width, boxWFromUser) : computedBoxW;
  let boxH = Math.round(lines.length * lineH + padY * 2);

  let adjPadX = padX;
  let adjPadY = padY;
  if (t.forceCircle) {
    const dim = Math.max(boxW, boxH);
    adjPadX = Math.round((dim - maxLineW) / 2);
    adjPadY = Math.round((dim - lines.length * lineH) / 2);
    boxW = dim;
    boxH = dim;
  }

  ctx.restore();

  return { lines, boxW, boxH, fontSize, fontWeight, lineH, padX: adjPadX, padY: adjPadY, minDimPx };
};

/**
 * Draw annotations (strokes and texts) onto a canvas.
 * This is a pure-function extraction of the redraw logic from CanvasAnnotations.jsx.
 *
 * @param {HTMLCanvasElement} canvas - The target canvas to draw onto
 * @param {{strokes: Array, texts: Array}} annotations - The annotations to draw
 * @param {{penColor?: string}} [options] - Drawing options
 */
export function drawAnnotationsToCanvas(canvas, annotations, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!options.skipClear) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const { strokes = [], texts = [] } = annotations || {};
  const textHighlightColor = options?.penColor || '#000000';
  const minDimPx = Math.max(1, Math.min(canvas.width, canvas.height));

  // Strokes (pen, arrow, rect, ellipse)
  for (const stroke of strokes) {
    const strokeType = stroke?.type || 'pen';
    const pts = Array.isArray(stroke?.points) ? stroke.points : [];
    if (pts.length < 1) continue;

    const lineWidth = Math.max(1, Math.round((stroke.widthRel || 0) * minDimPx));
    const color = stroke.color || '#ffffff';
    const alpha = typeof stroke.alpha === 'number' ? stroke.alpha : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (strokeType === 'arrow') {
      if (pts.length >= 2) {
        const x1 = pts[0].x * canvas.width;
        const y1 = pts[0].y * canvas.height;
        const x2 = pts[pts.length - 1].x * canvas.width;
        const y2 = pts[pts.length - 1].y * canvas.height;

        const headLength = Math.max(40, lineWidth * 10);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const shaftEndX = x2 - (headLength * 0.62) * Math.cos(angle);
        const shaftEndY = y2 - (headLength * 0.62) * Math.sin(angle);

        // --- White outline pass (drawn first, behind) ---
        const outlineWidth = Math.max(3, lineWidth * 0.55);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = lineWidth + outlineWidth * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(shaftEndX, shaftEndY);
        ctx.stroke();

        const headAngle = Math.PI / 5.4;
        const nockDepth = headLength * 0.25;
        const leftX = x2 - headLength * Math.cos(angle - headAngle);
        const leftY = y2 - headLength * Math.sin(angle - headAngle);
        const rightX = x2 - headLength * Math.cos(angle + headAngle);
        const rightY = y2 - headLength * Math.sin(angle + headAngle);
        const nockX = x2 - (headLength - nockDepth) * Math.cos(angle);
        const nockY = y2 - (headLength - nockDepth) * Math.sin(angle);
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = outlineWidth * 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(nockX, nockY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.stroke();

        // --- Colored fill pass (drawn on top) ---
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(shaftEndX, shaftEndY);
        ctx.stroke();

        ctx.fillStyle = color;
        drawArrowhead(ctx, x1, y1, x2, y2, headLength);
      }
    } else if (strokeType === 'rect') {
      if (pts.length >= 2) {
        const x1 = pts[0].x * canvas.width;
        const y1 = pts[0].y * canvas.height;
        const x2 = pts[pts.length - 1].x * canvas.width;
        const y2 = pts[pts.length - 1].y * canvas.height;

        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';

        const cornerRadius = Math.max(0, Math.min(lineWidth * 1.5, rw / 3, rh / 3));
        drawRoundRect(ctx, rx, ry, rw, rh, cornerRadius);
        ctx.stroke();
      }
    } else if (strokeType === 'ellipse') {
      if (pts.length >= 2) {
        const x1 = pts[0].x * canvas.width;
        const y1 = pts[0].y * canvas.height;
        const x2 = pts[pts.length - 1].x * canvas.width;
        const y2 = pts[pts.length - 1].y * canvas.height;

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const radiusX = Math.abs(x2 - x1) / 2;
        const radiusY = Math.abs(y2 - y1) / 2;

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, radiusX), Math.max(1, radiusY), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Pen: use perfect-freehand for natural-looking strokes
      const pixelPoints = pts.map((p) => [p.x * canvas.width, p.y * canvas.height, 0.5]);

      if (pixelPoints.length === 1) {
        const cx = pixelPoints[0][0];
        const cy = pixelPoints[0][1];
        ctx.beginPath();
        ctx.arc(cx, cy, lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        const outlinePoints = getStroke(pixelPoints, {
          size: lineWidth * 2,
          thinning: 0.5,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: true,
          start: { taper: 0, cap: true },
          end: { taper: 0, cap: true },
        });

        if (outlinePoints.length > 0) {
          const pathStr = stroke.pathStr || getSvgPathFromStrokePoints(outlinePoints);
          const path2d = new Path2D(pathStr);
          ctx.fillStyle = color;
          ctx.fill(path2d);
        }
      }
    }

    ctx.restore();
  }

  // Texts
  for (const t of texts) {
    const layout = computeTextLayout(ctx, canvas, t);
    if (!layout) continue;

    const x = (t.xNorm || 0) * canvas.width;
    const y = (t.yNorm || 0) * canvas.height;

    const radius = Math.round((t.radiusRel || 0) * minDimPx);
    const boxX = Math.round(x);
    const boxY = Math.round(y);
    const boxW = layout.boxW;
    const boxH = layout.boxH;

    ctx.save();
    ctx.font = `${layout.fontWeight} ${layout.fontSize}px ${TIKTOK_FONT_STACK}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const bg = String(t?.bgColor || '') || textHighlightColor || '#000000';
    const fg = String(t?.textColor || '') || '#ffffff';
    const strokeCol = String(t?.textStrokeColor || '') || '#000000';

    ctx.fillStyle = bg;
    drawRoundRect(ctx, boxX, boxY, boxW, boxH, radius);
    ctx.fill();

    const isCounter = t.forceCircle === true;
    const effectiveStrokeCol = isCounter ? 'rgba(0,0,0,0.75)' : strokeCol;
    const effectiveStrokeWidth = isCounter
      ? Math.max(2, Math.round(layout.fontSize * 0.22))
      : Math.max(2, Math.round((t.strokeWidthRel || 0) * minDimPx));

    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = effectiveStrokeCol;
    ctx.fillStyle = fg;
    ctx.lineWidth = effectiveStrokeWidth;

    layout.lines.forEach((line, i) => {
      const tx = t.forceCircle ? Math.round(boxX + (boxW / 2)) : (boxX + layout.padX);
      const ty = t.forceCircle
        ? Math.round(boxY + ((boxH - (layout.lines.length * layout.lineH)) / 2) + i * layout.lineH)
        : (boxY + layout.padY + i * layout.lineH);
      if (t.forceCircle) {
        ctx.textAlign = 'center';
      }
      if (line && line.length) {
        ctx.strokeText(line, tx, ty);
        ctx.fillText(line, tx, ty);
      }
    });
    ctx.restore();
  }
}
