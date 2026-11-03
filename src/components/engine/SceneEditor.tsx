import { useEffect, useRef, useState, useCallback } from "react";
import type { Entity, EntityKind, Scene } from "@/lib/engine/core";
import {
  KIND_PRESETS,
  uid,
  sortedForRender,
  isOnHiddenLayer,
  layerOpacityFor,
  isPlayerEntity,
  isMainGoalEntity,
  duplicateEntityInScene,
  childrenOf,
  entityById,
  removeEntityWithChildren,
  setEntityPosition,
} from "@/lib/engine/core";
import { canvasPixelSize, needsCanvasResize } from "@/lib/engine/canvas";
import { getImage, getRenderableImage } from "@/lib/engine/images";
import { currentFrameRenderable } from "@/lib/engine/animations";
import { drawChibiCharacter } from "@/lib/engine/character";

interface Props {
  scene: Scene;
  tool: EntityKind | "select" | "erase";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (scene: Scene) => void;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_PX = 12;

function handlePos(e: Entity, h: HandleId) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  switch (h) {
    case "nw": return { x: e.x, y: e.y };
    case "n":  return { x: cx, y: e.y };
    case "ne": return { x: e.x + e.w, y: e.y };
    case "e":  return { x: e.x + e.w, y: cy };
    case "se": return { x: e.x + e.w, y: e.y + e.h };
    case "s":  return { x: cx, y: e.y + e.h };
    case "sw": return { x: e.x, y: e.y + e.h };
    case "w":  return { x: e.x, y: cy };
  }
}

function resizeEntity(e: Entity, h: HandleId, wx: number, wy: number): Entity {
  const sn = (v: number) => Math.round(v / 10) * 10;
  let { x, y, w, h: he } = e;
  const right = x + w;
  const bottom = y + he;
  if (h.includes("w")) { const nx = Math.min(sn(wx), right - 10); w = right - nx; x = nx; }
  if (h.includes("e")) { const nr = Math.max(sn(wx), x + 10); w = nr - x; }
  if (h.includes("n")) { const ny = Math.min(sn(wy), bottom - 10); he = bottom - ny; y = ny; }
  if (h.includes("s")) { const nb = Math.max(sn(wy), y + 10); he = nb - y; }
  return { ...e, x, y, w, h: he };
}

