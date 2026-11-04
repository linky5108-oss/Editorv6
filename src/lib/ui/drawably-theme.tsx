import { useEffect } from "react";
import { mulberry32, randomSeed, scribbleFill } from "drawably";
import "drawably/style.css";
import "drawably/font.css";

const INSET = 2.5;

type SketchKind =
  | "button-solid"
  | "button-outline"
  | "button-pill"
  | "button-circle"
  | "tab-active"
  | "card"
  | "chip"
  | "chip-selected"
  | "badge"
  | "divider"
  | "bar-bottom"
  | "bar-top"
  | "bar-right";

interface SketchInstance {
  seed: number;
  lastW: number;
  lastH: number;
  lastKind: SketchKind | null;
  ro: ResizeObserver;
}

const sketchedElements = new WeakMap<HTMLElement, SketchInstance>();
const sketchedInputs = new WeakMap<HTMLElement, ResizeObserver>();

function hashStringSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1337;
}

function sampleSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number][] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const step = Math.max(20, Math.min(44, len / 4.5));
  const n = Math.max(3, Math.min(9, Math.ceil(len / step)));
  return Array.from({ length: n + 1 }, (_, i) => [
    x1 + ((x2 - x1) * i) / n,
    y1 + ((y2 - y1) * i) / n,
  ]);
}

function ellipseSegment(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n = 4,
): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

function roundedRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): [number, number][] {
  const rad = Math.max(2, Math.min(r, w / 2 - 1, h / 2 - 1));
  return [
    ...sampleSegment(x + rad, y, x + w - rad, y),
    ...ellipseSegment(x + w - rad, y + rad, rad, rad, -Math.PI / 2, 0, 3),
    ...sampleSegment(x + w, y + rad, x + w, y + h - rad),
    ...ellipseSegment(x + w - rad, y + h - rad, rad, rad, 0, Math.PI / 2, 3),
    ...sampleSegment(x + w - rad, y + h, x + rad, y + h),
    ...ellipseSegment(x + rad, y + h - rad, rad, rad, Math.PI / 2, Math.PI, 3),
    ...sampleSegment(x, y + h - rad, x, y + rad),
    ...ellipseSegment(x + rad, y + rad, rad, rad, Math.PI, Math.PI * 1.5, 3),
  ];
}

function jitterPoints(
  points: [number, number][],
  rand: () => number,
  amp: number,
): [number, number][] {
  return points.map(([x, y]) => [
    x + (rand() * 2 - 1) * amp,
    y + (rand() * 2 - 1) * amp,
  ]);
}

