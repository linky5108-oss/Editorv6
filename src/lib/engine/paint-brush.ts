import type { StrokePoint } from "./paint-stabilizer";

export type PaintBrush = "round" | "fine" | "grain" | "pixel" | "marker";

export type SymmetryMode = "none" | "horizontal" | "vertical" | "quad";

export interface BrushStrokeOptions {
  /** Opacidad del trazo de 0.05 a 1 (por defecto 1). */
  opacity?: number;
  /** Suavidad/difuminado de borde de 0 a 1 (por defecto 0). */
  softness?: number;
  /** Si está activo, pinta solo sobre píxeles con alfa existente (source-atop). */
  alphaLock?: boolean;
  /** Modo de simetría en vivo sobre el lienzo. */
  symmetry?: SymmetryMode;
  /** Ancho del lienzo (necesario para reflejar trazos con simetría). */
  canvasW?: number;
  /** Alto del lienzo (necesario para reflejar trazos con simetría). */
  canvasH?: number;
}

export const PAINT_BRUSHES: { id: PaintBrush; name: string; description: string }[] = [
  { id: "round", name: "Redondo", description: "Trazo suave de bordes redondeados" },
  { id: "fine", name: "Fino", description: "Punta delgada para contornos y detalles" },
  { id: "grain", name: "Granulado", description: "Textura moteada de carboncillo" },
  { id: "pixel", name: "Pixel art", description: "Cuadrados nítidos alineados a la rejilla" },
  { id: "marker", name: "Marcador", description: "Tinta translúcida de punta plana" },
];