export function SceneEditor({
  scene,
  tool,
  selectedId,
  onSelect,
  onChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(0.55);
  const animRef = useRef(0);

  const fitSceneToViewport = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 40 || h < 40) return;
    const s = Math.min(w / scene.width, h / scene.height) * 0.92;
    setScale(s);
    setPan({
      x: (w - scene.width * s) / 2,
      y: (h - scene.height * s) / 2,
    });
  }, [scene.width, scene.height]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    fitSceneToViewport();
    const ro = new ResizeObserver(fitSceneToViewport);
    ro.observe(wrap);
    window.addEventListener("resize", fitSceneToViewport);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fitSceneToViewport);
    };
  }, [fitSceneToViewport, scene.id]);

  // Keyboard shortcuts (Delete / Duplicate)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      const sel = scene.entities.find((e) => e.id === selectedId);
      if (!sel) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
        ev.preventDefault();
        const result = duplicateEntityInScene(scene, sel.id);
        if (result) {
          onChange(result.scene);
          onSelect(result.cloneId);
        }
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (!isPlayerEntity(sel) && !isMainGoalEntity(sel)) {
          ev.preventDefault();
          onChange(removeEntityWithChildren(scene, sel.id));
          onSelect(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, selectedId, onChange, onSelect]);

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<{
    mode: "idle" | "pan" | "move" | "resize" | "pinch" | "hb-move" | "hb-resize";
    startSX?: number;
    startSY?: number;
    entStartX?: number;
    entStartY?: number;
    entStartW?: number;
    entStartH?: number;
    hbStartX?: number;
    hbStartY?: number;
    hbStartW?: number;
    hbStartH?: number;
    entId?: string;
    handle?: HandleId;
    panStart?: { x: number; y: number };
    pinchStartDist?: number;
    pinchStartScale?: number;
    pinchStartCenter?: { x: number; y: number };
    pinchStartPan?: { x: number; y: number };
  }>({ mode: "idle" });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = (canvas.getContext("2d", { desynchronized: true }) ?? canvas.getContext("2d"))!;
    let mounted = true;

    const hasAnimated = scene.entities.some((e) =>
      (e.animations ?? []).some((c) => c.frames.length > 1 && c.fps > 0),
    );
    const sortedEnts = sortedForRender(scene).filter((e) => !isOnHiddenLayer(scene, e));

    const setupSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const next = canvasPixelSize(canvas.clientWidth, canvas.clientHeight, dpr);
      if (needsCanvasResize(canvas, next)) {
        canvas.width = next.width;
        canvas.height = next.height;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    };

    const render = (t: number) => {
      if (!mounted) return;
      setupSize();
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);

      // Level box background
      const grd = ctx.createLinearGradient(0, 0, 0, scene.height);
      grd.addColorStop(0, scene.bg || "#0b1e3f");
      grd.addColorStop(1, "#020617");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, scene.width, scene.height);

      if (scene.bgImage) {
        const bgImg = getRenderableImage(scene.bgImage);
        if (bgImg) {
          ctx.drawImage(bgImg, 0, 0, scene.width, scene.height);
        } else {
          const pendingBg = getImage(scene.bgImage);
          if (pendingBg && !pendingBg.onload) {
            pendingBg.onload = () => render(performance.now());
          }
        }
      }

      // Grid inside level box
      ctx.strokeStyle = "rgba(56,189,248,0.10)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let x = 0; x <= scene.width; x += 40) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, scene.height);
      }
      for (let y = 0; y <= scene.height; y += 40) {
        ctx.moveTo(0, y);
        ctx.lineTo(scene.width, y);
      }
      ctx.stroke();

      // Level box border
      ctx.strokeStyle = "rgba(56,189,248,0.55)";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(0, 0, scene.width, scene.height);

      const cullMinX = -pan.x / scale - 96;
      const cullMaxX = (W - pan.x) / scale + 96;
      const cullMinY = -pan.y / scale - 96;
      const cullMaxY = (H - pan.y) / scale + 96;

      const tSec = t / 1000;
      for (const e of sortedEnts) {
        if (e.x + e.w < cullMinX || e.x > cullMaxX || e.y + e.h < cullMinY || e.y > cullMaxY) continue;
        ctx.save();
        const la = layerOpacityFor(scene, e);
        const ea = (e.opacity ?? 1) * la;
        if (ea !== 1) ctx.globalAlpha = ea;
        const flipX = (e.facing === -1) !== !!e.flipX;
        const rot = ((e.rotation ?? 0) * Math.PI) / 180;
        if (rot) {
          const cx = e.x + e.w / 2;
          const cy = e.y + e.h / 2;
          ctx.translate(cx, cy);
          ctx.rotate(rot);
          ctx.translate(-cx, -cy);
        }
        ctx.translate(e.x + (flipX ? e.w : 0), e.y);
        ctx.scale(flipX ? -1 : 1, 1);
        const animImg = currentFrameRenderable(e, tSec, "idle");
        const drawFit = (img: HTMLImageElement | ImageBitmap) => {
          const fit = e.textureFit ?? "stretch";
          if (fit === "stretch") {
            ctx.drawImage(img, 0, 0, e.w, e.h);
            return;
          }
          const sa = img.width / img.height;
          const da = e.w / e.h;
          const cover = fit === "cover" ? sa > da : sa < da;
          const dw = cover ? e.h * sa : e.w;
          const dh = cover ? e.h : e.w / sa;
          ctx.drawImage(img, (e.w - dw) / 2, (e.h - dh) / 2, dw, dh);
        };
        if (animImg) {
          drawFit(animImg);
        } else if (e.texture) {
          const img = getRenderableImage(e.texture);
          if (img) drawFit(img);
          else {
            ctx.fillStyle = "rgba(56,189,248,0.15)";
            ctx.fillRect(0, 0, e.w, e.h);
            const pendingImg = getImage(e.texture);
            if (pendingImg && !pendingImg.onload) {
              pendingImg.onload = () => render(performance.now());
            }
          }
        } else {
          ctx.save();
          if (flipX) {
            ctx.translate(e.w, 0);
            ctx.scale(-1, 1);
          }
          ctx.shadowColor = e.color;
          ctx.shadowBlur = e.kind === "coin" ? 10 : e.kind === "goal" && e.goal ? 12 : 4;
          ctx.fillStyle = e.color;
          if (e.kind === "coin") {
            ctx.beginPath();
            ctx.arc(e.w / 2, e.h / 2, e.w / 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (e.kind === "goal" && e.goal) {
            ctx.fillStyle = "rgba(125,211,252,0.3)";
            ctx.fillRect(0, 0, e.w, e.h);
            ctx.fillStyle = e.color;
            ctx.fillRect(e.w / 2 - 2, 0, 4, e.h);
            ctx.beginPath();
            ctx.moveTo(e.w / 2 + 2, 4);
            ctx.lineTo(e.w / 2 + 22, 12);
            ctx.lineTo(e.w / 2 + 2, 20);
            ctx.closePath();
            ctx.fill();
          } else {
            const r = e.kind === "platform" ? 4 : 6;
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.arcTo(e.w, 0, e.w, e.h, r);
            ctx.arcTo(e.w, e.h, 0, e.h, r);
            ctx.arcTo(0, e.h, 0, 0, r);
            ctx.arcTo(0, 0, e.w, 0, r);
            ctx.closePath();
            ctx.fill();
            if (e.kind === "player") {
              ctx.shadowBlur = 0;
              drawChibiCharacter(ctx, 0, 0, e.w, e.h, e.color, flipX ? -1 : 1);
            }
          }
          ctx.restore();
        }
        ctx.restore();
      }

      // Hitboxes
      for (const e of scene.entities) {
        const hb = e.hitbox;
        if (!hb) continue;
        const isSel = e.id === selectedId;
        ctx.save();
        ctx.lineWidth = (isSel ? 2 : 1) / scale;
        ctx.strokeStyle = isSel ? "#f43f5e" : "rgba(244,63,94,0.55)";
        ctx.setLineDash([8 / scale, 6 / scale]);
        ctx.strokeRect(e.x + hb.x, e.y + hb.y, hb.w, hb.h);
        ctx.setLineDash([]);
        ctx.restore();
      }

      const sel = scene.entities.find((e) => e.id === selectedId);
      if (sel) {
        ctx.restore();
        const sx = pan.x + sel.x * scale;
        const sy = pan.y + sel.y * scale;
        const sw = sel.w * scale;
        const sh = sel.h * scale;

        // Hierarchy links
        const linked = [
          ...(sel.parentId ? [sel.parentId] : []),
          ...childrenOf(scene, sel.id).map((c) => c.id),
        ];
        if (linked.length) {
          const selCx = pan.x + (sel.x + sel.w / 2) * scale;
          const selCy = pan.y + (sel.y + sel.h / 2) * scale;
          ctx.save();
          ctx.strokeStyle = "rgba(167,139,250,0.85)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          for (const id of linked) {
            const other = scene.entities.find((e) => e.id === id);
            if (!other) continue;
            const ox = pan.x + (other.x + other.w / 2) * scale;
            const oy = pan.y + (other.y + other.h / 2) * scale;
            ctx.moveTo(selCx, selCy);
            ctx.lineTo(ox, oy);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          for (const id of linked) {
            const other = scene.entities.find((e) => e.id === id);
            if (!other) continue;
            const ox = pan.x + (other.x + other.w / 2) * scale;
            const oy = pan.y + (other.y + other.h / 2) * scale;
            ctx.fillStyle = "#a78bfa";
            ctx.fillRect(ox - 3, oy - 3, 6, 6);
          }
          ctx.restore();
        }

        // Selection bounding box
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#38bdf8";
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

        for (const h of HANDLES) {
          const wp = handlePos(sel, h);
          const hx = pan.x + wp.x * scale - HANDLE_PX / 2;
          const hy = pan.y + wp.y * scale - HANDLE_PX / 2;
          ctx.fillStyle = "#f8fafc";
          ctx.strokeStyle = "#0ea5e9";
          ctx.lineWidth = 1.5;
          ctx.fillRect(hx, hy, HANDLE_PX, HANDLE_PX);
          ctx.strokeRect(hx + 0.5, hy + 0.5, HANDLE_PX - 1, HANDLE_PX - 1);
        }

        if (sel.hitbox) {
          const hb = sel.hitbox;
          const hbX = pan.x + (sel.x + hb.x) * scale;
          const hbY = pan.y + (sel.y + hb.y) * scale;
          const hbW = hb.w * scale;
          const hbH = hb.h * scale;
          ctx.fillStyle = "rgba(244,63,94,0.10)";
          ctx.fillRect(hbX, hbY, hbW, hbH);
          const HB_PX = 10;
          const corners: [HandleId, number, number][] = [
            ["nw", hbX, hbY],
            ["ne", hbX + hbW, hbY],
            ["sw", hbX, hbY + hbH],
            ["se", hbX + hbW, hbY + hbH],
          ];
          for (const [, cx, cy] of corners) {
            ctx.fillStyle = "#fda4af";
            ctx.strokeStyle = "#f43f5e";
            ctx.lineWidth = 1.5;
            ctx.fillRect(cx - HB_PX / 2, cy - HB_PX / 2, HB_PX, HB_PX);
            ctx.strokeRect(cx - HB_PX / 2 + 0.5, cy - HB_PX / 2 + 0.5, HB_PX - 1, HB_PX - 1);
          }
        }
      } else {
        ctx.restore();
      }

      if (hasAnimated) animRef.current = requestAnimationFrame(render);
    };
    animRef.current = requestAnimationFrame(render);
    return () => {
      mounted = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [scene, pan, scale, selectedId]);

  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - pan.x) / scale,
    y: (sy - pan.y) / scale,
  });

  const hitTest = (wx: number, wy: number) => {
    for (let i = scene.entities.length - 1; i >= 0; i--) {
      const e = scene.entities[i];
      if (e.locked) continue;
      if (e.visible === false) continue;
      if (isOnHiddenLayer(scene, e)) continue;
      if (wx >= e.x && wx <= e.x + e.w && wy >= e.y && wy <= e.y + e.h) return e;
    }
    return null;
  };

  const hitHandle = (sx: number, sy: number): HandleId | null => {
    const sel = scene.entities.find((e) => e.id === selectedId);
    if (!sel) return null;
    for (const h of HANDLES) {
      const wp = handlePos(sel, h);
      const hx = pan.x + wp.x * scale;
      const hy = pan.y + wp.y * scale;
      if (Math.abs(sx - hx) <= HANDLE_PX && Math.abs(sy - hy) <= HANDLE_PX) return h;
    }
    return null;
  };

  const hitHbHandle = (sx: number, sy: number): "nw" | "ne" | "sw" | "se" | null => {
    const sel = scene.entities.find((e) => e.id === selectedId);
    if (!sel || !sel.hitbox) return null;
    const hb = sel.hitbox;
    const hbX = pan.x + (sel.x + hb.x) * scale;
    const hbY = pan.y + (sel.y + hb.y) * scale;
    const hbW = hb.w * scale;
    const hbH = hb.h * scale;
    const HB_PX = 14;
    const corners: ["nw" | "ne" | "sw" | "se", number, number][] = [
      ["nw", hbX, hbY],
      ["ne", hbX + hbW, hbY],
      ["sw", hbX, hbY + hbH],
      ["se", hbX + hbW, hbY + hbH],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.abs(sx - cx) <= HB_PX && Math.abs(sy - cy) <= HB_PX) return name;
    }
    return null;
  };

  const hitHbBody = (sx: number, sy: number) => {
    const sel = scene.entities.find((e) => e.id === selectedId);
    if (!sel || !sel.hitbox) return false;
    const hb = sel.hitbox;
    const hbX = pan.x + (sel.x + hb.x) * scale;
    const hbY = pan.y + (sel.y + hb.y) * scale;
    const hbW = hb.w * scale;
    const hbH = hb.h * scale;
    return sx >= hbX && sx <= hbX + hbW && sy >= hbY && sy <= hbY + hbH;
  };

  const cachedRectRef = useRef<DOMRect | null>(null);
  const getLocal = (ev: React.PointerEvent, refreshRect = false) => {
    if (refreshRect || !cachedRectRef.current) {
      cachedRectRef.current = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    }
    const rect = cachedRectRef.current;
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  };

  const beginPinch = () => {
    const pts = Array.from(pointers.current.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    gesture.current = {
      mode: "pinch",
      pinchStartDist: dist,
      pinchStartScale: scale,
      pinchStartCenter: { x: cx, y: cy },
      pinchStartPan: { ...pan },
    };
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const { sx, sy } = getLocal(ev, true);
    pointers.current.set(ev.pointerId, { x: sx, y: sy });

    if (pointers.current.size >= 2) {
      beginPinch();
      return;
    }

    const w = screenToWorld(sx, sy);

    const handle = hitHandle(sx, sy);
    if (handle && selectedId) {
      const ent = scene.entities.find((e) => e.id === selectedId)!;
      gesture.current = {
        mode: "resize",
        handle,
        entId: ent.id,
        entStartX: ent.x,
        entStartY: ent.y,
        entStartW: ent.w,
        entStartH: ent.h,
        startSX: sx,
        startSY: sy,
      };
      return;
    }

    if (tool === "select" && selectedId) {
      const hbHandle = hitHbHandle(sx, sy);
      const sel = scene.entities.find((e) => e.id === selectedId);
      if (hbHandle && sel?.hitbox) {
        gesture.current = {
          mode: "hb-resize",
          handle: hbHandle,
          entId: sel.id,
          hbStartX: sel.hitbox.x,
          hbStartY: sel.hitbox.y,
          hbStartW: sel.hitbox.w,
          hbStartH: sel.hitbox.h,
          startSX: sx,
          startSY: sy,
        };
        return;
      }
      if (hitHbBody(sx, sy) && sel?.hitbox) {
        gesture.current = {
          mode: "hb-move",
          entId: sel.id,
          hbStartX: sel.hitbox.x,
          hbStartY: sel.hitbox.y,
          startSX: sx,
          startSY: sy,
        };
        return;
      }
    }

    if (tool === "select") {
      const hit = hitTest(w.x, w.y);
      if (hit) {
        onSelect(hit.id);
        gesture.current = {
          mode: "move",
          entId: hit.id,
          entStartX: hit.x,
          entStartY: hit.y,
          startSX: sx,
          startSY: sy,
        };
      } else {
        onSelect(null);
        gesture.current = { mode: "pan", panStart: { ...pan }, startSX: sx, startSY: sy };
      }
    } else if (tool === "erase") {
      const hit = hitTest(w.x, w.y);
      if (hit && !isPlayerEntity(hit) && !isMainGoalEntity(hit)) {
        onChange(removeEntityWithChildren(scene, hit.id));
      }
    } else {
      const preset = KIND_PRESETS[tool];
      const ent: Entity = {
        ...preset,
        id: uid(),
        x: Math.round((w.x - preset.w / 2) / 20) * 20,
        y: Math.round((w.y - preset.h / 2) / 20) * 20,
      };
      let entities = scene.entities;
      if (tool === "player" && ent.controllable) {
        entities = entities.filter((e) => !isPlayerEntity(e));
      }
      onChange({ ...scene, entities: [...entities, ent] });
      onSelect(ent.id);
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (!pointers.current.has(ev.pointerId)) return;
    const { sx, sy } = getLocal(ev);
    pointers.current.set(ev.pointerId, { x: sx, y: sy });

    const g = gesture.current;

    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const pts = Array.from(pointers.current.values());
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const ratio = dist / (g.pinchStartDist || 1);
      const newScale = Math.max(0.15, Math.min(3, (g.pinchStartScale || 1) * ratio));
      const startC = g.pinchStartCenter!;
      const startPan = g.pinchStartPan!;
      const startScale = g.pinchStartScale!;
      const worldX = (startC.x - startPan.x) / startScale;
      const worldY = (startC.y - startPan.y) / startScale;
      setScale(newScale);
      setPan({ x: cx - worldX * newScale, y: cy - worldY * newScale });
      return;
    }

    if (g.mode === "pan" && g.panStart) {
      setPan({
        x: g.panStart.x + (sx - (g.startSX || 0)),
        y: g.panStart.y + (sy - (g.startSY || 0)),
      });
    } else if (g.mode === "move" && g.entId) {
      const dx = (sx - (g.startSX || 0)) / scale;
      const dy = (sy - (g.startSY || 0)) / scale;
      const target = entityById(scene, g.entId);
      if (!target) return;
      onChange(
        setEntityPosition(
          scene,
          g.entId,
          Math.round(((g.entStartX || 0) + dx) / 10) * 10,
          Math.round(((g.entStartY || 0) + dy) / 10) * 10,
        ),
      );
    } else if (g.mode === "resize" && g.entId && g.handle) {
      const w = screenToWorld(sx, sy);
      const entities = scene.entities.map((e) => {
        if (e.id !== g.entId) return e;
        const base: Entity = {
          ...e,
          x: g.entStartX!,
          y: g.entStartY!,
          w: g.entStartW!,
          h: g.entStartH!,
        };
        return resizeEntity(base, g.handle!, w.x, w.y);
      });
      onChange({ ...scene, entities });
    } else if (g.mode === "hb-move" && g.entId) {
      const dx = (sx - (g.startSX || 0)) / scale;
      const dy = (sy - (g.startSY || 0)) / scale;
      const entities = scene.entities.map((e) => {
        if (e.id !== g.entId || !e.hitbox) return e;
        return {
          ...e,
          hitbox: {
            ...e.hitbox,
            x: Math.round((g.hbStartX || 0) + dx),
            y: Math.round((g.hbStartY || 0) + dy),
          },
        };
      });
      onChange({ ...scene, entities });
    } else if (g.mode === "hb-resize" && g.entId && g.handle) {
      const dx = (sx - (g.startSX || 0)) / scale;
      const dy = (sy - (g.startSY || 0)) / scale;
      const entities = scene.entities.map((e) => {
        if (e.id !== g.entId || !e.hitbox) return e;
        let x = g.hbStartX || 0;
        let y = g.hbStartY || 0;
        let wRect = g.hbStartW || 0;
        let hRect = g.hbStartH || 0;
        if (g.handle!.includes("w")) { x = x + dx; wRect = wRect - dx; }
        if (g.handle!.includes("e")) { wRect = wRect + dx; }
        if (g.handle!.includes("n")) { y = y + dy; hRect = hRect - dy; }
        if (g.handle!.includes("s")) { hRect = hRect + dy; }
        if (wRect < 4) { x = x + wRect - 4; wRect = 4; }
        if (hRect < 4) { y = y + hRect - 4; hRect = 4; }
        return {
          ...e,
          hitbox: {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(wRect),
            h: Math.round(hRect),
          },
        };
      });
      onChange({ ...scene, entities });
    }
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size < 2 && gesture.current.mode === "pinch") {
      gesture.current = { mode: "idle" };
    }
    if (pointers.current.size === 0) {
      gesture.current = { mode: "idle" };
    }
  };

  const onWheel = (ev: React.WheelEvent) => {
    ev.preventDefault();
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = Math.max(0.15, Math.min(3, scale * factor));
    const wx = (sx - pan.x) / scale;
    const wy = (sy - pan.y) / scale;
    setScale(nextScale);
    setPan({
      x: sx - wx * nextScale,
      y: sy - wy * nextScale,
    });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden cyber-grid select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}