function pointsToSmoothPath(points: [number, number][], close: boolean): string {
  if (points.length === 0) return "";
  let d = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const mx = (cx + points[i + 1][0]) / 2;
    const my = (cy + points[i + 1][1]) / 2;
    d += `Q${cx.toFixed(2)} ${cy.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const [lx, ly] = points[points.length - 1];
  d += `L${lx.toFixed(2)} ${ly.toFixed(2)}`;
  return close ? `${d}Z` : d;
}

export function handDoubleRoundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  seed: number,
  roughness = 0.85,
): { fillPath: string; outlinePath: string } {
  const pts = roundedRectPoints(x, y, w, h, r);
  const rand = mulberry32(seed);
  const amp1 = 1.15 * roughness;
  const amp2 = 1.65 * roughness;
  const pass1 = pointsToSmoothPath(jitterPoints(pts, rand, amp1), true);
  const pass2 = pointsToSmoothPath(jitterPoints(pts, rand, amp2), true);
  return {
    fillPath: pass1,
    outlinePath: pass1 + pass2,
  };
}

export function handDoubleCircle(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  roughness = 0.85,
): { fillPath: string; outlinePath: string } {
  const pts = ellipseSegment(cx, cy, rx, ry, 0, Math.PI * 2, 14).slice(0, -1);
  const rand = mulberry32(seed);
  const amp1 = 1.1 * roughness;
  const amp2 = 1.6 * roughness;
  const pass1 = pointsToSmoothPath(jitterPoints(pts, rand, amp1), true);
  const pass2 = pointsToSmoothPath(jitterPoints(pts, rand, amp2), true);
  return {
    fillPath: pass1,
    outlinePath: pass1 + pass2,
  };
}

export function handDoubleLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  roughness = 0.85,
): string {
  const pts = sampleSegment(x1, y1, x2, y2);
  const rand = mulberry32(seed);
  const amp1 = 1.05 * roughness;
  const amp2 = 1.5 * roughness;
  return (
    pointsToSmoothPath(jitterPoints(pts, rand, amp1), false) +
    pointsToSmoothPath(jitterPoints(pts, rand, amp2), false)
  );
}

function hasCustomInlineBackground(el: HTMLElement): boolean {
  const bg = el.style.background || el.style.backgroundColor || el.style.backgroundImage;
  if (!bg) return false;
  return !bg.includes("data:image/svg+xml");
}

function classifyElement(el: HTMLElement): SketchKind | null {
  if (el.dataset.noDrawably !== undefined) return null;
  if (el.classList.contains("drawably-host")) return null;
  if (el.closest("[data-no-drawably], [data-canvas-handle], .monaco-editor")) return null;
  if (hasCustomInlineBackground(el)) return null;

  const tag = el.tagName;
  if (tag === "HR") return "divider";

  const cls = typeof el.className === "string" ? el.className : "";

  // No alterar recuadros de vista previa blancos ni lienzos principales
  if (cls.includes("bg-white") && !cls.includes("bg-card")) return null;

  // Barras estructurales (cabecera, barra de herramientas, barra lateral)
  if (cls.includes("app-header") || (tag === "HEADER" && cls.includes("editor-bar"))) {
    return "bar-bottom";
  }
  if (cls.includes("editor-rail")) {
    return "bar-right";
  }
  if ((tag === "NAV" || tag === "DIV") && cls.includes("editor-bar")) {
    return "bar-top";
  }

  // Chips e insignias
  if (cls.includes("m3-chip") || cls.includes("chip")) {
    if (
      cls.includes("m3-chip-selected") ||
      el.getAttribute("aria-selected") === "true" ||
      el.dataset.state === "active"
    ) {
      return "chip-selected";
    }
    return "chip";
  }

  if (el.hasAttribute("data-tag") || (tag === "SPAN" && cls.includes("rounded-md") && cls.includes("bg-primary/10"))) {
    return "badge";
  }

  // Botones y enlaces con aspecto de botón
  if (
    tag === "BUTTON" ||
    (tag === "A" &&
      /btn|button|bg-primary|grad-brand|m3-btn|glass-btn|glass-control|bg-card|border/.test(cls))
  ) {
    if (cls.includes("pick-cell")) return null;

    if (
      cls.includes("bg-primary") ||
      cls.includes("btn-grad") ||
      cls.includes("grad-brand") ||
      (cls.includes("m3-btn") && !cls.includes("m3-btn-outlined"))
    ) {
      return "button-solid";
    }

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const isRound =
      (cls.includes("rounded-full") || cls.includes("m3-icon-btn")) &&
      w > 0 &&
      h > 0 &&
      Math.abs(w - h) <= 8 &&
      w <= 56;

    if (isRound) {
      return "button-circle";
    }

    if (cls.includes("rounded-full")) {
      if (cls.includes("border-transparent") && !cls.includes("bg-card") && !cls.includes("bg-muted")) {
        return "button-pill";
      }
      return "chip";
    }

    if (
      cls.includes("glass-btn") ||
      cls.includes("glass-control") ||
      cls.includes("m3-btn-outlined") ||
      cls.includes("m3-icon-btn") ||
      cls.includes("neu-btn") ||
      cls.includes("editor-fab") ||
      cls.includes("bg-card") ||
      cls.includes("bg-secondary") ||
      cls.includes("bg-muted") ||
      cls.includes("bg-surface") ||
      (cls.includes("border") && !cls.includes("border-transparent"))
    ) {
      return "button-outline";
    }

    if (
      cls.includes("after:bg-primary") ||
      cls.includes("before:bg-primary") ||
      el.getAttribute("aria-selected") === "true" ||
      el.getAttribute("aria-current") === "page"
    ) {
      return "tab-active";
    }

    return null;
  }

  // Tarjetas, paneles, superficies, diálogos, menús
  if (
    cls.includes("m3-card") ||
    cls.includes("m3-card-outlined") ||
    cls.includes("glass-surface") ||
    cls.includes("glass-menu") ||
    (cls.includes("glass") && !cls.includes("glass-header") && !cls.includes("glass-menu-drawer")) ||
    cls.includes("panel") ||
    cls.includes("surface") ||
    cls.includes("auth-card") ||
    cls.includes("tile-blueprint") ||
    cls.includes("editor-fab-group") ||
    cls.includes("plus-glass-card") ||
    cls.includes("plus-glass-hero") ||
    cls.includes("plus-glass-note") ||
    cls.includes("notification-summary-surface") ||
    cls.includes("notification-category-panel") ||
    cls.includes("notification-empty-state") ||
    el.getAttribute("role") === "dialog" ||
    el.getAttribute("role") === "menu" ||
    el.getAttribute("role") === "listbox" ||
    ((tag === "ARTICLE" || tag === "SECTION" || tag === "DIV") &&
      (cls.includes("bg-card") || cls.includes("bg-surface")) &&
      cls.includes("border"))
  ) {
    if (cls.includes("inset-0") && cls.includes("fixed")) return null;
    return "card";
  }

  return null;
}

function toSvgDataUrl(w: number, h: number, body: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}'>${body}</svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}")`;
}

