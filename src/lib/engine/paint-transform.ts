import type { SymmetryMode } from "./paint-brush";
import type { ShapeBox } from "./paint-shapes";

/**
 * Motor geométrico de transformación de objetos en el lienzo (herramienta «Mover»),
 * selección rectangular/lazo, guías de simetría, modos de fusión de capas y
 * bote de pintura con tolerancia antialiasing y degradados.
 */

export type TransformHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotate"
  | "clone"
  | "body";

export type SelectionMode = "auto" | "rect" | "lasso";

export const LAYER_BLEND_MODES = [
  { id: "source-over", name: "Normal" },
  { id: "multiply", name: "Multiplicar" },
  { id: "screen", name: "Trama" },
  { id: "overlay", name: "Superponer" },
  { id: "soft-light", name: "Luz suave" },
  { id: "lighter", name: "Suma" },
] as const;

export type LayerBlendMode = typeof LAYER_BLEND_MODES[number]["id"];

export type FillGradientMode = "solid" | "linear" | "radial";

export interface FloodFillOptions {
  /** Tolerancia de color/alfa (0..100, por defecto 25). */
  tolerance?: number;
  /** Bloqueo alfa: solo rellena píxeles con opacidad existente conservando su alfa. */
  alphaLock?: boolean;
  /** Modo de relleno: color sólido, degradado lineal o degradado radial. */
  gradientMode?: FillGradientMode;
  /** Color secundario para rellenos con degradado. */
  secondaryColor?: string;
}

export interface TransformBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface HandlePoint {
  id: Exclude<TransformHandle, "body">;
  x: number;
  y: number;
}

/** Distancia del mástil de rotación en píxeles de pantalla. */
export const ROTATE_STEM_PX = 22;
/** Distancia de la insignia de clonación respecto a la esquina superior derecha en pantalla. */
export const CLONE_OFFSET_PX = 16;

/** Convierte un punto del mundo al espacio local (centrado y sin rotación) de la caja. */
export function worldToLocal(
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  rotation: number,
): { x: number; y: number } {
  const dx = wx - cx;
  const dy = wy - cy;
  if (!rotation) return { x: dx, y: dy };
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

/** Convierte un desplazamiento local al espacio del mundo aplicando la rotación. */
export function localToWorld(
  lx: number,
  ly: number,
  cx: number,
  cy: number,
  rotation: number,
): { x: number; y: number } {
  if (!rotation) return { x: cx + lx, y: cy + ly };
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  };
}

/**
 * Posiciones en coordenadas del lienzo de todos los tiradores interactivos del
 * marco (8 de escala, 1 de rotación arriba y 1 de clonación en la esquina).
 */
export function getTransformHandles(
  box: TransformBox,
  displayScale: number,
): HandlePoint[] {
  const s = Math.max(0.1, displayScale);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hw = box.w / 2;
  const hh = box.h / 2;
  const rotDist = ROTATE_STEM_PX / s;
  const cloneOff = CLONE_OFFSET_PX / s;

  const localHandles: { id: Exclude<TransformHandle, "body">; lx: number; ly: number }[] = [
    { id: "nw", lx: -hw, ly: -hh },
    { id: "n", lx: 0, ly: -hh },
    { id: "ne", lx: hw, ly: -hh },
    { id: "e", lx: hw, ly: 0 },
    { id: "se", lx: hw, ly: hh },
    { id: "s", lx: 0, ly: hh },
    { id: "sw", lx: -hw, ly: hh },
    { id: "w", lx: -hw, ly: 0 },
    { id: "rotate", lx: 0, ly: -hh - rotDist },
    { id: "clone", lx: hw + cloneOff, ly: -hh - cloneOff * 0.6 },
  ];

  return localHandles.map(h => {
    const p = localToWorld(h.lx, h.ly, cx, cy, box.rotation);
    return { id: h.id, x: p.x, y: p.y };
  });
}

/**
 * Detecta qué tirador (o el cuerpo interior) del marco transformable está bajo
 * el punto `(wx, wy)` en coordenadas del lienzo.
 */
