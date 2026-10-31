import { useEffect } from "react";
import { mulberry32, randomSeed, scribbleFill } from "drawably";
import "drawably/style.css";
import "drawably/font.css";

const SVG_NS = "http://www.w3.org/2000/svg";
const INSET = 1.25;

interface SketchInstance {
  svg: SVGSVGElement;
  seed: number;
  lastW: number;
  lastH: number;
  kind: "button-solid" | "button-outline" | "card" | "input" | "divider" | "chip";
  ro: ResizeObserver;
}

const sketchedElements = new WeakMap<HTMLElement, SketchInstance>();

function hashStringSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || randomSeed();
}

const f = (n: number) => n.toFixed(2);

/**
 * Genera un rectángulo redondeado dibujado a mano con pulso firme (sin temblor):
 * - En lugar de muestrear cada 8 px (que produce dientes de sierra temblorosos),
 *   cada lado se traza con una sola curva Bézier suave y continua (como un
 *   ilustrador trazando una línea firme a lápiz o estilógrafo).
 * - Incluye una segunda pasada sutil ligeramente desplazada en las esquinas y
 *   centros para dar el acabado artesanal de boceto limpio.
 */
function smoothHandRoundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  seed: number,
  passOffset = 0,
): string {
  const radius = Math.max(2, Math.min(r, w / 2 - 1, h / 2 - 1));
  const rand = mulberry32(seed + passOffset * 4099);
  const s = (amp: number) => (rand() * 2 - 1) * amp;

  // Desviación muy sutil y orgánica de trazo largo (nunca temblorosa)
  const bow = passOffset === 0 ? 0.55 : 0.75;
  const cornerJit = passOffset === 0 ? 0.3 : 0.45;

  const x0 = x + s(cornerJit);
  const y0 = y + s(cornerJit);
  const x1 = x + w + s(cornerJit);
  const y1 = y + h + s(cornerJit);

  // Puntos de inicio y fin de cada lado recto tras las esquinas redondeadas
  const topStartX = x0 + radius;
  const topEndX = x1 - radius;
  const rightStartY = y0 + radius;
  const rightEndY = y1 - radius;
  const bottomStartX = x1 - radius;
  const bottomEndX = x0 + radius;
  const leftStartY = y1 - radius;
  const leftEndY = y0 + radius;

  // Curvatura suave de un solo arco por lado (pulso firme)
  const topCtrlX = (topStartX + topEndX) / 2 + s(bow * 2);
  const topCtrlY = y0 + s(bow);

  const rightCtrlX = x1 + s(bow);
  const rightCtrlY = (rightStartY + rightEndY) / 2 + s(bow * 2);

  const bottomCtrlX = (bottomStartX + bottomEndX) / 2 + s(bow * 2);
  const bottomCtrlY = y1 + s(bow);

  const leftCtrlX = x0 + s(bow);
  const leftCtrlY = (leftStartY + leftEndY) / 2 + s(bow * 2);

  return [
    `M ${f(topStartX)} ${f(y0)}`,
    // Lado superior suave
    `Q ${f(topCtrlX)} ${f(topCtrlY)} ${f(topEndX)} ${f(y0)}`,
    // Esquina superior derecha
    `Q ${f(x1)} ${f(y0)} ${f(x1)} ${f(rightStartY)}`,
    // Lado derecho suave
    `Q ${f(rightCtrlX)} ${f(rightCtrlY)} ${f(x1)} ${f(rightEndY)}`,
    // Esquina inferior derecha
    `Q ${f(x1)} ${f(y1)} ${f(bottomStartX)} ${f(y1)}`,
    // Lado inferior suave
    `Q ${f(bottomCtrlX)} ${f(bottomCtrlY)} ${f(bottomEndX)} ${f(y1)}`,
    // Esquina inferior izquierda
    `Q ${f(x0)} ${f(y1)} ${f(x0)} ${f(leftStartY)}`,
    // Lado izquierdo suave
    `Q ${f(leftCtrlX)} ${f(leftCtrlY)} ${f(x0)} ${f(leftEndY)}`,
    // Esquina superior izquierda
    `Q ${f(x0)} ${f(y0)} ${f(topStartX)} ${f(y0)}`,
    "Z",
  ].join(" ");
}

