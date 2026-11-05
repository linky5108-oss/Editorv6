import React, { useMemo, useRef, useState } from "react";
import type { EntityKind } from "@/lib/engine/core";
import {
  applyScriptEdit,
  compileScriptToHtml5Js,
  ENTITY_EVENTS,
  EventType,
  normalizeScripts,
  Script,
} from "@/lib/engine/scripts";
import { Code2, Loader2, Trash2, Undo2, X } from "lucide-react";
import { ENGINE_KNOWLEDGE } from "@/lib/ai/engine-knowledge";
import {
  buildGeminiScriptEditPrompt,
  buildGeminiScriptPrompt,
  extractScriptsFromAiPayload,
  parseAiJson,
  requestScriptAi,
  synthesizeScriptsFromRequest,
} from "@/lib/ai/gemini-provider";
import {
  compileUserLanguageLocally,
  loadUserLanguage,
  sanitizeOrUpgradeHtml5ScriptJs,
} from "@/lib/ai/custom-language";

interface ScriptEditorProps {
  scripts?: Script[];
  onChange: (next: Script[]) => void;
  onClose: () => void;
  targetName?: string;
  ownerLabel?: string;
  targetKind?: EntityKind;
  aiTargetKind?: EntityKind;
  projectSummary?: string;
  aiSummary?: string;
  onOpenFullAiStudio?: () => void;
  events?: EventType[];
  allowedEvents?: EventType[];
  audioAssets?: { id: string; name: string; url: string; category: "music" | "sfx" }[];
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  scripts = [],
  onChange,
  onClose,
  targetName,
  ownerLabel,
  targetKind,
  aiTargetKind,
  projectSummary,
  aiSummary,
  events = ENTITY_EVENTS,
  allowedEvents,
}) => {
  const effectiveName = targetName || ownerLabel;
  const effectiveKind = targetKind || aiTargetKind;
  const effectiveSummary = projectSummary || aiSummary;
  const emitChange = (next: Script[]) => {
    (onChange as (arg: unknown) => void)(next);
  };
  const activeEvents = allowedEvents && allowedEvents.length > 0 ? allowedEvents : events;
  const safeAllowedEvents = activeEvents.length > 0 ? activeEvents : ENTITY_EVENTS;
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);

  const updateScript = (id: string, patch: Partial<Script>) =>
    emitChange(scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeScript = (id: string) => emitChange(scripts.filter((s) => s.id !== id));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        className="glass-menu w-full sm:max-w-2xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden border text-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="editor-bar flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Code2 size={15} className="text-primary" />
            <div className="font-display text-sm font-bold text-foreground">
              {ownerLabel ? <>HTML5 · {ownerLabel}</> : effectiveName ? <>Scripts HTML5 · {effectiveName}</> : "Scripts HTML5"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="glass-control w-8 h-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {/* Cuadro de scripts HTML5 */}
          <div className="glass-surface rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-display font-bold uppercase tracking-widest text-primary">
                Scripts HTML5 ({scripts.length})
              </span>
            </div>

            {scripts.length === 0 && (
              <div className="text-center py-6 px-4 rounded-xl border border-dashed border-line-strong text-xs text-muted-foreground">
                Sin scripts activos.
              </div>
            )}

            {scripts.map((s, si) => {
              const html5Code = sanitizeOrUpgradeHtml5ScriptJs(
                s.compiledJs?.trim() || compileScriptToHtml5Js(s, undefined, effectiveKind),
                s.customLanguageCode,
                undefined,
                effectiveKind,
              );
              return (
                <div
                  key={s.id}
                  className="glass-surface rounded-xl p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        #{si + 1}
                      </span>
                      <span className="text-[10px] font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 border border-primary/25 text-primary">
                        HTML5
                      </span>
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingScriptId((cur) => (cur === s.id ? null : s.id))
                        }
                        aria-expanded={editingScriptId === s.id}
                        className={`h-7 px-2.5 rounded-lg border flex items-center gap-1 text-[10px] font-display tracking-wider transition ${
                          editingScriptId === s.id
                            ? "btn-grad text-primary-foreground border-transparent font-bold"
                            : "glass-control text-foreground"
                        }`}
                      >
                        EDITAR
                      </button>
                      <button
                        onClick={() => removeScript(s.id)}
                        className="w-7 h-7 rounded-lg bg-destructive/10 text-destructive border border-destructive/30 grid place-items-center hover:bg-destructive/20"
                        title="Eliminar script"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {s.customLanguageCode &&
                    s.customLanguageCode.trim() !== html5Code.trim() && (
                      <pre className="rounded-lg bg-surface-2/40 border border-line px-2.5 py-2 font-mono text-[11px] text-foreground whitespace-pre-wrap">
                        {s.customLanguageCode}
                      </pre>
                    )}

                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-background/80 border border-line px-2.5 py-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
                    {html5Code}
                  </pre>

                  {editingScriptId === s.id && (
                    <ScriptContinuationBox
                      script={s}
                      targetKind={effectiveKind}
                      projectSummary={effectiveSummary}
                      onApply={(updated) => updateScript(s.id, updated)}
                      onClose={() => setEditingScriptId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Recuadro para escribir código nada más + botón Aplicar */}
          <ScriptCodeBox
            targetKind={effectiveKind}
            projectSummary={effectiveSummary}
            allowedEvents={safeAllowedEvents}
            onApply={(gen) => {
              emitChange([...scripts, ...gen]);
            }}
          />
        </div>
      </div>
    </div>
  );
};

function ScriptCodeBox({
  targetKind,
  projectSummary,
  allowedEvents,
  onApply,
}: {
  targetKind?: EntityKind;
  projectSummary?: string;
  allowedEvents: EventType[];
  onApply: (s: Script[]) => void;
}) {
  const userLanguage = useMemo(() => loadUserLanguage(), []);
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyCode = async () => {
    const code = req.trim();
    if (!code || busy) return;
    setErr(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const strippedHtmlScript = code
        .replace(/^<script[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();
      const isDirectJs =
        /(?:window\.AsternalRuntime|registerHook|document\.getElementById|requestAnimationFrame|\b(?:const|let|var|function)\s+[a-zA-Z_$]|\bapi\.(?:getPlayer|getEntities|spawnEntity|addScore|addLives|setGravity|setBg|shake|playSound)\b)/i.test(
          strippedHtmlScript,
        );

      const localCompiled = compileUserLanguageLocally(code, userLanguage, {
        targetEntityKind: targetKind,
        allowedEvents,
      });

      let valid: Script[] = [];
      let aiCustomJs = isDirectJs ? strippedHtmlScript : "";

      if (!isDirectJs) {
        try {
          const prompt = buildGeminiScriptPrompt({
            userRequest: code,
            engineKnowledge: ENGINE_KNOWLEDGE,
            targetEntityKind: targetKind,
            projectSummary,
          });
          const res = await requestScriptAi(prompt, {
            sessionId: `new-${targetKind ?? "entity"}`,
            signal: controller.signal,
          });
          const parsed = parseAiJson<unknown>(res.text);
          const extracted = extractScriptsFromAiPayload(parsed);
          if (extracted.customRuntimeJs) aiCustomJs = extracted.customRuntimeJs;
          const normalized = normalizeScripts(extracted.scripts).filter((s) =>
            allowedEvents.includes(s.event),
          );
          if (normalized.length > 0) {
            valid = normalized;
          }
        } catch {
          // Fallback local directo
        }
      }

      if (valid.length === 0 && aiCustomJs.trim()) {
        valid = [
          {
            id: `html5-${Date.now().toString(36)}`,
            event: allowedEvents[0] ?? "onUpdate",
            blocks: [],
            compiledJs: aiCustomJs.trim(),
            customLanguageCode: code,
          },
        ];
      }

      if (valid.length === 0 && localCompiled.compiledScripts.length > 0) {
        valid = localCompiled.compiledScripts;
      }

      if (valid.length === 0) {
        valid = normalizeScripts(
          synthesizeScriptsFromRequest(code, allowedEvents),
        ).filter((s) => allowedEvents.includes(s.event));
      }

      valid = valid.map((sc) => {
        const candidateAiJs = sc.compiledJs?.trim() || aiCustomJs.trim();
        const compiledFromBlocks =
          sc.blocks && sc.blocks.length > 0
            ? compileScriptToHtml5Js(sc, undefined, targetKind)
            : "";
        const rawHtml5Js =
          candidateAiJs ||
          compiledFromBlocks ||
          localCompiled.compiledJs ||
          compileScriptToHtml5Js(sc, undefined, targetKind);
        const html5Js = isDirectJs
          ? strippedHtmlScript
          : sanitizeOrUpgradeHtml5ScriptJs(
              rawHtml5Js,
              code,
              undefined,
              targetKind,
            );
        return {
          ...sc,
          blocks: sc.blocks ?? [],
          customLanguageCode: code,
          languageName: userLanguage.name,
          compiledJs: html5Js,
        };
      });

      if (valid.length === 0) {
        throw new Error("No se pudo aplicar el código.");
      }
      onApply(valid);
      setReq("");
    } catch (e: unknown) {
      if (!controller.signal.aborted) {
        setErr(e instanceof Error ? e.message : "Error aplicando el script");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="glass-surface rounded-xl p-3 space-y-2.5">
      <textarea
        value={req}
        onChange={(e) => setReq(e.target.value)}
        rows={4}
        disabled={busy}
        placeholder="Escribe tu código aquí..."
        className="w-full p-2.5 rounded-lg font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />
      {err && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/40 rounded-lg px-2.5 py-2">
          {err}
        </div>
      )}
      <button
        type="button"
        disabled={busy || !req.trim()}
        onClick={() => void applyCode()}
        className="w-full h-9 rounded-lg btn-grad text-primary-foreground text-xs font-display font-bold tracking-wider disabled:opacity-40 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 transition"
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        <span>{busy ? "Aplicando..." : "Aplicar"}</span>
      </button>
    </div>
  );
}

function ScriptContinuationBox({
  script,
  targetKind,
  projectSummary,
  onApply,
  onClose,
}: {
  script: Script;
  targetKind?: EntityKind;
  projectSummary?: string;
  onApply: (s: Script) => void;
  onClose: () => void;
}) {
  const userLanguage = useMemo(() => loadUserLanguage(), []);
  const [instruction, setInstruction] = useState(
    script.compiledJs?.trim() || script.customLanguageCode || "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Script | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const edit = async () => {
    const clean = instruction.trim();
    if (!clean || busy) return;
    setErr(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const strippedHtmlScript = clean
        .replace(/^<script[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();
      const isDirectJs =
        /(?:window\.AsternalRuntime|registerHook|document\.getElementById|requestAnimationFrame|\b(?:const|let|var|function)\s+[a-zA-Z_$]|\bapi\.(?:getPlayer|getEntities|spawnEntity|addScore|addLives|setGravity|setBg|shake|playSound)\b)/i.test(
          strippedHtmlScript,
        );

      if (isDirectJs) {
        setPrevious(script);
        onApply({
          ...script,
          compiledJs: strippedHtmlScript,
        });
        onClose();
        return;
      }

      const localCompiled = compileUserLanguageLocally(clean, userLanguage, {
        targetEntityKind: targetKind,
        allowedEvents: [script.event],
      });

      let applied: ReturnType<typeof applyScriptEdit> = null;
      let aiCustomJs = "";

      try {
        const prompt = buildGeminiScriptEditPrompt({
          instruction: clean,
          engineKnowledge: ENGINE_KNOWLEDGE,
          currentScript: script,
          targetEntityKind: targetKind,
          projectSummary,
        });
        const res = await requestScriptAi(prompt, {
          sessionId: `script-${script.id}`,
          signal: controller.signal,
        });
        const parsed = parseAiJson<unknown>(res.text);
        const extracted = extractScriptsFromAiPayload(parsed);
        if (extracted.customRuntimeJs) aiCustomJs = extracted.customRuntimeJs;
        const candidate = extracted.scripts[0] ?? (Array.isArray(parsed) ? parsed[0] : parsed);
        applied = applyScriptEdit(script, candidate);
      } catch {
        // fallback local
      }

      if (!applied && localCompiled.compiledScripts.length > 0) {
        applied = applyScriptEdit(script, localCompiled.compiledScripts[0]);
      }

      if (!applied) {
        const fallback = synthesizeScriptsFromRequest(clean, [script.event])[0];
        applied = applyScriptEdit(script, fallback);
      }

      const nextScriptBase = applied?.script ?? script;
      const compiledFromBlocks =
        nextScriptBase.blocks && nextScriptBase.blocks.length > 0
          ? compileScriptToHtml5Js(nextScriptBase, undefined, targetKind)
          : "";
      const rawHtml5Js =
        nextScriptBase.compiledJs?.trim() ||
        aiCustomJs.trim() ||
        compiledFromBlocks ||
        localCompiled.compiledJs ||
        compileScriptToHtml5Js(nextScriptBase, undefined, targetKind);
      const html5Js = sanitizeOrUpgradeHtml5ScriptJs(
        rawHtml5Js,
        clean,
        undefined,
        targetKind,
      );

      setPrevious(script);
      onApply({
        ...nextScriptBase,
        blocks: nextScriptBase.blocks ?? [],
        customLanguageCode: clean,
        languageName: userLanguage.name,
        compiledJs: html5Js,
      });
      onClose();
    } catch (e: unknown) {
      if (!controller.signal.aborted) {
        setErr(e instanceof Error ? e.message : "Error actualizando el script");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="glass-surface rounded-xl p-2.5 space-y-2">
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={2}
        disabled={busy}
        placeholder="Escribe el código..."
        className="w-full p-2 rounded-lg font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />
      {err && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/40 rounded-lg px-2.5 py-2">
          {err}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !instruction.trim()}
          onClick={() => void edit()}
          className="flex-1 h-9 rounded-lg btn-grad text-primary-foreground text-[11px] font-display font-bold tracking-wider disabled:opacity-40 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 transition"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          <span>{busy ? "Aplicando..." : "Aplicar"}</span>
        </button>
        {previous && !busy && (
          <button
            type="button"
            onClick={() => {
              onApply(previous);
              setPrevious(null);
            }}
            className="glass-control inline-flex items-center gap-1 px-3 h-9 rounded-lg text-[10px] font-display font-semibold tracking-widest text-foreground transition"
          >
            <Undo2 size={11} />
            DESHACER
          </button>
        )}
      </div>
    </div>
  );
}

