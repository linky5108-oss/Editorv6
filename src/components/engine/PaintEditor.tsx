import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePreferences } from "@/lib/preferences";
import type { SpriteAsset } from "@/lib/engine/core";
import { uid } from "@/lib/engine/core";
import { MAX_PAINT_ZOOM, MIN_PAINT_ZOOM, pinchAnchor, pinchScrollDelta, pinchZoom, pinchZoomArmed, type ZoomAnchor } from "@/lib/engine/paint-zoom";
import { createRafCoalescer } from "@/lib/engine/raf-coalesce";
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
import {
  PAINT_BRUSHES,
  drawBrush,
  drawBrushPath,
  type BrushStrokeOptions,
  type PaintBrush,
  type SymmetryMode,
} from "@/lib/engine/paint-brush";
import { drawCanvasChecker, gridEdgesScaled } from "@/lib/engine/paint-grid";
import {
  canvasBox,
  canvasScale,
  clampCanvasSide,
  keptArea,
  zoomForBox,
  type CanvasSize,
} from "@/lib/engine/paint-canvas";
import {
  PAINT_SHAPES,
  constrainShape,
  paintShape,
  placeShape,
  resizeShape,
  shapeBox,
  shapeClosed,
  shapeDef,
  shapeHit,
  shapeOutline,
  shapePathD,
  translateShape,
  type PaintShape,
  type ShapeObject,
} from "@/lib/engine/paint-shapes";
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
  worldToLocal,
  type FillGradientMode,
  type LayerBlendMode,
  type SelectionMode,
  type TransformBox,
  type TransformHandle,
} from "@/lib/engine/paint-transform";
import {
  Pencil, Eraser, PaintBucket, Shapes, Pipette, Type, Move,
  Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, Copy, Trash2, Layers,
  Undo2, Redo2, Plus, X, Check, SlidersHorizontal, Grid,
  Maximize2, AlertTriangle, FlipHorizontal2, FlipVertical2, ImagePlus,
  Scissors, ClipboardPaste, Scan, Lasso,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Tool = "brush" | "eraser" | "fill" | "shape" | "picker" | "text" | "select" | "move";

interface Props {
  onSave: (sprite: SpriteAsset) => void;
  onClose: () => void;
  size?: number;
  /**
   * Dibujo ya hecho que se abre para SEGUIR editándolo (el lápiz de cada
   * textura en «Añade texturas»). Entra en la primera capa sin reescalarlo y
   * el lienzo adopta la medida en la que se pintó, así que no se pierde nada.
   */
  source?: {
    image: string;
    width?: number;
    height?: number;
    /** Nombre que ya tenía la textura: al guardar se conserva. */
    name?: string;
  };
}

const SIZE_OPTIONS = [128, 256, 512, 768, 1024];
const BRUSH_PRESETS = [2, 4, 8, 16, 32];

/** Atajos de una letra para elegir herramienta (misma letra que la etiqueta). */
const TOOL_BY_KEY: Record<string, Tool> = {
  b: "brush", e: "eraser", g: "fill", s: "shape", i: "picker", t: "text", m: "select", v: "move",
};

/**
 * Las letras de las formas sueltas de antes siguen funcionando: eligen esa
 * forma y activan «Formas», en lugar de tener una herramienta por forma.
 */
const SHAPE_BY_KEY: Record<string, PaintShape> = {
  l: "line", r: "rect", c: "ellipse", a: "arrow",
};

/**
 * Objeto de texto del lienzo.
 *
 * Antes el texto se «quemaba» en el bitmap de la capa: al mover la capa se
 * desplazaba junto con el dibujo y no había forma de corregirlo. Ahora es un
 * objeto propio, con su posición y aspecto, que la herramienta «Mover»
 * selecciona, transforma (escala, rota, voltea) y clona sin tocar el resto de la obra.
 */
interface TextObject {
  id: string;
  text: string;
  x: number; // esquina superior izquierda, en px del lienzo
  y: number;
  fontSize: number;
  font: string;
  color: string;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

interface FloatingRaster {
  layerId: string;
  sourceCanvas: HTMLCanvasElement;
  box: TransformBox;
}

const TEXT_LINE_HEIGHT = 1.1;

function textFontOf(t: TextObject): string {
  return `${t.fontSize}px "${t.font}", sans-serif`;
}

/** Contexto 2D fuera de pantalla solo para medir texto. */
let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx!;
}

/** Caja del texto en px del lienzo: delimita la selección y el área de toque. */
function measureTextObject(t: TextObject): { w: number; h: number; rawW: number; rawH: number } {
  const ctx = measurer();
  ctx.font = textFontOf(t);
  const lines = t.text.split("\n");
  let rawW = 1;
  for (const line of lines) rawW = Math.max(rawW, ctx.measureText(line).width);
  const rawH = Math.max(1, lines.length) * t.fontSize * TEXT_LINE_HEIGHT;
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;
  return { w: rawW * sx, h: rawH * sy, rawW, rawH };
}

function textTransformBoxOf(t: TextObject): TransformBox {
  const m = measureTextObject(t);
  return {
    x: t.x,
    y: t.y,
    w: Math.max(4, m.w),
    h: Math.max(4, m.h),
    rotation: t.rotation ?? 0,
    flipX: !!t.flipX,
    flipY: !!t.flipY,
  };
}

function shapeTransformBoxOf(s: ShapeObject): TransformBox {
  const b = shapeBox(s.x0, s.y0, s.x1, s.y1);
  return {
    x: b.x,
    y: b.y,
    w: Math.max(4, b.w),
    h: Math.max(4, b.h),
    rotation: s.rotation ?? 0,
    flipX: !!s.flipX,
    flipY: !!s.flipY,
  };
}

function drawTextObject(ctx: CanvasRenderingContext2D, t: TextObject) {
  const m = measureTextObject(t);
  const sx = (t.scaleX ?? 1) * (t.flipX ? -1 : 1);
  const sy = (t.scaleY ?? 1) * (t.flipY ? -1 : 1);
  const rot = t.rotation ?? 0;
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.font = textFontOf(t);
  ctx.textBaseline = "top";
  if (rot !== 0 || sx !== 1 || sy !== 1) {
    const cx = t.x + m.w / 2;
    const cy = t.y + m.h / 2;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.scale(sx, sy);
    t.text.split("\n").forEach((line, i) => {
      ctx.fillText(line, -m.rawW / 2, -m.rawH / 2 + i * t.fontSize * TEXT_LINE_HEIGHT);
    });
  } else {
    t.text.split("\n").forEach((line, i) => {
      ctx.fillText(line, t.x, t.y + i * t.fontSize * TEXT_LINE_HEIGHT);
    });
  }
  ctx.restore();
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

/**
 * La forma, dibujada como icono. Sale de la MISMA geometría que el lienzo
 * (`shapePathD`), así que la ventana «Formas» nunca miente sobre lo que pinta.
 */
function ShapeGlyph({ shape, size = 20 }: { shape: PaintShape; size?: number }) {
  const view = 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${view} ${view}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d={shapePathD(shape, { x: 2.5, y: 2.5, w: view - 5, h: view - 5 })} />
    </svg>
  );
}

/** Rejilla con todas las formas: la ventana «Formas» y el panel de selección. */
function ShapePicker({
  value,
  onPick,
}: {
  value: PaintShape;
  onPick: (shape: PaintShape) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {PAINT_SHAPES.map(item => {
        const on = value === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onPick(item.id)}
            aria-label={item.name}
            aria-pressed={on}
            title={`${item.name}: ${item.description}`}
            className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition ${
              on
                ? "border-primary bg-accent text-accent-foreground"
                : "border-line bg-card text-ink-2 hover:bg-muted hover:text-foreground"
            }`}
          >
            <ShapeGlyph shape={item.id} size={22} />
            <span className="w-full truncate text-center text-[9px] font-medium leading-none">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blendMode?: LayerBlendMode;
  alphaLock?: boolean;
  canvas: HTMLCanvasElement;
  /** Textos de la capa: objetos independientes, no píxeles del bitmap. */
  texts: TextObject[];
  /**
   * Formas de la capa: también objetos. Se seleccionan, se mueven y se editan
   * aunque ya estén colocadas, en lugar de quedar fundidas con el dibujo.
   */
  shapes: ShapeObject[];
}

interface LayerSnapshotItem {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: LayerBlendMode;
  alphaLock?: boolean;
  dataUrl: string;
  imageData?: ImageData;
  texts: TextObject[];
  shapes: ShapeObject[];
}

/** Estado guardable para deshacer: bitmap de una capa o pila completa + objetos. */
interface Snapshot {
  layerId: string;
  dataUrl: string;
  imageData?: ImageData;
  texts: { layerId: string; items: TextObject[] }[];
  shapes: { layerId: string; items: ShapeObject[] }[];
  allLayers?: LayerSnapshotItem[];
  activeLayerId?: string;
}

interface PendingConfirm {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => void;
}

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

/** Tablero de transparencia de las miniaturas (cuadros de 8px). */
const CHECKER: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, var(--m3-surface-highest) 25%, transparent 25%), linear-gradient(-45deg, var(--m3-surface-highest) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--m3-surface-highest) 75%), linear-gradient(-45deg, transparent 75%, var(--m3-surface-highest) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
  backgroundColor: "var(--m3-surface-lowest)",
};

/** Tarjeta de sección del panel: cabecera micro-label + contenido. */
function SectionCard({
  label,
  icon,
  action,
  children,
}: {
  label: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <header className="flex items-center justify-between gap-2 mb-2.5">
        <span className="section-label">
          {icon}
          {label}
        </span>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PaintEditor({ onSave, onClose, size: initialSize = 512, source }: Props) {
  const sourceImage = useRef(source?.image ?? null);
  const [canvas, setCanvas] = useState<CanvasSize>(() => ({
    w: clampCanvasSide(source?.width ?? initialSize),
    h: clampCanvasSide(source?.height ?? initialSize),
  }));
  const sizeW = canvas.w;
  const sizeH = canvas.h;
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#38bdf8");
  const [secondaryColor, setSecondaryColor] = useState("#0f172a");
  const [fillGradientMode, setFillGradientMode] = useState<FillGradientMode>("solid");
  const [fillTolerance, setFillTolerance] = useState(25);
  const [recent, setRecent] = useState<string[]>(["#38bdf8", "#0f172a", "#ef4444", "#22c55e", "#fbbf24"]);
  const [width, setWidth] = useState(6);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const [brushSoftness, setBrushSoftness] = useState(0);
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>("none");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [brush, setBrush] = useState<PaintBrush>("round");
  const [name, setName] = useState(source?.name?.trim() || "drawing");
  const [stabilizeLevel, setStabilizeLevel] = useState(STABILIZE_DEFAULT);
  const [pressureOn, setPressureOn] = useState(true);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitPx, setFitPx] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const theme = usePreferences().theme;
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickSetting, setQuickSetting] = useState<"color" | "width" | "brush" | "shapes" | null>(null);
  const [hasArtwork, setHasArtwork] = useState(false);
  const artworkBeforeGesture = useRef(false);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const PALETTE = PALETTES[paletteIdx].colors;
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const selectedTextIdRef = useRef<string | null>(null);
  const textEditSnapshot = useRef(false);
  const [shapeKind, setShapeKind] = useState<PaintShape>("rect");
  const [shapeFilled, setShapeFilled] = useState(false);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const selectedShapeIdRef = useRef<string | null>(null);
  const shapeEditSnapshot = useRef(false);
  const floatingRasterRef = useRef<FloatingRaster | null>(null);
  const [hasFloatingRaster, setHasFloatingRaster] = useState(false);
  const [hoverHandle, setHoverHandle] = useState<TransformHandle | null>(null);
  const selectionPointsRef = useRef<{ x: number; y: number }[]>([]);
  const clipboardRasterRef = useRef<{ sourceCanvas: HTMLCanvasElement; w: number; h: number } | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // text overlay state
  const [textInput, setTextInput] = useState<{
    open: boolean; x: number; y: number; value: string; fontSize: number; font: string; color: string; id?: string;
  } | null>(null);

  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const checkerRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // ---------- Layers ----------
  const makeLayerCanvas = (): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = sizeW; c.height = sizeH;
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
  const active = layers.find(l => l.id === activeLayerId) ?? null;
  const activeEditable = !!active && active.visible && !active.locked;
  const selectedText = selectedTextId
    ? layers.flatMap(l => l.texts).find(t => t.id === selectedTextId) ?? null
    : null;
  const selectedShape = selectedShapeId
    ? layers.flatMap(l => l.shapes).find(s => s.id === selectedShapeId) ?? null
    : null;
  const selectedShapeBox = selectedShape
    ? shapeBox(selectedShape.x0, selectedShape.y0, selectedShape.x1, selectedShape.y1)
    : null;

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const activePointerId = useRef<number | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    ids: number[];
    distance: number;
    zoom: number;
    /** ¿Los dedos ya se han separado lo bastante para hacer zoom? */
    zooming: boolean;
    /** Punto del dibujo que el gesto tiene agarrado (0..1), o `null` sin marco. */
    anchor: ZoomAnchor | null;
    /** Foco del último cuadro aplicado (la mitad entre los dos dedos). */
    focus: { x: number; y: number };
  } | null>(null);
  // Gesto de vista (pellizco o cambio de tamaño del lienzo): se aplica al DOM
  // por cuadro y SIN re-renderizar el editor, que es lo que hacía que el zoom
  // fuera a tirones. El estado de React solo se fija al soltar.
  const pinchFrames = useRef<ReturnType<typeof createRafCoalescer<number>> | null>(null);
  const resizeFrames = useRef<ReturnType<typeof createRafCoalescer<{ dx: number; dy: number }>> | null>(null);
  // Tamaño de lienzo que se está mostrando sin pasar por React (gesto en curso).
  const liveBox = useRef<CanvasSize | null>(null);
  // Medida que enseña el lienzo mientras se arrastra el tirador: el tamaño nuevo
  // y la escala del dibujo, que no cambia durante el gesto.
  const resizeLive = useRef<{ scale: number; box: CanvasSize } | null>(null);
  const liveZoom = useRef(1);
  const resizeDrag = useRef<{
    id: number;
    x0: number;
    y0: number;
    /** Píxeles de pantalla por píxel de dibujo en el momento de agarrar. */
    scale: number;
    box0: CanvasSize;
    want: CanvasSize;
    /** Área útil del visor y sitio del marco en ella, para no correr el lienzo. */
    area: CanvasSize;
    offset: { x: number; y: number };
  } | null>(null);
  const gestureBlocked = useRef(false);
  const restoringStroke = useRef(false);
  const resizeResetTimer = useRef<number | null>(null);
  // Mientras dura un gesto de vista no se rehace el bitmap de pantalla: la
  // imagen se estira con CSS (gratis) y se vuelve a pintar una sola vez al
  // soltar. Reescalar el lienzo en cada cuadro era el grueso del tirón.
  const gesturePixels = useRef(false);
  const deferredBlit = useRef(false);

  const syncHistory = () => {
    setHistory({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    });
  };

  const displayScale = useRef<number>(1);
  const dragRect = useRef<DOMRect | null>(null);

  /** Aplica el repintado que se dejó pendiente durante un gesto de vista. */
  const flushDeferredBlit = () => {
    gesturePixels.current = false;
    if (!deferredBlit.current) return;
    deferredBlit.current = false;
    blit();
  };

  /** Cierra un gesto de vista: una sola repintura, ya a la medida final. */
  const endViewGesture = () => {
    deferredBlit.current = true;
    flushDeferredBlit();
  };

  /** Tamaño del marco escrito directamente en el DOM (sin pasar por React). */
  const applyLiveBox = (w: number, h: number) => {
    const box = boxRef.current;
    if (!box) return;
    const bw = Math.max(1, Math.round(w));
    const bh = Math.max(1, Math.round(h));
    box.style.width = `${bw}px`;
    box.style.height = `${bh}px`;
    liveBox.current = { w: bw, h: bh };
  };

  // Tarea del pellizco siempre fresca: el cuadro que se aplique dentro de unos
  // milisegundos no puede llevar la medida de un render antiguo.
  const pinchFrameTask = useRef<() => void>(() => {});

  /** Una sola aplicación por cuadro para una ráfaga de eventos de vista. */
  const schedulePinchFrame = () => {
    if (!pinchFrames.current) pinchFrames.current = createRafCoalescer<number>(() => pinchFrameTask.current());
    pinchFrames.current.push(1);
  };
  const scheduleResizeFrame = (dx: number, dy: number) => {
    if (!resizeFrames.current) resizeFrames.current = createRafCoalescer<{ dx: number; dy: number }>(v => applyResizeFrame(v.dx, v.dy));
    resizeFrames.current.push({ dx, dy });
  };

  /**
   * Aplica el cuadro pendiente del pellizco: el marco se escribe en píxeles y
   * el visor se desplaza para que el punto agarrado siga bajo los dedos. Nada
   * de esto pasa por React, así que el gesto no re-renderiza el editor.
   */
  const applyPinchFrame = () => {
    const gesture = pinch.current;
    const box = boxRef.current;
    if (!gesture || !box) return;
    const [a, b] = gesture.ids.map(id => touchPoints.current.get(id));
    if (!a || !b) return;
    const focus = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    // Los dedos nunca mantienen la distancia exacta mientras desplazan el
    // lienzo: hasta que no se separen lo suficiente el gesto es solo paneo, así
    // que la escala (y la retícula) no cambia ni un píxel. Cuando el dedo se
    // separa de verdad, el zoom empieza a seguirle desde esa distancia, sin
    // ningún salto (el zoom de partida es el que ya había).
    if (!gesture.zooming && pinchZoomArmed(gesture.distance, distance)) {
      gesture.zooming = true;
      gesture.distance = distance;
      gesture.zoom = liveZoom.current;
    }
    const next = gesture.zooming ? pinchZoom(gesture.zoom, gesture.distance, distance) : liveZoom.current;
    const viewport = viewportRef.current;
    if (next !== liveZoom.current || !liveBox.current) {
      // Cambió la escala: se reescala el marco y, con la medida ya puesta, se
      // resuelve el ancla para que el punto agarrado siga bajo los dedos.
      const scale = canvasScale(fitPx, next, canvas);
      applyLiveBox(scale * sizeW, scale * sizeH);
      liveZoom.current = next;
      if (gesture.anchor && viewport) {
        const { dx, dy } = pinchScrollDelta(gesture.anchor, box.getBoundingClientRect(), focus);
        if (dx) viewport.scrollLeft += dx;
        if (dy) viewport.scrollTop += dy;
      }
    } else if (viewport) {
      // Sin cambio de escala el gesto solo mueve la cámara: lo que se movió el
      // foco es exactamente lo que hay que mover el visor. Ni una medición.
      const dx = focus.x - gesture.focus.x;
      const dy = focus.y - gesture.focus.y;
      if (dx) viewport.scrollLeft -= dx;
      if (dy) viewport.scrollTop -= dy;
    }
    gesture.focus = focus;
  };

  /**
   * Aplica el cuadro pendiente del tirador: el lienzo enseña en vivo su medida
   * nueva (cuadros añadidos o quitados) y el dibujo no se mueve de escala.
   */
  const applyResizeFrame = (dx: number, dy: number) => {
    const drag = resizeDrag.current;
    if (!drag) return;
    const want = {
      w: clampCanvasSide((drag.box0.w + dx) / drag.scale),
      h: clampCanvasSide((drag.box0.h + dy) / drag.scale),
    };
    drag.want = want;
    resizeLive.current = { scale: drag.scale, box: want };
    applyLiveBox(want.w * drag.scale, want.h * drag.scale);
    // El lienzo no se pasea: se congela el sitio del marco en el visor mientras
    // dura el arrastre, así crece hacia la derecha y hacia abajo y la esquina
    // superior izquierda (el origen del dibujo) se queda clavada donde estaba.
    const box = boxRef.current;
    if (box) {
      box.style.marginLeft = `${drag.offset.x}px`;
      box.style.marginTop = `${drag.offset.y}px`;
      box.style.marginRight = "0px";
      box.style.marginBottom = "0px";
    }
  };

  /** Agarra el tirador: a partir de aquí el marco cambia de tamaño al arrastrar. */
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    if (resizeResetTimer.current !== null) {
      window.clearTimeout(resizeResetTimer.current);
      resizeResetTimer.current = null;
      box.style.transition = "";
    }
    const rect = box.getBoundingClientRect();
    const scale = sizeW > 0 ? rect.width / sizeW : 0;
    if (!(scale > 0)) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    // Área útil del visor (sin su relleno) y distancia del marco a su origen:
    // con ellas el lienzo se queda en su sitio mientras se redimensiona y vuelve
    // solo al centro al soltar.
    const viewport = viewportRef.current;
    const vcs = viewport ? getComputedStyle(viewport) : null;
    const padL = vcs ? (parseFloat(vcs.paddingLeft) || 0) : 0;
    const padT = vcs ? (parseFloat(vcs.paddingTop) || 0) : 0;
    const vrect = viewport ? viewport.getBoundingClientRect() : null;
    const area = {
      w: viewport ? viewport.clientWidth - padL - (vcs ? (parseFloat(vcs.paddingRight) || 0) : 0) : 0,
      h: viewport ? viewport.clientHeight - padT - (vcs ? (parseFloat(vcs.paddingBottom) || 0) : 0) : 0,
    };
    const offset = viewport && vrect
      ? { x: rect.left - vrect.left - padL + viewport.scrollLeft, y: rect.top - vrect.top - padT + viewport.scrollTop }
      : { x: 0, y: 0 };
    resizeDrag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      scale,
      box0: { w: rect.width, h: rect.height },
      want: { w: sizeW, h: sizeH },
      area,
      offset,
    };
    // El dibujo NO se estira: durante el arrastre el lienzo repinta en vivo la
    // medida nueva (retícula de cuadros añadidos o quitados) y pega el dibujo a
    // la esquina con la escala con la que empezó el gesto.
    resizeLive.current = { scale, box: { w: sizeW, h: sizeH } };
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag || drag.id !== e.pointerId) return;
    e.stopPropagation();
    scheduleResizeFrame(e.clientX - drag.x0, e.clientY - drag.y0);
  };

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag || drag.id !== e.pointerId) return;
    e.stopPropagation();
    resizeDrag.current = null;
    resizeFrames.current?.cancel();
    const next = drag.want;
    // El zoom se recalcula para que el lienzo siga ocupando lo mismo en pantalla:
    // al soltar, el dibujo no da ningún salto.
    const nextZoom = zoomForBox(next.w * drag.scale, fitPx, next);
    liveBox.current = null;
    // Fin del previsualizado: el lienzo vuelve a la medida del estado.
    resizeLive.current = null;
    if (next.w !== sizeW || next.h !== sizeH) {
      resizeCanvas(next);
      setZoom(nextZoom);
    }
    // Deja el marco en la medida definitiva de la vista (por si el render no
    // llega a escribirla: el tirador escribe el tamaño a mano).
    const committed = canvasBox(fitPx, nextZoom, next);
    applyLiveBox(committed.w, committed.h);
    liveBox.current = null;
    // Se retira el sitio congelado con una transición corta hacia la posición
    // centrada definitiva: el lienzo vuelve a su sitio sin dar un salto.
    const held = boxRef.current;
    if (held) {
      held.style.transition = "margin 180ms ease";
      held.style.marginLeft = `${Math.max(0, (drag.area.w - committed.w) / 2)}px`;
      held.style.marginTop = `${Math.max(0, (drag.area.h - committed.h) / 2)}px`;
      held.style.marginRight = "0px";
      held.style.marginBottom = "0px";
      resizeResetTimer.current = window.setTimeout(() => {
        resizeResetTimer.current = null;
        const box = boxRef.current;
        if (box) {
          box.style.transition = "";
          box.style.marginLeft = "";
          box.style.marginTop = "";
          box.style.marginRight = "";
          box.style.marginBottom = "";
        }
      }, 240);
    }
    endViewGesture();
  };

  // ---------- Selección flotante de trazos de capa y portapapeles ----------
  /** Estampa la selección flotante de píxeles de vuelta en su capa. */
  const commitFloatingRaster = (recomp = true) => {
    const floating = floatingRasterRef.current;
    if (!floating) return;
    const layer = layersRef.current.find(l => l.id === floating.layerId);
    if (layer) {
      const ctx = layer.canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = brush !== "pixel";
      ctx.imageSmoothingQuality = "high";
      drawFloatingRaster(ctx, floating);
    }
    floatingRasterRef.current = null;
    setHasFloatingRaster(false);
    if (recomp) {
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
    }
  };

  const duplicateFloatingRaster = () => {
    const floating = floatingRasterRef.current;
    if (!floating) return;
    const layer = layersRef.current.find(l => l.id === floating.layerId);
    if (!layer || objectEditLocked(layer)) return;
    pushSnapshot();
    const ctx = layer.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = brush !== "pixel";
    ctx.imageSmoothingQuality = "high";
    drawFloatingRaster(ctx, floating);
    floating.box = {
      ...floating.box,
      x: floating.box.x + 12,
      y: floating.box.y + 12,
    };
    recomposite();
    blit();
    setPreviewVersion(v => v + 1);
  };

  const deleteFloatingRaster = () => {
    if (!floatingRasterRef.current) return;
    floatingRasterRef.current = null;
    setHasFloatingRaster(false);
    recomposite();
    blit();
    setPreviewVersion(v => v + 1);
  };

  const copySelectionToClipboard = (): boolean => {
    const floating = floatingRasterRef.current;
    if (floating) {
      const bw = Math.max(1, Math.round(floating.box.w));
      const bh = Math.max(1, Math.round(floating.box.h));
      const clip = document.createElement("canvas");
      clip.width = bw;
      clip.height = bh;
      const cctx = clip.getContext("2d")!;
      cctx.imageSmoothingEnabled = brush !== "pixel";
      cctx.imageSmoothingQuality = "high";
      cctx.save();
      cctx.translate(bw / 2, bh / 2);
      cctx.scale(floating.box.flipX ? -1 : 1, floating.box.flipY ? -1 : 1);
      cctx.drawImage(floating.sourceCanvas, -bw / 2, -bh / 2, bw, bh);
      cctx.restore();
      clipboardRasterRef.current = { sourceCanvas: clip, w: bw, h: bh };
      setHasClipboard(true);
      return true;
    }
    const layer = activeLayer();
    if (!layer) return false;
    const lctx = layer.canvas.getContext("2d")!;
    const bounds = findNonEmptyPixelBounds(lctx.getImageData(0, 0, sizeW, sizeH));
    if (!bounds) return false;
    const clip = document.createElement("canvas");
    clip.width = bounds.w;
    clip.height = bounds.h;
    clip.getContext("2d")!.drawImage(
      layer.canvas,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      0,
      0,
      bounds.w,
      bounds.h,
    );
    clipboardRasterRef.current = { sourceCanvas: clip, w: bounds.w, h: bounds.h };
    setHasClipboard(true);
    return true;
  };

  const cutSelectionToClipboard = () => {
    if (floatingRasterRef.current) {
      copySelectionToClipboard();
      deleteFloatingRaster();
      return;
    }
    const layer = activeLayer();
    if (!layer || !isLayerEditable()) return;
    if (!copySelectionToClipboard()) return;
    pushSnapshot();
    const lctx = layer.canvas.getContext("2d")!;
    lctx.clearRect(0, 0, sizeW, sizeH);
    recomposite();
    blit();
    setPreviewVersion(v => v + 1);
  };

  const pasteFromClipboard = () => {
    const clip = clipboardRasterRef.current;
    const layer = activeLayer();
    if (!clip || !layer || !isLayerEditable()) return;
    commitFloatingRaster(false);
    selectText(null);
    selectShape(null);
    pushSnapshot();
    const copyCanvas = document.createElement("canvas");
    copyCanvas.width = clip.w;
    copyCanvas.height = clip.h;
    copyCanvas.getContext("2d")!.drawImage(clip.sourceCanvas, 0, 0);
    const px = Math.max(0, Math.min(sizeW - clip.w, Math.round((sizeW - clip.w) / 2 + 8)));
    const py = Math.max(0, Math.min(sizeH - clip.h, Math.round((sizeH - clip.h) / 2 + 8)));
    floatingRasterRef.current = {
      layerId: layer.id,
      sourceCanvas: copyCanvas,
      box: {
        x: px,
        y: py,
        w: clip.w,
        h: clip.h,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
    };
    setHasFloatingRaster(true);
    setTool("move");
    setHasArtwork(true);
    recomposite();
    blit();
    setPreviewVersion(v => v + 1);
  };

  // ---------- Textos y formas como objetos independientes ----------
  /** Ni un texto ni una forma se editan si su capa está oculta o bloqueada. */
  const objectEditLocked = (layer: PaintLayer) => !layer.visible || layer.locked;

  const findText = (id: string | null): { layer: PaintLayer; text: TextObject } | null => {
    if (!id) return null;
    for (const layer of layersRef.current) {
      const text = layer.texts.find(t => t.id === id);
      if (text) return { layer, text };
    }
    return null;
  };

  const selectText = (id: string | null) => {
    selectedTextIdRef.current = id;
    setSelectedTextId(id);
  };

  /** Reemplaza los textos de una capa (ref + estado, para pintar al instante). */
  const updateTexts = (layerId: string, fn: (texts: TextObject[]) => TextObject[]) => {
    const next = layersRef.current.map(l => l.id === layerId ? { ...l, texts: fn(l.texts) } : l);
    layersRef.current = next;
    setLayers(next);
  };

  const snapshotTexts = () =>
    layersRef.current.map(l => ({ layerId: l.id, items: l.texts.map(t => ({ ...t })) }));

  const applyTextSnapshot = (snap: { layerId: string; items: TextObject[] }[]) => {
    const map = new Map(snap.map(s => [s.layerId, s.items]));
    const next = layersRef.current.map(l => {
      const items = map.get(l.id);
      return items ? { ...l, texts: items.map(t => ({ ...t })) } : l;
    });
    layersRef.current = next;
    setLayers(next);
  };

  /** Si el texto seleccionado desapareció (deshacer, borrar capa...), suelta la selección. */
  const reconcileTextSelection = () => {
    if (selectedTextIdRef.current && !findText(selectedTextIdRef.current)) selectText(null);
  };

  /** Texto bajo un punto del lienzo: de la capa de arriba abajo (respeta rotación y escala). */
  const hitTestText = (wx: number, wy: number) => {
    const ordered = [...layersRef.current].reverse();
    for (const layer of ordered) {
      if (objectEditLocked(layer)) continue;
      for (let i = layer.texts.length - 1; i >= 0; i--) {
        const t = layer.texts[i];
        const m = measureTextObject(t);
        const cx = t.x + m.w / 2;
        const cy = t.y + m.h / 2;
        const local = worldToLocal(wx, wy, cx, cy, t.rotation ?? 0);
        const pad = 4;
        if (Math.abs(local.x) <= m.w / 2 + pad && Math.abs(local.y) <= m.h / 2 + pad) {
          return { layer, text: t };
        }
      }
    }
    return null;
  };

  const updateSelectedText = (patch: Partial<TextObject>) => {
    const found = findText(selectedTextIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    updateTexts(found.layer.id, texts =>
      texts.map(t => t.id === found.text.id ? { ...t, ...patch } : t));
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  /** Un solo punto de deshacer por sesión de edición en un campo. */
  const beginTextFieldEdit = () => {
    if (textEditSnapshot.current) return;
    pushSnapshot();
    textEditSnapshot.current = true;
  };

  const deleteSelectedText = () => {
    const found = findText(selectedTextIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    pushSnapshot();
    updateTexts(found.layer.id, texts => texts.filter(t => t.id !== found.text.id));
    selectText(null);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  const duplicateSelectedText = () => {
    const found = findText(selectedTextIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    pushSnapshot();
    const copy: TextObject = { ...found.text, id: uid(), x: found.text.x + 12, y: found.text.y + 12 };
    updateTexts(found.layer.id, texts => [...texts, copy]);
    selectText(copy.id);
    setTool("move");
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  // ---------- Formas como objetos independientes ----------
  const findShape = (id: string | null): { layer: PaintLayer; shape: ShapeObject } | null => {
    if (!id) return null;
    for (const layer of layersRef.current) {
      const shape = layer.shapes.find(s => s.id === id);
      if (shape) return { layer, shape };
    }
    return null;
  };

  const selectShape = (id: string | null) => {
    selectedShapeIdRef.current = id;
    setSelectedShapeId(id);
  };

  /** Reemplaza las formas de una capa (ref + estado, para pintar al instante). */
  const updateShapes = (layerId: string, fn: (shapes: ShapeObject[]) => ShapeObject[]) => {
    const next = layersRef.current.map(l => l.id === layerId ? { ...l, shapes: fn(l.shapes) } : l);
    layersRef.current = next;
    setLayers(next);
  };

  const snapshotShapes = () =>
    layersRef.current.map(l => ({ layerId: l.id, items: l.shapes.map(s => ({ ...s })) }));

  const applyShapeSnapshot = (snap: { layerId: string; items: ShapeObject[] }[] | undefined) => {
    if (!snap) return;
    const map = new Map(snap.map(s => [s.layerId, s.items]));
    const next = layersRef.current.map(l => {
      const items = map.get(l.id);
      return items ? { ...l, shapes: items.map(s => ({ ...s })) } : l;
    });
    layersRef.current = next;
    setLayers(next);
  };

  const reconcileShapeSelection = () => {
    if (selectedShapeIdRef.current && !findShape(selectedShapeIdRef.current)) selectShape(null);
  };

  const hitTestShapeObject = (wx: number, wy: number) => {
    const ordered = [...layersRef.current].reverse();
    for (const layer of ordered) {
      if (objectEditLocked(layer)) continue;
      for (let i = layer.shapes.length - 1; i >= 0; i--) {
        const s = layer.shapes[i];
        if (shapeHit(s, wx, wy, Math.max(6, s.width / 2 + 4))) return { layer, shape: s };
      }
    }
    return null;
  };

  const updateSelectedShape = (patch: Partial<ShapeObject>) => {
    const found = findShape(selectedShapeIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    updateShapes(found.layer.id, shapes =>
      shapes.map(s => s.id === found.shape.id ? { ...s, ...patch } : s));
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  const beginShapeFieldEdit = () => {
    if (shapeEditSnapshot.current) return;
    pushSnapshot();
    shapeEditSnapshot.current = true;
  };

  const deleteSelectedShape = () => {
    const found = findShape(selectedShapeIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    pushSnapshot();
    updateShapes(found.layer.id, shapes => shapes.filter(s => s.id !== found.shape.id));
    selectShape(null);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  const duplicateSelectedShape = () => {
    const found = findShape(selectedShapeIdRef.current);
    if (!found || objectEditLocked(found.layer)) return;
    pushSnapshot();
    const copy: ShapeObject = {
      ...found.shape,
      id: uid(),
      ...translateShape(found.shape, 12, 12),
    };
    updateShapes(found.layer.id, shapes => [...shapes, copy]);
    selectShape(copy.id);
    setTool("move");
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  const addShapeObject = (draft: ShapeObject) => {
    const layer = activeLayer();
    if (!layer || !isLayerEditable()) return;
    commitFloatingRaster(false);
    rememberColor(draft.color);
    updateShapes(layer.id, shapes => [...shapes, draft]);
    selectShape(draft.id);
    selectText(null);
    setTool("move");
    setHasArtwork(true);
    setPreviewVersion(v => v + 1);
  };

  /** Compone las capas visibles (con su modo de fusión, formas y textos) en el búfer. */
  const compositeInto = (c: CanvasRenderingContext2D, source: PaintLayer[]) => {
    c.clearRect(0, 0, sizeW, sizeH);
    const floating = floatingRasterRef.current;
    for (const l of source) {
      if (!l.visible) continue;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, l.opacity));
      c.globalCompositeOperation = l.blendMode ?? "source-over";
      c.drawImage(l.canvas, 0, 0);
      if (floating && floating.layerId === l.id) {
        drawFloatingRaster(c, floating);
      }
      // Las formas van sobre el bitmap y por debajo de los textos.
      for (const s of l.shapes) paintShape(c, s);
      for (const t of l.texts) drawTextObject(c, t);
      c.restore();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  };

  /** Fuente de la vista: búfer compuesto. */
  const recomposite = () => {
    const buf = bufferRef.current; if (!buf) return;
    compositeInto(buf.getContext("2d")!, layersRef.current);
  };

  const checkerPattern = (
    w: number,
    h: number,
    cols: number[],
    rows: number[],
    gridW: number,
    gridH: number,
    light: string,
    dark: string,
  ) => {
    const key = `${w}x${h}|${gridW}x${gridH}|${light}|${dark}`;
    const cached = checkerRef.current;
    if (cached && cached.key === key) return cached.canvas;
    const canvas = cached?.canvas ?? document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    drawCanvasChecker(canvas.getContext("2d")!, w, h, light, dark, cols, rows);
    checkerRef.current = { key, canvas };
    return canvas;
  };

  /** Vuelca el búfer al canvas de pantalla a la escala de vista actual. */
  const blit = (preview?: (ctx: CanvasRenderingContext2D) => void) => {
    if (gesturePixels.current) { deferredBlit.current = true; return; }
    const c = canvasRef.current; const buf = bufferRef.current;
    if (!c || !buf) return;
    const ctx = c.getContext("2d")!;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (W <= 0 || H <= 0) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
    const cs = getComputedStyle(c);
    const light = cs.getPropertyValue("--m3-surface-lowest").trim() || "#f4f4f5";
    const dark = cs.getPropertyValue("--m3-surface-highest").trim() || "#d4d4d8";
    const live = resizeLive.current;
    const gridW = live ? live.box.w : sizeW;
    const gridH = live ? live.box.h : sizeH;
    const artScale = live ? live.scale : W / sizeW;
    const cols = gridEdgesScaled(gridW, c.width, artScale * dpr);
    const rows = gridEdgesScaled(gridH, c.height, artScale * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(checkerPattern(c.width, c.height, cols, rows, gridW, gridH, light, dark), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const crispPixel = brush === "pixel" && artScale >= 2;
    ctx.imageSmoothingEnabled = !crispPixel;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(buf, 0, 0, sizeW * artScale, sizeH * artScale);
    displayScale.current = artScale;
    if (showGrid) {
      const line = Math.max(1, Math.round(dpr));
      const half = line % 2 === 0 ? 0 : 0.5;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = line;
      ctx.strokeStyle = cs.getPropertyValue("--primary").trim() || "#3b82f6";
      ctx.beginPath();
      for (let i = 0; i < cols.length - 1; i++) {
        ctx.moveTo(cols[i] + half, 0);
        ctx.lineTo(cols[i] + half, c.height);
      }
      for (let j = 0; j < rows.length - 1; j++) {
        ctx.moveTo(0, rows[j] + half);
        ctx.lineTo(c.width, rows[j] + half);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Guías de simetría en vivo (horizontal, vertical o ambas)
    if (symmetryMode !== "none") {
      drawSymmetryGuides(ctx, symmetryMode, sizeW, sizeH, displayScale.current);
    }
    // Contorno animado si el usuario está trazando una selección rectangular o de lazo
    if (drag.current.active && drag.current.selectionActive && selectionPointsRef.current.length > 1) {
      drawSelectionMarquee(
        ctx,
        drag.current.selectionKind === "lasso" ? "lasso" : "rect",
        selectionPointsRef.current,
        displayScale.current,
      );
    }
    // El objeto seleccionado (texto, forma o trazos de la capa activa) dibuja
    // su marco transformable (8 tiradores de escala, mástil de rotación e
    // insignia «+» para clonar) directamente sobre la vista, sin añadir UI DOM.
    const marked = findText(selectedTextIdRef.current);
    if (marked) {
      drawTransformGizmo(ctx, textTransformBoxOf(marked.text), displayScale.current);
    }
    const markedShape = findShape(selectedShapeIdRef.current);
    if (markedShape) {
      drawTransformGizmo(ctx, shapeTransformBoxOf(markedShape.shape), displayScale.current);
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

  const loadSourceDrawing = (layer: PaintLayer, image: string) => {
    const img = new Image();
    img.onload = () => {
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      if (img.width > 0 && img.height > 0 && (img.width !== layer.canvas.width || img.height !== layer.canvas.height)) {
        ctx.drawImage(img, 0, 0, layer.canvas.width, layer.canvas.height);
      } else {
        ctx.drawImage(img, 0, 0);
      }
      setHasArtwork(true);
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
    };
    img.onerror = () => console.error("No se pudo abrir el dibujo guardado para seguir editándolo.");
    img.src = image;
  };

  useEffect(() => {
    const buf = bufferRef.current ?? document.createElement("canvas");
    buf.width = sizeW; buf.height = sizeH;
    const bctx = buf.getContext("2d")!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bufferRef.current = buf;
    if (layersRef.current.length === 0) {
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
        texts: [],
        shapes: [],
      };
      layersRef.current = [firstLayer];
      activeLayerIdRef.current = initId;
      setLayers([firstLayer]);
      setActiveLayerId(initId);
      undoStack.current = [];
      redoStack.current = [];
      setHistory({ canUndo: false, canRedo: false });
      setHasArtwork(false);
      setTextInput(null);
      selectText(null);
      selectShape(null);
      floatingRasterRef.current = null;
      setHasFloatingRaster(false);
      if (sourceImage.current) loadSourceDrawing(firstLayer, sourceImage.current);
    }
    textEditSnapshot.current = false;
    shapeEditSnapshot.current = false;
    recomposite();
    blit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeW, sizeH]);

  useEffect(() => {
    if (tool !== "move" && tool !== "select" && floatingRasterRef.current) {
      commitFloatingRaster();
    }
    if (tool !== "move" && tool !== "select") setHoverHandle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useEffect(() => {
    if (floatingRasterRef.current && floatingRasterRef.current.layerId !== activeLayerId) {
      commitFloatingRaster();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerId]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const w = el.clientWidth - padX;
      const h = el.clientHeight - padY;
      setFitPx(Math.max(1, Math.floor(Math.min(w, h))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    pinchFrameTask.current = applyPinchFrame;
    const live = liveBox.current;
    if (live) applyLiveBox(live.w, live.h);
  });

  useLayoutEffect(() => {
    blit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitPx, zoom, sizeW, sizeH, showGrid, theme, brush, symmetryMode]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => blit());
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeW, sizeH]);

  const captureLayerImageData = (layer: PaintLayer): ImageData | undefined => {
    try {
      return layer.canvas.getContext("2d")!.getImageData(0, 0, sizeW, sizeH);
    } catch {
      return undefined;
    }
  };

  const captureAllLayersSnapshot = (): LayerSnapshotItem[] =>
    layersRef.current.map(l => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blendMode: l.blendMode,
      alphaLock: l.alphaLock,
      dataUrl: l.canvas.toDataURL("image/png"),
      imageData: captureLayerImageData(l),
      texts: l.texts.map(t => ({ ...t })),
      shapes: l.shapes.map(s => ({ ...s })),
    }));

  const pushSnapshot = () => {
    const layer = activeLayer(); if (!layer) return;
    artworkBeforeGesture.current = hasArtwork;
    undoStack.current.push({
      layerId: layer.id,
      dataUrl: layer.canvas.toDataURL("image/png"),
      imageData: captureLayerImageData(layer),
      texts: snapshotTexts(),
      shapes: snapshotShapes(),
    });
    if (undoStack.current.length > 32) undoStack.current.shift();
    redoStack.current = [];
    syncHistory();
    setHasArtwork(true);
    setPreviewVersion(v => v + 1);
  };

  const pushLayersSnapshot = () => {
    const layer = activeLayer();
    artworkBeforeGesture.current = hasArtwork;
    undoStack.current.push({
      layerId: layer?.id ?? "",
      dataUrl: layer ? layer.canvas.toDataURL("image/png") : "",
      imageData: layer ? captureLayerImageData(layer) : undefined,
      texts: snapshotTexts(),
      shapes: snapshotShapes(),
      allLayers: captureAllLayersSnapshot(),
      activeLayerId: activeLayerIdRef.current,
    });
    if (undoStack.current.length > 32) undoStack.current.shift();
    redoStack.current = [];
    syncHistory();
    setHasArtwork(true);
    setPreviewVersion(v => v + 1);
  };

  const getPos = (e: React.PointerEvent) => {
    const r = dragRect.current ?? canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * sizeW,
      y: ((e.clientY - r.top) / r.height) * sizeH,
    };
  };

  const drag = useRef<{
    active: boolean; tool: Tool;
    last: { x: number; y: number };
    start: { x: number; y: number };
    smooth: { x: number; y: number };
    transformHandle?: TransformHandle | null;
    transformStartBox?: TransformBox | null;
    textId?: string | null;
    textLayerId?: string | null;
    textStart?: TextObject | null;
    shapeId?: string | null;
    shapeLayerId?: string | null;
    shapeStart?: ShapeObject | null;
    rasterActive?: boolean;
    selectionActive?: boolean;
    selectionKind?: "rect" | "lasso";
  }>({ active: false, tool: "brush", last: { x: 0, y: 0 }, start: { x: 0, y: 0 }, smooth: { x: 0, y: 0 } });

  const strokeBackup = useRef<HTMLCanvasElement | null>(null);
  const strokeBackupLayerId = useRef<string | null>(null);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const stabilizerRef = useRef<StabilizerState | null>(null);
  const activeWidthRef = useRef<number>(6);

  const bctx = (): CanvasRenderingContext2D => {
    const layer = activeLayer();
    if (!layer) return bufferRef.current!.getContext("2d")!;
    return layer.canvas.getContext("2d")!;
  };
  const isLayerEditable = () => {
    const l = activeLayer();
    return !!l && l.visible && !l.locked;
  };

  const currentBrushOptions = (): BrushStrokeOptions => ({
    opacity: brushOpacity / 100,
    softness: brushSoftness / 100,
    alphaLock: !!activeLayer()?.alphaLock,
    symmetry: symmetryMode,
    canvasW: sizeW,
    canvasH: sizeH,
  });

  const strokeSegment = (x0: number, y0: number, x1: number, y1: number, erase: boolean, w?: number) => {
    const c = bctx();
    drawBrushPath(
      c,
      brush,
      color,
      w ?? width,
      [{ x: x0, y: y0, w: w ?? width }, { x: x1, y: y1, w: w ?? width }],
      erase,
      currentBrushOptions(),
    );
  };

  const redrawActiveCurve = (erase: boolean) => {
    const layer = activeLayer();
    const backup = strokeBackup.current;
    if (!layer || !backup || strokeBackupLayerId.current !== layer.id) return false;
    const c = layer.canvas.getContext("2d")!;
    c.clearRect(0, 0, sizeW, sizeH);
    c.drawImage(backup, 0, 0);
    const effectiveLevel = erase || brush === "pixel" ? 0 : stabilizeLevel;
    const refined = effectiveLevel > 0
      ? refineStrokePath(activePointsRef.current, effectiveLevel)
      : activePointsRef.current;
    drawBrushPath(c, brush, color, activeWidthRef.current, refined, erase, currentBrushOptions());
    return true;
  };

  const captureStrokeBackup = () => {
    const layer = activeLayer();
    if (!layer) return;
    let backup = strokeBackup.current;
    if (!backup) { backup = document.createElement("canvas"); strokeBackup.current = backup; }
    if (backup.width !== sizeW || backup.height !== sizeH) { backup.width = sizeW; backup.height = sizeH; }
    const c = backup.getContext("2d")!;
    c.clearRect(0, 0, sizeW, sizeH);
    c.drawImage(layer.canvas, 0, 0);
    strokeBackupLayerId.current = layer.id;
  };

  const stampDot = (x: number, y: number, erase: boolean, w?: number) => {
    const c = bctx();
    drawBrushPath(
      c,
      brush,
      color,
      w ?? width,
      [{ x, y, w: w ?? width }],
      erase,
      currentBrushOptions(),
    );
  };

  const floodFill = (sx: number, sy: number, hex: string) => {
    const layer = activeLayer();
    const c = bctx();
    const hasVectors = !!layer && (layer.shapes.length > 0 || layer.texts.length > 0);
    let workCtx = c;
    if (hasVectors && layer) {
      const temp = makeLayerCanvas();
      const tctx = temp.getContext("2d")!;
      tctx.drawImage(layer.canvas, 0, 0);
      for (const s of layer.shapes) paintShape(tctx, s);
      for (const t of layer.texts) drawTextObject(tctx, t);
      workCtx = tctx;
    }
    const img = workCtx.getImageData(0, 0, sizeW, sizeH);
    const before = hasVectors ? new Uint8ClampedArray(img.data) : null;
    const opts = {
      tolerance: fillTolerance,
      alphaLock: !!layer?.alphaLock,
      gradientMode: fillGradientMode,
      secondaryColor,
    };
    let changed = floodFillImageData(img.data, sizeW, sizeH, sx, sy, hex, opts);
    if (symmetryMode === "horizontal" || symmetryMode === "quad") {
      changed = floodFillImageData(img.data, sizeW, sizeH, sizeW - sx, sy, hex, opts) || changed;
    }
    if (symmetryMode === "vertical" || symmetryMode === "quad") {
      changed = floodFillImageData(img.data, sizeW, sizeH, sx, sizeH - sy, hex, opts) || changed;
    }
    if (symmetryMode === "quad") {
      changed = floodFillImageData(img.data, sizeW, sizeH, sizeW - sx, sizeH - sy, hex, opts) || changed;
    }
    if (!changed) return;
    if (hasVectors && before) {
      const targetImg = c.getImageData(0, 0, sizeW, sizeH);
      const dst = targetImg.data;
      const src = img.data;
      for (let i = 0; i < src.length; i += 4) {
        if (
          src[i] !== before[i] ||
          src[i + 1] !== before[i + 1] ||
          src[i + 2] !== before[i + 2] ||
          src[i + 3] !== before[i + 3]
        ) {
          dst[i] = src[i];
          dst[i + 1] = src[i + 1];
          dst[i + 2] = src[i + 2];
          dst[i + 3] = src[i + 3];
        }
      }
      c.putImageData(targetImg, 0, 0);
    } else {
      c.putImageData(img, 0, 0);
    }
  };

  const shapeDraftAt = (x0: number, y0: number, x1: number, y1: number, square: boolean): ShapeObject => {
    const end = square ? constrainShape(x0, y0, x1, y1) : { x1, y1 };
    return {
      id: "draft",
      shape: shapeKind,
      x0, y0,
      x1: end.x1, y1: end.y1,
      color,
      width,
      filled: shapeFilled && shapeClosed(shapeKind),
    };
  };

  /** Guarda un color en la fila de recientes (sin duplicados, hasta 12 muestras). */
  const rememberColor = (hex: string) => {
    const v = hex.toLowerCase();
    setRecent(prev => [v, ...prev.filter(c => c !== v)].slice(0, 12));
  };

  /** Elige un color y lo recuerda en la fila de recientes. */
  const paintColor = (hex: string) => {
    setColor(hex.toLowerCase());
    rememberColor(hex);
  };

  const pickColorAt = (x: number, y: number) => {
    const buf = bufferRef.current; if (!buf) return;
    const c = buf.getContext("2d")!;
    const d = c.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    if (d[3] === 0) return;
    const hex = "#" + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, "0")).join("");
    paintColor(hex);
  };

  const cancelStroke = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    selectionPointsRef.current = [];
    floatingRasterRef.current = null;
    setHasFloatingRaster(false);
    const backup = strokeBackupLayerId.current ? strokeBackup.current : null;
    const backupLayerId = strokeBackupLayerId.current;
    strokeBackupLayerId.current = null;
    const prev = undoStack.current.pop();
    syncHistory();
    setHasArtwork(artworkBeforeGesture.current);
    if (!prev) return;
    const layer = layersRef.current.find(l => l.id === prev.layerId);
    if (!layer) return;
    applyTextSnapshot(prev.texts);
    reconcileTextSelection();
    applyShapeSnapshot(prev.shapes);
    reconcileShapeSelection();
    if (backup && backupLayerId === layer.id) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      c.drawImage(backup, 0, 0);
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    if (prev.imageData) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      c.putImageData(prev.imageData, 0, 0);
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    restoringStroke.current = true;
    const img = new Image();
    img.onload = () => {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      c.drawImage(img, 0, 0);
      restoringStroke.current = false;
      recomposite(); blit();
      setPreviewVersion(v => v + 1);
    };
    img.onerror = () => {
      restoringStroke.current = false;
      console.error("No se pudo restaurar el trazo cancelado del lienzo.");
    };
    img.src = prev.dataUrl;
  };

  const onTouchDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, button, [data-canvas-handle]")) return;
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const captureTarget = e.target instanceof HTMLCanvasElement ? e.target : e.currentTarget;
    captureTarget.setPointerCapture(e.pointerId);
    if (touchPoints.current.size === 2 && !gestureBlocked.current) {
      gestureBlocked.current = true;
      cancelStroke();
      activePointerId.current = null;
      dragRect.current = null;
      setTextInput(null);
      gesturePixels.current = true;
      const entries = [...touchPoints.current.entries()];
      const [a, b] = entries.map(([, point]) => point);
      const box = boxRef.current;
      const focus = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      liveZoom.current = zoom;
      liveBox.current = null;
      pinch.current = {
        ids: entries.map(([id]) => id),
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        zoom,
        zooming: false,
        anchor: box ? pinchAnchor(box.getBoundingClientRect(), focus) : null,
        focus,
      };
    }
  };

  const onTouchMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return;
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch.current) return;
    schedulePinchFrame();
  };

  const onTouchEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    touchPoints.current.delete(e.pointerId);
    if (pinch.current?.ids.includes(e.pointerId)) {
      pinch.current = null;
      pinchFrames.current?.cancel();
      liveBox.current = null;
      if (liveZoom.current !== zoom) setZoom(liveZoom.current);
      endViewGesture();
    }
    if (touchPoints.current.size === 0) {
      gestureBlocked.current = false;
      endViewGesture();
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (gestureBlocked.current || restoringStroke.current || touchPoints.current.size > 1) return;
    activePointerId.current = e.pointerId;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRect.current = canvasRef.current!.getBoundingClientRect();
    blit();
    const p = getPos(e);
    if (tool === "picker") { pickColorAt(p.x, p.y); dragRect.current = null; return; }
    if (tool === "text") {
      const hit = hitTestText(p.x, p.y);
      if (hit) {
        activeLayerIdRef.current = hit.layer.id;
        setActiveLayerId(hit.layer.id);
        selectText(hit.text.id);
        setTextInput({ open: true, ...hit.text, value: hit.text.text });
        dragRect.current = null;
        return;
      }
      if (!isLayerEditable()) { dragRect.current = null; return; }
      setTextInput({ open: true, x: p.x, y: p.y, value: "", fontSize: Math.max(16, width * 4), font: "Rajdhani", color });
      dragRect.current = null;
      return;
    }
    if (tool === "shape") {
      if (!isLayerEditable()) { dragRect.current = null; return; }
      pushSnapshot();
      captureStrokeBackup();
      drag.current = { active: true, tool, last: p, start: p, smooth: p };
      selectText(null);
      selectShape(null);
      const draft = shapeDraftAt(p.x, p.y, p.x, p.y, e.shiftKey);
      blit(ctx => paintShape(ctx, draft));
      return;
    }
    if (tool === "move" || tool === "select") {
      const s = displayScale.current;
      const effectiveSelectionMode: SelectionMode =
        tool === "select" ? (selectionMode === "lasso" ? "lasso" : "rect") : selectionMode;

      // 1. Si ya hay un texto seleccionado, comprobar primero sus tiradores de transformación.
      const activeText = findText(selectedTextIdRef.current);
      if (activeText && !objectEditLocked(activeText.layer)) {
        const box = textTransformBoxOf(activeText.text);
        const h = hitTestTransformGizmo(box, p.x, p.y, s);
        if (h) {
          setTextInput(null);
          pushSnapshot();
          captureStrokeBackup();
          let targetText = activeText.text;
          const isClone = h === "clone" || (h === "body" && e.altKey);
          if (isClone) {
            const copy: TextObject = { ...targetText, id: uid() };
            updateTexts(activeText.layer.id, texts => [...texts, copy]);
            selectText(copy.id);
            targetText = copy;
          }
          drag.current = {
            active: true, tool, last: p, start: p, smooth: p,
            transformHandle: isClone ? (h === "clone" ? "clone" : "body") : h,
            transformStartBox: textTransformBoxOf(targetText),
            textId: targetText.id, textLayerId: activeText.layer.id,
            textStart: { ...targetText },
          };
          recomposite(); blit();
          return;
        }
      }

      // 2. Si ya hay una forma seleccionada, comprobar primero sus tiradores de transformación.
      const activeShape = findShape(selectedShapeIdRef.current);
      if (activeShape && !objectEditLocked(activeShape.layer)) {
        const box = shapeTransformBoxOf(activeShape.shape);
        const h = hitTestTransformGizmo(box, p.x, p.y, s);
        if (h) {
          setTextInput(null);
          pushSnapshot();
          captureStrokeBackup();
          let targetShape = activeShape.shape;
          const isClone = h === "clone" || (h === "body" && e.altKey);
          if (isClone) {
            const copy: ShapeObject = { ...targetShape, id: uid() };
            updateShapes(activeShape.layer.id, shapes => [...shapes, copy]);
            selectShape(copy.id);
            targetShape = copy;
          }
          drag.current = {
            active: true, tool, last: p, start: p, smooth: p,
            transformHandle: isClone ? (h === "clone" ? "clone" : "body") : h,
            transformStartBox: shapeTransformBoxOf(targetShape),
            shapeId: targetShape.id, shapeLayerId: activeShape.layer.id,
            shapeStart: { ...targetShape },
          };
          recomposite(); blit();
          return;
        }
      }

      // 3. Si hay una selección flotante de trazos de la capa activa, comprobar su marco.
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
              ctx.imageSmoothingEnabled = brush !== "pixel";
              ctx.imageSmoothingQuality = "high";
              drawFloatingRaster(ctx, floating);
            }
          }
          drag.current = {
            active: true, tool, last: p, start: p, smooth: p,
            transformHandle: isClone ? (h === "clone" ? "clone" : "body") : h,
            transformStartBox: { ...floating.box },
            rasterActive: true,
          };
          recomposite(); blit();
          return;
        }
        // Tocar fuera del marco estampa la selección flotante en la capa.
        commitFloatingRaster(false);
      }

      // Si la herramienta es Seleccionar o el modo es Marco/Lazo, empezar a trazar el área de selección.
      if ((effectiveSelectionMode === "rect" || effectiveSelectionMode === "lasso") && isLayerEditable()) {
        selectText(null);
        selectShape(null);
        selectionPointsRef.current = [{ x: p.x, y: p.y }];
        drag.current = {
          active: true,
          tool,
          last: p,
          start: p,
          smooth: p,
          selectionActive: true,
          selectionKind: effectiveSelectionMode,
        };
        recomposite();
        blit();
        return;
      }

      // 4. Comprobar si se toca un objeto de texto no seleccionado.
      const hitText = hitTestText(p.x, p.y);
      if (hitText) {
        if (hitText.layer.id !== activeLayerIdRef.current) {
          activeLayerIdRef.current = hitText.layer.id;
          setActiveLayerId(hitText.layer.id);
        }
        selectShape(null);
        setTextInput(null);
        pushSnapshot();
        captureStrokeBackup();
        let targetText = hitText.text;
        if (e.altKey) {
          const copy: TextObject = { ...targetText, id: uid() };
          updateTexts(hitText.layer.id, texts => [...texts, copy]);
          targetText = copy;
        }
        selectText(targetText.id);
        drag.current = {
          active: true, tool, last: p, start: p, smooth: p,
          transformHandle: "body",
          transformStartBox: textTransformBoxOf(targetText),
          textId: targetText.id, textLayerId: hitText.layer.id,
          textStart: { ...targetText },
        };
        recomposite(); blit();
        return;
      }

      // 5. Comprobar si se toca una forma no seleccionada.
      const hitShape = hitTestShapeObject(p.x, p.y);
      if (hitShape) {
        if (hitShape.layer.id !== activeLayerIdRef.current) {
          activeLayerIdRef.current = hitShape.layer.id;
          setActiveLayerId(hitShape.layer.id);
        }
        selectText(null);
        setTextInput(null);
        pushSnapshot();
        captureStrokeBackup();
        let targetShape = hitShape.shape;
        if (e.altKey) {
          const copy: ShapeObject = { ...targetShape, id: uid() };
          updateShapes(hitShape.layer.id, shapes => [...shapes, copy]);
          targetShape = copy;
        }
        selectShape(targetShape.id);
        drag.current = {
          active: true, tool, last: p, start: p, smooth: p,
          transformHandle: "body",
          transformStartBox: shapeTransformBoxOf(targetShape),
          shapeId: targetShape.id, shapeLayerId: hitShape.layer.id,
          shapeStart: { ...targetShape },
        };
        recomposite(); blit();
        return;
      }

      // 6. Si no se tocó ni texto ni forma y no había nada seleccionado:
      // si el toque cae directamente sobre un píxel pintado en modo Auto, levantar
      // los trazos; si cae en espacio vacío, trazar un área de selección rectangular.
      const hadObjectSelection = !!(selectedTextIdRef.current || selectedShapeIdRef.current);
      selectText(null);
      selectShape(null);
      if (!hadObjectSelection && isLayerEditable()) {
        const layer = activeLayer();
        if (layer) {
          const lctx = layer.canvas.getContext("2d")!;
          const img = lctx.getImageData(0, 0, sizeW, sizeH);
          const px = Math.max(0, Math.min(sizeW - 1, Math.floor(p.x)));
          const py = Math.max(0, Math.min(sizeH - 1, Math.floor(p.y)));
          let touchedPaintedPixel = false;
          for (let dy = -6; dy <= 6 && !touchedPaintedPixel; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
              const nx = px + dx;
              const ny = py + dy;
              if (nx >= 0 && nx < sizeW && ny >= 0 && ny < sizeH) {
                if (img.data[(ny * sizeW + nx) * 4 + 3] > 8) {
                  touchedPaintedPixel = true;
                  break;
                }
              }
            }
          }
          const bounds = touchedPaintedPixel ? findNonEmptyPixelBounds(img) : null;
          if (bounds) {
            pushSnapshot();
            captureStrokeBackup();
            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = bounds.w;
            srcCanvas.height = bounds.h;
            srcCanvas
              .getContext("2d")!
              .drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
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
            floatingRasterRef.current = {
              layerId: layer.id,
              sourceCanvas: srcCanvas,
              box,
            };
            setHasFloatingRaster(true);
            drag.current = {
              active: true, tool, last: p, start: p, smooth: p,
              transformHandle: "body",
              transformStartBox: { ...box },
              rasterActive: true,
            };
            recomposite(); blit();
            return;
          }
          // Arrastrar desde espacio vacío inicia una selección de área rectangular
          selectionPointsRef.current = [{ x: p.x, y: p.y }];
          drag.current = {
            active: true,
            tool,
            last: p,
            start: p,
            smooth: p,
            selectionActive: true,
            selectionKind: "rect",
          };
          recomposite();
          blit();
          return;
        }
      }

      dragRect.current = null;
      recomposite(); blit();
      return;
    }
    if (!isLayerEditable()) { dragRect.current = null; return; }
    if (tool === "fill") {
      rememberColor(color);
      pushSnapshot();
      captureStrokeBackup();
      drag.current = { active: true, tool, last: p, start: p, smooth: p };
      floodFill(p.x, p.y, color);
      recomposite(); blit();
      return;
    }
    // Lápiz y borrador.
    const erase = tool === "eraser";
    if (tool === "brush") rememberColor(color);
    if (erase) {
      selectText(null);
      selectShape(null);
    }
    drag.current = { active: true, tool, last: p, start: p, smooth: p };
    pushSnapshot();
    // Si se borra sobre una capa con formas o textos, rasterizarlos primero en el
    // bitmap de la capa para que el borrador pueda eliminarlos directamente.
    const currentLayer = activeLayer();
    if (erase && currentLayer && (currentLayer.shapes.length > 0 || currentLayer.texts.length > 0)) {
      const lctx = currentLayer.canvas.getContext("2d")!;
      lctx.save();
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = "source-over";
      for (const s of currentLayer.shapes) paintShape(lctx, s);
      for (const t of currentLayer.texts) drawTextObject(lctx, t);
      lctx.restore();
      const nextLayers = layersRef.current.map(l =>
        l.id === currentLayer.id ? { ...l, shapes: [], texts: [] } : l,
      );
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    }
    captureStrokeBackup();
    const isPen = e.pointerType === "pen";
    const pr = pressureOn && isPen && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
    const w = erase ? width : width * (pressureOn && isPen && brush !== "pixel" ? (0.4 + 1.2 * pr) : 1);
    activeWidthRef.current = w;
    activePointsRef.current = [{ x: p.x, y: p.y, w }];
    stabilizerRef.current = createStabilizerState(p, w);
    stampDot(p.x, p.y, tool === "eraser", w);
    recomposite();
    blit();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current.active) {
      if ((tool === "move" || tool === "select") && e.pointerType !== "touch") {
        const p = getPos(e);
        const s = displayScale.current;
        const activeText = findText(selectedTextIdRef.current);
        const activeShape = findShape(selectedShapeIdRef.current);
        const box = activeText
          ? textTransformBoxOf(activeText.text)
          : activeShape
            ? shapeTransformBoxOf(activeShape.shape)
            : floatingRasterRef.current?.box ?? null;
        const h = box ? hitTestTransformGizmo(box, p.x, p.y, s) : null;
        if (h !== hoverHandle) setHoverHandle(h);
      }
      return;
    }
    if (activePointerId.current !== e.pointerId) return;
    if (gestureBlocked.current || touchPoints.current.size > 1) return;
    const p = getPos(e);
    if (drag.current.tool === "brush" || drag.current.tool === "eraser") {
      const erase = drag.current.tool === "eraser";
      // Trazo recto asistido manteniendo Shift presionado
      if (e.shiftKey) {
        const startPt = activePointsRef.current[0] ?? { x: drag.current.start.x, y: drag.current.start.y, w: activeWidthRef.current };
        activePointsRef.current = [startPt, { x: p.x, y: p.y, w: activeWidthRef.current }];
        drag.current.last = { x: p.x, y: p.y };
        redrawActiveCurve(erase);
        recomposite();
        blit();
        return;
      }

      const r = dragRect.current!;
      const events = (typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : []) as PointerEvent[];
      const points = events.length ? events.map(ev => ({
        x: ((ev.clientX - r.left) / r.width) * sizeW,
        y: ((ev.clientY - r.top) / r.height) * sizeH,
        pressure: ev.pressure,
      })) : [{ x: p.x, y: p.y, pressure: e.pressure }];

      if (erase) {
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
      const effectiveLevel = brush === "pixel" ? 0 : stabilizeLevel;
      let addedPoints = false;

      for (const pt of points) {
        const pr = pressureOn && isPen && pt.pressure > 0 && pt.pressure !== 0.5 ? pt.pressure : 0.5;
        const w = width * (pressureOn && isPen && brush !== "pixel" ? (0.4 + 1.2 * pr) : 1);
        activeWidthRef.current = activeWidthRef.current * 0.7 + w * 0.3;

        if (stabilizerRef.current && effectiveLevel > 0) {
          const steps = advanceStabilizer(stabilizerRef.current, pt, activeWidthRef.current, effectiveLevel, false);
          for (const step of steps) {
            activePointsRef.current.push(step);
            drag.current.last = { x: step.x, y: step.y };
            addedPoints = true;
          }
        } else {
          let x1 = pt.x, y1 = pt.y;
          if (effectiveLevel > 0) {
            const smoothed = stabilizePoint(drag.current.last, pt, effectiveLevel);
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
        if (!redrawActiveCurve(false)) {
          const prev = activePointsRef.current[activePointsRef.current.length - 2] ?? drag.current.start;
          strokeSegment(prev.x, prev.y, drag.current.last.x, drag.current.last.y, false, activeWidthRef.current);
        }
        recomposite();
        blit();
      }
    } else if (drag.current.tool === "shape") {
      const draft = shapeDraftAt(drag.current.start.x, drag.current.start.y, p.x, p.y, e.shiftKey);
      blit(ctx => paintShape(ctx, draft));
    } else if ((drag.current.tool === "move" || drag.current.tool === "select") && drag.current.selectionActive) {
      const pts = selectionPointsRef.current;
      const lastPt = pts[pts.length - 1];
      if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) >= 1) {
        if (drag.current.selectionKind === "rect") {
          selectionPointsRef.current = [pts[0] ?? p, { x: p.x, y: p.y }];
        } else {
          selectionPointsRef.current.push({ x: p.x, y: p.y });
        }
        blit();
      }
    } else if ((drag.current.tool === "move" || drag.current.tool === "select") && drag.current.rasterActive && floatingRasterRef.current && drag.current.transformStartBox) {
      const startBox = drag.current.transformStartBox;
      const handle = drag.current.transformHandle ?? "body";
      if (handle === "body" || handle === "clone") {
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
    } else if ((drag.current.tool === "move" || drag.current.tool === "select") && drag.current.shapeId && drag.current.shapeLayerId && drag.current.shapeStart && drag.current.transformStartBox) {
      const id = drag.current.shapeId;
      const layerId = drag.current.shapeLayerId;
      const s0 = drag.current.shapeStart;
      const startBox = drag.current.transformStartBox;
      const handle = drag.current.transformHandle ?? "body";
      let patch: Partial<ShapeObject>;

      if (handle === "body" || handle === "clone") {
        const dx = Math.round(p.x - drag.current.start.x);
        const dy = Math.round(p.y - drag.current.start.y);
        patch = translateShape(s0, dx, dy);
      } else if (handle === "rotate") {
        const cx = startBox.x + startBox.w / 2;
        const cy = startBox.y + startBox.h / 2;
        patch = { rotation: computeRotationAngle(cx, cy, p.x, p.y, e.shiftKey) };
      } else {
        const scaled = computeScaledBox(startBox, handle, p.x, p.y, e.shiftKey, 4);
        const xForward = s0.x0 <= s0.x1;
        const yForward = s0.y0 <= s0.y1;
        patch = {
          x0: Math.round(xForward ? scaled.x : scaled.x + scaled.w),
          x1: Math.round(xForward ? scaled.x + scaled.w : scaled.x),
          y0: Math.round(yForward ? scaled.y : scaled.y + scaled.h),
          y1: Math.round(yForward ? scaled.y + scaled.h : scaled.y),
          flipX: scaled.flipX,
          flipY: scaled.flipY,
          rotation: scaled.rotation,
        };
      }

      layersRef.current = layersRef.current.map(l =>
        l.id === layerId
          ? { ...l, shapes: l.shapes.map(s => (s.id === id ? { ...s, ...patch } : s)) }
          : l,
      );
      recomposite(); blit();
    } else if ((drag.current.tool === "move" || drag.current.tool === "select") && drag.current.textId && drag.current.textLayerId && drag.current.textStart && drag.current.transformStartBox) {
      const id = drag.current.textId;
      const layerId = drag.current.textLayerId;
      const t0 = drag.current.textStart;
      const startBox = drag.current.transformStartBox;
      const handle = drag.current.transformHandle ?? "body";
      let patch: Partial<TextObject>;

      if (handle === "body" || handle === "clone") {
        const dx = Math.round(p.x - drag.current.start.x);
        const dy = Math.round(p.y - drag.current.start.y);
        patch = { x: Math.round(t0.x + dx), y: Math.round(t0.y + dy) };
      } else if (handle === "rotate") {
        const cx = startBox.x + startBox.w / 2;
        const cy = startBox.y + startBox.h / 2;
        patch = { rotation: computeRotationAngle(cx, cy, p.x, p.y, e.shiftKey) };
      } else {
        const scaled = computeScaledBox(startBox, handle, p.x, p.y, e.shiftKey, 6);
        const baseM = measureTextObject({ ...t0, scaleX: 1, scaleY: 1 });
        patch = {
          x: Math.round(scaled.x),
          y: Math.round(scaled.y),
          scaleX: Math.max(0.2, Math.min(20, scaled.w / Math.max(1, baseM.rawW))),
          scaleY: Math.max(0.2, Math.min(20, scaled.h / Math.max(1, baseM.rawH))),
          flipX: scaled.flipX,
          flipY: scaled.flipY,
          rotation: scaled.rotation,
        };
      }

      layersRef.current = layersRef.current.map(l =>
        l.id === layerId
          ? { ...l, texts: l.texts.map(t => (t.id === id ? { ...t, ...patch } : t)) }
          : l,
      );
      recomposite(); blit();
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    if (activePointerId.current !== e.pointerId) return;
    const p = getPos(e);
    const t = drag.current.tool;
    if (t === "brush" || t === "eraser") {
      const erase = t === "eraser";
      const effectiveLevel = brush === "pixel" ? 0 : stabilizeLevel;
      if (erase && !e.shiftKey) {
        if (Math.hypot(p.x - drag.current.last.x, p.y - drag.current.last.y) >= 0.1) {
          strokeSegment(drag.current.last.x, drag.current.last.y, p.x, p.y, true, width);
        }
        activePointsRef.current = [];
        stabilizerRef.current = null;
        recomposite();
        blit();
      } else {
        if (e.shiftKey) {
          const startPt = activePointsRef.current[0] ?? { x: drag.current.start.x, y: drag.current.start.y, w: activeWidthRef.current };
          activePointsRef.current = [startPt, { x: p.x, y: p.y, w: activeWidthRef.current }];
        } else if (stabilizerRef.current && effectiveLevel > 0) {
          const tailSteps = advanceStabilizer(stabilizerRef.current, p, activeWidthRef.current, effectiveLevel, true);
          for (const step of tailSteps) {
            activePointsRef.current.push(step);
            drag.current.last = { x: step.x, y: step.y };
          }
        } else if (Math.hypot(p.x - drag.current.last.x, p.y - drag.current.last.y) >= 0.25) {
          activePointsRef.current.push({ x: p.x, y: p.y, w: activeWidthRef.current });
          drag.current.last = p;
        }
        if (!redrawActiveCurve(erase)) {
          strokeSegment(drag.current.last.x, drag.current.last.y, p.x, p.y, erase, activeWidthRef.current);
        }
        activePointsRef.current = [];
        stabilizerRef.current = null;
        recomposite(); blit();
      }
    } else if (t === "shape") {
      const from = drag.current.start;
      const draft = shapeDraftAt(from.x, from.y, p.x, p.y, e.shiftKey);
      if (shapeBox(draft.x0, draft.y0, draft.x1, draft.y1).w < 2 && shapeBox(draft.x0, draft.y0, draft.x1, draft.y1).h < 2) {
        cancelStroke();
      } else {
        addShapeObject({ ...draft, id: uid() });
        recomposite(); blit();
      }
    } else if ((t === "move" || t === "select") && drag.current.selectionActive) {
      const pts = selectionPointsRef.current;
      const selKind = drag.current.selectionKind ?? (selectionMode === "lasso" ? "lasso" : "rect");
      selectionPointsRef.current = [];
      drag.current.selectionActive = false;
      const layer = activeLayer();
      if (layer && isLayerEditable() && pts.length >= 2) {
        const lctx = layer.canvas.getContext("2d")!;
        const img = lctx.getImageData(0, 0, sizeW, sizeH);
        if (selKind === "rect") {
          const p0 = pts[0];
          const p1 = pts[pts.length - 1];
          const rx = Math.max(0, Math.floor(Math.min(p0.x, p1.x)));
          const ry = Math.max(0, Math.floor(Math.min(p0.y, p1.y)));
          const rw = Math.min(sizeW - rx, Math.ceil(Math.abs(p1.x - p0.x)));
          const rh = Math.min(sizeH - ry, Math.ceil(Math.abs(p1.y - p0.y)));
          if (rw >= 2 && rh >= 2) {
            const bounds = findNonEmptyPixelBounds(img, { x: rx, y: ry, w: rw, h: rh });
            if (bounds) {
              pushSnapshot();
              const srcCanvas = document.createElement("canvas");
              srcCanvas.width = bounds.w;
              srcCanvas.height = bounds.h;
              srcCanvas
                .getContext("2d")!
                .drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
              if (!e.altKey) {
                lctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
              }
              floatingRasterRef.current = {
                layerId: layer.id,
                sourceCanvas: srcCanvas,
                box: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotation: 0, flipX: false, flipY: false },
              };
              setHasFloatingRaster(true);
            }
          }
        } else if (selKind === "lasso" && pts.length >= 3) {
          const bounds = findLassoPixelBounds(img, pts);
          if (bounds) {
            pushSnapshot();
            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = bounds.w;
            srcCanvas.height = bounds.h;
            const sctx = srcCanvas.getContext("2d")!;
            const subImg = sctx.createImageData(bounds.w, bounds.h);
            const srcData = img.data;
            const dstData = subImg.data;
            for (let y = 0; y < bounds.h; y++) {
              for (let x = 0; x < bounds.w; x++) {
                const wx = bounds.x + x;
                const wy = bounds.y + y;
                if (pointInPolygon(wx + 0.5, wy + 0.5, pts)) {
                  const si = (wy * sizeW + wx) * 4;
                  const di = (y * bounds.w + x) * 4;
                  dstData[di] = srcData[si];
                  dstData[di + 1] = srcData[si + 1];
                  dstData[di + 2] = srcData[si + 2];
                  dstData[di + 3] = srcData[si + 3];
                  if (!e.altKey) {
                    srcData[si + 3] = 0;
                  }
                }
              }
            }
            sctx.putImageData(subImg, 0, 0);
            if (!e.altKey) {
              lctx.putImageData(img, 0, 0);
            }
            floatingRasterRef.current = {
              layerId: layer.id,
              sourceCanvas: srcCanvas,
              box: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotation: 0, flipX: false, flipY: false },
            };
            setHasFloatingRaster(true);
          }
        }
      }
      recomposite();
      blit();
    } else if (t === "move" || t === "select") {
      const tapDist = Math.hypot(p.x - drag.current.start.x, p.y - drag.current.start.y) * displayScale.current;
      const handle = drag.current.transformHandle;
      if (handle === "clone" && tapDist < 6) {
        if (drag.current.textId && drag.current.textLayerId && drag.current.textStart) {
          const id = drag.current.textId;
          const layerId = drag.current.textLayerId;
          const t0 = drag.current.textStart;
          layersRef.current = layersRef.current.map(l =>
            l.id === layerId
              ? { ...l, texts: l.texts.map(tx => (tx.id === id ? { ...tx, x: t0.x + 12, y: t0.y + 12 } : tx)) }
              : l,
          );
        } else if (drag.current.shapeId && drag.current.shapeLayerId && drag.current.shapeStart) {
          const id = drag.current.shapeId;
          const layerId = drag.current.shapeLayerId;
          const moved = translateShape(drag.current.shapeStart, 12, 12);
          layersRef.current = layersRef.current.map(l =>
            l.id === layerId
              ? { ...l, shapes: l.shapes.map(sh => (sh.id === id ? { ...sh, ...moved } : sh)) }
              : l,
          );
        } else if (drag.current.rasterActive && floatingRasterRef.current && drag.current.transformStartBox) {
          floatingRasterRef.current.box = {
            ...drag.current.transformStartBox,
            x: drag.current.transformStartBox.x + 12,
            y: drag.current.transformStartBox.y + 12,
          };
        }
      }
      setLayers([...layersRef.current]);
      if (handle === "body" && !e.altKey && tapDist < 6) {
        const hit = findText(drag.current.textId ?? null);
        if (hit) setTextInput({ open: true, ...hit.text, value: hit.text.text });
      }
      drag.current.transformHandle = null;
      drag.current.transformStartBox = null;
      drag.current.textId = null;
      drag.current.textLayerId = null;
      drag.current.textStart = null;
      drag.current.shapeId = null;
      drag.current.shapeLayerId = null;
      drag.current.shapeStart = null;
      drag.current.rasterActive = false;
      recomposite(); blit();
    }
    drag.current.active = false;
    activePointerId.current = null;
    dragRect.current = null;
    strokeBackupLayerId.current = null;
    setPreviewVersion(v => v + 1);
  };

  const commitText = () => {
    const state = textInput;
    if (!state || !state.value.trim()) { setTextInput(null); return; }
    const layer = activeLayer();
    if (!layer || !isLayerEditable()) { setTextInput(null); return; }
    commitFloatingRaster(false);
    rememberColor(state.color);
    pushSnapshot();
    const existing = state.id ? findText(state.id)?.text : undefined;
    const obj: TextObject = {
      id: state.id ?? uid(),
      text: state.value,
      x: Math.round(state.x),
      y: Math.round(state.y),
      fontSize: Math.max(8, Math.min(200, Math.round(state.fontSize) || 16)),
      font: state.font,
      color: state.color,
      scaleX: existing?.scaleX,
      scaleY: existing?.scaleY,
      rotation: existing?.rotation,
      flipX: existing?.flipX,
      flipY: existing?.flipY,
    };
    updateTexts(layer.id, texts => state.id ? texts.map(t => t.id === state.id ? obj : t) : [...texts, obj]);
    setTextInput(null);
    selectShape(null);
    selectText(obj.id);
    setTool("move");
    setHasArtwork(true);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  /** Restaura un punto de deshacer: pila completa de capas o bitmap de una capa + objetos. */
  const applySnapshot = (snap: Snapshot, target: Snapshot[]) => {
    if (drag.current.active) {
      drag.current.active = false;
      activePointerId.current = null;
      dragRect.current = null;
      strokeBackupLayerId.current = null;
      activePointsRef.current = [];
      stabilizerRef.current = null;
      selectionPointsRef.current = [];
    }
    floatingRasterRef.current = null;
    setHasFloatingRaster(false);
    if (snap.allLayers) {
      const curActive = activeLayer();
      target.push({
        layerId: curActive?.id ?? "",
        dataUrl: curActive ? curActive.canvas.toDataURL("image/png") : "",
        imageData: curActive ? captureLayerImageData(curActive) : undefined,
        texts: snapshotTexts(),
        shapes: snapshotShapes(),
        allLayers: captureAllLayersSnapshot(),
        activeLayerId: activeLayerIdRef.current,
      });
      const restored: PaintLayer[] = snap.allLayers.map(item => {
        const canvas = makeLayerCanvas();
        if (item.imageData) {
          const c = canvas.getContext("2d")!;
          c.clearRect(0, 0, sizeW, sizeH);
          c.putImageData(item.imageData, 0, 0);
        }
        return {
          id: item.id,
          name: item.name,
          visible: item.visible,
          locked: item.locked,
          opacity: item.opacity,
          blendMode: item.blendMode ?? "source-over",
          alphaLock: !!item.alphaLock,
          canvas,
          texts: item.texts.map(t => ({ ...t })),
          shapes: item.shapes.map(s => ({ ...s })),
        };
      });
      layersRef.current = restored;
      setLayers(restored);
      const nextActiveId =
        snap.activeLayerId && restored.some(l => l.id === snap.activeLayerId)
          ? snap.activeLayerId
          : restored[restored.length - 1]?.id ?? "";
      activeLayerIdRef.current = nextActiveId;
      setActiveLayerId(nextActiveId);
      reconcileTextSelection();
      reconcileShapeSelection();
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      snap.allLayers.forEach((item, idx) => {
        if (item.imageData || !item.dataUrl) return;
        const targetLayer = restored[idx];
        const img = new Image();
        img.onload = () => {
          const c = targetLayer.canvas.getContext("2d")!;
          c.clearRect(0, 0, sizeW, sizeH);
          c.drawImage(img, 0, 0);
          recomposite();
          blit();
          setPreviewVersion(v => v + 1);
        };
        img.src = item.dataUrl;
      });
      return;
    }
    const layer = layersRef.current.find(l => l.id === snap.layerId);
    target.push({
      layerId: snap.layerId,
      dataUrl: layer ? layer.canvas.toDataURL("image/png") : "",
      imageData: layer ? captureLayerImageData(layer) : undefined,
      texts: snapshotTexts(),
      shapes: snapshotShapes(),
    });
    applyTextSnapshot(snap.texts);
    reconcileTextSelection();
    applyShapeSnapshot(snap.shapes);
    reconcileShapeSelection();
    if (!layer) {
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    if (snap.imageData) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      c.putImageData(snap.imageData, 0, 0);
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    if (!snap.dataUrl) {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      recomposite();
      blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    recomposite();
    blit();
    const img = new Image();
    img.onload = () => {
      const c = layer.canvas.getContext("2d")!;
      c.clearRect(0, 0, sizeW, sizeH);
      c.drawImage(img, 0, 0);
      recomposite(); blit(); setPreviewVersion(v => v + 1);
    };
    img.src = snap.dataUrl;
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    applySnapshot(prev, redoStack.current);
    syncHistory();
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    applySnapshot(next, undoStack.current);
    syncHistory();
  };

  const clearActiveLayer = () => {
    if (!isLayerEditable()) return;
    floatingRasterRef.current = null;
    setHasFloatingRaster(false);
    pushSnapshot();
    const c = bctx();
    c.clearRect(0, 0, sizeW, sizeH);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };
  const clearAll = () => {
    if (!isLayerEditable()) return;
    setPendingConfirm({
      title: "¿Limpiar la capa activa?",
      description: "Se borra el contenido de la capa seleccionada. Puedes deshacerlo.",
      confirmLabel: "LIMPIAR",
      destructive: true,
      action: clearActiveLayer,
    });
  };

  const save = () => {
    commitFloatingRaster(false);
    recomposite();
    const buf = bufferRef.current; if (!buf) return;
    const dataUrl = buf.toDataURL("image/png");
    const asset: SpriteAsset = {
      id: uid(),
      name: name.trim() || "drawing",
      width: sizeW,
      height: sizeH,
      fps: 8,
      loop: true,
      frames: [{ id: uid(), layers: [], composite: dataUrl }],
    };
    onSave(asset);
  };

  // Acciones siempre frescas para el listener de teclado (se registra una vez).
  const actionsRef = useRef({
    undo, redo, save,
    deleteSelectedText, duplicateSelectedText, clearTextSelection: () => selectText(null),
    deleteSelectedShape, duplicateSelectedShape, clearShapeSelection: () => selectShape(null),
    commitFloatingRaster, duplicateFloatingRaster, deleteFloatingRaster,
    copySelectionToClipboard, cutSelectionToClipboard, pasteFromClipboard,
  });
  useEffect(() => {
    actionsRef.current = {
      undo, redo, save,
      deleteSelectedText, duplicateSelectedText, clearTextSelection: () => selectText(null),
      deleteSelectedShape, duplicateSelectedShape, clearShapeSelection: () => selectShape(null),
      commitFloatingRaster, duplicateFloatingRaster, deleteFloatingRaster,
      copySelectionToClipboard, cutSelectionToClipboard, pasteFromClipboard,
    };
  });

  // Atajos: herramientas con una letra, historial con modificador, portapapeles y zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (t?.closest('[data-paint-quick-setting]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) actionsRef.current.redo(); else actionsRef.current.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); actionsRef.current.redo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); actionsRef.current.save(); return; }
      if (!typing && mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        actionsRef.current.copySelectionToClipboard();
        return;
      }
      if (!typing && mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        actionsRef.current.cutSelectionToClipboard();
        return;
      }
      if (!typing && mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        actionsRef.current.pasteFromClipboard();
        return;
      }
      if (!typing && selectedTextIdRef.current) {
        if (e.key === "Escape") { e.preventDefault(); actionsRef.current.clearTextSelection(); blit(); return; }
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); actionsRef.current.deleteSelectedText(); return; }
        if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); actionsRef.current.duplicateSelectedText(); return; }
      }
      if (!typing && selectedShapeIdRef.current) {
        if (e.key === "Escape") { e.preventDefault(); actionsRef.current.clearShapeSelection(); blit(); return; }
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); actionsRef.current.deleteSelectedShape(); return; }
        if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); actionsRef.current.duplicateSelectedShape(); return; }
      }
      if (!typing && floatingRasterRef.current) {
        if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); actionsRef.current.commitFloatingRaster(); return; }
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); actionsRef.current.deleteFloatingRaster(); return; }
        if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); actionsRef.current.duplicateFloatingRaster(); return; }
      }
      if (mod || typing) return;
      const key = e.key.toLowerCase();
      const shapeFromKey = SHAPE_BY_KEY[key];
      if (shapeFromKey) { setShapeKind(shapeFromKey); setTool("shape"); return; }
      const next = TOOL_BY_KEY[key];
      if (next) { setTool(next); return; }
      if (e.key === "[") setWidth(w => Math.max(1, w - 1));
      if (e.key === "]") setWidth(w => Math.min(48, w + 1));
      if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- Layer & Canvas operations (panel) ----------
  const addLayer = () => {
    commitFloatingRaster(false);
    pushLayersSnapshot();
    const newL: PaintLayer = {
      id: uid(),
      name: `Capa ${layersRef.current.length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      alphaLock: false,
      canvas: makeLayerCanvas(),
      texts: [],
      shapes: [],
    };
    const next = [...layersRef.current, newL];
    layersRef.current = next;
    setLayers(next);
    setActiveLayerId(newL.id);
    activeLayerIdRef.current = newL.id;
    recomposite(); blit();
  };
  const duplicateLayer = (id: string) => {
    commitFloatingRaster(false);
    const idx = layersRef.current.findIndex(l => l.id === id);
    if (idx < 0) return;
    pushLayersSnapshot();
    const src = layersRef.current[idx];
    const c = makeLayerCanvas();
    c.getContext("2d")!.drawImage(src.canvas, 0, 0);
    const copy: PaintLayer = {
      ...src,
      id: uid(),
      name: src.name + " copia",
      canvas: c,
      texts: src.texts.map(t => ({ ...t, id: uid() })),
      shapes: src.shapes.map(s => ({ ...s, id: uid() })),
    };
    const next = [...layersRef.current];
    next.splice(idx + 1, 0, copy);
    layersRef.current = next;
    setLayers(next);
    setActiveLayerId(copy.id);
    activeLayerIdRef.current = copy.id;
    recomposite(); blit();
  };
  const removeLayer = (id: string) => {
    if (layersRef.current.length <= 1) return;
    if (floatingRasterRef.current?.layerId === id) {
      floatingRasterRef.current = null;
      setHasFloatingRaster(false);
    }
    pushLayersSnapshot();
    const next = layersRef.current.filter(l => l.id !== id);
    layersRef.current = next;
    setLayers(next);
    if (activeLayerIdRef.current === id) {
      const fallback = next[next.length - 1].id;
      setActiveLayerId(fallback);
      activeLayerIdRef.current = fallback;
    }
    reconcileTextSelection();
    reconcileShapeSelection();
    recomposite(); blit();
  };
  const deleteLayer = (id: string) => {
    if (layersRef.current.length <= 1) return;
    const target = layersRef.current.find(l => l.id === id);
    setPendingConfirm({
      title: "¿Borrar esta capa?",
      description: target ? `Se eliminará «${target.name}» con todo su contenido.` : undefined,
      confirmLabel: "BORRAR",
      destructive: true,
      action: () => removeLayer(id),
    });
  };
  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = layersRef.current.findIndex(l => l.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= layersRef.current.length) return;
    pushLayersSnapshot();
    const next = [...layersRef.current];
    [next[idx], next[j]] = [next[j], next[idx]];
    layersRef.current = next;
    setLayers(next);
    recomposite(); blit();
  };
  const mergeDown = (id: string) => {
    commitFloatingRaster(false);
    const idx = layersRef.current.findIndex(l => l.id === id);
    if (idx <= 0) return;
    pushLayersSnapshot();
    const top = layersRef.current[idx];
    const below = layersRef.current[idx - 1];
    const c = below.canvas.getContext("2d")!;
    if (below.shapes.length > 0 || below.texts.length > 0) {
      c.save();
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      for (const s of below.shapes) paintShape(c, s);
      for (const t of below.texts) drawTextObject(c, t);
      c.restore();
    }
    const topHasCustomComposite =
      Math.abs(top.opacity - 1) > 0.001 || (top.blendMode && top.blendMode !== "source-over");
    let remainingShapes: ShapeObject[] = [];
    let remainingTexts: TextObject[] = [];
    if (topHasCustomComposite) {
      const topComp = makeLayerCanvas();
      const tctx = topComp.getContext("2d")!;
      tctx.drawImage(top.canvas, 0, 0);
      for (const s of top.shapes) paintShape(tctx, s);
      for (const t of top.texts) drawTextObject(tctx, t);
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, top.opacity));
      c.globalCompositeOperation = top.blendMode ?? "source-over";
      c.drawImage(topComp, 0, 0);
      c.restore();
    } else {
      c.save();
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      c.drawImage(top.canvas, 0, 0);
      c.restore();
      remainingShapes = top.shapes.map(s => ({ ...s }));
      remainingTexts = top.texts.map(t => ({ ...t }));
    }
    const next = layersRef.current
      .filter(l => l.id !== id)
      .map(l => l.id === below.id ? { ...l, texts: remainingTexts, shapes: remainingShapes } : l);
    layersRef.current = next;
    setLayers(next);
    if (activeLayerIdRef.current === id) {
      setActiveLayerId(below.id);
      activeLayerIdRef.current = below.id;
    }
    reconcileTextSelection();
    reconcileShapeSelection();
    recomposite(); blit();
  };
  const flattenNow = () => {
    commitFloatingRaster(false);
    pushLayersSnapshot();
    selectText(null);
    selectShape(null);
    recomposite();
    const buf = bufferRef.current!;
    const merged = makeLayerCanvas();
    merged.getContext("2d")!.drawImage(buf, 0, 0);
    const single: PaintLayer = {
      id: uid(),
      name: "Aplanada",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      alphaLock: false,
      canvas: merged,
      texts: [],
      shapes: [],
    };
    layersRef.current = [single];
    setLayers([single]);
    setActiveLayerId(single.id);
    activeLayerIdRef.current = single.id;
    recomposite(); blit();
  };
  const flatten = () => {
    setPendingConfirm({
      title: "¿Aplanar todas las capas?",
      description: "Todas las capas visibles se combinarán en una sola. Puedes deshacerlo con Ctrl+Z.",
      confirmLabel: "APLANAR",
      destructive: true,
      action: flattenNow,
    });
  };
  const updateLayer = (id: string, p: Partial<PaintLayer>) => {
    const next = layersRef.current.map(l => l.id === id ? { ...l, ...p } : l);
    layersRef.current = next;
    setLayers(next);
    recomposite(); blit();
  };

  /** Voltea horizontal o verticalmente la selección flotante, el objeto activo o la capa activa. */
  const flipActiveTarget = (axis: "x" | "y") => {
    if (floatingRasterRef.current) {
      pushSnapshot();
      floatingRasterRef.current.box = {
        ...floatingRasterRef.current.box,
        flipX: axis === "x" ? !floatingRasterRef.current.box.flipX : floatingRasterRef.current.box.flipX,
        flipY: axis === "y" ? !floatingRasterRef.current.box.flipY : floatingRasterRef.current.box.flipY,
      };
      recomposite(); blit();
      setPreviewVersion(v => v + 1);
      return;
    }
    if (selectedTextIdRef.current) {
      const found = findText(selectedTextIdRef.current);
      if (found && !objectEditLocked(found.layer)) {
        pushSnapshot();
        updateSelectedText(axis === "x" ? { flipX: !found.text.flipX } : { flipY: !found.text.flipY });
      }
      return;
    }
    if (selectedShapeIdRef.current) {
      const found = findShape(selectedShapeIdRef.current);
      if (found && !objectEditLocked(found.layer)) {
        pushSnapshot();
        updateSelectedShape(axis === "x" ? { flipX: !found.shape.flipX } : { flipY: !found.shape.flipY });
      }
      return;
    }
    const layer = activeLayer();
    if (!layer || !isLayerEditable()) return;
    pushSnapshot();
    const tmp = makeLayerCanvas();
    const tctx = tmp.getContext("2d")!;
    tctx.save();
    tctx.translate(axis === "x" ? sizeW : 0, axis === "y" ? sizeH : 0);
    tctx.scale(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1);
    tctx.drawImage(layer.canvas, 0, 0);
    tctx.restore();
    const lctx = layer.canvas.getContext("2d")!;
    lctx.clearRect(0, 0, sizeW, sizeH);
    lctx.drawImage(tmp, 0, 0);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  /** Voltea todo el lienzo (todas las capas, textos y formas) horizontal o verticalmente. */
  const flipEntireCanvas = (axis: "x" | "y") => {
    commitFloatingRaster(false);
    pushLayersSnapshot();
    const next = layersRef.current.map(layer => {
      const out = makeLayerCanvas();
      const ctx = out.getContext("2d")!;
      ctx.save();
      ctx.translate(axis === "x" ? sizeW : 0, axis === "y" ? sizeH : 0);
      ctx.scale(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
      const texts = layer.texts.map(t => {
        const m = measureTextObject(t);
        return {
          ...t,
          x: axis === "x" ? Math.round(sizeW - t.x - m.w) : t.x,
          y: axis === "y" ? Math.round(sizeH - t.y - m.h) : t.y,
          flipX: axis === "x" ? !t.flipX : t.flipX,
          flipY: axis === "y" ? !t.flipY : t.flipY,
        };
      });
      const shapes = layer.shapes.map(s => ({
        ...s,
        x0: axis === "x" ? sizeW - s.x0 : s.x0,
        x1: axis === "x" ? sizeW - s.x1 : s.x1,
        y0: axis === "y" ? sizeH - s.y0 : s.y0,
        y1: axis === "y" ? sizeH - s.y1 : s.y1,
        flipX: axis === "x" ? !s.flipX : s.flipX,
        flipY: axis === "y" ? !s.flipY : s.flipY,
      }));
      return { ...layer, canvas: out, texts, shapes };
    });
    layersRef.current = next;
    setLayers(next);
    recomposite(); blit();
    setPreviewVersion(v => v + 1);
  };

  /** Importa una imagen desde el dispositivo como selección flotante transformable en la capa activa. */
  const handleImportImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const layer = activeLayer();
    if (!layer || !isLayerEditable()) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        commitFloatingRaster(false);
        selectText(null);
        selectShape(null);
        pushSnapshot();
        const maxW = sizeW * 0.85;
        const maxH = sizeH * 0.85;
        const ratio = Math.min(1, maxW / Math.max(1, img.width), maxH / Math.max(1, img.height));
        const targetW = Math.max(4, Math.round(img.width * ratio));
        const targetH = Math.max(4, Math.round(img.height * ratio));
        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        srcCanvas.getContext("2d")!.drawImage(img, 0, 0);
        floatingRasterRef.current = {
          layerId: layer.id,
          sourceCanvas: srcCanvas,
          box: {
            x: Math.round((sizeW - targetW) / 2),
            y: Math.round((sizeH - targetH) / 2),
            w: targetW,
            h: targetH,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
        };
        setHasFloatingRaster(true);
        setTool("move");
        setHasArtwork(true);
        recomposite();
        blit();
        setPreviewVersion(v => v + 1);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // ---------- Tamaño del lienzo (se recorta o se añade, nunca se estira) ----------
  /**
   * Cambia el tamaño del lienzo SIN tocar la escala del dibujo: el contenido se
   * conserva 1:1 desde la esquina, así que agrandar añade superficie vacía y
   * reducir recorta lo que sobra. Los textos y las formas mantienen su tamaño y
   * su sitio: si quedan fuera del lienzo nuevo se recortan, y al agrandarlo otra
   * vez reaparecen. Nada se reescala, así que la obra nunca se deforma.
   */
  const resizeCanvas = (next: CanvasSize) => {
    if (next.w === sizeW && next.h === sizeH) return;
    commitFloatingRaster(false);
    const kept = keptArea(canvas, next);
    const resized = layersRef.current.map(layer => {
      const out = document.createElement("canvas");
      out.width = next.w; out.height = next.h;
      const c = out.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      // Copia el área que sobrevive, 1:1 y desde la esquina: aquí no hay ninguna
      // escala, solo recorte (y un trozo nuevo, que queda vacío).
      c.drawImage(layer.canvas, kept.x, kept.y, kept.w, kept.h, kept.x, kept.y, kept.w, kept.h);
      return { ...layer, canvas: out };
    });
    layersRef.current = resized;
    setLayers(resized);
    // Los puntos de deshacer guardan bitmaps del tamaño anterior.
    undoStack.current = [];
    redoStack.current = [];
    syncHistory();
    strokeBackupLayerId.current = null;
    textEditSnapshot.current = false;
    shapeEditSnapshot.current = false;
    setCanvas(next);
  };

  /** Los atajos de tamaño dejan el lienzo cuadrado, recortando o añadiendo. */
  const changeSize = (side: number) => resizeCanvas({ w: clampCanvasSide(side), h: clampCanvasSide(side) });

  // Miniatura compuesta para la barra superior (derivada del ESTADO, no de refs).
  const thumb = useMemo(() => {
    try {
      const c = document.createElement("canvas");
      c.width = sizeW; c.height = sizeH;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      compositeInto(ctx, layers);
      return c.toDataURL("image/png");
    } catch { return ""; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, layers.length, sizeW, sizeH]);

  // Miniaturas por capa memoizadas para no codificar PNGs en cada render de controles.
  const layerThumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of layers) {
      try {
        map.set(l.id, l.canvas.toDataURL("image/png"));
      } catch {
        map.set(l.id, "");
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, layers.length, sizeW, sizeH]);

  const TOOLS: { id: Tool; icon: ReactNode; title: string; key: string }[] = [
    { id: "brush", icon: <Pencil size={20} strokeWidth={1.9} />, title: "Pincel", key: "B" },
    { id: "eraser", icon: <Eraser size={20} strokeWidth={1.9} />, title: "Borrador", key: "E" },
    { id: "fill", icon: <PaintBucket size={20} strokeWidth={1.9} />, title: "Relleno", key: "G" },
    // Una sola herramienta para todas las formas: el icono es la forma elegida y
    // la ventana «Formas» (abajo, junto a «Lápices») tiene el catálogo completo.
    { id: "shape", icon: <ShapeGlyph shape={shapeKind} size={20} />, title: "Formas", key: "S" },
    { id: "picker", icon: <Pipette size={20} strokeWidth={1.9} />, title: "Cuentagotas", key: "I" },
    { id: "text", icon: <Type size={20} strokeWidth={1.9} />, title: "Texto", key: "T" },
    { id: "select", icon: <Scan size={20} strokeWidth={1.9} />, title: "Seleccionar", key: "M" },
    { id: "move", icon: <Move size={20} strokeWidth={1.9} />, title: "Mover", key: "V" },
  ];

  // Marco del lienzo: conserva la proporción del dibujo, así que la vista nunca
  // lo deforma y el zoom sigue siendo una sola escala.
  const frameBox = canvasBox(fitPx, zoom, canvas);
  const boxPx = frameBox.w;
  const boxPy = frameBox.h;
  // Cuadro de texto: anclado al punto tocado y ajustado tanto en ancho como en
  // alto para no salirse nunca del área visible.
  const textPopupLeft = textInput && boxPx > 0
    ? `${Math.max(0, Math.min(Math.max(0, (1 - 210 / boxPx) * 100), (textInput.x / sizeW) * 100))}%`
    : "0%";
  const textPopupTop = textInput && boxPy > 0
    ? `${Math.max(0, Math.min(Math.max(0, (1 - 220 / boxPy) * 100), (textInput.y / sizeH) * 100))}%`
    : "0%";

  const canvasCursorClass =
    tool === "move" || tool === "select"
      ? hoverHandle
        ? cursorForHandle(hoverHandle)
        : tool === "select"
          ? "cursor-crosshair"
          : cursorForHandle(hoverHandle)
      : tool === "text"
        ? "cursor-text"
        : "cursor-crosshair";

  // Fuera de paneles animados: un transform en un ancestro limita position:fixed.
  return createPortal(
    <div
      className="fixed inset-x-0 top-0 h-dvh z-[125] flex flex-col bg-background text-foreground overflow-hidden"
      aria-label="Editor de dibujo"
    >
      {/* ══ Barra superior (M3 small top app bar) ═══════════════════════════ */}
      <header className="shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 h-14 sm:h-16 border-b border-line bg-surface-2">
        <button
          onClick={onClose}
          title="Cerrar el editor"
          aria-label="Cerrar el editor"
          className="shrink-0 w-10 h-10 grid place-items-center rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition"
        >
          <X size={20} />
        </button>

        <div
          className="hidden md:block shrink-0 w-9 h-9 rounded-xl border border-line"
          style={
            thumb
              ? {
                  ...CHECKER,
                  backgroundImage: `url(${thumb})`,
                  backgroundSize: "contain",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center",
                }
              : CHECKER
          }
          aria-hidden
        />

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dibujo sin título"
          aria-label="Nombre del dibujo"
          className="min-w-0 flex-1 max-w-[240px] sm:max-w-[300px] bg-muted border border-line rounded-xl px-2.5 py-1.5 text-[13px] font-medium truncate focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 transition"
        />

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!history.canUndo}
            title="Deshacer (Ctrl+Z)"
            aria-label="Deshacer"
            className="hidden md:grid w-10 h-10 place-items-center rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={redo}
            disabled={!history.canRedo}
            title="Rehacer (Ctrl+Shift+Z)"
            aria-label="Rehacer"
            className="hidden md:grid w-10 h-10 place-items-center rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none"
          >
            <Redo2 size={18} />
          </button>
          <button
            onClick={() => { setQuickSetting(null); setPanelOpen(o => !o); }}
            title="Ajustes y capas"
            aria-label="Abrir ajustes y capas"
            aria-expanded={panelOpen}
            aria-controls="paint-settings"
            className="xl:hidden relative shrink-0 w-10 h-10 grid place-items-center rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition"
          >
            <SlidersHorizontal size={19} />
          </button>
          <button
            onClick={onClose}
            className="hidden sm:inline-flex items-center h-10 px-3 rounded-full text-[13px] font-medium text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            title="Guardar (Ctrl+S)"
            className="btn-grad shrink-0 inline-flex items-center gap-1.5 h-10 px-3 sm:px-4 rounded-full text-[13px] font-semibold text-primary-foreground active:scale-95 transition"
          >
            <Check size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Guardar</span>
            <span className="sr-only sm:hidden">Guardar</span>
          </button>
        </div>
      </header>

      {/* ══ Cuerpo: rail + lienzo + panel (columna en móvil, fila en escritorio) */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row">
        {/* ── Herramientas: dock inferior en móvil / rail lateral en escritorio */}
        <nav
          aria-label="Herramientas de dibujo"
          className="order-2 md:order-1 shrink-0 flex md:flex-col items-center gap-0.5 md:gap-1 p-1.5 md:py-3 overflow-x-auto md:overflow-x-visible md:overflow-y-auto no-scrollbar border-t md:border-t-0 md:border-r border-line bg-surface-2 md:w-[72px]"
        >
          {TOOLS.map(t => {
            const on = tool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  if (t.id === "select" && selectionMode === "auto") {
                    setSelectionMode("rect");
                  }
                  setTool(t.id);
                }}
                title={`${t.title} (${t.key})`}
                aria-label={t.title}
                aria-pressed={on}
                className="group shrink-0 flex flex-col items-center gap-0.5 md:gap-1 md:w-full px-0 md:px-1 py-1 rounded-2xl transition"
              >
                <span
                  className={`grid place-items-center w-10 md:w-11 h-8 rounded-full transition-colors ${
                    on
                      ? "bg-accent text-accent-foreground"
                      : "text-ink-2 group-hover:bg-muted group-hover:text-foreground"
                  }`}
                >
                  {t.icon}
                </span>
                <span className={`hidden md:block text-[10px] leading-none font-medium ${on ? "text-foreground" : "text-ink-3"}`}>
                  {t.title}
                </span>
              </button>
            );
          })}
          {/* Historial en el dock móvil (en escritorio vive en la barra superior) */}
          <span className="md:hidden shrink-0 w-px self-stretch my-2 bg-line" aria-hidden />
          <button
            onClick={undo}
            disabled={!history.canUndo}
            title="Deshacer (Ctrl+Z)"
            aria-label="Deshacer"
            className="md:hidden shrink-0 grid place-items-center w-10 h-10 rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none"
          >
            <Undo2 size={19} />
          </button>
          <button
            onClick={redo}
            disabled={!history.canRedo}
            title="Rehacer (Ctrl+Shift+Z)"
            aria-label="Rehacer"
            className="md:hidden shrink-0 grid place-items-center w-10 h-10 rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none"
          >
            <Redo2 size={19} />
          </button>
        </nav>

        {/* ── Visor del lienzo ─────────────────────────────────────────────── */}
        <div className="order-1 md:order-2 flex-1 min-w-0 min-h-0 flex flex-col bg-surface-2/50">
          {/* Accesos siempre visibles, independientes del panel de ajustes. */}
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-surface-2" aria-label="Ajustes rápidos del trazo">
            <Popover open={quickSetting === "color"} onOpenChange={open => { if (open) setPanelOpen(false); setQuickSetting(open ? "color" : null); }}>
              <PopoverTrigger asChild>
                <button
                  aria-label="Cambiar color"
                  title="Cambiar color"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-3 text-xs font-medium hover:bg-accent transition"
                >
                  <span className="h-5 w-5 rounded-full border border-line" style={{ background: color }} aria-hidden />
                  Color
                </button>
              </PopoverTrigger>
              <PopoverContent data-paint-quick-setting align="start" collisionPadding={12} aria-label="Cambiar color del trazo" className="z-[126] w-80 max-w-[calc(100vw-24px)] max-h-[70dvh] overflow-y-auto rounded-2xl border-line">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Color del trazo</h3>
                  <button aria-label="Cerrar color" onClick={() => setQuickSetting(null)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"><X size={16} /></button>
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <input type="color" value={color} onChange={e => paintColor(e.target.value)} aria-label="Color personalizado" className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-muted" />
                  <span className="text-xs font-mono uppercase">{color}</span>
                  <select value={paletteIdx} onChange={e => setPaletteIdx(Number(e.target.value))} aria-label="Paleta rápida" className="ml-auto min-w-0 rounded-lg border border-line bg-muted px-2 py-2 text-xs">
                    {PALETTES.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-8 gap-2">
                  {PALETTE.map(c => (
                    <button key={c} aria-label={`Color ${c}`} aria-pressed={color === c.toLowerCase()} onClick={() => paintColor(c)} className={`aspect-square rounded-lg border border-line ${color === c.toLowerCase() ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : "hover:scale-105"}`} style={{ background: c }} />
                  ))}
                </div>
                {recent.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-muted-foreground">Recientes</p>
                    <div className="flex flex-wrap gap-2">
                      {recent.map(c => <button key={c} aria-label={`Color reciente ${c}`} onClick={() => paintColor(c)} className="h-7 w-7 rounded-full border border-line" style={{ background: c }} />)}
                    </div>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium text-ink-2">Relleno y degradado</span>
                    <div className="flex gap-1">
                      {([
                        { id: "solid", label: "Sólido" },
                        { id: "linear", label: "Lineal" },
                        { id: "radial", label: "Radial" },
                      ] as const).map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => setFillGradientMode(mode.id)}
                          aria-pressed={fillGradientMode === mode.id}
                          className={`px-2 py-1 rounded-full text-[10px] font-semibold transition ${
                            fillGradientMode === mode.id
                              ? "bg-accent text-accent-foreground"
                              : "bg-muted text-ink-2 hover:bg-accent"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {fillGradientMode !== "solid" && (
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="text-[11px] text-ink-3">Color secundario</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={secondaryColor}
                          onChange={e => setSecondaryColor(e.target.value.toLowerCase())}
                          aria-label="Color secundario de degradado"
                          className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-muted"
                        />
                        <button
                          onClick={() => {
                            const prev = color;
                            setColor(secondaryColor);
                            setSecondaryColor(prev);
                          }}
                          title="Intercambiar colores"
                          className="px-2 py-1 rounded-full border border-line bg-card text-[10px] font-medium text-ink-2 hover:bg-accent transition"
                        >
                          Invertir
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={quickSetting === "width"} onOpenChange={open => { if (open) setPanelOpen(false); setQuickSetting(open ? "width" : null); }}>
              <PopoverTrigger asChild>
                <button aria-label="Cambiar grosor" title="Cambiar grosor" className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-3 text-xs font-medium hover:bg-accent transition">
                  <Pencil size={16} /> Grosor <span className="font-mono tabular-nums text-primary">{width} px</span>
                </button>
              </PopoverTrigger>
              <PopoverContent data-paint-quick-setting align="start" collisionPadding={12} aria-label="Cambiar grosor del trazo" className="z-[126] w-72 max-w-[calc(100vw-24px)] max-h-[70dvh] overflow-y-auto rounded-2xl border-line">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Grosor · {width} px</h3>
                  <button aria-label="Cerrar grosor" onClick={() => setQuickSetting(null)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"><X size={16} /></button>
                </div>
                <Slider min={1} max={48} step={1} value={[width]} onValueChange={([v]) => setWidth(v)} aria-label="Grosor rápido del trazo" className="my-4" />
                <div className="flex gap-1.5">
                  {BRUSH_PRESETS.map(p => (
                    <button key={p} onClick={() => setWidth(p)} aria-label={`Grosor ${p} píxeles`} aria-pressed={width === p} className={`h-10 flex-1 rounded-full text-xs font-semibold ${width === p ? "bg-accent text-accent-foreground" : "bg-muted text-ink-2 hover:bg-accent"}`}>{p}</button>
                  ))}
                </div>
                <div className="mt-3 space-y-2.5 pt-2.5 border-t border-line">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-2 w-16 shrink-0">Opacidad</span>
                    <Slider
                      min={5}
                      max={100}
                      step={1}
                      value={[brushOpacity]}
                      onValueChange={([v]) => setBrushOpacity(v)}
                      aria-label="Opacidad del pincel"
                      className="flex-1"
                    />
                    <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                      {brushOpacity}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-2 w-16 shrink-0">Suavidad</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[brushSoftness]}
                      onValueChange={([v]) => setBrushSoftness(v)}
                      aria-label="Suavidad del pincel"
                      className="flex-1"
                    />
                    <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                      {brushSoftness}%
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid h-14 place-items-center rounded-xl bg-muted" aria-hidden>
                  <span
                    className="rounded-full"
                    style={{
                      width,
                      height: width,
                      opacity: brushOpacity / 100,
                      background: tool === "eraser" ? "var(--muted-foreground)" : color,
                      filter: brushSoftness > 0 ? `blur(${Math.max(0.5, width * (brushSoftness / 100) * 0.22)}px)` : undefined,
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* Controles rápidos de Selección de Área y Transformación */}
            <div className="inline-flex items-center gap-1 rounded-full border border-line bg-card p-1">
              <button
                type="button"
                onClick={() => {
                  setSelectionMode("rect");
                  setTool("select");
                }}
                aria-pressed={(tool === "select" || tool === "move") && selectionMode !== "lasso"}
                title="Seleccionar área rectangular para transformar (M)"
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition ${
                  tool === "select" && selectionMode !== "lasso"
                    ? "bg-accent text-accent-foreground"
                    : "text-ink-2 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Scan size={14} />
                <span>Marco</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectionMode("lasso");
                  setTool("select");
                }}
                aria-pressed={(tool === "select" || tool === "move") && selectionMode === "lasso"}
                title="Seleccionar área con lazo libre para transformar"
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition ${
                  (tool === "select" || tool === "move") && selectionMode === "lasso"
                    ? "bg-accent text-accent-foreground"
                    : "text-ink-2 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Lasso size={14} />
                <span>Lazo</span>
              </button>
            </div>

            {(hasFloatingRaster || selectedShape || selectedText) && (
              <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1">
                <button
                  type="button"
                  onClick={() => flipActiveTarget("x")}
                  title="Voltear selección horizontalmente"
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-foreground hover:bg-accent transition"
                >
                  <FlipHorizontal2 size={13} />
                  <span className="hidden sm:inline">Voltear H</span>
                </button>
                <button
                  type="button"
                  onClick={() => flipActiveTarget("y")}
                  title="Voltear selección verticalmente"
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-foreground hover:bg-accent transition"
                >
                  <FlipVertical2 size={13} />
                  <span className="hidden sm:inline">Voltear V</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasFloatingRaster) duplicateFloatingRaster();
                    else if (selectedShape) duplicateSelectedShape();
                    else if (selectedText) duplicateSelectedText();
                  }}
                  title="Duplicar selección (Ctrl+D)"
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-foreground hover:bg-accent transition"
                >
                  <Copy size={13} />
                  <span className="hidden sm:inline">Duplicar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasFloatingRaster) deleteFloatingRaster();
                    else if (selectedShape) deleteSelectedShape();
                    else if (selectedText) deleteSelectedText();
                  }}
                  title="Borrar área seleccionada (Supr)"
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-destructive hover:bg-destructive/15 transition"
                >
                  <Trash2 size={13} />
                  <span className="hidden sm:inline">Borrar</span>
                </button>
                {hasFloatingRaster && (
                  <button
                    type="button"
                    onClick={() => commitFloatingRaster(true)}
                    title="Aplicar transformación (Enter)"
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition"
                  >
                    <Check size={13} />
                    <span>Aplicar</span>
                  </button>
                )}
              </div>
            )}
          </div>
          {/* Aviso de capa no editable: franja propia, sin tapar el lienzo */}
          {!activeEditable && (
            <div className="shrink-0 h-9 flex items-center justify-center gap-2 px-3 border-b border-line bg-warn/15">
              <AlertTriangle size={14} className="shrink-0 text-warn" />
              <span className="text-[11px] font-medium text-foreground truncate">
                {active
                  ? (active.locked ? "Capa bloqueada: no se puede dibujar en ella" : "Capa oculta: no se puede dibujar en ella")
                  : "Sin capa activa"}
              </span>
              {active && (
                <button
                  onClick={() => updateLayer(active.id, active.locked ? { locked: false } : { visible: true })}
                  className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
                >
                  {active.locked ? "Desbloquear" : "Mostrar"}
                </button>
              )}
            </div>
          )}
          <div
            ref={viewportRef}
            className="flex-1 min-w-0 min-h-0 flex overflow-auto overscroll-contain touch-none p-3 md:p-5"
            onPointerDownCapture={onTouchDown}
            onPointerMoveCapture={onTouchMove}
            onPointerUpCapture={onTouchEnd}
            onPointerCancelCapture={onTouchEnd}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
              setZoom(z => Math.max(MIN_PAINT_ZOOM, Math.min(MAX_PAINT_ZOOM, Math.round(z * factor * 100) / 100)));
            }}
          >
            {/* El marco conserva la proporción del lienzo y el tirador vive
                fuera del recorte, para que dibujar en la esquina siga libre. */}
            <div
              ref={boxRef}
              className="relative m-auto shrink-0"
              style={{ width: frameBox.w, height: frameBox.h }}
            >
              <div className="absolute inset-0 rounded-2xl border border-line shadow-[var(--m3-elev-2)] overflow-hidden">
                {/* Tablero de transparencia: lo pinta `blit` dentro del bitmap del
                    lienzo, con la misma retícula que la guía. El color de fondo
                    solo cubre el instante previo a la primera pintura. */}
                <div className="w-full h-full relative" style={{ backgroundColor: "var(--m3-surface-lowest)" }}>
                  <canvas
                    key={`canvas-${sizeW}x${sizeH}`}
                    ref={canvasRef}
                    className={`w-full h-full touch-none block ${canvasCursorClass}`}
                    style={{ touchAction: "none", background: "transparent" }}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={() => {
                      cancelStroke();
                      activePointerId.current = null;
                      dragRect.current = null;
                      activePointsRef.current = [];
                      stabilizerRef.current = null;
                    }}
                  />
                  {/* La guía de cuadrícula la dibuja `blit` sobre el tablero, con
                      los mismos bordes enteros, así que ya no hay una capa de CSS
                      que se desincronice al hacer zoom. */}
                </div>

                {/* Estado vacío: invita a dibujar sin bloquear el trazo */}
                {!hasArtwork && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center">
                    <div className="rounded-2xl bg-popover/90 border border-line px-4 py-3 shadow-[var(--m3-elev-1)]">
                      <Pencil size={22} className="mx-auto text-primary" />
                      <p className="mt-1.5 text-[13px] font-semibold text-foreground">Empieza a dibujar</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Elige una herramienta y traza sobre el lienzo
                      </p>
                    </div>
                  </div>
                )}

                {/* Pista de «Mover»: esta herramienta trabaja sobre objetos y trazos seleccionados */}
                {tool === "move" && !selectedText && !selectedShape && !hasFloatingRaster && (
                  <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
                    <span className="rounded-full bg-popover/90 border border-line px-3 py-1 text-[11px] text-muted-foreground shadow-[var(--m3-elev-1)]">
                      {layers.some(l => l.texts.length > 0 || l.shapes.length > 0) || hasArtwork
                        ? "Toca un texto, forma o trazo para seleccionarlo, transformarlo o clonarlo"
                        : "Añade un texto, forma o trazo y transfórmalo aquí"}
                    </span>
                  </div>
                )}
              </div>

              {/* Entrada de texto: vive en el marco pero fuera del recorte overflow-hidden
                  para que nunca quede cortada cuando el lienzo es pequeño. */}
              {textInput?.open && (
                <div
                  onPointerDown={e => e.stopPropagation()}
                  className="absolute z-30 rounded-2xl p-2.5 flex flex-col gap-2 w-52 max-w-[92vw] border border-line bg-popover text-popover-foreground shadow-[var(--m3-elev-3)]"
                  style={{ left: textPopupLeft, top: textPopupTop }}
                >
                  <textarea
                    autoFocus
                    value={textInput.value}
                    onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                    placeholder="Escribe el texto…"
                    aria-label="Texto"
                    className="bg-muted border border-line rounded-xl px-2 py-1.5 text-[13px] w-full min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={textInput.font}
                      onChange={(e) => setTextInput({ ...textInput, font: e.target.value })}
                      aria-label="Fuente"
                      className="bg-muted border border-line rounded-xl text-[10px] px-2 py-1 flex-1 min-w-0"
                    >
                      {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input
                      type="number"
                      min={8}
                      max={200}
                      value={textInput.fontSize}
                      onChange={(e) => setTextInput({ ...textInput, fontSize: Number(e.target.value) })}
                      aria-label="Tamaño de fuente"
                      className="bg-muted border border-line rounded-xl text-[10px] px-2 py-1 w-14 tabular-nums"
                    />
                  </div>
                  <label className="flex items-center justify-between gap-2 text-[11px]">
                    Color del texto
                    <input type="color" value={textInput.color} onChange={e => setTextInput({ ...textInput, color: e.target.value })} aria-label="Color del texto en el lienzo" className="h-8 w-12 rounded border border-line bg-muted" />
                  </label>
                  <div className="flex gap-1.5">
                    <button onClick={() => setTextInput(null)} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition">
                      Cancelar
                    </button>
                    <button onClick={commitText} className="flex-1 btn-grad text-[10px] font-semibold px-2 py-1.5 rounded-full text-primary-foreground active:scale-95 transition">
                      {textInput.id ? "Aplicar" : "Añadir"}
                    </button>
                  </div>
                </div>
              )}

              {/* Tirador del lienzo: se arrastra para cambiar su tamaño sin
                  reescalar el dibujo (se recorta o se añade superficie). Vive
                  fuera del recorte, así que la esquina sigue siendo papel. */}
              <div
                data-canvas-handle
                role="button"
                tabIndex={0}
                title={`Cambiar el tamaño del lienzo (${sizeW}×${sizeH})`}
                aria-label="Cambiar el tamaño del lienzo arrastrando"
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
                className="absolute -bottom-2 -right-2 z-20 grid h-8 w-8 cursor-nwse-resize place-items-center rounded-full border border-line bg-card text-ink-2 shadow-[var(--m3-elev-2)] touch-none hover:text-primary hover:border-primary/40 active:scale-95 transition"
              >
                <Maximize2 size={14} />
              </div>
            </div>
          </div>

          {/* Barra inferior del visor: medidas, zoom y cuadrícula */}
          <div className="shrink-0 h-12 flex items-center justify-between gap-2 px-2 md:px-3 border-t border-line bg-surface-2 overflow-x-auto no-scrollbar">
            <span className="pl-1 shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
              {sizeW}×{sizeH} · {Math.round(zoom * 100)}%
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Único acceso a los lápices: vive abajo, junto al lienzo, y su
                  ventana se abre desde el borde inferior. */}
              <button
                onClick={() => { setPanelOpen(false); setQuickSetting("brush"); }}
                aria-label="Elegir lápices"
                aria-expanded={quickSetting === "brush"}
                aria-controls="paint-brushes-sheet"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 text-[11px] font-medium text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition"
              >
                <Pencil size={15} />
                <span className="hidden sm:inline">Lápices</span>
                <span className="font-mono text-primary">{PAINT_BRUSHES.find(b => b.id === brush)?.name ?? brush}</span>
              </button>
              {/* Misma ubicación y misma apertura que «Lápices»: la ventana con
                  todas las formas disponibles. */}
              <button
                onClick={() => { setPanelOpen(false); setQuickSetting("shapes"); }}
                aria-label="Elegir formas"
                aria-expanded={quickSetting === "shapes"}
                aria-controls="paint-shapes-sheet"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 text-[11px] font-medium text-ink-2 hover:bg-accent hover:text-accent-foreground active:scale-95 transition"
              >
                <Shapes size={15} />
                <span className="hidden sm:inline">Formas</span>
                <span className="font-mono text-primary">{shapeDef(shapeKind).name}</span>
              </button>
              <span className="w-px self-stretch my-1.5 bg-line" aria-hidden />
              <span className="hidden lg:inline px-2 text-[10px] text-muted-foreground">Pellizca con dos dedos para ampliar, reducir o mover el lienzo</span>
              <button
                onClick={() => setZoom(1)}
                title="Ajustar al área (0)"
                aria-label="Ajustar al área"
                className="h-9 px-2 rounded-full text-[10px] font-mono tabular-nums text-ink-2 hover:bg-accent hover:text-accent-foreground transition"
              >
                {Math.round(zoom * 100)}%
              </button>
              <span className="w-px self-stretch my-1.5 bg-line" aria-hidden />
              <button
                onClick={() => setShowGrid(g => !g)}
                aria-pressed={showGrid}
                title="Cuadrícula de guía"
                aria-label="Cuadrícula de guía"
                className={`w-9 h-9 grid place-items-center rounded-full transition ${
                  showGrid ? "bg-accent text-accent-foreground" : "text-ink-2 hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Grid size={16} />
              </button>
              <button
                onClick={() => setZoom(1)}
                title="Ajustar al área"
                aria-label="Ajustar al área"
                className="w-9 h-9 grid place-items-center rounded-full text-ink-2 hover:bg-accent hover:text-accent-foreground transition"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Panel de ajustes y capas (hoja inferior en móvil, fijo en escritorio) */}
        {panelOpen && (
          <div
            className="xl:hidden absolute inset-0 z-30 bg-black/40"
            onClick={() => setPanelOpen(false)}
            aria-hidden
          />
        )}
        <aside
          id="paint-settings"
          aria-label="Ajustes y capas"
          className={`${
            panelOpen ? "flex" : "hidden"
          } xl:flex order-3 shrink-0 min-w-0 flex-col absolute inset-x-0 bottom-0 z-40 max-h-[80dvh] rounded-t-[28px] xl:static xl:inset-auto xl:z-auto xl:max-h-none xl:rounded-none border-t xl:border-t-0 xl:border-l border-line bg-card shadow-[var(--m3-elev-3)] xl:shadow-none w-full max-w-xl mx-auto xl:mx-0 xl:w-[320px] 2xl:w-[352px]`}
        >
          <div className="xl:hidden shrink-0 pt-2 pb-1 flex justify-center">
            <span className="h-1 w-9 rounded-full bg-line-strong" aria-hidden />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-1 xl:py-3 space-y-2.5">
            {/* — Trazo, dinámicas, simetría y selección — */}
            <SectionCard label="Trazo" icon={<Pencil size={11} />}>
              <label className="mt-2.5 flex items-center justify-between gap-2 cursor-pointer select-none">
                <span className="text-[11px] text-ink-2">Presión</span>
                <Switch checked={pressureOn} onCheckedChange={setPressureOn} aria-label="Sensibilidad a la presión" />
              </label>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[11px] text-ink-2 w-16 shrink-0">Opacidad</span>
                <Slider
                  min={5}
                  max={100}
                  step={1}
                  value={[brushOpacity]}
                  onValueChange={([v]) => setBrushOpacity(v)}
                  aria-label="Opacidad del trazo"
                  className="flex-1"
                />
                <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                  {brushOpacity}%
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-ink-2 w-16 shrink-0">Suavidad</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[brushSoftness]}
                  onValueChange={([v]) => setBrushSoftness(v)}
                  aria-label="Suavidad del trazo"
                  className="flex-1"
                />
                <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                  {brushSoftness}%
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-ink-2 w-16 shrink-0">Tolerancia</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[fillTolerance]}
                  onValueChange={([v]) => setFillTolerance(v)}
                  aria-label="Tolerancia de relleno"
                  className="flex-1"
                />
                <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                  {fillTolerance}%
                </span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-line">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] text-ink-2">Simetría en vivo</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {([
                    { id: "none", label: "No" },
                    { id: "horizontal", label: "Horiz." },
                    { id: "vertical", label: "Vert." },
                    { id: "quad", label: "4 ejes" },
                  ] as const).map(sym => (
                    <button
                      key={sym.id}
                      onClick={() => setSymmetryMode(sym.id)}
                      aria-label={`Simetría ${sym.label}`}
                      aria-pressed={symmetryMode === sym.id}
                      className={`h-7 rounded-full text-[10px] font-semibold transition ${
                        symmetryMode === sym.id
                          ? "bg-accent text-accent-foreground"
                          : "bg-muted text-ink-2 hover:bg-accent"
                      }`}
                    >
                      {sym.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-line">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] text-ink-2">Selección («Mover»)</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { id: "auto", label: "Auto" },
                    { id: "rect", label: "Marco" },
                    { id: "lasso", label: "Lazo" },
                  ] as const).map(mode => (
                    <button
                      key={mode.id}
                      onClick={() => { setSelectionMode(mode.id); setTool("move"); }}
                      aria-label={`Modo de selección ${mode.label}`}
                      aria-pressed={selectionMode === mode.id}
                      className={`h-7 rounded-full text-[10px] font-semibold transition ${
                        selectionMode === mode.id
                          ? "bg-accent text-accent-foreground"
                          : "bg-muted text-ink-2 hover:bg-accent"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    onClick={copySelectionToClipboard}
                    disabled={!hasFloatingRaster && !selectedText && !selectedShape && !hasArtwork}
                    title="Copiar selección (Ctrl+C)"
                    className="flex-1 text-[10px] font-medium px-2 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Copiar
                  </button>
                  <button
                    onClick={cutSelectionToClipboard}
                    disabled={!hasFloatingRaster && !selectedText && !selectedShape && !hasArtwork}
                    title="Cortar selección (Ctrl+X)"
                    className="flex-1 text-[10px] font-medium px-2 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Cortar
                  </button>
                  <button
                    onClick={pasteFromClipboard}
                    disabled={!hasClipboard}
                    title="Pegar selección (Ctrl+V)"
                    className="flex-1 text-[10px] font-medium px-2 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Pegar
                  </button>
                </div>
              </div>
            </SectionCard>

            {/* — Estabilización del lápiz: barra para calibrar el trazo — */}
            <SectionCard label="Estabilización" icon={<Pencil size={11} />}>
              <div className="mt-1 flex items-center gap-3">
                <Slider
                  min={STABILIZE_MIN}
                  max={STABILIZE_MAX}
                  step={1}
                  value={[stabilizeLevel]}
                  onValueChange={([v]) => setStabilizeLevel(v)}
                  aria-label="Nivel de estabilización del lápiz"
                  className="flex-1"
                />
                <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                  {stabilizeLevel}%
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                {stabilizeLevel === 0
                  ? "Sin estabilización: el trazo sigue el dedo o el lápiz al instante. Ideal para detalles rápidos."
                  : "Suaviza el temblor de la mano: a más nivel el trazo es más limpio, pero responde un poco más despacio."}
              </p>
            </SectionCard>

            {/* — Texto seleccionado: objeto independiente del dibujo — */}
            {selectedText && (
              <SectionCard
                label="Texto seleccionado"
                icon={<Type size={11} />}
                action={
                  <button
                    onClick={duplicateSelectedText}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition inline-flex items-center gap-1"
                  >
                    <Copy size={11} /> Duplicar
                  </button>
                }
              >
                <textarea
                  value={selectedText.text}
                  onFocus={beginTextFieldEdit}
                  onBlur={() => { textEditSnapshot.current = false; }}
                  onChange={(e) => updateSelectedText({ text: e.target.value })}
                  aria-label="Contenido del texto"
                  className="w-full bg-muted border border-line rounded-xl px-2 py-1.5 text-[13px] min-h-[56px] focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <div className="mt-2 flex items-center gap-1.5">
                  <select
                    value={selectedText.font}
                    onChange={(e) => updateSelectedText({ font: e.target.value })}
                    aria-label="Fuente del texto"
                    className="bg-muted border border-line rounded-xl text-[10px] px-2 py-1 flex-1"
                  >
                    {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={selectedText.fontSize}
                    onFocus={beginTextFieldEdit}
                    onBlur={() => { textEditSnapshot.current = false; }}
                    onChange={(e) => updateSelectedText({ fontSize: Math.max(8, Math.min(200, Number(e.target.value) || 8)) })}
                    aria-label="Tamaño de fuente del texto"
                    className="bg-muted border border-line rounded-xl text-[10px] px-2 py-1 w-14 tabular-nums"
                  />
                  <label className="relative w-8 h-8 shrink-0" title="Color del texto">
                    <input
                      type="color"
                      value={selectedText.color}
                      onChange={(e) => updateSelectedText({ color: e.target.value.toLowerCase() })}
                      aria-label="Color del texto"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <span
                      className="block w-8 h-8 rounded-xl border border-line pointer-events-none"
                      style={{ background: selectedText.color }}
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] leading-relaxed text-ink-3">
                    Arrastra con «Mover» para colocarlo: solo se mueve este texto.
                  </span>
                  <button
                    onClick={deleteSelectedText}
                    className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition inline-flex items-center gap-1"
                  >
                    <Trash2 size={11} /> Borrar
                  </button>
                </div>
              </SectionCard>
            )}

            {/* — Forma seleccionada: editable también después de colocarla — */}
            {selectedShape && selectedShapeBox && (
              <SectionCard
                label="Forma seleccionada"
                icon={<Shapes size={11} />}
                action={
                  <button
                    onClick={duplicateSelectedShape}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition inline-flex items-center gap-1"
                  >
                    <Copy size={11} /> Duplicar
                  </button>
                }
              >
                <ShapePicker
                  value={selectedShape.shape}
                  onPick={kind => { beginShapeFieldEdit(); updateSelectedShape({ shape: kind }); }}
                />
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {([
                    { label: "X", value: Math.round(selectedShapeBox.x), aria: "Posición X de la forma", apply: (v: number) => placeShape(selectedShape, v, selectedShapeBox.y) },
                    { label: "Y", value: Math.round(selectedShapeBox.y), aria: "Posición Y de la forma", apply: (v: number) => placeShape(selectedShape, selectedShapeBox.x, v) },
                    { label: "Ancho", value: Math.round(selectedShapeBox.w), aria: "Ancho de la forma", apply: (v: number) => resizeShape(selectedShape, v, selectedShapeBox.h) },
                    { label: "Alto", value: Math.round(selectedShapeBox.h), aria: "Alto de la forma", apply: (v: number) => resizeShape(selectedShape, selectedShapeBox.w, v) },
                  ]).map(field => (
                    <label key={field.label} className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      {field.label}
                      <input
                        type="number"
                        min={field.label === "Ancho" || field.label === "Alto" ? 1 : 0}
                        max={field.label === "Ancho" ? sizeW : field.label === "Alto" ? sizeH : Math.max(sizeW, sizeH)}
                        value={field.value}
                        onFocus={beginShapeFieldEdit}
                        onBlur={() => { shapeEditSnapshot.current = false; }}
                        onChange={(e) => {
                          const raw = Number(e.target.value);
                          const v = Number.isFinite(raw) ? Math.round(raw) : 0;
                          updateSelectedShape(field.apply(v));
                        }}
                        aria-label={field.aria}
                        className="min-w-0 flex-1 bg-muted border border-line rounded-lg px-2 py-1 text-[10px] tabular-nums"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Slider
                    min={1}
                    max={48}
                    step={1}
                    value={[selectedShape.width]}
                    onValueChange={([v]) => { beginShapeFieldEdit(); updateSelectedShape({ width: v }); }}
                    onValueCommit={() => { shapeEditSnapshot.current = false; }}
                    aria-label="Grosor de la forma seleccionada"
                    className="flex-1"
                  />
                  <span className="w-8 text-right font-mono text-[10px] tabular-nums text-primary">{selectedShape.width}</span>
                  <label className="relative h-8 w-8 shrink-0" title="Color de la forma">
                    <input
                      type="color"
                      value={selectedShape.color}
                      onChange={(e) => updateSelectedShape({ color: e.target.value.toLowerCase() })}
                      aria-label="Color de la forma"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    <span className="pointer-events-none block h-8 w-8 rounded-xl border border-line" style={{ background: selectedShape.color }} />
                  </label>
                </div>
                <label className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span>Relleno sólido</span>
                  <Switch
                    checked={selectedShape.filled && shapeClosed(selectedShape.shape)}
                    onCheckedChange={v => { beginShapeFieldEdit(); updateSelectedShape({ filled: v }); }}
                    disabled={!shapeClosed(selectedShape.shape)}
                    aria-label="Relleno de la forma seleccionada"
                  />
                </label>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] leading-relaxed text-ink-3">
                    Arrástrala con «Mover» (V) o escribe aquí su posición: solo se mueve esta forma.
                  </span>
                  <button
                    onClick={deleteSelectedShape}
                    className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition inline-flex items-center gap-1"
                  >
                    <Trash2 size={11} /> Borrar
                  </button>
                </div>
              </SectionCard>
            )}

            {/* — Capas — */}
            <SectionCard
              label={`Capas · ${layers.length}`}
              icon={<Layers size={11} />}
              action={
                <div className="flex gap-1">
                  <button
                    onClick={addLayer}
                    className="btn-grad text-[10px] font-semibold px-2.5 py-1 rounded-full text-primary-foreground inline-flex items-center gap-1 active:scale-95 transition"
                  >
                    <Plus size={11} strokeWidth={2.5} /> Nueva
                  </button>
                  <button
                    onClick={flatten}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition"
                  >
                    Aplanar
                  </button>
                </div>
              }
            >
              <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-0.5">
                {[...layers].slice().reverse().map((l) => {
                  const isActive = l.id === activeLayerId;
                  return (
                    <div
                      key={l.id}
                      onClick={() => { setActiveLayerId(l.id); activeLayerIdRef.current = l.id; }}
                      className={`group rounded-xl p-2 flex flex-col gap-1.5 transition-colors cursor-pointer border ${
                        isActive ? "border-primary/40 bg-accent/40" : "border-line bg-muted hover:bg-accent/25"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-8 h-8 rounded-lg shrink-0 border border-line"
                          style={{
                            ...CHECKER,
                            backgroundImage: layerThumbs.get(l.id) ? `url(${layerThumbs.get(l.id)})` : CHECKER.backgroundImage,
                            backgroundSize: layerThumbs.get(l.id) ? "contain" : CHECKER.backgroundSize,
                            backgroundPosition: layerThumbs.get(l.id) ? "center" : CHECKER.backgroundPosition,
                            backgroundRepeat: layerThumbs.get(l.id) ? "no-repeat" : "repeat",
                            opacity: l.visible ? 1 : 0.35,
                          }}
                        />
                        <input
                          value={l.name}
                          onChange={(e) => updateLayer(l.id, { name: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Nombre de la capa"
                          className="flex-1 min-w-0 bg-transparent text-[11px] font-medium focus:outline-none focus:bg-card rounded px-1 py-0.5"
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { alphaLock: !l.alphaLock }); }}
                          title={l.alphaLock ? "Desactivar bloqueo alfa" : "Bloquear píxeles transparentes (Alfa)"}
                          aria-label="Bloqueo alfa de la capa"
                          aria-pressed={!!l.alphaLock}
                          className={`w-7 h-7 grid place-items-center rounded-full text-[10px] font-bold transition hover:bg-accent ${
                            l.alphaLock ? "bg-accent text-primary" : "text-muted-foreground"
                          }`}
                        >
                          α
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }); }}
                          title={l.visible ? "Ocultar capa" : "Mostrar capa"}
                          aria-label={l.visible ? "Ocultar capa" : "Mostrar capa"}
                          className={`w-7 h-7 grid place-items-center rounded-full transition hover:bg-accent ${l.visible ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { locked: !l.locked }); }}
                          title={l.locked ? "Desbloquear capa" : "Bloquear capa"}
                          aria-label={l.locked ? "Desbloquear capa" : "Bloquear capa"}
                          className={`w-7 h-7 grid place-items-center rounded-full transition hover:bg-accent ${l.locked ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {l.locked ? <Lock size={13} /> : <Unlock size={13} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteLayer(l.id); }}
                          disabled={layers.length <= 1}
                          title="Borrar capa"
                          aria-label="Borrar capa"
                          className="w-7 h-7 grid place-items-center rounded-full text-destructive/70 hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {isActive && (
                        <div className="flex flex-wrap items-center gap-1 pl-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }}
                            title="Subir capa"
                            aria-label="Subir capa"
                            className="w-7 h-7 grid place-items-center rounded-full text-ink-2 hover:bg-accent transition"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }}
                            title="Bajar capa"
                            aria-label="Bajar capa"
                            className="w-7 h-7 grid place-items-center rounded-full text-ink-2 hover:bg-accent transition"
                          >
                            <ChevronDown size={13} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); flipActiveTarget("x"); }}
                            title="Voltear horizontalmente"
                            className="text-[10px] font-medium px-2 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition"
                          >
                            Voltear H
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); flipActiveTarget("y"); }}
                            title="Voltear verticalmente"
                            className="text-[10px] font-medium px-2 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition"
                          >
                            Voltear V
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateLayer(l.id); }}
                            title="Duplicar capa"
                            className="ml-auto text-[10px] font-medium px-2.5 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition inline-flex items-center gap-1"
                          >
                            <Copy size={11} /> Duplicar
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); mergeDown(l.id); }}
                            disabled={layers[0]?.id === l.id}
                            title="Combinar con la capa de abajo"
                            className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition disabled:opacity-40 disabled:pointer-events-none"
                          >
                            Combinar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {active && (
                <div className="space-y-2 mt-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-ink-2 shrink-0">Opacidad</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round((active.opacity ?? 1) * 100)]}
                      onValueChange={([v]) => updateLayer(active.id, { opacity: v / 100 })}
                      aria-label="Opacidad de la capa"
                      className="flex-1"
                    />
                    <span className="text-[11px] font-mono tabular-nums text-primary w-9 text-right">
                      {Math.round((active.opacity ?? 1) * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-2 shrink-0">Modo de fusión</span>
                    <select
                      value={active.blendMode ?? "source-over"}
                      onChange={e => updateLayer(active.id, { blendMode: e.target.value as LayerBlendMode })}
                      aria-label="Modo de fusión de la capa"
                      className="min-w-0 flex-1 max-w-[170px] rounded-xl border border-line bg-muted px-2 py-1 text-[11px]"
                    >
                      {LAYER_BLEND_MODES.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* — Lienzo — */}
            <SectionCard
              label="Lienzo"
              icon={<Maximize2 size={11} />}
              action={
                <button
                  onClick={clearAll}
                  disabled={!activeEditable}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1"
                >
                  <Trash2 size={11} /> Limpiar
                </button>
              }
            >
              <div className="grid grid-cols-5 gap-1.5">
                {SIZE_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => changeSize(s)}
                    aria-pressed={sizeW === s && sizeH === s}
                    className={`h-8 rounded-full text-[10px] font-semibold tabular-nums transition ${
                      sizeW === s && sizeH === s
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-ink-2 hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImportImageFile}
                aria-label="Archivo de imagen para importar"
                className="hidden"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!activeEditable}
                  className="flex-1 text-[10px] font-medium px-2.5 py-1.5 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition disabled:opacity-40 disabled:pointer-events-none"
                >
                  Importar imagen
                </button>
                <button
                  onClick={() => flipEntireCanvas("x")}
                  title="Voltear todo el lienzo horizontalmente"
                  className="text-[10px] font-medium px-2.5 py-1.5 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition"
                >
                  Voltear H
                </button>
                <button
                  onClick={() => flipEntireCanvas("y")}
                  title="Voltear todo el lienzo verticalmente"
                  className="text-[10px] font-medium px-2.5 py-1.5 rounded-full border border-line bg-card text-ink-2 hover:bg-accent transition"
                >
                  Voltear V
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                Arrastra el tirador de la esquina para cambiar el tamaño del lienzo: el dibujo no
                cambia de escala —lo que sobra se recorta y lo que falta se añade vacío— y la
                cuadrícula se quita o se añade con él. La guía se activa desde el visor.
              </p>
            </SectionCard>
          </div>

          <div className="xl:hidden shrink-0 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-line">
            <button
              onClick={() => setPanelOpen(false)}
              className="w-full h-11 rounded-full btn-grad text-[13px] font-semibold text-primary-foreground active:scale-[0.98] transition"
            >
              Listo
            </button>
          </div>
        </aside>
      </div>

      {/* Hoja inferior de lápices: siempre entra desde abajo, nunca desde arriba. */}
      {quickSetting === "brush" && (
        <>
          <div
            className="fixed inset-0 z-[125] bg-black/40 animate-in fade-in"
            onClick={() => setQuickSetting(null)}
            aria-hidden
          />
          <div
            id="paint-brushes-sheet"
            role="dialog"
            aria-label="Tipos de lápiz"
            data-paint-quick-setting
            className="fixed inset-x-0 bottom-0 z-[126] mx-auto w-full max-w-md rounded-t-[28px] border-t border-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--m3-elev-3)] animate-in slide-in-from-bottom duration-200"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden />
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Tipos de lápiz</h3>
              <button aria-label="Cerrar lápices" onClick={() => setQuickSetting(null)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"><X size={16} /></button>
            </div>
            <div className="space-y-2">
              {PAINT_BRUSHES.map(item => (
                <button
                  key={item.id}
                  aria-pressed={brush === item.id}
                  onClick={() => { setBrush(item.id); setTool("brush"); setQuickSetting(null); }}
                  className={`w-full rounded-xl border p-3 text-left transition ${brush === item.id ? "border-primary bg-accent text-accent-foreground" : "border-line hover:bg-muted"}`}
                >
                  <span className="block text-sm font-semibold">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Hoja inferior de formas: entra desde abajo, igual que la de lápices. */}
      {quickSetting === "shapes" && (
        <>
          <div
            className="fixed inset-0 z-[125] bg-black/40 animate-in fade-in"
            onClick={() => setQuickSetting(null)}
            aria-hidden
          />
          <div
            id="paint-shapes-sheet"
            role="dialog"
            aria-label="Formas disponibles"
            data-paint-quick-setting
            className="fixed inset-x-0 bottom-0 z-[126] mx-auto w-full max-w-md max-h-[80dvh] overflow-y-auto rounded-t-[28px] border-t border-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--m3-elev-3)] animate-in slide-in-from-bottom duration-200"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden />
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Formas</h3>
              <button aria-label="Cerrar formas" onClick={() => setQuickSetting(null)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"><X size={16} /></button>
            </div>
            <ShapePicker
              value={shapeKind}
              onPick={id => { setShapeKind(id); setTool("shape"); }}
            />
            <label className="mt-3 flex items-center justify-between gap-2 text-[11px]">
              <span>Grosor</span>
              <span className="flex items-center gap-2">
                <Slider min={1} max={48} step={1} value={[width]} onValueChange={([v]) => setWidth(v)} aria-label="Grosor de la forma" className="w-28" />
                <span className="w-10 text-right font-mono tabular-nums text-primary">{width} px</span>
              </span>
            </label>
            <label className="mt-2 flex items-center justify-between gap-2 text-[11px]">
              <span>Relleno sólido</span>
              <Switch
                checked={shapeFilled && shapeClosed(shapeKind)}
                onCheckedChange={setShapeFilled}
                disabled={!shapeClosed(shapeKind)}
                aria-label="Relleno de la forma"
              />
            </label>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
              {shapeClosed(shapeKind)
                ? `${shapeDef(shapeKind).name}: ${shapeDef(shapeKind).description}. Arrastra sobre el lienzo para colocarla.`
                : `${shapeDef(shapeKind).name} es una forma abierta: solo se puede trazar.`}
              {" "}Al soltarla queda seleccionada y con «Mover» la cambias de sitio cuando quieras.
            </p>
          </div>
        </>
      )}

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
    </div>,
    document.body,
  );
}