function grainOffset(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Genera las trayectorias reflejadas según el modo de simetría activo.
 * Devuelve siempre un arreglo de trayectorias (1 para "none", 2 para "horizontal"/"vertical", 4 para "quad").
 */
export function mirrorStrokePoints(
  points: StrokePoint[],
  symmetry: SymmetryMode = "none",
  canvasW = 0,
  canvasH = 0,
): StrokePoint[][] {
  if (symmetry === "none" || points.length === 0 || canvasW <= 0 || canvasH <= 0) {
    return [points];
  }
  const flipX = ( pts: StrokePoint[] ) => pts.map(p => ({ ...p, x: canvasW - p.x }));
  const flipY = ( pts: StrokePoint[] ) => pts.map(p => ({ ...p, y: canvasH - p.y }));
  if (symmetry === "horizontal") {
    return [points, flipX(points)];
  }
  if (symmetry === "vertical") {
    return [points, flipY(points)];
  }
  return [points, flipX(points), flipY(points), flipY(flipX(points))];
}

function resolveCompositeOp(erase: boolean, alphaLock?: boolean): GlobalCompositeOperation {
  if (erase) return "destination-out";
  if (alphaLock) return "source-atop";
  return "source-over";
}

function applySoftnessShadow(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  erase: boolean,
  softness = 0,
) {
  const s = erase ? 0 : Math.max(0, Math.min(1, softness));
  if (s <= 0.01) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    return;
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(1, width * s * 0.75);
}

/**
 * Limpia por completo cualquier residuo semitransparente de anti-aliasing dentro
 * del área barrida por el borrador para garantizar un borrado al 100% en una pasada.
 */
function clearEraserPathAlpha(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; w?: number }[],
  baseWidth: number,
) {
  if (
    points.length === 0 ||
    typeof ctx.getImageData !== "function" ||
    typeof ctx.putImageData !== "function" ||
    !ctx.canvas
  ) {
    return;
  }
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  if (!(cw > 0 && ch > 0)) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxW = baseWidth;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.w !== undefined && p.w > maxW) maxW = p.w;
  }
  const maxR = Math.max(0.5, Math.max(1, maxW) / 2) + 0.45;
  const x0 = Math.max(0, Math.floor(minX - maxR - 1));
  const y0 = Math.max(0, Math.floor(minY - maxR - 1));
  const x1 = Math.min(cw, Math.ceil(maxX + maxR + 1));
  const y1 = Math.min(ch, Math.ceil(maxY + maxR + 1));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;

  const img = ctx.getImageData(x0, y0, bw, bh);
  const data = img.data;
  const rSq = maxR * maxR;

  if (points.length === 1) {
    const cx = points[0].x;
    const cy = points[0].y;
    for (let py = 0; py < bh; py++) {
      const wy = y0 + py + 0.5 - cy;
      const wySq = wy * wy;
      if (wySq > rSq) continue;
      for (let px = 0; px < bw; px++) {
        const wx = x0 + px + 0.5 - cx;
        if (wx * wx + wySq <= rSq) {
          const idx = (py * bw + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, x0, y0);
    return;
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segR = Math.max(0.5, Math.max(1, b.w ?? baseWidth) / 2) + 0.45;
    const segRSq = segR * segR;
    const sMinX = Math.max(0, Math.floor(Math.min(a.x, b.x) - segR - x0));
    const sMaxX = Math.min(bw - 1, Math.ceil(Math.max(a.x, b.x) + segR - x0));
    const sMinY = Math.max(0, Math.floor(Math.min(a.y, b.y) - segR - y0));
    const sMaxY = Math.min(bh - 1, Math.ceil(Math.max(a.y, b.y) + segR - y0));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    for (let py = sMinY; py <= sMaxY; py++) {
      const wy = y0 + py + 0.5;
      for (let px = sMinX; px <= sMaxX; px++) {
        const wx = x0 + px + 0.5;
        const t =
          lenSq > 0
            ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / lenSq))
            : 0;
        const projX = a.x + t * dx;
        const projY = a.y + t * dy;
        const dSq = (wx - projX) * (wx - projX) + (wy - projY) * (wy - projY);
        if (dSq <= segRSq) {
          const idx = (py * bw + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
        }
      }
    }
  }

  ctx.putImageData(img, x0, y0);
}

export function drawBrushStamp(
  ctx: CanvasRenderingContext2D,
  brush: PaintBrush,
  color: string,
  width: number,
  x: number,
  y: number,
  erase = false,
  options?: BrushStrokeOptions,
) {
  const pts: StrokePoint[] = [{ x, y, w: width }];
  const sym = options?.symmetry ?? "none";
  const paths = mirrorStrokePoints(pts, sym, options?.canvasW ?? 0, options?.canvasH ?? 0);
  const opacity = erase ? 1 : Math.max(0.05, Math.min(1, options?.opacity ?? 1));
  const softness = erase ? 0 : Math.max(0, Math.min(1, options?.softness ?? 0));

  for (const path of paths) {
    const pt = path[0];
    if (!pt) continue;
    drawSingleStamp(ctx, brush, color, width, pt.x, pt.y, erase, opacity, softness, options?.alphaLock);
  }
}

function drawSingleStamp(
  ctx: CanvasRenderingContext2D,
  brush: PaintBrush,
  color: string,
  width: number,
  x: number,
  y: number,
  erase: boolean,
  opacity: number,
  softness: number,
  alphaLock?: boolean,
) {
  const effOpacity = erase ? 1 : opacity;
  const effSoftness = erase ? 0 : softness;

  ctx.save();
  ctx.imageSmoothingEnabled = brush !== "pixel";
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = resolveCompositeOp(erase, alphaLock);
  ctx.fillStyle = color;

  if (brush === "pixel") {
    ctx.globalAlpha = effOpacity;
    const side = Math.max(1, Math.round(width));
    const gx = Math.floor(x / side) * side;
    const gy = Math.floor(y / side) * side;
    ctx.fillRect(gx, gy, side, side);
    ctx.restore();
    return;
  }

  if (brush === "grain" && !erase) {
    const radius = Math.max(1.5, width * 0.65);
    const dots = Math.max(6, Math.round(width * 2.2));
    const dotSize = Math.max(1, Math.round(width / 6));
    ctx.globalAlpha = 0.55 * effOpacity;
    for (let i = 0; i < dots; i++) {
      const a = grainOffset(x + y + i * 1.7) * Math.PI * 2;
      const r = Math.sqrt(grainOffset(x * 0.7 + y * 1.3 + i * 3.1)) * radius;
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), dotSize, dotSize);
    }
    ctx.restore();
    return;
  }

  applySoftnessShadow(ctx, color, width, erase, effSoftness);

  if (brush === "marker" && !erase) {
    const side = Math.max(2, width);
    ctx.globalAlpha = 0.35 * effOpacity;
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
    ctx.restore();
    return;
  }

  ctx.globalAlpha = effOpacity;
  const effW = brush === "fine" && !erase ? Math.max(1, Math.round(width * 0.3)) : Math.max(1, width);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, effW / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (erase) {
    clearEraserPathAlpha(ctx, [{ x, y, w: effW }], effW);
  }
}

