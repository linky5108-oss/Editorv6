import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Entity, OrionHistoryItem, Project } from "@/lib/engine/core";
import { BLOCK_LABELS, EVENT_LABELS, normalizeScripts } from "@/lib/engine/scripts";
import { exportProjectHtml5 } from "@/lib/engine/html5-game";
import {
  ORION_QUICK_PROMPTS,
  runOrionGameEdit,
} from "@/lib/ai/orion-game-architect";
import { ENGINE_KNOWLEDGE } from "@/lib/ai/engine-knowledge";
import {
  buildGeminiScriptPrompt,
  geminiChat,
  parseAiJson,
} from "@/lib/ai/gemini-provider";
import { GameRuntime } from "./GameRuntime";

interface OrionAiModeScreenProps {
  project: Project;
  /** Entidad seleccionada desde el Inspector para enfocar el Script manual. */
  initialTargetEntityId?: string | null;
  onChangeProject: (next: Project) => void;
  onSaveProject?: () => void;
  onExit: () => void;
}

type WorkspaceView = "split" | "preview" | "scripts";
type MobilePane = "chat" | "preview" | "scripts";

const INITIAL_WELCOME: OrionHistoryItem = {
  id: "script-manual-welcome",
  role: "assistant",
  content:
    "Bienvenido al creador de Script manual con Inteligencia Artificial. Ya no necesitas escribir código ni armar bloques a mano: describe con tus palabras qué comportamiento, poder, regla, física o acción quieres y la IA creará el script manual directamente en tu juego.",
  summary: [
    "Creación de script manual 100% con inteligencia artificial",
    "Conectado en tiempo real con la vista previa y el editor normal",
  ],
  createdAt: 0,
};

