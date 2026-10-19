/**
 * Estabilizador del lápiz (anti-vibración del trazo).
 *
 * El trazo se suaviza con una media móvil exponencial: cada punto dibujado se
 * acerca al cursor una fracción (`alpha`) del camino que le queda. Cuanto menor
 * es `alpha`, más suave —y más rezagado— va el pincel. Antes el valor estaba
 * fijo a la mitad y se activaba o desactivaba con un interruptor; ahora es un
 * nivel de 0 a 100 que el usuario regula con una barra.
 *
 * El módulo es puro (sin canvas ni React) para poder fijar su calibración con
 * pruebas y reutilizarlo tanto en el editor de sprites como en el lienzo de la
 * galería.
 */

export const STABILIZE_MIN = 0;
export const STABILIZE_MAX = 100;
/** Punto medio: suaviza sin que el trazo parezca ir a la zaga. */
export const STABILIZE_DEFAULT = 50;

export interface Point {
  x: number;
  y: number;
}

export interface StrokePoint extends Point {
  w?: number;
}

/** Nivel usable: entero dentro de 0-100 (un valor inválido vuelve al punto medio). */
export function clampStabilizeLevel(level: number): number {
  if (!Number.isFinite(level)) return STABILIZE_DEFAULT;
  return Math.max(STABILIZE_MIN, Math.min(STABILIZE_MAX, Math.round(level)));
}

/**
 * Fracción del camino que el trazo recorre hacia el cursor en cada punto.
 * 1 = sigue el cursor exactamente (sin estabilización); a mayor nivel, el pincel
 * se mueve menos por punto y el trazo sale más suave y regular.
 */
export function stabilizeAlpha(level: number): number {
  const clamped = clampStabilizeLevel(level);
  return 1 - (clamped / STABILIZE_MAX) * 0.88;
}

/** Punto suavizado: acerca el último punto dibujado a la posición del cursor. */
export function stabilizePoint(last: Point, target: Point, level: number): Point {
  const alpha = stabilizeAlpha(level);
  return {
    x: last.x + (target.x - last.x) * alpha,
    y: last.y + (target.y - last.y) * alpha,
  };
}

/**
 * Estado del estabilizador multicapa («cuerda tensa» + doble filtro en cascada).
 * Elimina el temblor de pulso y las oscilaciones laterales antes de que lleguen
 * al trazo.
 */
export interface StabilizerState {
  anchor: Point;
  mid: Point;
  tip: Point;
  width: number;
}

export function createStabilizerState(start: Point, width: number): StabilizerState {
  return {
    anchor: { x: start.x, y: start.y },
    mid: { x: start.x, y: start.y },
    tip: { x: start.x, y: start.y },
    width,
  };
}

/**
 * Avanza el estabilizador hacia `target` subdividiendo saltos largos en pasos
 * uniformes para que el suavizado no dependa de la frecuencia del ratón o dedo.
 */
export function advanceStabilizer(
  state: StabilizerState,
  target: Point,
  targetWidth: number,
  level: number,
  catchUp = false,
): StrokePoint[] {
  const clamped = clampStabilizeLevel(level);
  if (clamped === 0) {
    state.anchor = { x: target.x, y: target.y };
    state.mid = { x: target.x, y: target.y };
    state.tip = { x: target.x, y: target.y };
    state.width = targetWidth;
    return [{ x: target.x, y: target.y, w: targetWidth }];
  }

  const strength = clamped / STABILIZE_MAX;
  // Radio de «cuerda tensa»: absorbe micro-temblores laterales sin mover la punta.
  const stringRadius = catchUp ? 0 : strength * 2.6;
  const startOrigin = catchUp ? state.tip : state.anchor;
  const dxTotal = target.x - startOrigin.x;
  const dyTotal = target.y - startOrigin.y;
  const distTotal = Math.hypot(dxTotal, dyTotal);

  if (!catchUp && distTotal <= stringRadius) {
    return [];
  }

  if (catchUp && distTotal <= 0.25) {
    state.anchor = { x: target.x, y: target.y };
    state.mid = { x: target.x, y: target.y };
    state.tip = { x: target.x, y: target.y };
    state.width = targetWidth;
    return [{ x: target.x, y: target.y, w: targetWidth }];
  }

  // Subdividir en pasos de ~1.5 px garantiza curvas continuas aunque el puntero salte rápido.
  const steps = Math.max(1, Math.min(catchUp ? 32 : 24, Math.ceil(distTotal / 1.5)));
  const alpha = catchUp
    ? Math.max(0.38, stabilizeAlpha(clamped * 0.5))
    : stabilizeAlpha(clamped) * 0.72 + 0.06;
  const out: StrokePoint[] = [];

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const tx = startOrigin.x + dxTotal * t;
    const ty = startOrigin.y + dyTotal * t;
    const vx = tx - state.mid.x;
    const vy = ty - state.mid.y;
    const vd = Math.hypot(vx, vy);

    if (!catchUp && vd > stringRadius && vd > 0) {
      const pull = (vd - stringRadius) / vd;
      state.mid = {
        x: state.mid.x + vx * pull * alpha,
        y: state.mid.y + vy * pull * alpha,
      };
    } else {
      state.mid = {
        x: state.mid.x + vx * alpha,
        y: state.mid.y + vy * alpha,
      };
    }

    state.tip = {
      x: state.tip.x + (state.mid.x - state.tip.x) * alpha,
      y: state.tip.y + (state.mid.y - state.tip.y) * alpha,
    };
    state.width = state.width + (targetWidth - state.width) * 0.25;

    const prev = out[out.length - 1];
    if (!prev || Math.hypot(state.tip.x - prev.x, state.tip.y - prev.y) >= 0.35) {
      out.push({ x: state.tip.x, y: state.tip.y, w: state.width });
    }
  }

  if (catchUp) {
    state.mid = { x: target.x, y: target.y };
    state.tip = { x: target.x, y: target.y };
    state.width = targetWidth;
    const last = out[out.length - 1];
    if (!last || Math.hypot(target.x - last.x, target.y - last.y) > 0.1) {
      out.push({ x: target.x, y: target.y, w: targetWidth });
    } else {
      out[out.length - 1] = { x: target.x, y: target.y, w: targetWidth };
    }
  }

  state.anchor = { x: target.x, y: target.y };
  return out;
}

