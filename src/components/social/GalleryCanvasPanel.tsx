import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pencil, Eraser, PaintBucket, Slash, Square, Circle, Pipette, Type, Move,
  Eye, EyeOff, Lock, Unlock, Trash2, Layers, Undo2, Redo2, Plus, Save, X,
} from "lucide-react";
import type { SpriteAsset } from "@/lib/engine/core";
import { uid } from "@/lib/engine/core";
import {
  STABILIZE_DEFAULT,
  STABILIZE_MAX,
  STABILIZE_MIN,
  advanceStabilizer,
  createStabilizerState,
  refineStrokePath,
  stabilizePoint,
  type StabilizerState,
  type StrokePoint,
} from "@/lib/engine/paint-stabilizer";
import { drawBrushPath, mirrorStrokePoints, type BrushStrokeOptions, type SymmetryMode } from "@/lib/engine/paint-brush";
import {
  LAYER_BLEND_MODES,
  computeRotationAngle,
  computeScaledBox,
  cursorForHandle,
  drawSelectionMarquee,
  drawSymmetryGuides,
  drawTransformGizmo,
  findLassoPixelBounds,
  findNonEmptyPixelBounds,
  floodFillImageData,
  hitTestTransformGizmo,
  pointInPolygon,
  type FillGradientMode,
  type LayerBlendMode,
  type SelectionMode,
  type TransformBox,
  type TransformHandle,
} from "@/lib/engine/paint-transform";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Tool = "brush" | "eraser" | "fill" | "line" | "rect" | "circle" | "picker" | "text" | "move";

interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: LayerBlendMode;
  alphaLock?: boolean;
  canvas: HTMLCanvasElement;
}

interface FloatingRaster {
  layerId: string;
  sourceCanvas: HTMLCanvasElement;
  box: TransformBox;
}

