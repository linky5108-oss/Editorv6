import { useMemo, useState } from "react";
import { Sparkles, Trash2, Undo2, Wand2, X } from "lucide-react";
import type { AudioAsset } from "@/lib/engine/core";
import {
  applyChosenAudioToInstruction,
  buildAudioSelectionQuestion,
  detectAudioRequestAndCandidates,
  getProjectAudioLibrary,
  injectAudioAssetIntoScripts,
} from "@/lib/engine/audio-library";
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
  parseAiJson,
  requestScriptAi,
  synthesizeScriptsFromRequest,
} from "@/lib/ai/gemini-provider";

function coerceScriptEvents(list: Script[], allowedEvents: EventType[]): Script[] {
  if (!allowedEvents.length) return list;
  const allowedSet = new Set<EventType>(allowedEvents);
  const isUiOnly = allowedEvents.every((e) => e === "onTap" || e === "onHold" || e === "onRelease");
  return list.map((s) => {
    if (allowedSet.has(s.event)) return s;
    if (isUiOnly) {
      const mapped: EventType =
        s.event === "onUpdate" && allowedSet.has("onHold")
          ? "onHold"
          : allowedEvents[0] ?? "onTap";
      return { ...s, event: mapped };
    }
    const mapped: EventType =
      s.event === "onHold" && allowedSet.has("onUpdate")
        ? "onUpdate"
        : allowedSet.has("onCollide")
          ? "onCollide"
          : allowedEvents[0] ?? "onStart";
    return { ...s, event: mapped };
  });
}

/**
 * Editor de Script manual impulsado exclusivamente por Inteligencia Artificial.
 * Mantiene la estética negro con azul del estudio de Script manual.
 */