export function OrionAiModeScreen({
  project,
  initialTargetEntityId = null,
  onChangeProject,
  onSaveProject,
  onExit,
}: OrionAiModeScreenProps) {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("split");
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const [targetEntityId, setTargetEntityId] = useState<string | null>(initialTargetEntityId);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [activeModelLabel, setActiveModelLabel] = useState<string>("Script manual · IA");
  const [previewNonce, setPreviewNonce] = useState(0);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeScene = useMemo(
    () => project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0],
    [project],
  );

  const targetEntity: Entity | null = useMemo(() => {
    if (!activeScene || !targetEntityId) return null;
    return activeScene.entities.find((e) => e.id === targetEntityId) ?? null;
  }, [activeScene, targetEntityId]);

  const history: OrionHistoryItem[] = useMemo(() => {
    const saved = project.customRuntime?.orionHistory ?? [];
    return saved.length > 0 ? saved : [INITIAL_WELCOME];
  }, [project.customRuntime?.orionHistory]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.length, busy]);

  const handleSendToAi = async (customText?: string) => {
    const text = (customText ?? prompt).trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    if (!customText) setPrompt("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const contextualInstruction = targetEntity
        ? `[Script manual para la entidad "${targetEntity.name || targetEntity.kind}" (id: "${targetEntity.id}", tipo: ${targetEntity.kind} en ${targetEntity.x},${targetEntity.y})]: ${text}`
        : text;

      const result = await runOrionGameEdit({
        instruction: contextualInstruction,
        project,
        signal: controller.signal,
      });

      let updatedProject = result.project;

      // Si hay una entidad seleccionada y la IA aún no le añadió un script manual directo,
      // generamos también su Script manual de entidad con Gemini para que quede asignado a esa entidad.
      if (targetEntity) {
        const sceneAfter =
          updatedProject.scenes.find((s) => s.id === updatedProject.activeSceneId) ??
          updatedProject.scenes[0];
        const entAfter = sceneAfter?.entities.find((e) => e.id === targetEntity.id);
        const beforeCount = targetEntity.scripts?.length ?? 0;
        const afterCount = entAfter?.scripts?.length ?? 0;

        if (entAfter && afterCount === beforeCount) {
          try {
            const scriptPrompt = buildGeminiScriptPrompt({
              userRequest: text,
              engineKnowledge: ENGINE_KNOWLEDGE,
              targetEntityKind: entAfter.kind,
              projectSummary: `Entidad ${entAfter.name || entAfter.kind} (${entAfter.kind}) en ${entAfter.x},${entAfter.y} ${entAfter.w}x${entAfter.h}.`,
            });
            const scriptRes = await geminiChat([{ role: "user", content: scriptPrompt }], {
              signal: controller.signal,
            });
            const generatedScripts = normalizeScripts(parseAiJson(scriptRes.text));
            if (generatedScripts.length > 0) {
              updatedProject = {
                ...updatedProject,
                scenes: updatedProject.scenes.map((sc) =>
                  sc.id === sceneAfter.id
                    ? {
                        ...sc,
                        entities: sc.entities.map((e) =>
                          e.id === entAfter.id
                            ? { ...e, scripts: [...(e.scripts ?? []), ...generatedScripts] }
                            : e,
                        ),
                      }
                    : sc,
                ),
              };
            }
          } catch {
            // Si la instrucción era una mecánica global del runtime, conservamos el resultado global
          }
        }
      }

      setActiveModelLabel(result.modelUsed);
      onChangeProject(updatedProject);
      setPreviewNonce((n) => n + 1);
      setSyncNotice(`Script manual creado con IA (${result.changesSummary.length} cambios aplicados)`);
      setTimeout(() => setSyncNotice(null), 4000);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo crear el script manual con IA en este momento.",
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const removeEntityScriptManual = (entityId: string, scriptId: string) => {
    if (!activeScene) return;
    const nextScenes = project.scenes.map((sc) =>
      sc.id === activeScene.id
        ? {
            ...sc,
            entities: sc.entities.map((ent) =>
              ent.id === entityId
                ? { ...ent, scripts: (ent.scripts ?? []).filter((s) => s.id !== scriptId) }
                : ent,
            ),
          }
        : sc,
    );
    onChangeProject({ ...project, scenes: nextScenes });
    setPreviewNonce((n) => n + 1);
  };

  const clearGlobalRuntimeScriptManual = () => {
    onChangeProject({
      ...project,
      customRuntime: {
        ...(project.customRuntime ?? {}),
        jsCode: "",
        customHtmlOverride: null,
      },
    });
    setPreviewNonce((n) => n + 1);
  };

  const totalScripts = useMemo(() => {
    if (!activeScene) return 0;
    const entityCount = activeScene.entities.reduce((acc, e) => acc + (e.scripts?.length ?? 0), 0);
    const hasGlobal = Boolean(project.customRuntime?.jsCode?.trim());
    return entityCount + (hasGlobal ? 1 : 0);
  }, [activeScene, project.customRuntime?.jsCode]);

  const entitiesWithScripts = useMemo(() => {
    if (!activeScene) return [];
    return activeScene.entities.filter((e) => (e.scripts?.length ?? 0) > 0);
  }, [activeScene]);

  return (
    <div
      data-testid="orion-ai-mode-fullscreen"
      className="fixed inset-0 z-50 flex h-dvh w-dvw flex-col bg-[#090D16] text-slate-100 overflow-hidden select-none"
    >
      {/* Barra superior a pantalla completa */}
      <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0D1322] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onExit}
            data-testid="orion-back-to-editor"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-[#131B2E] px-2.5 text-xs font-medium text-slate-200 hover:border-sky-400/50 hover:text-white active:scale-95 transition whitespace-nowrap"
          >
            <ArrowLeft size={14} />
            <span>Volver al editor</span>
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/15 border border-sky-400/35 text-sky-300">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-display text-sm font-bold tracking-tight text-white whitespace-nowrap">
                  Script manual · Inteligencia Artificial
                </span>
                {targetEntity && (
                  <span className="rounded bg-sky-500/20 border border-sky-400/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-200 whitespace-nowrap">
                    Objeto: {targetEntity.name || targetEntity.kind.toUpperCase()}
                  </span>
                )}
                <span className="hidden xl:inline-block rounded bg-sky-500/15 border border-sky-400/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300 whitespace-nowrap">
                  {activeModelLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Selector de distribución en tableta/escritorio */}
        <div className="hidden md:flex items-center gap-1 rounded-lg border border-white/10 bg-[#090D16] p-1">
          <button
            type="button"
            onClick={() => setWorkspaceView("split")}
            className={`h-7 rounded-md px-2.5 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "split"
                ? "bg-sky-500 text-slate-950 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            IA + Vista previa + Scripts manuales
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("preview")}
            className={`h-7 rounded-md px-2.5 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "preview"
                ? "bg-sky-500 text-slate-950 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            IA + Vista previa
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("scripts")}
            className={`h-7 rounded-md px-2.5 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "scripts"
                ? "bg-sky-500 text-slate-950 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            IA + Scripts manuales ({totalScripts})
          </button>
        </div>

        {/* Acciones rápidas derechas */}
        <div className="flex items-center gap-1.5">
          {syncNotice && (
            <span className="hidden xl:inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 whitespace-nowrap">
              <Check size={12} />
              {syncNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => exportProjectHtml5(project)}
            title="Descargar juego HTML5 autónomo"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 active:scale-95 transition whitespace-nowrap"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Exportar Juego</span>
          </button>
          {onSaveProject && (
            <button
              type="button"
              onClick={onSaveProject}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-500 px-3 text-xs font-bold text-slate-950 hover:bg-sky-400 active:scale-95 transition whitespace-nowrap"
            >
              Guardar
            </button>
          )}
        </div>
      </header>

      {/* Conmutador móvil en una sola fila (< 768px) */}
      <div className="flex md:hidden shrink-0 items-center border-b border-white/10 bg-[#0D1322] px-2 py-1.5 gap-1">
        <button
          type="button"
          onClick={() => setMobilePane("chat")}
          className={`flex-1 h-8 rounded-md text-xs font-semibold transition whitespace-nowrap ${
            mobilePane === "chat"
              ? "bg-sky-500 text-slate-950"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Crear Script manual
        </button>
        <button
          type="button"
          onClick={() => setMobilePane("preview")}
          className={`flex-1 h-8 rounded-md text-xs font-semibold transition whitespace-nowrap ${
            mobilePane === "preview"
              ? "bg-sky-500 text-slate-950"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Vista previa viva
        </button>
        <button
          type="button"
          onClick={() => setMobilePane("scripts")}
          className={`flex-1 h-8 rounded-md text-xs font-semibold transition whitespace-nowrap ${
            mobilePane === "scripts"
              ? "bg-sky-500 text-slate-950"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Scripts manuales ({totalScripts})
        </button>
      </div>

      {/* Cuerpo principal */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* PANEL 1: Chat de creación de Script manual con IA */}
        <section
          className={`${
            mobilePane === "chat" ? "flex" : "hidden"
          } md:flex w-full md:w-[340px] lg:w-[390px] xl:w-[420px] shrink-0 flex-col border-r border-white/10 bg-[#0D1322] min-h-0`}
        >
          {/* Selector de objeto objetivo para el Script manual */}
          <div className="flex flex-col gap-2 border-b border-white/8 px-3.5 py-2.5 bg-[#11182B]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Creador de Script manual con IA
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                {totalScripts} {totalScripts === 1 ? "script manual" : "scripts manuales"}
              </span>
            </div>

            {activeScene && activeScene.entities.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-display tracking-wider text-slate-400 shrink-0">
                  APLICAR A:
                </span>
                <select
                  value={targetEntityId ?? ""}
                  onChange={(e) => setTargetEntityId(e.target.value || null)}
                  className="flex-1 rounded-lg border border-white/12 bg-[#090D16] px-2 py-1 text-[11px] font-mono text-slate-200 outline-none focus:border-sky-400/50"
                >
                  <option value="">Todo el juego / Escena activa</option>
                  {activeScene.entities.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {(ent.name || ent.kind).toUpperCase()} ({ent.kind}) · {ent.scripts?.length ?? 0} script manual
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Historial de conversación con la IA */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-3.5 space-y-3 select-text"
          >
            {history.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border p-3 text-xs leading-relaxed ${
                  item.role === "assistant"
                    ? "border-sky-400/25 bg-[#121B30] text-slate-100"
                    : "ml-6 border-white/10 bg-[#182238] text-slate-200"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`font-display text-[11px] font-bold tracking-wide ${
                      item.role === "assistant" ? "text-sky-300" : "text-amber-300"
                    }`}
                  >
                    {item.role === "assistant" ? "IA · Script manual" : "Tú"}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {item.role === "assistant" ? "Generado con IA" : "Instrucción"}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">
                  {item.content}
                </p>
                {item.summary && item.summary.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t border-white/10 pt-2">
                    {item.summary.map((line, i) => (
                      <li
                        key={`${item.id}-s-${i}`}
                        className="flex items-start gap-1.5 text-[11px] text-sky-200/90"
                      >
                        <Check size={12} className="mt-0.5 shrink-0 text-sky-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {item.role === "assistant" && item.id !== "script-manual-welcome" && (
                  <div className="mt-2.5 pt-2 border-t border-white/8 flex md:hidden">
                    <button
                      type="button"
                      onClick={() => setMobilePane("preview")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/20 border border-sky-400/40 px-2.5 py-1 text-[11px] font-semibold text-sky-200"
                    >
                      <Play size={11} />
                      Probar script manual en vivo
                    </button>
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2.5 rounded-xl border border-sky-400/30 bg-[#121B30] p-3 text-xs text-sky-200">
                <Loader2 size={15} className="animate-spin text-sky-400 shrink-0" />
                <span>
                  La inteligencia artificial está creando y aplicando el script manual en tu juego…
                </span>
              </div>
            )}
          </div>

          {/* Ideas rápidas para crear scripts manuales con IA */}
          <div className="border-t border-white/8 bg-[#0B101D] px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400">
                Ideas rápidas de Script manual con IA:
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {ORION_QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSendToAi(q.prompt)}
                  className="shrink-0 rounded-lg border border-white/10 bg-[#141D33] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-sky-400/50 hover:text-sky-200 active:scale-95 transition whitespace-nowrap disabled:opacity-50"
                >
                  <Wand2 size={11} className="inline mr-1 text-sky-400" />
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Caja de entrada para crear/modificar Script manual con IA */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendToAi();
            }}
            className="border-t border-white/10 bg-[#0D1322] p-3 space-y-2"
          >
            {error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
                {error}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendToAi();
                  }
                }}
                rows={2}
                placeholder={
                  targetEntity
                    ? `Describe el script manual para ${targetEntity.name || targetEntity.kind}: ej. al chocar salta, persigue al jugador, dispara…`
                    : "Describe el script manual que quieres crear con IA: poderes, enemigos, reglas, sonidos o físicas…"
                }
                data-testid="orion-chat-input"
                className="flex-1 resize-none rounded-xl border border-white/12 bg-[#090D16] px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-400/60 select-text"
              />
              <button
                type="submit"
                disabled={busy || !prompt.trim()}
                data-testid="orion-chat-send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 disabled:opacity-40 active:scale-95 transition"
                title="Crear Script manual con IA"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </form>
        </section>

        {/* PANEL 2: Vista previa HTML5 interactiva en vivo */}
        {(workspaceView === "split" || workspaceView === "preview" || mobilePane === "preview") && (
          <section
            className={`${
              mobilePane === "preview" ? "flex" : "hidden"
            } ${
              workspaceView === "scripts" ? "md:hidden" : "md:flex"
            } flex-1 flex-col min-w-0 min-h-0 border-r border-white/10 bg-[#090D16]`}
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#0D1322] px-3">
              <div className="flex items-center gap-2 min-w-0">
                <Play size={13} className="text-sky-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-200 truncate">
                  Vista previa en vivo · {activeScene?.name || "Escena activa"} ({activeScene?.entities.length ?? 0} objetos)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new Event("asternal:restart"));
                    setPreviewNonce((n) => n + 1);
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-white/12 bg-[#141D33] px-2 text-[11px] font-medium text-slate-200 hover:border-sky-400/50 whitespace-nowrap"
                >
                  <RefreshCw size={11} />
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeProject({
                      ...project,
                      settings: {
                        ...project.settings,
                        showHitboxes: !project.settings.showHitboxes,
                      },
                    })
                  }
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap ${
                    project.settings.showHitboxes
                      ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                      : "border-white/12 bg-[#141D33] text-slate-300"
                  }`}
                >
                  Hitboxes
                </button>
              </div>
            </div>

            <div className="relative flex-1 min-h-0 w-full bg-[#050811]">
              {activeScene && (
                <GameRuntime
                  key={`orion-preview-${previewNonce}`}
                  scene={activeScene}
                  scenes={project.scenes}
                  assets={project.assets}
                  customRuntime={project.customRuntime}
                  title={project.name}
                  fpsCap={project.settings.fpsCap}
                  showHUD={project.settings.showHUD}
                  showFPS={project.settings.showFPS ?? true}
                  volume={project.settings.volume ?? 0.8}
                  muted={project.settings.muted ?? false}
                  music={project.settings.music ?? false}
                  musicUrl={project.settings.musicUrl ?? null}
                  touchControls={project.settings.touchControls ?? true}
                  autoPause={project.settings.autoPause ?? true}
                  showHitboxes={project.settings.showHitboxes ?? false}
                  embedded={false}
                  onExit={onExit}
                />
              )}
            </div>
          </section>
        )}

        {/* PANEL 3: Lista de Scripts manuales creados por la IA (sin código ni bloques manuales) */}
        {(workspaceView === "split" || workspaceView === "scripts" || mobilePane === "scripts") && (
          <section
            className={`${
              mobilePane === "scripts" ? "flex" : "hidden"
            } ${
              workspaceView === "preview" ? "md:hidden" : "md:flex"
            } w-full ${
              workspaceView === "split" ? "md:w-[34%] lg:w-[36%] xl:w-[38%]" : "md:flex-1"
            } flex-col min-w-0 min-h-0 bg-[#090D16]`}
          >
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0D1322] px-3">
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-sky-400" />
                <span className="text-xs font-semibold text-slate-200 whitespace-nowrap">
                  Scripts manuales activos (generados con IA)
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                {totalScripts} activos
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {project.customRuntime?.jsCode?.trim() && (
                <div className="rounded-xl border border-sky-400/30 bg-[#11192E] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-xs font-bold text-sky-300">
                      ✦ Script manual global del juego (IA)
                    </span>
                    <button
                      type="button"
                      onClick={clearGlobalRuntimeScriptManual}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 size={11} />
                      Quitar
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Mecánicas avanzadas, controles especiales y efectos de la escena creados automáticamente por la inteligencia artificial. Pídele en el chat cualquier ajuste para modificarlo.
                  </p>
                </div>
              )}

              {entitiesWithScripts.map((ent) => (
                <div
                  key={ent.id}
                  className="rounded-xl border border-white/10 bg-[#10172A] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetEntityId(ent.id)}
                      className="font-display text-xs font-bold text-white hover:text-sky-300 transition text-left"
                    >
                      {(ent.name || ent.kind).toUpperCase()} ({ent.kind})
                    </button>
                    <span className="font-mono text-[10px] text-sky-300">
                      {ent.scripts?.length ?? 0} script manual
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {(ent.scripts ?? []).map((sc, idx) => (
                      <div
                        key={sc.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-white/8 bg-[#0B101D] p-2.5"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="text-[11px] font-semibold text-sky-200">
                            Script manual #{idx + 1} · {EVENT_LABELS[sc.event]}
                            {sc.event === "onCollide" ? ` (${sc.withKind ?? "any"})` : ""}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {sc.blocks.length > 0
                              ? sc.blocks.map((b) => BLOCK_LABELS[b.kind] ?? b.kind).join(" → ")
                              : "Comportamiento gestionado por IA"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeEntityScriptManual(ent.id, sc.id)}
                          title="Eliminar script manual"
                          className="shrink-0 rounded border border-rose-500/35 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {totalScripts === 0 && (
                <div className="rounded-xl border border-dashed border-white/12 p-6 text-center space-y-2">
                  <Sparkles size={20} className="mx-auto text-sky-400" />
                  <div className="text-xs font-semibold text-slate-200">
                    Aún no hay scripts manuales activos
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Usa el chat de Inteligencia Artificial a la izquierda o elige una idea rápida para crear un script manual sin escribir código ni usar bloques.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