/**
 * Refina la geometría completa del trazo activo:
 * 1. Si el trazo es casi recto (la desviación lateral máxima respecto a la cuerda
 *    es pequeña para el nivel de estabilización), corrige automáticamente las
 *    ondulaciones para evitar trazos chuecos.
 * 2. Aplica suavizado simétrico de Taubin (λ / μ) que elimina temblores y picos
 *    sin encoger las curvas ni los círculos.
 */
export function refineStrokePath(points: StrokePoint[], level: number): StrokePoint[] {
  if (points.length <= 2) return points;
  const clamped = clampStabilizeLevel(level);
  const strength = clamped / STABILIZE_MAX;

  // Filtrar puntos demasiado pegados que causan quiebres bruscos de tangente.
  const deduped: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= 0.4) {
      deduped.push(points[i]);
    }
  }
  deduped.push(points[points.length - 1]);
  if (deduped.length <= 2) return deduped;

  let current = deduped.map(p => ({ ...p }));

  // 1. Corrección de rectitud (anti-trazos chuecos) cuando la intención es una recta.
  if (strength > 0) {
    const first = current[0];
    const last = current[current.length - 1];
    const chordX = last.x - first.x;
    const chordY = last.y - first.y;
    const chordLen = Math.hypot(chordX, chordY);

    if (chordLen > 6) {
      const ux = chordX / chordLen;
      const uy = chordY / chordLen;
      let maxPerp = 0;
      let pathLen = 0;
      for (let i = 1; i < current.length; i++) {
        pathLen += Math.hypot(current[i].x - current[i - 1].x, current[i].y - current[i - 1].y);
        const rx = current[i].x - first.x;
        const ry = current[i].y - first.y;
        const perp = Math.abs(rx * (-uy) + ry * ux);
        if (perp > maxPerp) maxPerp = perp;
      }

      // Tolerancia proporcional al nivel de estabilización: si la desviación y el
      // exceso de arco son bajos, aplana progresivamente las desviaciones laterales.
      const maxAllowedPerp = 1.5 + strength * 9.5;
      const ratio = maxPerp / chordLen;
      const maxAllowedRatio = 0.02 + strength * 0.065;
      const straightness = pathLen / Math.max(1, chordLen);

      if (maxPerp <= maxAllowedPerp && ratio <= maxAllowedRatio && straightness < 1.08) {
        const t = 1 - Math.max(maxPerp / maxAllowedPerp, ratio / maxAllowedRatio);
        const pull = Math.min(0.96, t * t * (0.45 + 0.55 * strength));
        current = current.map((pt, i) => {
          if (i === 0 || i === current.length - 1) return pt;
          const rx = pt.x - first.x;
          const ry = pt.y - first.y;
          const proj = Math.max(0, Math.min(chordLen, rx * ux + ry * uy));
          const lineX = first.x + ux * proj;
          const lineY = first.y + uy * proj;
          return {
            ...pt,
            x: pt.x + (lineX - pt.x) * pull,
            y: pt.y + (lineY - pt.y) * pull,
          };
        });
      }
    }
  }

  // 2. Suavizado de Taubin (λ = 0.48, μ = -0.50): elimina zigzags sin encoger curvas.
  const passes = Math.max(1, Math.round(1 + strength * 5));
  const lambda = 0.48;
  const mu = -0.5;

  const laplacianStep = (src: StrokePoint[], factor: number): StrokePoint[] => {
    const next = src.map(p => ({ ...p }));
    for (let i = 1; i < src.length - 1; i++) {
      const prev = src[i - 1];
      const curr = src[i];
      const after = src[i + 1];
      const mx = (prev.x + after.x) * 0.5;
      const my = (prev.y + after.y) * 0.5;
      next[i].x = curr.x + (mx - curr.x) * factor;
      next[i].y = curr.y + (my - curr.y) * factor;
      if (curr.w !== undefined && prev.w !== undefined && after.w !== undefined) {
        next[i].w = curr.w + ((prev.w + after.w) * 0.5 - curr.w) * 0.35;
      }
    }
    return next;
  };

  for (let p = 0; p < passes; p++) {
    current = laplacianStep(current, lambda);
    current = laplacianStep(current, mu);
  }

  return current;
}