interface Props {
  /** Scripts manuales actuales del propietario. */
  scripts?: Script[];
  /** Título del encabezado, p. ej. «PLAYER» o «OBJETO». */
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
  if (typeof block.soundName === "string" && block.soundName.trim()) {
    return `${label}: «${block.soundName}»`;
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
  const [pendingAudioChoice, setPendingAudioChoice] = useState<{
    instruction: string;
    candidates: AudioAsset[];
    question: string;
  } | null>(null);

  const audioLibrary = useMemo(() => getProjectAudioLibrary(null), []);

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

  const generateWithAi = async (customText?: string, chosenAudioAsset?: AudioAsset) => {
    const requestText = (customText ?? aiPrompt).trim();
    if (!requestText || aiBusy) return;

    const detection = detectAudioRequestAndCandidates(requestText, audioLibrary);
    if (!chosenAudioAsset && detection.needsDisambiguation && detection.candidates.length > 0) {
      setAiErr(null);
      setPendingAudioChoice({
        instruction: requestText,
        candidates: detection.candidates,
        question: buildAudioSelectionQuestion(detection.candidates, detection.intentKind),
      });
      return;
    }

    const activeAudioAsset = chosenAudioAsset ?? detection.matchedAsset;
    const effectiveRequest = activeAudioAsset
      ? applyChosenAudioToInstruction(requestText, activeAudioAsset)
      : requestText;

    setPendingAudioChoice(null);
    setAiBusy(true);
    setAiErr(null);
    try {
      const allowedEventsHint = `Eventos permitidos para este objeto: ${events.join(", ")}.`;
      const prompt = buildGeminiScriptPrompt({
        userRequest: `${effectiveRequest}\n${allowedEventsHint}`,
        engineKnowledge: ENGINE_KNOWLEDGE,
        targetEntityKind: aiTargetKind,
        projectSummary: `${aiSummary} Scripts manuales actuales: ${scripts.length}.`,
      });

      let normalized: Script[] = [];
      try {
        const res = await requestScriptAi(prompt);
        normalized = coerceScriptEvents(normalizeScripts(parseAiJson(res.text)), events);
      } catch {
        normalized = [];
      }

      if (!normalized.length || normalized.every((s) => s.blocks.length === 0)) {
        normalized = coerceScriptEvents(
          normalizeScripts(synthesizeScriptsFromRequest(effectiveRequest, events)),
          events,
        );
      }

      if (activeAudioAsset) {
        normalized = injectAudioAssetIntoScripts(normalized, activeAudioAsset, requestText);
      }
      if (!normalized.length) {
        throw new Error("La inteligencia artificial no devolvió ningún script manual válido. Intenta describir la acción con más detalle.");
      }
      const next = [...scripts, ...normalized];
      commit(next);
      setGeneratedIds(normalized.map((s) => s.id));
      setOpenId(normalized[0]?.id ?? openId);
      if (!customText) setAiPrompt("");
    } catch (e) {
      if (activeAudioAsset) {
        // Fallback local directo si se seleccionó un audio de la biblioteca
        const fallbackScripts = injectAudioAssetIntoScripts([], activeAudioAsset, requestText);
        const next = [...scripts, ...fallbackScripts];
        commit(next);
        setGeneratedIds(fallbackScripts.map((s) => s.id));
        setOpenId(fallbackScripts[0]?.id ?? openId);
        if (!customText) setAiPrompt("");
      } else {
        setAiErr(e instanceof Error ? e.message : "No se pudo crear el script manual con IA.");
      }
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#090D16] text-slate-100 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-sky-500/20 bg-gradient-to-r from-[#0B1120] via-[#0D1528] to-[#0B1120] shadow-[0_4px_24px_-6px_rgba(2,6,23,0.9),inset_0_1px_0_rgba(56,189,248,0.14)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-500/25 to-blue-600/20 border border-sky-400/40 text-sky-300 shadow-[0_0_15px_-3px_rgba(56,189,248,0.45)]">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold text-white tracking-wide truncate">
              SCRIPT MANUAL · {ownerLabel}
            </div>
            <div className="text-[10px] font-mono text-sky-300/80">
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
              className="px-3 py-1.5 rounded-xl bg-sky-500/15 border border-sky-400/40 text-sky-200 text-xs font-display font-semibold tracking-wide hover:bg-sky-500/25 hover:text-white transition"
            >
              ✦ ABRIR ESTUDIO DE SCRIPT MANUAL
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-sky-400/25 bg-[#121B2F] text-slate-200 text-xs font-display font-semibold hover:border-sky-400/60 hover:text-white transition"
          >
            <X size={13} />
            CERRAR
          </button>
        </div>
      </header>

      <div className="mx-3 mt-3 rounded-2xl border border-sky-400/30 bg-gradient-to-br from-[#10192E] to-[#0C1324] p-4 space-y-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-display font-bold tracking-wider text-sky-300">
            <Sparkles size={13} className="text-sky-400" />
            <span>NUEVO SCRIPT MANUAL CON IA</span>
          </div>
          <span className="rounded-md bg-sky-500/15 border border-sky-400/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-sky-300">
            {scripts.length} {scripts.length === 1 ? "script manual" : "scripts manuales"}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-300">
          Describe con tus palabras qué comportamiento o acción quieres para <strong className="text-white">{ownerLabel}</strong>. La inteligencia artificial creará el script manual automáticamente sin código ni bloques manuales.
        </p>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              disabled={aiBusy}
              onClick={() => void generateWithAi(idea)}
              className="shrink-0 rounded-lg border border-sky-400/25 bg-[#121C33] px-2.5 py-1.5 text-[10px] font-medium text-slate-100 hover:border-sky-400/70 hover:bg-sky-500/20 hover:text-white transition whitespace-nowrap disabled:opacity-40"
            >
              <Wand2 size={10} className="inline mr-1 text-sky-400" />
              {idea}
            </button>
          ))}
        </div>

        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="Ej: haz que persiga al jugador y al tocarlo le reste una vida y suene…"
          rows={2}
          className="w-full rounded-xl border border-sky-400/25 bg-[#070B13] px-3 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 min-h-[60px] resize-none"
        />
        {pendingAudioChoice && (
          <div className="rounded-xl border border-sky-400/50 bg-[#0B1426] p-3 space-y-2">
            <div className="text-[11px] font-display font-bold text-sky-300">
              ♪ BIBLIOTECA DE AUDIO DETECTADA
            </div>
            <p className="text-xs text-slate-200">{pendingAudioChoice.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingAudioChoice.candidates.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => void generateWithAi(pendingAudioChoice.instruction, asset)}
                  className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500/35 transition"
                >
                  ♪ {asset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {aiErr && (
          <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/40 rounded-lg px-3 py-2">
            {aiErr}
          </div>
        )}
        <button
          type="button"
          disabled={aiBusy || !aiPrompt.trim()}
          onClick={() => void generateWithAi()}
          className="w-full h-10 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 text-xs font-display font-bold tracking-widest shadow-[0_4px_14px_rgba(14,165,233,0.35)] hover:from-sky-400 hover:to-blue-400 disabled:opacity-40 active:scale-[0.98] transition"
        >
          {aiBusy ? "CREANDO SCRIPT MANUAL CON IA…" : "✦ CREAR SCRIPT MANUAL CON IA"}
        </button>
        {generatedIds.length > 0 && (
          <button
            type="button"
            onClick={removeGenerated}
            className="w-full h-8 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-[10px] font-display font-semibold tracking-widest hover:bg-rose-500/25 transition"
          >
            DESHACER ÚLTIMO SCRIPT MANUAL GENERADO ({generatedIds.length})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {scripts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-sky-400/25 bg-[#0C1324]/70 p-8 text-center text-xs text-slate-300">
            Aún no hay ningún script manual en <strong className="text-white">{ownerLabel}</strong>. Escribe arriba lo que quieres que haga y pulsa{" "}
            <span className="text-sky-300 font-semibold">CREAR SCRIPT MANUAL CON IA</span>.
          </div>
        )}

        {scripts.map((s, idx) => {
          const open = openId === s.id;
          return (
            <div key={s.id} className="rounded-xl border border-sky-400/25 bg-[#0E1629] overflow-hidden shadow-sm">
              <div className="flex items-center gap-2 pl-3.5 pr-2.5 py-2.5 bg-[#111B31]">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : s.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <span className="font-display text-xs font-bold text-sky-300 tracking-wide truncate">
                    ✦ SCRIPT MANUAL #{idx + 1} · {EVENT_LABELS[s.event]}
                    {s.event === "onCollide" ? ` (${s.withKind ?? "any"})` : ""}
                  </span>
                  <span className="ml-auto rounded bg-sky-500/15 border border-sky-400/30 px-2 py-0.5 text-[10px] font-mono text-sky-200">
                    {s.blocks.length} {s.blocks.length === 1 ? "acción IA" : "acciones IA"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeScript(s.id)}
                  title="Eliminar script manual"
                  aria-label="Eliminar script manual"
                  className="shrink-0 w-7 h-7 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 grid place-items-center hover:bg-rose-500/20 transition"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {open && (
                <div className="border-t border-sky-500/15 p-3.5 space-y-3">
                  <div className="rounded-xl bg-[#090E1B] border border-sky-400/15 p-3 space-y-2">
                    <div className="text-[10px] font-display font-bold tracking-widest text-sky-300/90">
                      COMPORTAMIENTO GENERADO POR LA IA
                    </div>
                    {s.blocks.length === 0 ? (
                      <div className="text-xs text-slate-400">
                        Sin acciones todavía. Usa el cuadro de abajo para indicarle a la IA qué debe hacer este script manual.
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {s.blocks.map((b) => (
                          <li
                            key={b.id}
                            className="flex items-center gap-2 text-xs font-mono text-slate-100"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0 shadow-[0_0_6px_#38bdf8]" />
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
                    className="w-full py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 font-display font-semibold text-[10px] tracking-widest hover:bg-rose-500/25 transition"
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

function unwrapScript(raw: unknown, fallbackEvent: EventType): unknown {
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === "object" && "event" in first) return first;
    return { event: fallbackEvent, blocks: raw };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { script?: unknown; scripts?: unknown; event?: unknown; blocks?: unknown };
    if (obj.script) return unwrapScript(obj.script, fallbackEvent);
    if (Array.isArray(obj.scripts) && obj.scripts[0]) return unwrapScript(obj.scripts[0], fallbackEvent);
    if (!obj.event && Array.isArray(obj.blocks)) {
      return { ...obj, event: fallbackEvent };
    }
  }
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

      let result = null as ReturnType<typeof applyScriptEdit>;
      try {
        const res = await requestScriptAi(prompt, {
          sessionId: `asternal-script-${script.id}-${Date.now().toString(36)}`,
        });
        result = applyScriptEdit(script, unwrapScript(parseAiJson(res.text), script.event));
      } catch {
        result = null;
      }

      if (!result) {
        const synthesized = normalizeScripts(synthesizeScriptsFromRequest(text, [script.event]));
        const extraBlocks = synthesized[0]?.blocks ?? [];
        if (extraBlocks.length > 0) {
          result = {
            script: {
              ...script,
              blocks: [...script.blocks, ...extraBlocks],
            },
            suggestedEvent: null,
          };
        }
      }

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
    <div className="rounded-xl border border-sky-400/25 bg-[#10192E] p-3 space-y-2.5">
      <div className="text-[10px] font-display font-bold tracking-widest text-sky-300">
        MODIFICAR ESTE SCRIPT MANUAL CON IA
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Ej: haz que además suene y sume el doble de puntos…"
        rows={2}
        className="w-full rounded-xl border border-sky-400/25 bg-[#070B13] px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 min-h-[48px] resize-none"
      />
      {err && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/40 rounded-lg px-2.5 py-2">
          {err}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !instruction.trim()}
          onClick={() => void edit()}
          className="flex-1 h-9 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 text-[11px] font-display font-bold tracking-widest shadow-sm hover:from-sky-400 hover:to-blue-400 disabled:opacity-40 active:scale-[0.98] transition"
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
            className="inline-flex items-center gap-1 px-3 h-9 rounded-xl border border-sky-400/30 bg-[#131E36] text-[10px] font-display font-semibold tracking-widest text-sky-200 hover:bg-sky-500/20 transition"
          >
            <Undo2 size={11} />
            DESHACER
          </button>
        )}
      </div>
    </div>
  );
}
