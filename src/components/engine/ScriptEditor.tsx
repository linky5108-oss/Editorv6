import { useState } from "react";
import { Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import {
  type Block,
  type EventType,
  type Script,
  BLOCK_LABELS,
  ENTITY_EVENTS,
  EVENT_LABELS,
  applyScriptEdit,
  normalizeScripts,
} from "@/lib/engine/scripts";
import { ENGINE_KNOWLEDGE } from "@/lib/ai/engine-knowledge";
import {
  buildGeminiScriptEditPrompt,
  buildGeminiScriptPrompt,
  geminiChat,
  parseAiJson,
} from "@/lib/ai/gemini-provider";

/**
 * Editor de Script manual impulsado exclusivamente por Inteligencia Artificial.
 * Elimina por completo la creación manual por código o bloques de código:
 * todos los scripts manuales se crean y modifican describiendo en lenguaje
 * natural lo que debe hacer la entidad o el elemento de interfaz.
 */
interface Props {
  /** Scripts manuales actuales del propietario. */
  scripts?: Script[];
  /** Título del encabezado, p. ej. «PLAYER» o «BOTÓN · JUMP». */
  ownerLabel: string;
  /** Qué tipo de objeto se está configurando (lo usa la IA). */
  aiTargetKind: string;
  /** Resumen para la IA: dónde está y qué tamaño tiene. */
  aiSummary: string;
  /** Eventos válidos para este propietario (entidad o UI). */
  events?: EventType[];
  /** Si se proporciona, permite abrir directamente el estudio completo de Script manual con vista previa en vivo. */
  onOpenFullAiStudio?: () => void;
  onChange: (patch: { scripts: Script[] }) => void;
  onClose: () => void;
}

const QUICK_IDEAS: string[] = [
  "Al chocar con el jugador, empuja hacia atrás y resta 1 vida",
  "En cada fotograma, persigue suavemente al jugador",
  "Al tocar este objeto, suma 25 puntos, sacude la pantalla y destrúyelo",
  "Cada 2 segundos, lanza un salto automático hacia arriba",
];

function describeBlockNaturally(block: Block): string {
  const label = BLOCK_LABELS[block.kind] ?? block.kind;
  if (block.kind === "if" || block.kind === "ifVariable" || block.kind === "repeat") {
    const nested = (block.thenBlocks ?? []).map(describeBlockNaturally).join(", ");
    return nested ? `${label} (${nested})` : label;
  }
  if (typeof block.value === "number") return `${label}: ${block.value}`;
  if (typeof block.w === "number" && typeof block.h === "number") return `${label}: ${block.w}×${block.h}`;
  if (typeof block.x === "number" && typeof block.y === "number") return `${label}: (${block.x}, ${block.y})`;
  if (typeof block.text === "string" && block.text.trim()) return `${label}: ${block.text}`;
  if (typeof block.color === "string" && block.color.trim()) return `${label}: ${block.color}`;
  return label;
}

export function ScriptEditor({
  scripts: initialScripts,
  ownerLabel,
  aiTargetKind,
  aiSummary,
  events = ENTITY_EVENTS,
  onOpenFullAiStudio,
  onChange,
  onClose,
}: Props) {
  const [scripts, setScripts] = useState<Script[]>(initialScripts ?? []);
  const [openId, setOpenId] = useState<string | null>(scripts[0]?.id ?? null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [generatedIds, setGeneratedIds] = useState<string[]>([]);

  const commit = (next: Script[]) => {
    setScripts(next);
    onChange({ scripts: next });
  };

  const removeScript = (id: string) => {
    commit(scripts.filter((s) => s.id !== id));
    setGeneratedIds((ids) => ids.filter((x) => x !== id));
  };

  const removeGenerated = () => {
    if (!generatedIds.length) return;
    commit(scripts.filter((s) => !generatedIds.includes(s.id)));
    setGeneratedIds([]);
  };

  const replaceScript = (id: string, next: Script) =>
    commit(scripts.map((s) => (s.id === id ? { ...next, id } : s)));

  const generateWithAi = async (customText?: string) => {
    const requestText = (customText ?? aiPrompt).trim();
    if (!requestText || aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    try {
      const allowedEventsHint = `Eventos permitidos para este objeto: ${events.join(", ")}.`;
      const prompt = buildGeminiScriptPrompt({
        userRequest: `${requestText}\n${allowedEventsHint}`,
        engineKnowledge: ENGINE_KNOWLEDGE,
        targetEntityKind: aiTargetKind,
        projectSummary: `${aiSummary} Scripts manuales actuales: ${scripts.length}.`,
      });
      const res = await geminiChat([{ role: "user", content: prompt }]);
      const normalized = normalizeScripts(parseAiJson(res.text));
      if (!normalized.length) {
        throw new Error("La inteligencia artificial no devolvió ningún script manual válido. Intenta describir la acción con más detalle.");
      }
      const next = [...scripts, ...normalized];
      commit(next);
      setGeneratedIds(normalized.map((s) => s.id));
      setOpenId(normalized[0]?.id ?? openId);
      if (!customText) setAiPrompt("");
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : "No se pudo crear el script manual con IA.");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 panel border-b">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 border border-primary/35 text-primary">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm text-primary-glow glow-text truncate">
              SCRIPT MANUAL · {ownerLabel}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Creación y edición de script manual con inteligencia artificial
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenFullAiStudio && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullAiStudio();
              }}
              className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/40 text-primary text-xs font-display tracking-wide hover:bg-primary/25 transition"
            >
              ✦ VISTA PREVIA + IA COMPLETA
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md panel glow-border text-xs font-display"
          >
            CERRAR
          </button>
        </div>
      </header>

      <div className="mx-3 mt-3 rounded-xl border border-primary/35 bg-card p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-display font-semibold tracking-widest text-primary">
            <Sparkles size={13} />
            <span>NUEVO SCRIPT MANUAL CON IA</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">
            {scripts.length} {scripts.length === 1 ? "script manual" : "scripts manuales"}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Describe con tus palabras qué comportamiento o acción quieres para <strong>{ownerLabel}</strong>. La inteligencia artificial creará el script manual automáticamente sin código ni bloques manuales.
        </p>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              disabled={aiBusy}
              onClick={() => void generateWithAi(idea)}
              className="shrink-0 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[10px] font-medium text-ink-2 hover:border-primary/40 hover:text-foreground transition whitespace-nowrap disabled:opacity-40"
            >
              <Wand2 size={10} className="inline mr-1 text-primary" />
              {idea}
            </button>
          ))}
        </div>

        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="Ej: haz que persiga al jugador y al tocarlo le reste una vida y suene…"
          rows={2}
          className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-xs outline-none focus:border-primary/40 min-h-[60px] resize-none"
        />
        {aiErr && (
          <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-2">
            {aiErr}
          </div>
        )}
        <button
          type="button"
          disabled={aiBusy || !aiPrompt.trim()}
          onClick={() => void generateWithAi()}
          className="w-full h-9 rounded-xl btn-grad text-primary-foreground text-[11px] font-display tracking-widest disabled:opacity-40 active:scale-[0.98] transition"
        >
          {aiBusy ? "CREANDO SCRIPT MANUAL CON IA…" : "✦ CREAR SCRIPT MANUAL CON IA"}
        </button>
        {generatedIds.length > 0 && (
          <button
            type="button"
            onClick={removeGenerated}
            className="w-full h-8 rounded-xl bg-destructive/15 border border-destructive/40 text-destructive text-[10px] font-display tracking-widest"
          >
            DESHACER ÚLTIMO SCRIPT MANUAL GENERADO ({generatedIds.length})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {scripts.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
            Aún no hay ningún script manual en <strong>{ownerLabel}</strong>. Escribe arriba lo que quieres que haga y pulsa{" "}
            <span className="text-primary font-semibold">CREAR SCRIPT MANUAL CON IA</span>.
          </div>
        )}

        {scripts.map((s, idx) => {
          const open = openId === s.id;
          return (
            <div key={s.id} className="panel rounded-xl border border-border/60 overflow-hidden">
              <div className="flex items-center gap-2 pl-3 pr-2 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : s.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <span className="font-display text-xs text-primary-glow tracking-widest truncate">
                    ✦ SCRIPT MANUAL #{idx + 1} · {EVENT_LABELS[s.event]}
                    {s.event === "onCollide" ? ` (${s.withKind ?? "any"})` : ""}
                  </span>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {s.blocks.length} {s.blocks.length === 1 ? "acción IA" : "acciones IA"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeScript(s.id)}
                  title="Eliminar script manual"
                  aria-label="Eliminar script manual"
                  className="shrink-0 w-7 h-7 rounded-md border border-destructive/40 text-destructive grid place-items-center hover:bg-destructive/10 transition"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {open && (
                <div className="border-t border-border/40 p-3 space-y-2.5">
                  <div className="rounded-lg bg-muted/40 border border-border/50 p-2.5 space-y-1.5">
                    <div className="text-[10px] font-display tracking-widest text-muted-foreground">
                      COMPORTAMIENTO GENERADO POR LA IA
                    </div>
                    {s.blocks.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        Sin acciones todavía. Usa el cuadro de abajo para indicarle a la IA qué debe hacer este script manual.
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {s.blocks.map((b) => (
                          <li
                            key={b.id}
                            className="flex items-center gap-2 text-xs font-mono text-foreground"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            <span>{describeBlockNaturally(b)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <ScriptAiEditor
                    script={s}
                    targetKind={aiTargetKind}
                    summary={aiSummary}
                    onApply={(next) => replaceScript(s.id, next)}
                  />

                  <button
                    type="button"
                    onClick={() => removeScript(s.id)}
                    className="w-full py-1.5 rounded-lg bg-destructive/15 border border-destructive/40 text-destructive font-display text-[10px] tracking-widest"
                  >
                    ELIMINAR ESTE SCRIPT MANUAL
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function unwrapScript(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw[0];
  if (raw && typeof raw === "object" && "script" in raw) return (raw as { script: unknown }).script;
  return raw;
}

function ScriptAiEditor({
  script,
  targetKind,
  summary,
  onApply,
}: {
  script: Script;
  targetKind: string;
  summary: string;
  onApply: (next: Script) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Script | null>(null);

  const edit = async () => {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const prompt = buildGeminiScriptEditPrompt({
        instruction: text,
        engineKnowledge: ENGINE_KNOWLEDGE,
        currentScript: script,
        targetEntityKind: targetKind,
        projectSummary: summary,
      });
      const res = await geminiChat([{ role: "user", content: prompt }], {
        sessionId: `asternal-script-${script.id}`,
      });
      const result = applyScriptEdit(script, unwrapScript(parseAiJson(res.text)));
      if (!result) throw new Error("La IA no devolvió una actualización válida para este script manual.");
      setPrevious(script);
      onApply({
        ...result.script,
        event: result.suggestedEvent ?? result.script.event,
      });
      setInstruction("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo modificar el script manual con IA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
      <div className="text-[10px] font-display tracking-widest text-primary-glow">
        MODIFICAR ESTE SCRIPT MANUAL CON IA
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Ej: haz que además suene y sume el doble de puntos…"
        rows={2}
        className="w-full rounded-lg border border-border bg-input/50 px-2.5 py-2 text-xs outline-none focus:border-primary/40 min-h-[48px] resize-none"
      />
      {err && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-2">
          {err}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || !instruction.trim()}
          onClick={() => void edit()}
          className="flex-1 h-8 rounded-lg btn-grad text-primary-foreground text-[10px] font-display tracking-widest disabled:opacity-40 active:scale-[0.98] transition"
        >
          {busy ? "ACTUALIZANDO CON IA…" : "APLICAR CAMBIO CON IA"}
        </button>
        {previous && !busy && (
          <button
            type="button"
            onClick={() => {
              onApply(previous);
              setPrevious(null);
            }}
            className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-border text-[10px] font-display tracking-widest text-muted-foreground"
          >
            <Undo2 size={11} />
            DESHACER
          </button>
        )}
      </div>
    </div>
  );
}
