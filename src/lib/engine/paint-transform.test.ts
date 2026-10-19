import { describe, expect, it } from "vitest";
import {
  LAYER_BLEND_MODES,
  computeRotationAngle,
  computeScaledBox,
  cursorForHandle,
  findLassoPixelBounds,
  findNonEmptyPixelBounds,
  floodFillImageData,
  getTransformHandles,
  hitTestTransformGizmo,
  localToWorld,
  pointInPolygon,
  worldToLocal,
  type TransformBox,
} from "./paint-transform";

const BASE_BOX: TransformBox = {
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  rotation: 0,
  flipX: false,
  flipY: false,
};

describe("motor de transformación de objetos en el lienzo", () => {
  it("convierte coordenadas entre el mundo y el espacio local con rotación", () => {
    const cx = 200;
    const cy = 150;
    const rot = Math.PI / 3;
    const world = localToWorld(40, -25, cx, cy, rot);
    const local = worldToLocal(world.x, world.y, cx, cy, rot);
    expect(local.x).toBeCloseTo(40, 5);
    expect(local.y).toBeCloseTo(-25, 5);
  });

  it("detecta los 8 tiradores de escala, el de rotación, el de clonación y el cuerpo", () => {
    const handles = getTransformHandles(BASE_BOX, 1);
    expect(handles).toHaveLength(10);
    for (const h of handles) {
      expect(hitTestTransformGizmo(BASE_BOX, h.x, h.y, 1)).toBe(h.id);
    }
    expect(hitTestTransformGizmo(BASE_BOX, 200, 150, 1)).toBe("body");
    expect(hitTestTransformGizmo(BASE_BOX, 10, 10, 1)).toBeNull();
  });

  it("escala desde esquinas y lados manteniendo el borde opuesto anclado", () => {
    const east = computeScaledBox(BASE_BOX, "e", 360, 150);
    expect(east.x).toBeCloseTo(100);
    expect(east.w).toBeCloseTo(260);
    expect(east.h).toBeCloseTo(100);
    expect(east.flipX).toBe(false);

    const nw = computeScaledBox(BASE_BOX, "nw", 60, 80);
    expect(nw.x).toBeCloseTo(60);
    expect(nw.y).toBeCloseTo(80);
    expect(nw.w).toBeCloseTo(240);
    expect(nw.h).toBeCloseTo(120);
  });

  it("voltea horizontal o verticalmente al cruzar el lado opuesto del marco", () => {
    const flippedX = computeScaledBox(BASE_BOX, "e", 40, 150);
    expect(flippedX.flipX).toBe(true);
    expect(flippedX.w).toBeCloseTo(60);
    expect(flippedX.x).toBeCloseTo(40);

    const flippedY = computeScaledBox(BASE_BOX, "n", 200, 250);
    expect(flippedY.flipY).toBe(true);
    expect(flippedY.h).toBeCloseTo(50);
    expect(flippedY.y).toBeCloseTo(200);
  });

  it("calcula el ángulo de rotación desde el tirador superior con y sin ajuste de 15°", () => {
    expect(computeRotationAngle(200, 150, 300, 150, false)).toBeCloseTo(Math.PI / 2);
    const snapped = computeRotationAngle(200, 150, 200 + Math.cos(-Math.PI / 2 + 0.24), 150 + Math.sin(-Math.PI / 2 + 0.24), true);
    expect(snapped).toBeCloseTo(Math.PI / 12);
    expect(cursorForHandle("rotate")).toBe("cursor-grab");
    expect(cursorForHandle("clone")).toBe("cursor-copy");
  });

  it("encuentra los límites de píxeles no transparentes de una capa o de un recorte rectangular", () => {
    const data = new Uint8ClampedArray(20 * 20 * 4);
    const setAlpha = (x: number, y: number, a: number) => {
      data[(y * 20 + x) * 4 + 3] = a;
    };
    setAlpha(4, 5, 255);
    setAlpha(12, 15, 200);
    const img = { width: 20, height: 20, data } as ImageData;
    expect(findNonEmptyPixelBounds(img)).toEqual({ x: 4, y: 5, w: 9, h: 11 });
    expect(findNonEmptyPixelBounds(img, { x: 0, y: 0, w: 8, h: 8 })).toEqual({ x: 4, y: 5, w: 1, h: 1 });
  });

  it("recorta una selección por lazo libre evaluando la máscara poligonal", () => {
    const data = new Uint8ClampedArray(20 * 20 * 4);
    const setAlpha = (x: number, y: number, a: number) => {
      data[(y * 20 + x) * 4 + 3] = a;
    };
    setAlpha(5, 5, 255);
    setAlpha(6, 6, 255);
    setAlpha(15, 15, 255);
    const poly = [
      { x: 2, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 10 },
      { x: 2, y: 10 },
    ];
    expect(pointInPolygon(5.5, 5.5, poly)).toBe(true);
    expect(pointInPolygon(15.5, 15.5, poly)).toBe(false);
    const bounds = findLassoPixelBounds({ width: 20, height: 20, data } as ImageData, poly);
    expect(bounds).toEqual({ x: 5, y: 5, w: 2, h: 2 });
  });

  it("rellena por inundación con tolerancia, bloqueo alfa y degradados lineal/radial", () => {
    const W = 10, H = 10;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) {
        const i = (y * W + x) * 4;
        data[i] = 10; data[i + 1] = 20; data[i + 2] = 30; data[i + 3] = 200;
      }
    }
    const filled = floodFillImageData(data, W, H, 4, 4, "#ff0000", {
      tolerance: 50,
      alphaLock: true,
      gradientMode: "linear",
      secondaryColor: "#0000ff",
    });
    expect(filled).toBe(true);
    expect(data[3]).toBe(0);
    const iStart = (2 * W + 2) * 4;
    expect(data[iStart + 3]).toBe(200);
    expect(data[iStart]).toBeGreaterThan(200);
    const iEnd = (7 * W + 7) * 4;
    expect(data[iEnd + 2]).toBeGreaterThan(200);
  });

  it("expone el catálogo de modos de fusión de capas", () => {
    expect(LAYER_BLEND_MODES.map(m => m.id)).toEqual([
      "source-over",
      "multiply",
      "screen",
      "overlay",
      "soft-light",
      "lighter",
    ]);
  });
});