export function hitTestTransformGizmo(
  box: TransformBox,
  wx: number,
  wy: number,
  displayScale: number,
): TransformHandle | null {
  const s = Math.max(0.1, displayScale);
  const handleRadius = 12 / s;
  const specialRadius = 14 / s;
  const handles = getTransformHandles(box, displayScale);

  for (const h of handles) {
    const r = h.id === "rotate" || h.id === "clone" ? specialRadius : handleRadius;
    if (Math.hypot(wx - h.x, wy - h.y) <= r) {
      return h.id;
    }
  }

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const local = worldToLocal(wx, wy, cx, cy, box.rotation);
  const pad = 4 / s;
  if (
    Math.abs(local.x) <= box.w / 2 + pad &&
    Math.abs(local.y) <= box.h / 2 + pad
  ) {
    return "body";
  }

  return null;
}

/**
 * Calcula la nueva caja al arrastrar uno de los 8 tiradores de escala.
 * Conserva anclado el borde o esquina opuesta en el espacio del mundo y voltea
 * automáticamente (`flipX` / `flipY`) cuando el usuario cruza el lado opuesto.
 */
export function computeScaledBox(
  initial: TransformBox,
  handle: Exclude<TransformHandle, "rotate" | "clone" | "body">,
  wx: number,
  wy: number,
  lockAspect = false,
  minSize = 4,
): TransformBox {
  const cx0 = initial.x + initial.w / 2;
  const cy0 = initial.y + initial.h / 2;
  const hw0 = Math.max(1, initial.w / 2);
  const hh0 = Math.max(1, initial.h / 2);
  const local = worldToLocal(wx, wy, cx0, cy0, initial.rotation);

  const dirX = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const dirY = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;

  let newW = initial.w;
  let newH = initial.h;
  let flipX = initial.flipX;
  let flipY = initial.flipY;
  let signX = 1;
  let signY = 1;

  const anchorX = -dirX * hw0;
  const anchorY = -dirY * hh0;

  if (dirX !== 0) {
    const rawW = dirX * (local.x - anchorX);
    if (rawW < 0) {
      flipX = !initial.flipX;
      signX = -1;
    }
    newW = Math.max(minSize, Math.abs(rawW));
  }

  if (dirY !== 0) {
    const rawH = dirY * (local.y - anchorY);
    if (rawH < 0) {
      flipY = !initial.flipY;
      signY = -1;
    }
    newH = Math.max(minSize, Math.abs(rawH));
  }

  if (lockAspect && dirX !== 0 && dirY !== 0) {
    const aspect = Math.max(1, initial.w) / Math.max(1, initial.h);
    if (newW / newH > aspect) {
      newH = Math.max(minSize, newW / aspect);
    } else {
      newW = Math.max(minSize, newH * aspect);
    }
  }

  const localCenterX = dirX !== 0 ? anchorX + dirX * signX * (newW / 2) : 0;
  const localCenterY = dirY !== 0 ? anchorY + dirY * signY * (newH / 2) : 0;
  const newCenter = localToWorld(localCenterX, localCenterY, cx0, cy0, initial.rotation);

  return {
    x: newCenter.x - newW / 2,
    y: newCenter.y - newH / 2,
    w: newW,
    h: newH,
    rotation: initial.rotation,
    flipX,
    flipY,
  };
}

/**
 * Calcula el ángulo de rotación (en radianes) al arrastrar el tirador superior.
 * Con `snap` activo (Shift), redondea a múltiplos de 15°.
 */
export function computeRotationAngle(
  cx: number,
  cy: number,
  wx: number,
  wy: number,
  snap = false,
): number {
  let angle = Math.atan2(wy - cy, wx - cx) + Math.PI / 2;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  if (snap) {
    const step = Math.PI / 12; // 15 grados
    angle = Math.round(angle / step) * step;
  }
  return angle;
}

