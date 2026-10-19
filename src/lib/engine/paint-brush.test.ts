import { describe, expect, it, vi } from "vitest";
import { drawBrush, drawBrushPath, mirrorStrokePoints, PAINT_BRUSHES } from "./paint-brush";

function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    fillStyle: "",
    strokeStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  };
}

describe("lápices del lienzo", () => {
  it("ofrece cinco estilos distintos", () => {
    expect(PAINT_BRUSHES.map(b => b.id)).toEqual(["round", "fine", "grain", "pixel", "marker"]);
  });
  it("pixel art usa cuadrados enteros alineados y cubre todo el segmento", () => {
    const ctx = context();
    drawBrush(ctx as unknown as CanvasRenderingContext2D, "pixel", "#123456", 4, 1, 1, 21, 1);
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fillRect.mock.calls).toEqual([[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 4, 4], [12, 0, 4, 4], [16, 0, 4, 4], [20, 0, 4, 4]]);
  });
  it("el fino reduce el ancho y el marcador cambia opacidad y extremos", () => {
    const ctx = context();
    drawBrush(ctx as unknown as CanvasRenderingContext2D, "fine", "#123456", 10, 0, 0, 10, 10);
    expect(ctx.lineWidth).toBe(3);
    drawBrush(ctx as unknown as CanvasRenderingContext2D, "marker", "#123456", 10, 0, 0, 10, 10);
    expect(ctx.lineWidth).toBe(10);
    expect(ctx.globalAlpha).toBe(0.35);
    expect(ctx.lineCap).toBe("square");
  });
  it("el granulado pinta partículas reproducibles en lugar de una línea sólida", () => {
    const a = context(), b = context();
    drawBrush(a as unknown as CanvasRenderingContext2D, "grain", "#123456", 8, 0, 0, 10, 10);
    drawBrush(b as unknown as CanvasRenderingContext2D, "grain", "#123456", 8, 0, 0, 10, 10);
    expect(a.fillRect.mock.calls.length).toBeGreaterThan(8);
    expect(a.fillRect.mock.calls).toEqual(b.fillRect.mock.calls);
    expect(a.stroke).not.toHaveBeenCalled();
  });
  it("drawBrushPath traza una sola spline cuadrática suave con antialiasing de alta calidad", () => {
    const ctx = context();
    drawBrushPath(
      ctx as unknown as CanvasRenderingContext2D,
      "round",
      "#38bdf8",
      8,
      [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 12 }, { x: 30, y: 20 }],
    );
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });
  it("mirrorStrokePoints refleja trazos en simetría horizontal, vertical y cuádruple", () => {
    const pts = [{ x: 10, y: 20, w: 6 }];
    expect(mirrorStrokePoints(pts, "none", 100, 100)).toHaveLength(1);
    const horiz = mirrorStrokePoints(pts, "horizontal", 100, 100);
    expect(horiz).toEqual([
      [{ x: 10, y: 20, w: 6 }],
      [{ x: 90, y: 20, w: 6 }],
    ]);
    const quad = mirrorStrokePoints(pts, "quad", 100, 100);
    expect(quad).toHaveLength(4);
    expect(quad[3]).toEqual([{ x: 90, y: 80, w: 6 }]);
  });
  it("drawBrushPath aplica opacidad, suavidad, bloqueo alfa y simetría en vivo", () => {
    const ctx = context();
    drawBrushPath(
      ctx as unknown as CanvasRenderingContext2D,
      "round",
      "#ff0055",
      10,
      [{ x: 10, y: 10 }, { x: 25, y: 25 }],
      false,
      {
        opacity: 0.5,
        softness: 0.8,
        alphaLock: true,
        symmetry: "horizontal",
        canvasW: 100,
        canvasH: 100,
      },
    );
    expect(ctx.globalCompositeOperation).toBe("source-atop");
    expect(ctx.globalAlpha).toBeCloseTo(0.5);
    expect(ctx.shadowBlur).toBeGreaterThan(0);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it("el borrador fuerza siempre 100% de opacidad, 0 suavidad y elimina el alfa residual en una sola pasada", () => {
    let writtenImg: { data: Uint8ClampedArray; width: number; height: number } | null = null;
    let writtenY0 = 0;
    let writtenX0 = 0;
    const ctx = {
      ...context(),
      canvas: { width: 20, height: 20 },
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(200),
        width: w,
        height: h,
      })),
      putImageData: vi.fn((img: { data: Uint8ClampedArray; width: number; height: number }, x0: number, y0: number) => {
        writtenImg = img;
        writtenX0 = x0;
        writtenY0 = y0;
      }),
    };
    drawBrushPath(
      ctx as unknown as CanvasRenderingContext2D,
      "round",
      "#ff0055",
      8,
      [{ x: 2, y: 10 }, { x: 18, y: 10 }],
      true,
      {
        opacity: 0.25,
        softness: 0.9,
        alphaLock: true,
      },
    );
    expect(ctx.globalCompositeOperation).toBe("destination-out");
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.shadowBlur).toBe(0);
    expect(ctx.putImageData).toHaveBeenCalled();
    expect(writtenImg).not.toBeNull();
    const centerIdx = ((10 - writtenY0) * writtenImg!.width + (10 - writtenX0)) * 4;
    expect(writtenImg!.data[centerIdx + 3]).toBe(0);
  });
});