/**
 * Línea horizontal dibujada a mano con pulso firme (un solo arco suave).
 */
function smoothHandLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  passOffset = 0,
): string {
  const rand = mulberry32(seed + passOffset * 3137);
  const s = (amp: number) => (rand() * 2 - 1) * amp;
  const bow = passOffset === 0 ? 0.5 : 0.7;
  const cx = (x1 + x2) / 2 + s(2);
  const cy = (y1 + y2) / 2 + s(bow);
  return `M ${f(x1)} ${f(y1 + s(0.25))} Q ${f(cx)} ${f(cy)} ${f(x2)} ${f(y2 + s(0.25))}`;
}

function classifyElement(el: HTMLElement): SketchInstance["kind"] | null {
  if (el.dataset.noDrawably !== undefined) return null;
  if (el.classList.contains("drawably-host")) return null;
  if (el.closest("[data-canvas-handle], .monaco-editor")) return null;

  const tag = el.tagName;
  if (tag === "HR") return "divider";

  if (
    tag === "BUTTON" ||
    (tag === "A" &&
      el.className &&
      /btn|button|bg-primary|grad-brand|m3-btn|glass-btn|glass-control/.test(el.className))
  ) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (
      cls.includes("bg-primary") ||
      cls.includes("btn-grad") ||
      cls.includes("grad-brand") ||
      (cls.includes("m3-btn") && !cls.includes("m3-btn-outlined"))
    ) {
      return "button-solid";
    }
    if (
      cls.includes("glass-btn") ||
      cls.includes("glass-control") ||
      cls.includes("m3-btn-outlined") ||
      cls.includes("m3-icon-btn") ||
      cls.includes("neu-btn") ||
      cls.includes("border")
    ) {
      return "button-outline";
    }
    return null;
  }

  const cls = typeof el.className === "string" ? el.className : "";
  if (cls.includes("m3-chip") || cls.includes("chip")) {
    return "chip";
  }

  if (
    cls.includes("m3-card") ||
    cls.includes("panel") ||
    cls.includes("surface") ||
    cls.includes("auth-card") ||
    cls.includes("plus-glass-card") ||
    cls.includes("plus-glass-hero") ||
    el.getAttribute("role") === "dialog" ||
    el.getAttribute("role") === "menu"
  ) {
    return "card";
  }

  return null;
}

function renderSketchPaths(inst: SketchInstance, w: number, h: number) {
  if (w < 18 || h < 14) {
    inst.svg.innerHTML = "";
    return;
  }
  if (Math.abs(w - inst.lastW) < 1 && Math.abs(h - inst.lastH) < 1 && inst.svg.childElementCount > 0) {
    return;
  }
  inst.lastW = w;
  inst.lastH = h;
  inst.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  inst.svg.textContent = "";

  if (inst.kind === "divider") {
    const d1 = smoothHandLine(2, h / 2, w - 2, h / 2, inst.seed, 0);
    const p1 = document.createElementNS(SVG_NS, "path");
    p1.setAttribute("d", d1);
    p1.setAttribute("class", "drawably-outline");
    inst.svg.appendChild(p1);
    return;
  }

  const r =
    inst.kind === "chip"
      ? Math.min(14, Math.floor(h / 2) - 1)
      : inst.kind === "card"
        ? 10
        : Math.min(9, Math.floor(h / 2) - 1);

  if (inst.kind === "button-solid") {
    const scribbleD = scribbleFill(
      INSET + 3,
      INSET + 3,
      Math.max(4, w - 2 * INSET - 6),
      Math.max(4, h - 2 * INSET - 6),
      { seed: inst.seed + 101, roughness: 0.25, boil: 0 },
    );
    if (scribbleD) {
      const pScribble = document.createElementNS(SVG_NS, "path");
      pScribble.setAttribute("d", scribbleD);
      pScribble.setAttribute("class", "drawably-scribble drawably-primary-scribble");
      inst.svg.appendChild(pScribble);
    }
  }

  // Trazo principal firme y limpio
  const mainD = smoothHandRoundedRect(
    INSET,
    INSET,
    Math.max(4, w - 2 * INSET),
    Math.max(4, h - 2 * INSET),
    r,
    inst.seed,
    0,
  );
  const pMain = document.createElementNS(SVG_NS, "path");
  pMain.setAttribute("d", mainD);
  pMain.setAttribute("class", "drawably-outline");
  inst.svg.appendChild(pMain);

  // Segunda pasada sutil de lápiz/estilógrafo (da carácter de dibujo a mano sin verse tembloroso)
  const secondD = smoothHandRoundedRect(
    INSET,
    INSET,
    Math.max(4, w - 2 * INSET),
    Math.max(4, h - 2 * INSET),
    r,
    inst.seed,
    1,
  );
  const pSecond = document.createElementNS(SVG_NS, "path");
  pSecond.setAttribute("d", secondD);
  pSecond.setAttribute("class", "drawably-outline drawably-outline-pass2");
  inst.svg.appendChild(pSecond);
}