/** Cursor CSS apropiado para cada tirador del marco. */
export function cursorForHandle(handle: TransformHandle | null): string {
  switch (handle) {
    case "nw":
    case "se":
      return "cursor-nwse-resize";
    case "ne":
    case "sw":
      return "cursor-nesw-resize";
    case "n":
    case "s":
      return "cursor-ns-resize";
    case "e":
    case "w":
      return "cursor-ew-resize";
    case "rotate":
      return "cursor-grab";
    case "clone":
      return "cursor-copy";
    case "body":
      return "cursor-move";
    default:
      return "cursor-move";
  }
}

/**
 * Dibuja el marco de transformación orientado, sus 8 tiradores de escala, el
 * mástil superior de rotación y la insignia rápida de clonación («+») en la
 * vista del lienzo (coordenadas de pantalla ya escaladas por `displayScale`).
 */
export function drawTransformGizmo(
  ctx: CanvasRenderingContext2D,
  box: TransformBox,
  displayScale: number,
): void {
  const s = Math.max(0.1, displayScale);
  const cx = (box.x + box.w / 2) * s;
  const cy = (box.y + box.h / 2) * s;
  const bw = Math.max(2, box.w * s);
  const bh = Math.max(2, box.h * s);
  const hw = bw / 2;
  const hh = bh / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (box.rotation) ctx.rotate(box.rotation);

  // 1. Rectángulo discontinuo principal
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-hw, -hh, bw, bh);
  ctx.setLineDash([]);

  // 2. Mástil y tirador circular de rotación (arriba)
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, -hh - ROTATE_STEM_PX);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, -hh - ROTATE_STEM_PX, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = "#f8fafc";
  ctx.fill();
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3. Insignia de clonación rápida («+») junto a la esquina superior derecha
  const cloneX = hw + CLONE_OFFSET_PX;
  const cloneY = -hh - CLONE_OFFSET_PX * 0.6;
  ctx.beginPath();
  ctx.arc(cloneX, cloneY, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = "#0ea5e9";
  ctx.fill();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cloneX - 3.5, cloneY);
  ctx.lineTo(cloneX + 3.5, cloneY);
  ctx.moveTo(cloneX, cloneY - 3.5);
  ctx.lineTo(cloneX, cloneY + 3.5);
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.stroke();

  // 4. 8 tiradores cuadrados de escala (4 esquinas + 4 lados)
  const hs = 8.5;
  const pts: [number, number][] = [
    [-hw, -hh],
    [0, -hh],
    [hw, -hh],
    [hw, 0],
    [hw, hh],
    [0, hh],
    [-hw, hh],
    [-hw, 0],
  ];
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 1.25;
  for (const [px, py] of pts) {
    ctx.fillRect(px - hs / 2, py - hs / 2, hs, hs);
    ctx.strokeRect(px - hs / 2, py - hs / 2, hs, hs);
  }

  ctx.restore();
}

/**
 * Encuentra la caja envolvente de los píxeles no transparentes de `ImageData`
 * dentro del rectángulo opcional `region` (o de todo el lienzo si no se pasa).
 */
export function findNonEmptyPixelBounds(
  img: ImageData,
  region?: ShapeBox,
  alphaThreshold = 8,
): ShapeBox | null {
  const W = img.width;
  const H = img.height;
  const data = img.data;
  const xStart = region ? Math.max(0, Math.floor(region.x)) : 0;
  const yStart = region ? Math.max(0, Math.floor(region.y)) : 0;
  const xEnd = region ? Math.min(W - 1, Math.ceil(region.x + region.w) - 1) : W - 1;
  const yEnd = region ? Math.min(H - 1, Math.ceil(region.y + region.h) - 1) : H - 1;

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;

  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const a = data[(y * W + x) * 4 + 3];
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX + 1),
    h: Math.max(1, maxY - minY + 1),
  };
}

/**
 * Comprueba si un punto `(px, py)` está dentro de un polígono cerrado usando
 * el algoritmo de cruce de rayos (ray-casting).
 */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Encuentra la caja envolvente de los píxeles no vacíos contenidos dentro de un
 * lazo poligonal.
 */
