import { describe, expect, it } from "vitest";
import {
  STABILIZE_DEFAULT,
  STABILIZE_MAX,
  STABILIZE_MIN,
  advanceStabilizer,
  clampStabilizeLevel,
  createStabilizerState,
  refineStrokePath,
  stabilizeAlpha,
  stabilizePoint,
} from "./paint-stabilizer";

describe("estabilizador del lápiz", () => {
  it("mantiene el nivel dentro de 0-100 y recupera el punto medio ante valores inválidos", () => {
    expect(clampStabilizeLevel(-20)).toBe(STABILIZE_MIN);
    expect(clampStabilizeLevel(180)).toBe(STABILIZE_MAX);
    expect(clampStabilizeLevel(42.6)).toBe(43);
    expect(clampStabilizeLevel(Number.NaN)).toBe(STABILIZE_DEFAULT);
  });

  it("calibra el peso del suavizado: sin estabilización sigue el cursor exacto", () => {
    expect(stabilizeAlpha(0)).toBe(1);
    const exact = stabilizePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(exact).toEqual({ x: 100, y: 0 });
  });

  it("a mayor nivel, el trazo avanza menos por punto (más suave)", () => {
    expect(stabilizeAlpha(100)).toBeLessThan(stabilizeAlpha(50));
    const soft = stabilizePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 80);
    expect(soft.x).toBeGreaterThan(0);
    expect(soft.x).toBeLessThan(100);
  });

  it("nunca pasa del cursor por suavizar el trazo", () => {
    const point = stabilizePoint({ x: 0, y: 0 }, { x: 200, y: -50 }, 70);
    expect(point.x).toBeLessThanOrEqual(200);
    expect(point.y).toBeGreaterThanOrEqual(-50);
  });

  it("endereza trazos chuecos y elimina vibraciones laterales al refinar la curva", () => {
    const wobblyLine = [
      { x: 0, y: 0 },
      { x: 20, y: 2.2 },
      { x: 40, y: -1.9 },
      { x: 60, y: 2.4 },
      { x: 80, y: -1.7 },
      { x: 100, y: 0 },
    ];
    const refined = refineStrokePath(wobblyLine, 80);
    const maxDeviation = Math.max(...refined.map(p => Math.abs(p.y)));
    expect(maxDeviation).toBeLessThan(0.5);
  });

  it("filtra micro-temblores dentro del radio de cuerda tensa", () => {
    const state = createStabilizerState({ x: 50, y: 50 }, 6);
    const jitter = advanceStabilizer(state, { x: 50.8, y: 49.5 }, 6, 80, false);
    expect(jitter).toHaveLength(0);
    const stroke = advanceStabilizer(state, { x: 80, y: 50 }, 6, 80, false);
    expect(stroke.length).toBeGreaterThan(1);
  });

  it("al soltar el trazo (catchUp), la punta alcanza exactamente la posición final del cursor", () => {
    const state = createStabilizerState({ x: 10, y: 10 }, 6);
    advanceStabilizer(state, { x: 120, y: 40 }, 6, 85, false);
    expect(state.tip.x).toBeLessThan(120);
    const tail = advanceStabilizer(state, { x: 120, y: 40 }, 6, 85, true);
    expect(tail.length).toBeGreaterThan(0);
    const last = tail[tail.length - 1];
    expect(last.x).toBeCloseTo(120, 4);
    expect(last.y).toBeCloseTo(40, 4);
    expect(state.tip).toEqual({ x: 120, y: 40 });
  });
});