function drawFloatingRaster(ctx: CanvasRenderingContext2D, floating: FloatingRaster) {
  const { box, sourceCanvas } = floating;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (box.rotation) ctx.rotate(box.rotation);
  ctx.scale(box.flipX ? -1 : 1, box.flipY ? -1 : 1);
  ctx.drawImage(sourceCanvas, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

interface PendingConfirm {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => void;
}

const SIZE_OPTIONS = [128, 256, 512, 768, 1024];

const PALETTES: { name: string; colors: string[] }[] = [
  {
    name: "Neon",
    colors: [
      "#000000", "#1f2937", "#6b7280", "#f8fafc",
      "#ef4444", "#f97316", "#fbbf24", "#22c55e",
      "#06b6d4", "#38bdf8", "#3b82f6", "#8b5cf6",
      "#ec4899", "#7c2d12", "#fde68a", "#0ea5e9",
    ],
  },
  {
    name: "Pastel",
    colors: [
      "#ffffff", "#fde2e4", "#fad2e1", "#e2ece9",
      "#bee1e6", "#cddafd", "#dfe7fd", "#f0efeb",
      "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff",
      "#a0c4ff", "#bdb2ff", "#ffc6ff", "#fffffc",
    ],
  },
  {
    name: "Retro 8-bit",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
      "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
      "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
  },
  {
    name: "Earth",
    colors: [
      "#2d1b0e", "#5c3a1e", "#8b5a2b", "#c08552",
      "#dab49d", "#f3e9dc", "#606c38", "#283618",
      "#bc6c25", "#dda15e", "#fefae0", "#a98467",
      "#6f4518", "#3f2d20", "#b08968", "#ddb892",
    ],
  },
  {
    name: "Mono",
    colors: [
      "#000000", "#111111", "#222222", "#333333",
      "#444444", "#555555", "#666666", "#777777",
      "#888888", "#999999", "#aaaaaa", "#bbbbbb",
      "#cccccc", "#dddddd", "#eeeeee", "#ffffff",
    ],
  },
];

const FONTS = ["Rajdhani", "Orbitron", "JetBrains Mono", "Georgia", "Arial"];

interface Props {
  onSave: (sprite: SpriteAsset) => void;
  onClose: () => void;
}

export function GalleryCanvasPanel({ onSave, onClose }: Props) {
  const [size, setSize] = useState<number>(512);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#38bdf8");
  const [secondaryColor] = useState("#a855f7");
  const [gradientMode] = useState<FillGradientMode>("solid");
  const [width, setWidth] = useState(6);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSoftness, setBrushSoftness] = useState(0);
  const [fillTolerance, setFillTolerance] = useState(90);
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>("none");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [name, setName] = useState("Mi obra");
  const [stabilizeLevel, setStabilizeLevel] = useState(STABILIZE_DEFAULT);
  const [pressureOn, setPressureOn] = useState(true);
  const [paletteIdx] = useState(0);
  const PALETTE = PALETTES[paletteIdx].colors;
  const [previewVersion, setPreviewVersion] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [fitSide, setFitSide] = useState<number>(360);
  const [hoverHandle, setHoverHandle] = useState<TransformHandle | null>(null);
  const floatingRasterRef = useRef<FloatingRaster | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);

  // text overlay state
  const [textInput, setTextInput] = useState<{
    open: boolean; x: number; y: number; value: string; fontSize: number; font: string;
  } | null>(null);

  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // ---------- Layers ----------
  const makeLayerCanvas = (): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return c;
  };
  const [layers, setLayers] = useState<PaintLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>("");
  const layersRef = useRef<PaintLayer[]>([]);
  const activeLayerIdRef = useRef("");
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);
  const activeLayer = () => layersRef.current.find(l => l.id === activeLayerIdRef.current) ?? null;

  const undoStack = useRef<{ layerId: string; dataUrl: string; imageData?: ImageData }[]>([]);
  const redoStack = useRef<{ layerId: string; dataUrl: string; imageData?: ImageData }[]>([]);
  const activePointerId = useRef<number | null>(null);
  const activePointers = useRef<Set<number>>(new Set());
  const strokeBackup = useRef<HTMLCanvasElement | null>(null);
  const strokeBackupLayerId = useRef<string | null>(null);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const stabilizerRef = useRef<StabilizerState | null>(null);
  const activeWidthRef = useRef<number>(6);

  const commitFloatingRaster = (recomp = true) => {
    const floating = floatingRasterRef.current;
    if (!floating) return;
    const layer = layersRef.current.find(l => l.id === floating.layerId);
    if (layer) {
      const ctx = layer.canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      drawFloatingRaster(ctx, floating);
    }
    floatingRasterRef.current = null;
    if (recomp) {
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
    }
  };

  useEffect(() => {
    if (tool !== "move" && floatingRasterRef.current) {
      commitFloatingRaster();
    }
    if (tool !== "move") setHoverHandle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useEffect(() => {
    if (floatingRasterRef.current && floatingRasterRef.current.layerId !== activeLayerId) {
      commitFloatingRaster();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerId]);

  useEffect(() => {
    const buf = document.createElement("canvas");
    buf.width = size; buf.height = size;
    const bctx = buf.getContext("2d")!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bufferRef.current = buf;
    floatingRasterRef.current = null;
    const initId = uid();
    const firstLayer: PaintLayer = {
      id: initId,
      name: "Capa 1",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      alphaLock: false,
      canvas: makeLayerCanvas(),
    };
    layersRef.current = [firstLayer];
    activeLayerIdRef.current = initId;
    setLayers([firstLayer]);
    setActiveLayerId(initId);
    recomposite();
    blit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      const side = Math.max(120, Math.floor(Math.min(vp.clientWidth - 8, vp.clientHeight - 8)));
      setFitSide(side);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => blit());
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    blit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSide, size, symmetryMode]);

  const recomposite = () => {
    const buf = bufferRef.current; if (!buf) return;
    const c = buf.getContext("2d")!;
    c.clearRect(0, 0, size, size);
    const floating = floatingRasterRef.current;
    for (const l of layersRef.current) {
      if (!l.visible) continue;
      c.globalAlpha = Math.max(0, Math.min(1, l.opacity));
      c.globalCompositeOperation = l.blendMode ?? "source-over";
      c.drawImage(l.canvas, 0, 0);
      if (floating && floating.layerId === l.id) {
        drawFloatingRaster(c, floating);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  };

  const captureLayerImageData = (layer: PaintLayer): ImageData | undefined => {
    try {
      return layer.canvas.getContext("2d")!.getImageData(0, 0, size, size);
    } catch {
      return undefined;
    }
  };

  const pushSnapshot = () => {
    const layer = activeLayer(); if (!layer) return;
    undoStack.current.push({
      layerId: layer.id,
      dataUrl: layer.canvas.toDataURL("image/png"),
      imageData: captureLayerImageData(layer),
    });
    if (undoStack.current.length > 32) undoStack.current.shift();
    redoStack.current = [];
    setPreviewVersion(v => v + 1);
  };

  const captureStrokeBackup = () => {
    const layer = activeLayer();
    if (!layer) return;
    let backup = strokeBackup.current;
    if (!backup) { backup = document.createElement("canvas"); strokeBackup.current = backup; }
    if (backup.width !== size || backup.height !== size) { backup.width = size; backup.height = size; }
    const c = backup.getContext("2d")!;
    c.clearRect(0, 0, size, size);
    c.drawImage(layer.canvas, 0, 0);
    strokeBackupLayerId.current = layer.id;
  };

  const getBrushStrokeOptions = (): BrushStrokeOptions => {
    const layer = activeLayer();
    return {
      opacity: brushOpacity,
      softness: brushSoftness,
      alphaLock: !!layer?.alphaLock,
      symmetry: symmetryMode,
      canvasW: size,
      canvasH: size,
    };
  };

  const redrawActiveCurve = (erase: boolean, straightLine = false) => {
    const layer = activeLayer();
    const backup = strokeBackup.current;
    if (!layer || !backup || strokeBackupLayerId.current !== layer.id) return false;
    const c = layer.canvas.getContext("2d")!;
    c.clearRect(0, 0, size, size);
    c.drawImage(backup, 0, 0);
    const rawPts = activePointsRef.current;
    const ptsToDraw = straightLine && rawPts.length >= 2
      ? [rawPts[0], rawPts[rawPts.length - 1]]
      : (!erase && stabilizeLevel > 0 ? refineStrokePath(rawPts, stabilizeLevel) : rawPts);
    drawBrushPath(c, "round", color, activeWidthRef.current, ptsToDraw, erase, getBrushStrokeOptions());
    return true;
  };

  const displayScale = useRef<number>(1);
  const dragRect = useRef<DOMRect | null>(null);

  const blit = (preview?: (ctx: CanvasRenderingContext2D) => void) => {
    const c = canvasRef.current; const buf = bufferRef.current;
    if (!c || !buf) return;
    const ctx = c.getContext("2d")!;
    const W = c.clientWidth;
    if (W <= 0) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(W * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(buf, 0, 0, W, W);
    displayScale.current = W / size;
    if (symmetryMode !== "none") {
      drawSymmetryGuides(ctx, symmetryMode, size, size, displayScale.current);
    }
    if (floatingRasterRef.current) {
      drawTransformGizmo(ctx, floatingRasterRef.current.box, displayScale.current);
    }
    if (preview) {
      ctx.save();
      ctx.scale(displayScale.current, displayScale.current);
      preview(ctx);
      ctx.restore();
    }
  };

  const getPos = (e: React.PointerEvent) => {
    const r = dragRect.current ?? canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * size,
      y: ((e.clientY - r.top) / r.height) * size,
    };
  };

  const drag = useRef<{
    active: boolean; tool: Tool;
    last: { x: number; y: number };
    start: { x: number; y: number };
    smooth: { x: number; y: number };
    transformHandle?: TransformHandle | "marquee-rect" | "marquee-lasso" | null;
    transformStartBox?: TransformBox | null;
  }>({ active: false, tool: "brush", last: { x: 0, y: 0 }, start: { x: 0, y: 0 }, smooth: { x: 0, y: 0 } });
  const bctx = (): CanvasRenderingContext2D => {
    const layer = activeLayer();
    if (!layer) return bufferRef.current!.getContext("2d")!;
    return layer.canvas.getContext("2d")!;
  };
  const isLayerEditable = () => {
    const l = activeLayer();
    return !!l && l.visible && !l.locked;
  };

  const strokeSegment = (x0: number, y0: number, x1: number, y1: number, erase: boolean, w?: number) => {
    const c = bctx();
    drawBrushPath(
      c,
      "round",
      color,
      w ?? width,
      [
        { x: x0, y: y0, w: w ?? width },
        { x: x1, y: y1, w: w ?? width },
      ],
      erase,
      getBrushStrokeOptions(),
    );
  };

  const stampDot = (x: number, y: number, erase: boolean, w?: number) => {
    const c = bctx();
    drawBrushPath(
      c,
      "round",
      color,
      w ?? width,
      [{ x, y, w: w ?? width }],
      erase,
      getBrushStrokeOptions(),
    );
  };

  const floodFill = (sx: number, sy: number, hex: string) => {
    const c = bctx();
    const layer = activeLayer();
    const img = c.getImageData(0, 0, size, size);
    const fillPoint = (px: number, py: number) => {
      floodFillImageData(img.data, size, size, px, py, hex, {
        tolerance: fillTolerance,
        alphaLock: !!layer?.alphaLock,
        gradientMode,
        secondaryColor,
      });
    };
    const axes = mirrorStrokePoints([{ x: sx, y: sy, w: 1 }], symmetryMode, size, size);
    for (const axis of axes) {
      if (axis.length > 0) fillPoint(axis[0].x, axis[0].y);
    }
    c.putImageData(img, 0, 0);
  };

  const drawPreviewShape = (ctx: CanvasRenderingContext2D, t: Tool, x0: number, y0: number, x1: number, y1: number) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (t === "line") {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    } else if (t === "rect") {
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (t === "circle") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };

  const commitShape = (t: Tool, x0: number, y0: number, x1: number, y1: number) => {
    const c = bctx();
    c.save();
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (t === "line") {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    } else if (t === "rect") {
      c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (t === "circle") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  };

  const pickColorAt = (x: number, y: number) => {
    const buf = bufferRef.current; if (!buf) return;
    const c = buf.getContext("2d")!;
    const d = c.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    if (d[3] === 0) return;
    const hex = "#" + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, "0")).join("");
    setColor(hex);
  };

  const cancelStroke = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    floatingRasterRef.current = null;
    lassoPointsRef.current = [];
    activePointsRef.current = [];
    stabilizerRef.current = null;
    const backup = strokeBackupLayerId.current ? strokeBackup.current : null;
    const backupLayerId = strokeBackupLayerId.current;
    strokeBackupLayerId.current = null;
    const prev = undoStack.current.pop();
    if (!prev) return;
    const layer = layersRef.current.find(l => l.id === prev.layerId);
    if (!layer) return;
    if (backup && backupLayerId === layer.id) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.drawImage(backup, 0, 0);
      recomposite();
      blit();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.drawImage(img, 0, 0);
      recomposite(); blit();
    };
    img.src = prev.dataUrl;
  };

  const onDown = (e: React.PointerEvent) => {
    activePointers.current.add(e.pointerId);
    if (activePointers.current.size > 1) {
      cancelStroke();
      activePointerId.current = null;
      return;
    }
    activePointerId.current = e.pointerId;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRect.current = canvasRef.current!.getBoundingClientRect();
    blit();
    const p = getPos(e);
    if (tool === "picker") { pickColorAt(p.x, p.y); dragRect.current = null; return; }
    if (tool === "text") {
      if (!isLayerEditable()) { dragRect.current = null; return; }
      setTextInput({ open: true, x: p.x, y: p.y, value: "", fontSize: Math.max(16, width * 4), font: "Rajdhani" });
      dragRect.current = null;
      return;
    }
    if (!isLayerEditable()) { dragRect.current = null; return; }
    if (tool === "move") {
      const s = displayScale.current;
      if (floatingRasterRef.current) {
        const floating = floatingRasterRef.current;
        const h = hitTestTransformGizmo(floating.box, p.x, p.y, s);
        if (h) {
          pushSnapshot();
          captureStrokeBackup();
          const isClone = h === "clone" || (h === "body" && e.altKey);
          if (isClone) {
            const layer = layersRef.current.find(l => l.id === floating.layerId);
            if (layer) {
              const ctx = layer.canvas.getContext("2d")!;
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              drawFloatingRaster(ctx, floating);
            }
          }
          drag.current = {
            active: true, tool, last: p, start: p, smooth: p,
            transformHandle: isClone ? (h === "clone" ? "clone" : "body") : h,
            transformStartBox: { ...floating.box },
          };
          recomposite(); blit();
          return;
        }
        commitFloatingRaster(false);
      }
      if (selectionMode === "rect" || selectionMode === "lasso") {
        lassoPointsRef.current = [{ x: p.x, y: p.y }];
        drag.current = {
          active: true,
          tool,
          last: p,
          start: p,
          smooth: p,
          transformHandle: selectionMode === "rect" ? "marquee-rect" : "marquee-lasso",
          transformStartBox: null,
        };
        recomposite(); blit();
        return;
      }
      const layer = activeLayer();
      if (layer) {
        const lctx = layer.canvas.getContext("2d")!;
        const img = lctx.getImageData(0, 0, size, size);
        const bounds = findNonEmptyPixelBounds(img);
        if (bounds) {
          pushSnapshot();
          captureStrokeBackup();
          const srcCanvas = document.createElement("canvas");
          srcCanvas.width = bounds.w;
          srcCanvas.height = bounds.h;
          srcCanvas.getContext("2d")!.drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
          if (!e.altKey) {
            lctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
          }
          const box: TransformBox = {
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
            rotation: 0,
            flipX: false,
            flipY: false,
          };
          floatingRasterRef.current = { layerId: layer.id, sourceCanvas: srcCanvas, box };
          drag.current = {
            active: true, tool, last: p, start: p, smooth: p,
            transformHandle: "body",
            transformStartBox: { ...box },
          };
          recomposite(); blit();
          return;
        }
      }
      dragRect.current = null;
      recomposite(); blit();
      return;
    }
    pushSnapshot();
    captureStrokeBackup();
    drag.current = { active: true, tool, last: p, start: p, smooth: p };
    if (tool === "brush" || tool === "eraser") {
      const erase = tool === "eraser";
      const isPen = e.pointerType === "pen";
      const pr = pressureOn && isPen && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
      const w = erase ? width : width * (pressureOn && isPen ? (0.4 + 1.2 * pr) : 1);
      activeWidthRef.current = w;
      activePointsRef.current = [{ x: p.x, y: p.y, w }];
      stabilizerRef.current = createStabilizerState(p, w);
      stampDot(p.x, p.y, erase, w);
      recomposite();
      blit();
    } else if (tool === "fill") {
      floodFill(p.x, p.y, color);
      recomposite(); blit();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current.active) {
      if (tool === "move" && e.pointerType !== "touch") {
        const p = getPos(e);
        const box = floatingRasterRef.current?.box ?? null;
        const h = box ? hitTestTransformGizmo(box, p.x, p.y, displayScale.current) : null;
        if (h !== hoverHandle) setHoverHandle(h);
      }
      return;
    }
    if (activePointerId.current !== e.pointerId) return;
    if (activePointers.current.size > 1) { cancelStroke(); return; }
    const p = getPos(e);
    if (drag.current.tool === "brush" || drag.current.tool === "eraser") {
      const r = dragRect.current!;
      const events = (typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : []) as PointerEvent[];
      const points = events.length ? events.map(ev => ({
        x: ((ev.clientX - r.left) / r.width) * size,
        y: ((ev.clientY - r.top) / r.height) * size,
        pressure: ev.pressure,
      })) : [{ x: p.x, y: p.y, pressure: e.pressure }];
      const erase = drag.current.tool === "eraser";
      if (erase && !e.shiftKey) {
        let erasedAny = false;
        for (const pt of points) {
          if (Math.hypot(pt.x - drag.current.last.x, pt.y - drag.current.last.y) >= 0.15) {
            strokeSegment(drag.current.last.x, drag.current.last.y, pt.x, pt.y, true, width);
            drag.current.last = { x: pt.x, y: pt.y };
            activePointsRef.current.push({ x: pt.x, y: pt.y, w: width });
            erasedAny = true;
          }
        }
        if (erasedAny) {
          recomposite();
          blit();
        }
        return;
      }
      const isPen = e.pointerType === "pen";
      let addedPoints = false;

      for (const pt of points) {
        const pr = pressureOn && isPen && pt.pressure > 0 && pt.pressure !== 0.5 ? pt.pressure : 0.5;
        const w = width * (pressureOn && isPen ? (0.4 + 1.2 * pr) : 1);
        activeWidthRef.current = activeWidthRef.current * 0.7 + w * 0.3;

        if (stabilizerRef.current && stabilizeLevel > 0) {
          const steps = advanceStabilizer(stabilizerRef.current, pt, activeWidthRef.current, stabilizeLevel, false);
          for (const step of steps) {
            activePointsRef.current.push(step);
            drag.current.last = { x: step.x, y: step.y };
            addedPoints = true;
          }
        } else {
          let x1 = pt.x, y1 = pt.y;
          if (stabilizeLevel > 0) {
            const smoothed = stabilizePoint(drag.current.last, pt, stabilizeLevel);
            x1 = smoothed.x;
            y1 = smoothed.y;
          }
          if (Math.hypot(x1 - drag.current.last.x, y1 - drag.current.last.y) >= 0.25) {
            activePointsRef.current.push({ x: x1, y: y1, w: activeWidthRef.current });
            drag.current.last = { x: x1, y: y1 };
            addedPoints = true;
          }
        }
      }

      if (addedPoints) {
        if (!redrawActiveCurve(erase, e.shiftKey)) {
          const prev = activePointsRef.current[activePointsRef.current.length - 2] ?? drag.current.start;
          strokeSegment(prev.x, prev.y, drag.current.last.x, drag.current.last.y, erase, activeWidthRef.current);
        }
        recomposite();
        blit();
      }
    } else if (drag.current.tool === "line" || drag.current.tool === "rect" || drag.current.tool === "circle") {
      const t = drag.current.tool;
      blit(ctx => drawPreviewShape(ctx, t, drag.current.start.x, drag.current.start.y, p.x, p.y));
    } else if (drag.current.tool === "move") {
      if (drag.current.transformHandle === "marquee-rect") {
        drag.current.last = p;
        blit(ctx => {
          ctx.save();
          ctx.scale(1 / displayScale.current, 1 / displayScale.current);
          drawSelectionMarquee(
            ctx,
            "rect",
            [drag.current.start, p],
            displayScale.current,
          );
          ctx.restore();
        });
        return;
      }
      if (drag.current.transformHandle === "marquee-lasso") {
        const lastPt = lassoPointsRef.current[lassoPointsRef.current.length - 1];
        if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) >= 1.5) {
          lassoPointsRef.current.push({ x: p.x, y: p.y });
        }
        drag.current.last = p;
        blit(ctx => {
          ctx.save();
          ctx.scale(1 / displayScale.current, 1 / displayScale.current);
          drawSelectionMarquee(ctx, "lasso", lassoPointsRef.current, displayScale.current);
          ctx.restore();
        });
        return;
      }
      if (floatingRasterRef.current && drag.current.transformStartBox) {
        const startBox = drag.current.transformStartBox;
        const handle = drag.current.transformHandle as TransformHandle | null;
        if (!handle || handle === "body" || handle === "clone") {
          const dx = Math.round(p.x - drag.current.start.x);
          const dy = Math.round(p.y - drag.current.start.y);
          floatingRasterRef.current.box = { ...startBox, x: startBox.x + dx, y: startBox.y + dy };
        } else if (handle === "rotate") {
          const cx = startBox.x + startBox.w / 2;
          const cy = startBox.y + startBox.h / 2;
          floatingRasterRef.current.box = {
            ...startBox,
            rotation: computeRotationAngle(cx, cy, p.x, p.y, e.shiftKey),
          };
        } else {
          floatingRasterRef.current.box = computeScaledBox(startBox, handle, p.x, p.y, e.shiftKey, 4);
        }
        recomposite(); blit();
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (!drag.current.active) return;
    if (activePointerId.current !== e.pointerId) return;
    const p = getPos(e);
    const t = drag.current.tool;
    if (t === "brush" || t === "eraser") {
      const erase = t === "eraser";
      if (erase && !e.shiftKey) {
        if (Math.hypot(p.x - drag.current.last.x, p.y - drag.current.last.y) >= 0.1) {
          strokeSegment(drag.current.last.x, drag.current.last.y, p.x, p.y, true, width);
        }
        activePointsRef.current = [];
        stabilizerRef.current = null;
        recomposite(); blit();
      } else {
        if (stabilizerRef.current && stabilizeLevel > 0) {
          const tailSteps = advanceStabilizer(stabilizerRef.current, p, activeWidthRef.current, stabilizeLevel, true);
          for (const step of tailSteps) {
            activePointsRef.current.push(step);
            drag.current.last = { x: step.x, y: step.y };
          }
        } else if (Math.hypot(p.x - drag.current.last.x, p.y - drag.current.last.y) >= 0.25) {
          activePointsRef.current.push({ x: p.x, y: p.y, w: activeWidthRef.current });
          drag.current.last = p;
        }
        if (!redrawActiveCurve(erase, e.shiftKey)) {
          strokeSegment(drag.current.last.x, drag.current.last.y, p.x, p.y, erase);
        }
        activePointsRef.current = [];
        stabilizerRef.current = null;
        recomposite(); blit();
      }
    } else if (t === "line" || t === "rect" || t === "circle") {
      commitShape(t, drag.current.start.x, drag.current.start.y, p.x, p.y);
      recomposite(); blit();
    } else if (t === "move") {
      if (drag.current.transformHandle === "marquee-rect") {
        const layer = activeLayer();
        const rx = Math.round(Math.min(drag.current.start.x, p.x));
        const ry = Math.round(Math.min(drag.current.start.y, p.y));
        const rw = Math.round(Math.abs(p.x - drag.current.start.x));
        const rh = Math.round(Math.abs(p.y - drag.current.start.y));
        if (layer && rw >= 3 && rh >= 3) {
          const lctx = layer.canvas.getContext("2d")!;
          const img = lctx.getImageData(0, 0, size, size);
          const bounds = findNonEmptyPixelBounds(img, { x: rx, y: ry, w: rw, h: rh });
          if (bounds) {
            pushSnapshot();
            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = bounds.w;
            srcCanvas.height = bounds.h;
            srcCanvas.getContext("2d")!.drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
            if (!e.altKey) lctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
            floatingRasterRef.current = {
              layerId: layer.id,
              sourceCanvas: srcCanvas,
              box: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotation: 0, flipX: false, flipY: false },
            };
          }
        }
        drag.current.transformHandle = null;
        recomposite(); blit();
      } else if (drag.current.transformHandle === "marquee-lasso") {
        const layer = activeLayer();
        const poly = lassoPointsRef.current;
        lassoPointsRef.current = [];
        if (layer && poly.length >= 3) {
          const lctx = layer.canvas.getContext("2d")!;
          const img = lctx.getImageData(0, 0, size, size);
          const bounds = findLassoPixelBounds(img, poly);
          if (bounds) {
            pushSnapshot();
            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = bounds.w;
            srcCanvas.height = bounds.h;
            const sctx = srcCanvas.getContext("2d")!;
            const subImg = sctx.createImageData(bounds.w, bounds.h);
            for (let y = 0; y < bounds.h; y++) {
              for (let x = 0; x < bounds.w; x++) {
                const gx = bounds.x + x;
                const gy = bounds.y + y;
                if (!pointInPolygon(gx + 0.5, gy + 0.5, poly)) continue;
                const gi = (gy * size + gx) * 4;
                const si = (y * bounds.w + x) * 4;
                subImg.data[si] = img.data[gi];
                subImg.data[si + 1] = img.data[gi + 1];
                subImg.data[si + 2] = img.data[gi + 2];
                subImg.data[si + 3] = img.data[gi + 3];
                if (!e.altKey) img.data[gi + 3] = 0;
              }
            }
            sctx.putImageData(subImg, 0, 0);
            if (!e.altKey) lctx.putImageData(img, 0, 0);
            floatingRasterRef.current = {
              layerId: layer.id,
              sourceCanvas: srcCanvas,
              box: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotation: 0, flipX: false, flipY: false },
            };
          }
        }
        drag.current.transformHandle = null;
        recomposite(); blit();
      } else {
        const tapDist = Math.hypot(p.x - drag.current.start.x, p.y - drag.current.start.y) * displayScale.current;
        if (drag.current.transformHandle === "clone" && tapDist < 6 && floatingRasterRef.current && drag.current.transformStartBox) {
          floatingRasterRef.current.box = {
            ...drag.current.transformStartBox,
            x: drag.current.transformStartBox.x + 12,
            y: drag.current.transformStartBox.y + 12,
          };
        }
        drag.current.transformHandle = null;
        drag.current.transformStartBox = null;
        recomposite(); blit();
      }
    }
    drag.current.active = false;
    activePointerId.current = null;
    dragRect.current = null;
    strokeBackupLayerId.current = null;
    setPreviewVersion(v => v + 1);
  };

  const commitText = () => {
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    if (!isLayerEditable()) { setTextInput(null); return; }
    commitFloatingRaster(false);
    pushSnapshot();
    const c = bctx();
    c.save();
    c.fillStyle = color;
    c.font = `${textInput.fontSize}px "${textInput.font}", sans-serif`;
    c.textBaseline = "top";
    const lines = textInput.value.split("\n");
    lines.forEach((ln, i) => c.fillText(ln, textInput.x, textInput.y + i * textInput.fontSize * 1.1));
    c.restore();
    setTextInput(null);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  const undo = () => {
    if (drag.current.active) {
      drag.current.active = false;
      activePointerId.current = null;
      dragRect.current = null;
      strokeBackupLayerId.current = null;
      activePointsRef.current = [];
      stabilizerRef.current = null;
      lassoPointsRef.current = [];
    }
    floatingRasterRef.current = null;
    const prev = undoStack.current.pop();
    if (!prev) return;
    const layer = layersRef.current.find(l => l.id === prev.layerId);
    if (!layer) { setPreviewVersion(v => v + 1); return; }
    redoStack.current.push({
      layerId: layer.id,
      dataUrl: layer.canvas.toDataURL("image/png"),
      imageData: captureLayerImageData(layer),
    });
    if (prev.imageData) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.putImageData(prev.imageData, 0, 0);
      recomposite(); blit(); setPreviewVersion(v => v + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.drawImage(img, 0, 0);
      recomposite(); blit(); setPreviewVersion(v => v + 1);
    };
    img.src = prev.dataUrl;
  };

  const redo = () => {
    if (drag.current.active) {
      drag.current.active = false;
      activePointerId.current = null;
      dragRect.current = null;
      strokeBackupLayerId.current = null;
      activePointsRef.current = [];
      stabilizerRef.current = null;
      lassoPointsRef.current = [];
    }
    floatingRasterRef.current = null;
    const next = redoStack.current.pop();
    if (!next) return;
    const layer = layersRef.current.find(l => l.id === next.layerId);
    if (!layer) { setPreviewVersion(v => v + 1); return; }
    undoStack.current.push({
      layerId: layer.id,
      dataUrl: layer.canvas.toDataURL("image/png"),
      imageData: captureLayerImageData(layer),
    });
    if (next.imageData) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.putImageData(next.imageData, 0, 0);
      recomposite(); blit(); setPreviewVersion(v => v + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, size, size);
      c.drawImage(img, 0, 0);
      recomposite(); blit(); setPreviewVersion(v => v + 1);
    };
    img.src = next.dataUrl;
  };

  const clearAll = () => {
    if (!isLayerEditable()) return;
    setPendingConfirm({
      title: "¿Limpiar la capa activa?",
      description: "Se borrará el contenido de la capa seleccionada. Puedes deshacerlo.",
      confirmLabel: "LIMPIAR",
      destructive: true,
      action: () => {
        floatingRasterRef.current = null;
        pushSnapshot();
        const c = bctx();
        c.clearRect(0, 0, size, size);
        recomposite(); blit();
        setPreviewVersion(v => v + 1);
      },
    });
  };

  // ---------- Layer operations ----------
  const addLayer = () => {
    commitFloatingRaster(false);
    const newL: PaintLayer = {
      id: uid(),
      name: `Capa ${layersRef.current.length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      alphaLock: false,
      canvas: makeLayerCanvas(),
    };
    const next = [...layersRef.current, newL];
    layersRef.current = next;
    setLayers(next);
    setActiveLayerId(newL.id);
    activeLayerIdRef.current = newL.id;
    recomposite(); blit();
  };

  const updateLayer = (id: string, p: Partial<PaintLayer>) => {
    const next = layersRef.current.map(l => l.id === id ? { ...l, ...p } : l);
    layersRef.current = next;
    setLayers(next);
    recomposite(); blit();
  };

  const doSave = () => {
    commitFloatingRaster(false);
    recomposite();
    const buf = bufferRef.current; if (!buf) return;
    const dataUrl = buf.toDataURL("image/png");
    const asset: SpriteAsset = {
      id: uid(),
      name: name.trim() || "Mi obra",
      width: size,
      height: size,
      fps: 8,
      loop: true,
      frames: [{ id: uid(), layers: [], composite: dataUrl }],
    };
    onSave(asset);
  };

  const thumb = useMemo(() => {
    const buf = bufferRef.current;
    if (!buf) return "";
    try { return buf.toDataURL("image/png"); } catch { return ""; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, layers.length, size]);

  const layerThumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of layers) {
      try { map.set(l.id, l.canvas.toDataURL("image/png")); } catch { map.set(l.id, ""); }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, layers.length, size]);

  const TOOLS: { id: Tool; icon: ReactNode; title: string }[] = [
    { id: "brush", icon: <Pencil size={19} strokeWidth={2} />, title: "Pincel" },
    { id: "eraser", icon: <Eraser size={19} strokeWidth={2} />, title: "Borrador" },
    { id: "fill", icon: <PaintBucket size={19} strokeWidth={2} />, title: "Relleno" },
    { id: "line", icon: <Slash size={19} strokeWidth={2} />, title: "Línea" },
    { id: "rect", icon: <Square size={19} strokeWidth={2} />, title: "Rectángulo" },
    { id: "circle", icon: <Circle size={19} strokeWidth={2} />, title: "Círculo" },
    { id: "picker", icon: <Pipette size={19} strokeWidth={2} />, title: "Cuentagotas" },
    { id: "text", icon: <Type size={19} strokeWidth={2} />, title: "Texto" },
    { id: "move", icon: <Move size={19} strokeWidth={2} />, title: "Mover / Transformar" },
  ];

  const textLeftPct = textInput
    ? Math.max(2, Math.min(Math.max(2, (1 - 196 / Math.max(200, fitSide)) * 100), (textInput.x / size) * 100))
    : 0;
  const textTopPct = textInput
    ? Math.max(2, Math.min(Math.max(2, (1 - 170 / Math.max(200, fitSide)) * 100), (textInput.y / size) * 100))
    : 0;

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-border/40 panel overflow-hidden bg-surface">
      {/* Top bar - compact but usable */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b border-border/30 gap-1.5 shrink-0 bg-muted/50">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div
            className="w-8 h-8 rounded-md shrink-0 overflow-hidden"
            style={{
              backgroundColor: "#e5e7eb",
              backgroundImage: thumb ? `url(${thumb})` : undefined,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
            }}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-input/40 border border-border/40 rounded-md px-2 py-1 text-sm font-medium tracking-tight min-w-0 flex-1 max-w-[120px] focus:outline-none focus:border-primary/40 focus:bg-accent/30 transition"
          />
          <select
            value={size}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (next === size) return;
              const hasContent = layersRef.current.some(l => {
                const ctx = l.canvas.getContext("2d")!;
                const d = ctx.getImageData(0, 0, l.canvas.width, l.canvas.height).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
                return false;
              });
              const applySize = () => {
                undoStack.current = [];
                redoStack.current = [];
                setSize(next);
              };
              if (hasContent) {
                setPendingConfirm({
                  title: "¿Cambiar tamaño del lienzo?",
                  description: "Cambiar el tamaño del lienzo reiniciará el dibujo actual.",
                  confirmLabel: "CONTINUAR",
                  destructive: true,
                  action: applySize,
                });
                return;
              }
              applySize();
            }}
            className="bg-input/40 border border-border/40 rounded-md px-2.5 py-1.5 text-sm font-mono tracking-tight focus:outline-none focus:border-primary/40 tabular-nums shrink-0"
            aria-label="Tamaño del lienzo"
          >
            {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}×{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setLayersOpen(!layersOpen)} title="Capas"
            className={`h-8 px-2.5 rounded-md border transition inline-flex items-center gap-1.5 text-xs font-semibold ${
              layersOpen
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border/50 bg-muted/50 text-foreground/70 hover:text-foreground hover:bg-muted/80"
            }`}
          >
            <Layers size={16} />{layers.length}
          </button>
          <button onClick={onClose} className="h-8 px-2.5 rounded-md border border-border/50 bg-muted/50 text-foreground/70 hover:text-foreground hover:bg-muted/80 transition inline-flex items-center gap-1 text-xs font-semibold">
            <X size={15} />
          </button>
          <button onClick={doSave} className="h-9 px-3.5 rounded-md grad-brand text-primary-foreground hover:shadow-lg hover:shadow-primary/20 transition active:scale-[0.97] inline-flex items-center gap-1.5 text-sm font-semibold shadow-sm">
            <Save size={16} />
            <span className="hidden sm:inline">Publicar</span>
          </button>
        </div>
      </div>

      {/* Main: Canvas + Tools */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Canvas area - max space, properly measured square */}
        <div ref={viewportRef} className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden p-1 relative">
          <div
            ref={containerRef}
            key={`canvas-${size}`}
            className="relative rounded-lg"
            style={{ width: fitSide, height: fitSide }}
          >
            <div
              className="w-full h-full rounded-lg overflow-hidden"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
                backgroundColor: "#ffffff",
              }}
            >
              <canvas
                ref={canvasRef}
                className={`w-full h-full touch-none block ${tool === "move" ? cursorForHandle(hoverHandle) : "cursor-crosshair"}`}
                style={{ touchAction: "none", background: "transparent" }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            </div>

            {textInput?.open && (
              <div
                onPointerDown={e => e.stopPropagation()}
                className="absolute rounded-xl p-2.5 flex flex-col gap-2 z-20"
                style={{
                  left: `${textLeftPct}%`,
                  top: `${textTopPct}%`,
                  maxWidth: "88%",
                  background: "oklch(0.2 0.04 262 / 0.92)",
                  backdropFilter: "blur(20px) saturate(180%)",
                  border: "1px solid oklch(1 0 0 / 0.12)",
                  boxShadow: "0 12px 40px -10px oklch(0 0 0 / 0.6)",
                }}
              >
                <textarea autoFocus value={textInput.value} onChange={(e) => setTextInput({ ...textInput, value: e.target.value })} placeholder="Escribe el texto…" className="bg-muted border border-border rounded-lg px-2 py-1.5 text-[13px] w-44 min-h-[56px] focus:outline-none focus:border-primary/50" />
                <div className="flex items-center gap-1.5">
                  <select value={textInput.font} onChange={(e) => setTextInput({ ...textInput, font: e.target.value })} className="bg-muted border border-border rounded-lg text-[10px] px-2 py-1 flex-1">
                    {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <input type="number" min={8} max={200} value={textInput.fontSize} onChange={(e) => setTextInput({ ...textInput, fontSize: Number(e.target.value) })} className="bg-muted border border-border rounded-lg text-[10px] px-2 py-1 w-12 tabular-nums" />
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setTextInput(null)} className="text-[10px] font-medium px-2 py-1.5 rounded-lg border border-border bg-muted flex-1">Cancelar</button>
                  <button onClick={commitText} className="text-[10px] font-semibold px-2 py-1.5 rounded-lg text-primary-foreground flex-1" style={{ background: "var(--gradient-asternal)" }}>Añadir</button>
                </div>
              </div>
            )}
          </div>

          {/* Floating layers panel - matches gallery canvas styling */}
          {layersOpen && (
            <div
              className="absolute top-1 right-1 z-20 rounded-xl p-2.5 space-y-1.5 w-52 bg-surface border border-border/40 shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wider text-foreground/80 inline-flex items-center gap-1.5">
                  <Layers size={13} /> CAPAS · {layers.length}
                </span>
                <div className="flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); addLayer(); }} className="w-7 h-7 rounded-md flex items-center justify-center text-primary-foreground active:scale-95 transition" style={{ background: "var(--gradient-asternal)" }}>
                    <Plus size={13} strokeWidth={2} />
                  </button>
                  <button onClick={() => setLayersOpen(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted/80 border border-border/40 transition">
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-auto">
                {[...layers].slice().reverse().map((l) => {
                  const isActive = l.id === activeLayerId;
                  const lThumb = layerThumbs.get(l.id) || "";
                  return (
                    <div key={l.id} className={`group rounded-lg p-2 flex flex-col gap-1.5 transition-all cursor-pointer ${
                      isActive
                        ? "bg-primary/15 border border-primary/30"
                        : "bg-muted/40 border border-border/40 hover:bg-muted/60"
                    }`}
                      onClick={() => { setActiveLayerId(l.id); activeLayerIdRef.current = l.id; }}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-7 h-7 rounded-md shrink-0 overflow-hidden" style={{
                          backgroundColor: "#ffffff",
                          backgroundImage: lThumb ? `url(${lThumb})` : undefined,
                          backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat",
                          boxShadow: "inset 0 0 0 1px oklch(0.82 0.01 250 / 0.6)",
                          opacity: l.visible ? 1 : 0.35,
                        }} />
                        <input value={l.name} onChange={(e) => updateLayer(l.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 bg-transparent text-[11px] font-medium focus:outline-none focus:bg-muted/50 rounded px-1.5 py-0.5" />
                        <button onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { alphaLock: !l.alphaLock }); }}
                          title="Bloqueo alfa"
                          className={`w-6 h-6 grid place-items-center rounded-md text-[10px] font-bold transition hover:bg-muted/50 ${l.alphaLock ? "text-primary bg-primary/15" : "text-muted-foreground"}`}>α</button>
                        <button onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }); }}
                          className={`w-6 h-6 grid place-items-center rounded-md transition hover:bg-muted/50 ${l.visible ? "text-primary" : "text-muted-foreground"}`}>{l.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                        <button onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { locked: !l.locked }); }}
                          className={`w-6 h-6 grid place-items-center rounded-md transition hover:bg-muted/50 ${l.locked ? "text-destructive" : "text-muted-foreground"}`}>{l.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                      </div>
                      {isActive && (
                        <select
                          value={l.blendMode ?? "source-over"}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateLayer(l.id, { blendMode: e.target.value as LayerBlendMode })}
                          className="w-full rounded border border-border/50 bg-muted/60 px-1.5 py-0.5 text-[10px]"
                        >
                          {LAYER_BLEND_MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Tools sidebar - legible buttons, compact width */}
        <div className="lg:w-[112px] shrink-0 border-t lg:border-t-0 lg:border-l border-border/30 overflow-y-auto bg-muted/20">
          <div className="p-1.5 space-y-1.5">
            {/* Tool dock */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/80 border border-border/40">
              {TOOLS.map(t => (
                <button key={t.id} title={t.title} onClick={() => setTool(t.id)}
                  className={`h-9 rounded-md transition-all flex items-center justify-center ${
                    tool === t.id
                      ? "text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                  style={tool === t.id ? {
                    background: "var(--gradient-asternal)",
                    boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.25), 0 2px 8px -2px oklch(0.66 0.18 252 / 0.5)",
                  } : undefined}
                >{t.icon}</button>
              ))}
            </div>

            {/* History row */}
            <div className="flex gap-1">
              <button onClick={undo} title="Deshacer" className="flex-1 h-9 rounded-md border border-border/50 bg-muted/30 text-foreground/70 hover:text-foreground hover:bg-muted/60 transition flex items-center justify-center active:scale-95"><Undo2 size={18} /></button>
              <button onClick={redo} title="Rehacer" className="flex-1 h-9 rounded-md border border-border/50 bg-muted/30 text-foreground/70 hover:text-foreground hover:bg-muted/60 transition flex items-center justify-center active:scale-95"><Redo2 size={18} /></button>
              <button onClick={clearAll} title="Limpiar capa" className="flex-1 h-9 rounded-md border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition flex items-center justify-center active:scale-95"><Trash2 size={18} /></button>
            </div>

            {/* Color & Brush Settings */}
            <div className="p-2 rounded-lg bg-muted/50 border border-border/40 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative w-8 h-8 shrink-0">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label="Color picker" />
                  <div className="w-8 h-8 rounded-md pointer-events-none ring-1 ring-white/20" style={{ background: color, boxShadow: "0 2px 8px -4px oklch(0 0 0 / 0.4)" }} />
                </div>
                <input type="text" value={color.toUpperCase()} onChange={(e) => { const v = e.target.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) setColor(v.startsWith("#") ? v : `#${v}`); }}
                  className="bg-input/50 border border-border/50 rounded-md px-1.5 py-1.5 text-xs font-mono w-16 tracking-tight focus:outline-none focus:border-primary/40 uppercase" maxLength={7} aria-label="Hex color" />
              </div>
              <div className="grid grid-cols-8 gap-1">
                {PALETTE.map((c) => (
                  <button key={c} onClick={() => setColor(c)} className="aspect-square rounded-md transition-all min-h-[20px]" style={{
                    background: c,
                    boxShadow: color.toLowerCase() === c.toLowerCase()
                      ? "inset 0 0 0 1.5px white, 0 0 0 2px oklch(0.67 0.14 250 / 0.7)"
                      : "inset 0 0 0 1px oklch(1 0 0 / 0.12)",
                    transform: color.toLowerCase() === c.toLowerCase() ? "scale(1.08)" : undefined,
                  }} aria-label={c} />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground/90 w-14 shrink-0">Grosor</span>
                <input type="range" min={1} max={48} value={width} onChange={e => setWidth(Number(e.target.value))} className="flex-1 accent-primary h-2.5" />
                <span className="font-mono text-primary font-bold w-7 text-right tabular-nums text-sm">{width}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground/90 w-14 shrink-0">Opac.</span>
                <input type="range" min={5} max={100} value={Math.round(brushOpacity * 100)} onChange={e => setBrushOpacity(Number(e.target.value) / 100)} className="flex-1 accent-primary h-2.5" aria-label="Opacidad del pincel" />
                <span className="font-mono text-primary font-bold w-7 text-right tabular-nums text-sm">{Math.round(brushOpacity * 100)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground/90 w-14 shrink-0">Suav.</span>
                <input type="range" min={0} max={100} value={Math.round(brushSoftness * 100)} onChange={e => setBrushSoftness(Number(e.target.value) / 100)} className="flex-1 accent-primary h-2.5" aria-label="Suavidad del pincel" />
                <span className="font-mono text-primary font-bold w-7 text-right tabular-nums text-sm">{Math.round(brushSoftness * 100)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground/90 w-14 shrink-0">Toler.</span>
                <input type="range" min={0} max={255} value={fillTolerance} onChange={e => setFillTolerance(Number(e.target.value))} className="flex-1 accent-primary h-2.5" aria-label="Tolerancia de relleno" />
                <span className="font-mono text-primary font-bold w-7 text-right tabular-nums text-sm">{fillTolerance}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground/90 w-14 shrink-0">Estab.</span>
                <input type="range" min={STABILIZE_MIN} max={STABILIZE_MAX} value={stabilizeLevel} onChange={e => setStabilizeLevel(Number(e.target.value))} className="flex-1 accent-primary h-2.5" aria-label="Nivel de estabilización del lápiz" />
                <span className="font-mono text-primary font-bold w-7 text-right tabular-nums text-sm">{stabilizeLevel}</span>
              </div>
              <div className="grid grid-cols-4 gap-0.5 pt-1">
                {([
                  { id: "none", label: "1x" },
                  { id: "horizontal", label: "H" },
                  { id: "vertical", label: "V" },
                  { id: "quad", label: "4x" },
                ] as const).map(sym => (
                  <button
                    key={sym.id}
                    onClick={() => setSymmetryMode(sym.id)}
                    title={`Simetría ${sym.label}`}
                    className={`h-6 rounded text-[10px] font-semibold transition ${
                      symmetryMode === sym.id
                        ? "bg-primary/20 text-primary border border-primary/40"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sym.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-0.5 pt-0.5">
                {([
                  { id: "auto", label: "Auto" },
                  { id: "rect", label: "Marco" },
                  { id: "lasso", label: "Lazo" },
                ] as const).map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => { setSelectionMode(mode.id); setTool("move"); }}
                    title={`Selección ${mode.label}`}
                    className={`h-6 rounded text-[10px] font-semibold transition ${
                      selectionMode === mode.id
                        ? "bg-primary/20 text-primary border border-primary/40"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <label className="flex items-center justify-between cursor-pointer select-none gap-1.5 flex-1">
                  <span className="text-sm font-semibold text-muted-foreground/90">Pres</span>
                  <span role="switch" aria-checked={pressureOn} onClick={() => setPressureOn(!pressureOn)} className="relative w-10 h-6 rounded-full transition-colors shrink-0" style={{ background: pressureOn ? "oklch(0.7 0.17 145)" : "oklch(0.35 0.02 260)", boxShadow: "inset 0 1px 2px oklch(0 0 0 / 0.4)" }}>
                    <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all" style={{ left: pressureOn ? "19px" : "3px", boxShadow: "0 1px 4px oklch(0 0 0 / 0.4)" }} />
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel}
        destructive={pendingConfirm?.destructive}
        onConfirm={() => {
          const pending = pendingConfirm;
          setPendingConfirm(null);
          pending?.action();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