export function findLassoPixelBounds(
  img: ImageData,
  polygon: { x: number; y: number }[],
  alphaThreshold = 8,
): ShapeBox | null {
  if (polygon.length < 3) return null;
  const W = img.width;
  const H = img.height;
  const data = img.data;

  let polyMinX = W;
  let polyMinY = H;
  let polyMaxX = 0;
  let polyMaxY = 0;
  for (const pt of polygon) {
    if (pt.x < polyMinX) polyMinX = pt.x;
    if (pt.y < polyMinY) polyMinY = pt.y;
    if (pt.x > polyMaxX) polyMaxX = pt.x;
    if (pt.y > polyMaxY) polyMaxY = pt.y;
  }

  const xStart = Math.max(0, Math.floor(polyMinX));
  const yStart = Math.max(0, Math.floor(polyMinY));
  const xEnd = Math.min(W - 1, Math.ceil(polyMaxX));
  const yEnd = Math.min(H - 1, Math.ceil(polyMaxY));

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;

  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const a = data[(y * W + x) * 4 + 3];
      if (a >= alphaThreshold && pointInPolygon(x + 0.5, y + 0.5, polygon)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX + 1),
    h: Math.max(1, maxY - minY + 1),
  };
}

/**
 * Dibuja el contorno discontinuo de selección activa (rectángulo o lazo) mientras
 * el usuario arrastra sobre el lienzo.
 */
export function drawSelectionMarquee(
  ctx: CanvasRenderingContext2D,
  mode: "rect" | "lasso",
  points: { x: number; y: number }[],
  displayScale = 1,
): void {
  if (points.length < 2) return;
  const s = Math.max(0.1, displayScale);
  ctx.save();
  ctx.lineWidth = 1.5;

  const tracePath = () => {
    ctx.beginPath();
    if (mode === "rect") {
      const p0 = points[0];
      const p1 = points[points.length - 1];
      const rx = Math.min(p0.x, p1.x) * s;
      const ry = Math.min(p0.y, p1.y) * s;
      const rw = Math.abs(p1.x - p0.x) * s;
      const rh = Math.abs(p1.y - p0.y) * s;
      ctx.rect(rx, ry, rw, rh);
    } else {
      ctx.moveTo(points[0].x * s, points[0].y * s);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * s, points[i].y * s);
      }
      ctx.closePath();
    }
  };

  ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
  tracePath();
  ctx.fill();

  ctx.strokeStyle = "#0f172a";
  ctx.setLineDash([5, 5]);
  tracePath();
  ctx.stroke();

  ctx.strokeStyle = "#38bdf8";
  ctx.lineDashOffset = 5;
  tracePath();
  ctx.stroke();

  ctx.restore();
}

/**
 * Dibuja las guías de simetría horizontal y/o vertical en el centro del visor.
 */
export function drawSymmetryGuides(
  ctx: CanvasRenderingContext2D,
  symmetry: SymmetryMode,
  canvasW: number,
  canvasH: number,
  displayScale = 1,
): void {
  if (symmetry === "none") return;
  const s = Math.max(0.1, displayScale);
  const midX = Math.round((canvasW / 2) * s) + 0.5;
  const midY = Math.round((canvasH / 2) * s) + 0.5;
  const totalW = canvasW * s;
  const totalH = canvasH * s;

  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);

  if (symmetry === "horizontal" || symmetry === "quad") {
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, totalH);
    ctx.stroke();
  }
  if (symmetry === "vertical" || symmetry === "quad") {
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(totalW, midY);
    ctx.stroke();
  }
  ctx.restore();
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

/**
 * Rellena por inundación (`flood fill`) sobre `ImageData.data` con soporte de:
 * - Tolerancia configurable (`0..100`) para cubrir bordes suavizados (antialiasing)
 * - Bloqueo alfa (`alphaLock`) para conservar la opacidad existente
 * - Degradado lineal o radial entre el color primario y el secundario
 */