function renderSketchPaths(inst: SketchInstance, el: HTMLElement, w: number, h: number) {
  const kind = classifyElement(el);
  if (!kind || w < 14 || h < 10) {
    if (inst.lastKind) {
      el.classList.remove(`drawably-kind-${inst.lastKind}`);
    }
    inst.lastKind = null;
    el.classList.remove("drawably-auto-host");
    el.style.removeProperty("--drawably-svg-bg");
    el.style.removeProperty("--drawably-svg-bg-hover");
    return;
  }

  if (
    inst.lastKind === kind &&
    Math.abs(w - inst.lastW) < 1 &&
    Math.abs(h - inst.lastH) < 1
  ) {
    return;
  }

  if (inst.lastKind && inst.lastKind !== kind) {
    el.classList.remove(`drawably-kind-${inst.lastKind}`);
  }
  el.classList.add("drawably-auto-host", `drawably-kind-${kind}`);

  inst.lastW = w;
  inst.lastH = h;
  inst.lastKind = kind;

  const isDark = document.documentElement.classList.contains("dark");
  const ink = isDark ? "#e7e5e0" : "#18181b";
  const ink2 = isDark ? "#b8b4ac" : "#474645";
  const pen = isDark ? "#7c7aff" : "#2724d1";
  const isDialog =
    el.getAttribute("role") === "dialog" ||
    el.getAttribute("role") === "menu" ||
    el.getAttribute("role") === "listbox";
  const cardFill = isDialog
    ? isDark
      ? "#272623"
      : "#efeeea"
    : isDark
      ? "#252422"
      : "#ebeae6";
  const hoverFill = isDark ? "#2f2e3b" : "#dcdbe8";
  const pillFill = isDark ? "rgba(231,229,224,0.05)" : "rgba(24,24,27,0.04)";
  const washFill = isDark ? "rgba(124,122,255,0.18)" : "rgba(39,36,209,0.14)";
  const shadowFill = isDark ? "rgba(0,0,0,0.52)" : "rgba(24,24,27,0.16)";

  // 1. Divisores y bordes de barras
  if (kind === "divider") {
    const d = handDoubleLine(2, h / 2, w - 2, h / 2, inst.seed, 0.8);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<path d='${d}' fill='none' stroke='${ink}' stroke-width='1.55' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  if (kind === "bar-bottom") {
    const d = handDoubleLine(0, h - 1.5, w, h - 1.5, inst.seed, 0.75);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<rect width='${w}' height='${h}' fill='${cardFill}'/><path d='${d}' fill='none' stroke='${ink}' stroke-width='1.55' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  if (kind === "bar-top") {
    const d = handDoubleLine(0, 1.5, w, 1.5, inst.seed, 0.75);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<rect width='${w}' height='${h}' fill='${cardFill}'/><path d='${d}' fill='none' stroke='${ink}' stroke-width='1.55' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  if (kind === "bar-right") {
    const d = handDoubleLine(w - 1.5, 0, w - 1.5, h, inst.seed, 0.75);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<rect width='${w}' height='${h}' fill='${cardFill}'/><path d='${d}' fill='none' stroke='${ink}' stroke-width='1.55' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  // 2. Pestañas activas
  if (kind === "tab-active") {
    const padX = Math.max(6, w * 0.16);
    const d = handDoubleLine(padX, h - 3, w - padX, h - 3, inst.seed, 0.85);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<path d='${d}' fill='none' stroke='${pen}' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  // 3. Botones circulares
  if (kind === "button-circle") {
    const rx = Math.max(4, w / 2 - INSET);
    const ry = Math.max(4, h / 2 - INSET);
    const { fillPath, outlinePath } = handDoubleCircle(w / 2, h / 2, rx, ry, inst.seed, 0.85);
    el.style.setProperty(
      "--drawably-svg-bg",
      toSvgDataUrl(
        w,
        h,
        `<path d='${fillPath}' fill='${cardFill}'/><path d='${outlinePath}' fill='none' stroke='${ink}' stroke-width='1.65' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    el.style.setProperty(
      "--drawably-svg-bg-hover",
      toSvgDataUrl(
        w,
        h,
        `<path d='${fillPath}' fill='${hoverFill}'/><path d='${outlinePath}' fill='none' stroke='${ink}' stroke-width='1.65' stroke-linecap='round' stroke-linejoin='round'/>`,
      ),
    );
    return;
  }

  // 4. Rectángulos redondeados / píldoras / tarjetas / botones sólidos
  const r =
    kind === "chip" || kind === "chip-selected" || kind === "button-pill"
      ? Math.min(18, Math.floor(h / 2) - 2)
      : kind === "badge"
        ? 4
        : kind === "card"
          ? 11
          : Math.min(9, Math.floor(h / 2) - 2);

  const roughness = kind === "card" ? 0.78 : kind === "badge" ? 0.65 : 0.88;
  const boxW = Math.max(4, w - 2 * INSET);
  const boxH = Math.max(4, h - 2 * INSET);

  const { fillPath, outlinePath } = handDoubleRoundedRect(
    INSET,
    INSET,
    boxW,
    boxH,
    r,
    inst.seed,
    roughness,
  );

  let shadowMarkup = "";
  if (kind === "card" || kind === "button-solid" || kind === "button-outline") {
    const tr = kind === "card" ? "translate(2.5 3)" : "translate(2 2.2)";
    shadowMarkup = `<path d='${fillPath}' transform='${tr}' fill='${shadowFill}'/>`;
  }

  const fillVal =
    kind === "button-solid"
      ? pen
      : kind === "chip-selected"
        ? washFill
        : kind === "button-pill"
          ? pillFill
          : cardFill;

  const fillMarkup =
    kind === "button-solid"
      ? `<path d='${fillPath}' fill='${pen}' stroke='${pen}' stroke-width='2'/>`
      : `<path d='${fillPath}' fill='${fillVal}'/>`;

  let scribbleMarkup = "";
  if (kind === "button-solid" || kind === "chip-selected") {
    const scribbleD = scribbleFill(
      INSET + 3,
      INSET + 3,
      Math.max(4, boxW - 6),
      Math.max(4, boxH - 6),
      { seed: inst.seed + 101, roughness: 0.45, boil: 0 },
    );
    if (scribbleD) {
      const scStroke =
        kind === "button-solid" ? "rgba(255,255,255,0.24)" : "rgba(39,36,209,0.18)";
      const scWidth = kind === "button-solid" ? "1.35" : "1.25";
      scribbleMarkup = `<path d='${scribbleD}' fill='none' stroke='${scStroke}' stroke-width='${scWidth}'/>`;
    }
  }

  const strokeColor =
    kind === "chip-selected" || kind === "badge"
      ? pen
      : kind === "button-pill"
        ? ink2
        : ink;
  const strokeWidth =
    kind === "button-solid"
      ? "1.85"
      : kind === "chip-selected" || kind === "badge"
        ? "1.75"
        : kind === "button-pill"
          ? "1.35"
          : "1.65";

  const outlineMarkup = `<path d='${outlinePath}' fill='none' stroke='${strokeColor}' stroke-width='${strokeWidth}' stroke-linecap='round' stroke-linejoin='round'/>`;

  el.style.setProperty(
    "--drawably-svg-bg",
    toSvgDataUrl(w, h, `${shadowMarkup}${fillMarkup}${scribbleMarkup}${outlineMarkup}`),
  );

  if (kind === "button-outline" || kind === "button-pill" || kind === "chip") {
    el.style.setProperty(
      "--drawably-svg-bg-hover",
      toSvgDataUrl(
        w,
        h,
        `${shadowMarkup}<path d='${fillPath}' fill='${hoverFill}'/>${outlineMarkup}`,
      ),
    );
  }
}

function attachOrUpdateDrawablySketch(el: HTMLElement) {
  const existing = sketchedElements.get(el);
  if (existing) {
    renderSketchPaths(existing, el, el.offsetWidth, el.offsetHeight);
    return;
  }

  const kind = classifyElement(el);
  if (!kind) return;

  const cs = window.getComputedStyle(el);
  if (cs.display === "inline" || cs.display === "contents") return;

  const labelSeed = (
    el.getAttribute("aria-label") ||
    el.textContent ||
    el.className ||
    el.tagName
  ).slice(0, 40);
  const seed = hashStringSeed(labelSeed);

  const inst: SketchInstance = {
    seed,
    lastW: 0,
    lastH: 0,
    lastKind: null,
    ro: new ResizeObserver(() => {
      renderSketchPaths(inst, el, el.offsetWidth, el.offsetHeight);
    }),
  };

  sketchedElements.set(el, inst);
  renderSketchPaths(inst, el, el.offsetWidth, el.offsetHeight);
  inst.ro.observe(el);
}

function attachInputSketch(el: HTMLElement) {
  if (sketchedInputs.has(el)) return;
  if (el.closest("[data-no-drawably], .glass-control, .search-field, .drawably-inputbox, .drawably-select, .drawably-textarea")) {
    return;
  }
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (["checkbox", "radio", "range", "color", "file", "hidden"].includes(type)) {
    return;
  }

  const seed = hashStringSeed(el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName);

  const updateBg = () => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 24 || h < 18) return;
    const isDark = document.documentElement.classList.contains("dark");
    const stroke = isDark ? "%23e7e5e0" : "%2318181b";
    const fill = isDark ? "%2322211f" : "%23efeeea";
    const { fillPath, outlinePath } = handDoubleRoundedRect(
      2,
      2,
      w - 4,
      h - 4,
      7,
      seed,
      0.8,
    );
    const svgData = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}'><path d='${fillPath}' fill='${fill}'/><path d='${outlinePath}' fill='none' stroke='${stroke}' stroke-width='1.55' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
    el.style.backgroundImage = `url("data:image/svg+xml;utf8,${svgData}")`;
    el.style.backgroundRepeat = "no-repeat";
    el.style.backgroundSize = "100% 100%";
    el.classList.add("drawably-sketched-input");
  };

  const ro = new ResizeObserver(updateBg);
  sketchedInputs.set(el, ro);
  updateBg();
  ro.observe(el);
}

const CANDIDATE_SELECTOR = [
  "button",
  'a[class*="btn"]',
  'a[class*="bg-primary"]',
  'a[class*="bg-card"]',
  'a[class*="border"]',
  ".m3-card",
  ".m3-card-outlined",
  ".glass",
  ".glass-surface",
  ".glass-menu",
  ".glass-btn",
  ".glass-control",
  ".panel",
  ".surface",
  ".m3-chip",
  ".chip",
  ".auth-card",
  ".tile-blueprint",
  ".editor-fab-group",
  ".plus-glass-card",
  ".plus-glass-hero",
  ".plus-glass-note",
  ".notification-summary-surface",
  ".notification-category-panel",
  ".notification-empty-state",
  ".app-header",
  ".editor-bar",
  ".editor-rail",
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-tag]",
  "hr",
].join(", ");

function scanSubtree(root: ParentNode) {
  if (root instanceof HTMLElement) {
    if (root.matches("input, textarea, select")) {
      attachInputSketch(root);
    } else {
      attachOrUpdateDrawablySketch(root);
    }
  }
  const candidates = root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR);
  candidates.forEach((el) => attachOrUpdateDrawablySketch(el));

  const inputs = root.querySelectorAll<HTMLElement>("input, textarea, select");
  inputs.forEach((inp) => attachInputSketch(inp));
}

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
        if (m.type === "attributes" && m.target instanceof HTMLElement) {
          pendingNodes.add(m.target);
          continue;
        }
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            pendingNodes.add(node);
          }
        });
      }
      if (pendingNodes.size > 0 && !rafId) {
        rafId = requestAnimationFrame(flushPending);
      }
    });

    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-selected", "aria-current", "data-state"],
    });

    void randomSeed;

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
        <filter id="drawably-pencil-icon" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="9" result="inkNoise" />
          <feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="1.05" xChannelSelector="R" yChannelSelector="G" result="pass1" />
          <feOffset in="SourceGraphic" dx="0.65" dy="0.5" result="shifted" />
          <feDisplacementMap in="shifted" in2="inkNoise" scale="0.75" xChannelSelector="G" yChannelSelector="R" result="pass2" />
          <feComponentTransfer in="pass2" result="pass2Ink">
            <feFuncA type="linear" slope="0.52" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="pass2Ink" />
            <feMergeNode in="pass1" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