function attachDrawablySketch(el: HTMLElement) {
  if (sketchedElements.has(el)) return;
  const kind = classifyElement(el);
  if (!kind) return;

  const cs = window.getComputedStyle(el);
  if (cs.display === "inline" || cs.display === "contents") return;
  if (cs.position === "static") {
    el.classList.add("drawably-rel-host");
  }
  el.classList.add("drawably-auto-host", `drawably-kind-${kind}`);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "drawably-svg drawably-auto-svg");
  svg.setAttribute("aria-hidden", "true");
  el.insertBefore(svg, el.firstChild);

  const labelSeed = (el.textContent || el.getAttribute("aria-label") || el.className || "").slice(0, 32);
  const seed = hashStringSeed(labelSeed);

  const ro = new ResizeObserver(() => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    renderSketchPaths(inst, w, h);
  });

  const inst: SketchInstance = {
    svg,
    seed,
    lastW: 0,
    lastH: 0,
    kind,
    ro,
  };

  sketchedElements.set(el, inst);
  renderSketchPaths(inst, el.offsetWidth, el.offsetHeight);
  ro.observe(el);
}

function scanSubtree(root: ParentNode) {
  if (root instanceof HTMLElement) {
    attachDrawablySketch(root);
  }
  const candidates = root.querySelectorAll<HTMLElement>(
    'button, a[class*="btn"], a[class*="bg-primary"], .m3-card, .m3-card-outlined, .panel, .surface, .m3-chip, .chip, .auth-card, [role="dialog"], [role="menu"], hr',
  );
  candidates.forEach((el) => attachDrawablySketch(el));
}

/**
 * Proveedor del tema dibujado a mano estilo Drawably:
 * - Bordes trazados con curvas suaves de pulso firme (sin temblor ni dientes de sierra).
 * - Filtro SVG limpio de doble pasada sutil para los iconos.
 */
export function DrawablyThemeProvider() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme-style", "drawably");
    scanSubtree(document.body);

    let rafId = 0;
    const pendingNodes = new Set<ParentNode>();

    const flushPending = () => {
      rafId = 0;
      pendingNodes.forEach((node) => {
        if (node.isConnected) scanSubtree(node);
      });
      pendingNodes.clear();
    };

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && !node.classList.contains("drawably-svg")) {
            pendingNodes.add(node);
          }
        });
      }
      if (pendingNodes.size > 0 && !rafId) {
        rafId = requestAnimationFrame(flushPending);
      }
    });

    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      className="fixed top-0 left-0 w-0 h-0 pointer-events-none overflow-hidden"
    >
      <defs>
        {/* Filtro de icono dibujado a mano con trazo firme (sin distorsión temblorosa) */}
        <filter id="drawably-pencil-icon" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="1" seed="5" result="smoothCurve" />
          <feDisplacementMap in="SourceGraphic" in2="smoothCurve" scale="0.45" xChannelSelector="R" yChannelSelector="G" result="pass1" />
          <feOffset in="SourceGraphic" dx="0.4" dy="0.35" result="pass2Shift" />
          <feComponentTransfer in="pass2Shift" result="pass2Soft">
            <feFuncA type="linear" slope="0.38" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="pass2Soft" />
            <feMergeNode in="pass1" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