export function floodFillImageData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  startX: number,
  startY: number,
  primaryHex: string,
  options?: FloodFillOptions,
): boolean {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;

  const startIdx = (sy * w + sx) * 4;
  const tr = data[startIdx];
  const tg = data[startIdx + 1];
  const tb = data[startIdx + 2];
  const ta = data[startIdx + 3];

  const alphaLock = options?.alphaLock ?? false;
  if (alphaLock && ta === 0) return false;

  const [r1, g1, b1] = parseHexRgb(primaryHex);
  const gradientMode = options?.gradientMode ?? "solid";
  const [r2, g2, b2] = parseHexRgb(options?.secondaryColor ?? primaryHex);
  const tolPct = Math.max(0, Math.min(100, options?.tolerance ?? 25));
  const maxDiff = Math.round((tolPct / 100) * 255);

  if (
    gradientMode === "solid" &&
    maxDiff === 0 &&
    tr === r1 &&
    tg === g1 &&
    tb === b1 &&
    (alphaLock || ta === 255)
  ) {
    return false;
  }

  const visited = new Uint8Array(w * h);
  const filledMask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const startCell = sy * w + sx;
  visited[startCell] = 1;
  queue[tail++] = startCell;

  const matches = (cell: number): boolean => {
    const p = cell * 4;
    const a = data[p + 3];
    if (alphaLock && a === 0) return false;
    if (ta === 0 && a === 0) return true;
    const dr = Math.abs(data[p] - tr);
    const dg = Math.abs(data[p + 1] - tg);
    const db = Math.abs(data[p + 2] - tb);
    const da = Math.abs(a - ta);
    return dr <= maxDiff && dg <= maxDiff && db <= maxDiff && da <= maxDiff;
  };

  let minX = sx;
  let minY = sy;
  let maxX = sx;
  let maxY = sy;
  let filledCount = 0;

  while (head < tail) {
    const cell = queue[head++];
    if (!matches(cell)) continue;
    filledMask[cell] = 1;
    filledCount++;

    const cx = cell % w;
    const cy = (cell - cx) / w;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;

    // Expandir 1px hacia bordes semitransparentes contiguos cuando hay tolerancia
    // para eliminar halos de antialiasing junto a trazos de pincel.
    const neighbors = [
      cx > 0 ? cell - 1 : -1,
      cx < w - 1 ? cell + 1 : -1,
      cy > 0 ? cell - w : -1,
      cy < h - 1 ? cell + w : -1,
    ];
    for (const nb of neighbors) {
      if (nb >= 0 && !visited[nb]) {
        visited[nb] = 1;
        queue[tail++] = nb;
      }
    }
  }

  if (filledCount === 0) return false;

  // Si se rellena una zona transparente con tolerancia > 0, incluir el anillo de
  // 1px de antialiasing alrededor de la región para evitar halos dentados.
  if (ta < 32 && tolPct > 0 && !alphaLock) {
    const fringe: number[] = [];
    for (let y = Math.max(0, minY - 1); y <= Math.min(h - 1, maxY + 1); y++) {
      for (let x = Math.max(0, minX - 1); x <= Math.min(w - 1, maxX + 1); x++) {
        const c = y * w + x;
        if (filledMask[c]) continue;
        const a = data[c * 4 + 3];
        if (a > 0 && a < 210) {
          const hasFilledNeighbor =
            (x > 0 && filledMask[c - 1] === 1) ||
            (x < w - 1 && filledMask[c + 1] === 1) ||
            (y > 0 && filledMask[c - w] === 1) ||
            (y < h - 1 && filledMask[c + w] === 1);
          if (hasFilledNeighbor) fringe.push(c);
        }
      }
    }
    for (const c of fringe) {
      filledMask[c] = 1;
      const cx = c % w;
      const cy = (c - cx) / w;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const maxRadius = Math.max(1, Math.hypot(spanX / 2, spanY / 2));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = y * w + x;
      if (!filledMask[cell]) continue;
      const p = cell * 4;
      let t = 0;
      if (gradientMode === "linear") {
        t = ((x - minX) / spanX + (y - minY) / spanY) * 0.5;
      } else if (gradientMode === "radial") {
        t = Math.min(1, Math.hypot(x - centerX, y - centerY) / maxRadius);
      }
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      const origA = data[p + 3];
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = alphaLock ? origA : 255;
    }
  }

  return true;
}