export function drawBrush(
  ctx: CanvasRenderingContext2D,
  brush: PaintBrush,
  color: string,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  erase = false,
  options?: BrushStrokeOptions,
) {
  const opacity = erase ? 1 : Math.max(0.05, Math.min(1, options?.opacity ?? 1));
  const softness = erase ? 0 : Math.max(0, Math.min(1, options?.softness ?? 0));

  ctx.save();
  ctx.imageSmoothingEnabled = brush !== "pixel";
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = resolveCompositeOp(erase, options?.alphaLock);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (brush === "pixel") {
    ctx.globalAlpha = opacity;
    const side = Math.max(1, Math.round(width));
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, side * 0.5)));
    let lastGx = Number.NaN;
    let lastGy = Number.NaN;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const gx = Math.floor(x / side) * side;
      const gy = Math.floor(y / side) * side;
      if (gx !== lastGx || gy !== lastGy) {
        ctx.fillRect(gx, gy, side, side);
        lastGx = gx;
        lastGy = gy;
      }
    }
    ctx.restore();
    return;
  }

  if (brush === "grain" && !erase) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / 2));
    const radius = Math.max(1.5, width * 0.65);
    const dots = Math.max(6, Math.round(width * 2.2));
    const dotSize = Math.max(1, Math.round(width / 6));
    ctx.globalAlpha = 0.55 * opacity;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (let i = 0; i < dots; i++) {
        const a = grainOffset(px + py + i * 1.7 + s) * Math.PI * 2;
        const r = Math.sqrt(grainOffset(px * 0.7 + py * 1.3 + i * 3.1 + s)) * radius;
        ctx.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r), dotSize, dotSize);
      }
    }
    ctx.restore();
    return;
  }

  applySoftnessShadow(ctx, color, width, erase, softness);

  if (brush === "fine" && !erase) {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(1, Math.round(width * 0.3));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  } else if (brush === "marker" && !erase) {
    ctx.globalAlpha = 0.35 * opacity;
    ctx.lineWidth = Math.max(2, width);
    ctx.lineCap = "square";
    ctx.lineJoin = "bevel";
  } else {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(1, width);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();

  if (erase) {
    clearEraserPathAlpha(
      ctx,
      [
        { x: x0, y: y0, w: width },
        { x: x1, y: y1, w: width },
      ],
      width,
    );
  }
}

/**
 * Traza una trayectoria completa como una curva cuadrática continua (con soporte
 * de presión variable, opacidad, suavidad, bloqueo alfa y simetría en vivo).
 */
export function drawBrushPath(
  ctx: CanvasRenderingContext2D,
  brush: PaintBrush,
  color: string,
  baseWidth: number,
  points: StrokePoint[],
  erase = false,
  options?: BrushStrokeOptions,
) {
  if (points.length === 0) return;
  if (points.length === 1) {
    drawBrushStamp(ctx, brush, color, points[0].w ?? baseWidth, points[0].x, points[0].y, erase, options);
    return;
  }

  const sym = options?.symmetry ?? "none";
  const allPaths = mirrorStrokePoints(points, sym, options?.canvasW ?? 0, options?.canvasH ?? 0);
  for (const pathPts of allPaths) {
    drawSingleBrushPath(ctx, brush, color, baseWidth, pathPts, erase, options);
  }
}

function drawSingleBrushPath(
  ctx: CanvasRenderingContext2D,
  brush: PaintBrush,
  color: string,
  baseWidth: number,
  points: StrokePoint[],
  erase: boolean,
  options?: BrushStrokeOptions,
) {
  if (brush === "pixel") {
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      drawBrush(ctx, brush, color, p1.w ?? baseWidth, p0.x, p0.y, p1.x, p1.y, erase, options);
    }
    return;
  }

  if (brush === "grain" && !erase) {
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      drawBrush(ctx, brush, color, p1.w ?? baseWidth, p0.x, p0.y, p1.x, p1.y, false, options);
    }
    return;
  }

  const opacity = erase ? 1 : Math.max(0.05, Math.min(1, options?.opacity ?? 1));
  const softness = erase ? 0 : Math.max(0, Math.min(1, options?.softness ?? 0));

  let minW = Infinity;
  let maxW = -Infinity;
  for (const p of points) {
    const w = p.w ?? baseWidth;
    if (w < minW) minW = w;
    if (w > maxW) maxW = w;
  }
  const hasVariablePressure = !erase && maxW - minW > 0.6 && brush !== "marker";

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = resolveCompositeOp(erase, options?.alphaLock);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  applySoftnessShadow(ctx, color, baseWidth, erase, softness);

  if (!hasVariablePressure) {
    const w = erase ? baseWidth : (points[points.length - 1].w ?? baseWidth);
    if (brush === "fine" && !erase) {
      ctx.globalAlpha = opacity;
      ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    } else if (brush === "marker" && !erase) {
      ctx.globalAlpha = 0.35 * opacity;
      ctx.lineWidth = Math.max(2, w);
      ctx.lineCap = "square";
      ctx.lineJoin = "bevel";
    } else {
      ctx.globalAlpha = opacity;
      ctx.lineWidth = Math.max(1, w);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2 || erase) {
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) * 0.5;
        const midY = (points[i].y + points[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.restore();
    if (erase) {
      clearEraserPathAlpha(ctx, points, w);
    }
    return;
  }

  ctx.globalAlpha = opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const scaleFactor = brush === "fine" && !erase ? 0.3 : 1;

  let prevX = points[0].x;
  let prevY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const targetX = next ? (curr.x + next.x) * 0.5 : curr.x;
    const targetY = next ? (curr.y + next.y) * 0.5 : curr.y;
    const w = Math.max(0.75, (curr.w ?? baseWidth) * scaleFactor);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    if (next) {
      ctx.quadraticCurveTo(curr.x, curr.y, targetX, targetY);
    } else {
      ctx.lineTo(targetX, targetY);
    }
    ctx.stroke();
    prevX = targetX;
    prevY = targetY;
  }
  ctx.restore();
}
