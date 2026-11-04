import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const core = read("src/lib/engine/core.ts");
const runtime = read("src/components/engine/GameRuntime.tsx");
const scriptEditor = read("src/components/engine/ScriptEditor.tsx");
const knowledge = read("src/lib/ai/engine-knowledge.ts");

describe("scripts en la interfaz (apartado UI)", () => {
  it("un elemento de interfaz guarda sus propios scripts", () => {
    const element = core.split("export interface UIElement {")[1]?.split("}")[0] ?? "";
    expect(element).toContain("scripts?: Script[];");
    // Y los eventos que los disparan son los tres momentos del toque.
    expect(element).toContain("onTap");
    expect(element).toContain("onHold");
    expect(element).toContain("onRelease");
  });

  it("el editor de bloques se reutiliza: selector acotado por contexto y textos del propietario", () => {
    expect(scriptEditor).toContain("events?: EventType[];");
    expect(scriptEditor).toContain("events = ENTITY_EVENTS");
    expect(scriptEditor).toContain("{events.map(k =>");
    expect(scriptEditor).toContain("EVENTS · {ownerLabel}");
  });

  it("al jugar, el toque ejecuta los scripts del elemento (y no solo los de un botón)", () => {
    // Se puede tocar cualquier elemento con scripts, no únicamente botones.
    expect(runtime).toContain('(e.kind === "button" || (e.scripts?.length ?? 0) > 0)');
    // El toque busca en la UI que se está jugando (la copia del runtime), no en
    // la del editor: si un script esconde o mueve el elemento, el toque lo ve.
    expect(runtime).toContain("const liveUI = (): UIElement[] => workRef.current?.ui ?? scene.ui ?? [];");
    expect(runtime).toContain("const tappable = liveUI().filter(e =>");
    expect(runtime).toContain("workRef.current = work;");
    // Pulsar y soltar disparan su script; «mantener» va con el fotograma.
    expect(runtime).toContain('if (b.scripts?.length) uiScriptsRef.current?.(b, down ? "tap" : "release");');
    expect(runtime).toContain('uiScriptsRef.current?.(d.el, "hold");');
    expect(runtime).toContain("uiScriptsRef.current = (el, phase) => scripts.runUI(el, phase);");
  });

  it("el contexto de la IA conoce los eventos y los scripts de interfaz", () => {
    expect(knowledge).toContain("onTap|onHold|onRelease");
    expect(knowledge).toContain("scripts?: Script[]");
  });
});
