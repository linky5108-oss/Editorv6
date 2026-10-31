import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Cpu,
  Layers,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type { AudioAsset, Entity, OrionHistoryItem, Project } from "@/lib/engine/core";
import { entityKindLabel } from "@/lib/engine/core";
import {
  applyChosenAudioToInstruction,
  buildAudioSelectionQuestion,
  detectAudioRequestAndCandidates,
  getProjectAudioLibrary,
  injectAudioAssetIntoScripts,
} from "@/lib/engine/audio-library";
import { playSoundUrl, startMusic, stopCustomSounds, stopMusic } from "@/lib/engine/sfx";
import { BLOCK_LABELS, EVENT_LABELS, normalizeScripts } from "@/lib/engine/scripts";
import {
  ORION_QUICK_PROMPTS,
  runOrionGameEdit,
} from "@/lib/ai/orion-game-architect";
import { ENGINE_KNOWLEDGE } from "@/lib/ai/engine-knowledge";
import {
  buildGeminiScriptPrompt,
  parseAiJson,
  requestScriptAi,
  synthesizeScriptsFromRequest,
} from "@/lib/ai/gemini-provider";

interface OrionAiModeScreenProps {
  project: Project;
  /** Entidad seleccionada desde el Inspector para enfocar el Script manual. */
  initialTargetEntityId?: string | null;
  onChangeProject: (next: Project) => void;
  onSaveProject?: () => void;
  onSwitchToHumanScratch?: () => void;
  onExit: () => void;
}

type WorkspaceView = "split" | "chat" | "scripts";
type MobilePane = "chat" | "scripts";

const ENTITY_QUICK_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Perseguir al jugador",
    prompt: "Haz que este objeto persiga suavemente al jugador en cada fotograma y al tocarlo le reste 1 vida.",
  },
  {
    label: "Rebotar e impulsar",
    prompt: "Al chocar con el jugador, impúlsalo alto hacia arriba con partículas y sonido de rebote.",
  },
  {
    label: "Patrullar y disparar",
    prompt: "Haz que patrulle de lado a lado y cada 2 segundos lance un destello o ataque.",
  },
  {
    label: "Dar puntos y desaparecer",
    prompt: "Al tocar este objeto, suma 50 puntos, reproduce sonido de premio, lanza partículas y destrúyelo.",
  },
];

const INITIAL_WELCOME: OrionHistoryItem = {
  id: "script-manual-welcome",
  role: "assistant",
  content:
    "Bienvenido al estudio de Script manual con Inteligencia Artificial. Describe con tus palabras qué comportamiento, mecánica, poder, física o acción necesitas y la IA construirá y conectará el script manual directamente en tu juego.",
  summary: [
    "Creación de script manual 100% con inteligencia artificial",
    "Sincronizado directamente con las entidades y el editor del proyecto",
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
  const [pendingAudioChoice, setPendingAudioChoice] = useState<{
    instruction: string;
    candidates: AudioAsset[];
    question: string;
  } | null>(null);
  const [previewingAudioId, setPreviewingAudioId] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const audioLibrary = useMemo(() => getProjectAudioLibrary(project), [project]);

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
  }, [history.length, busy, pendingAudioChoice]);

  const focusPromptForEntity = (entityId: string | null, prefill?: string) => {
    setTargetEntityId(entityId);
    if (typeof prefill === "string") {
      setPrompt(prefill);
    }
    setMobilePane("chat");
    if (workspaceView === "scripts") {
      setWorkspaceView("split");
    }
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
  };

  const togglePreviewTrack = (asset: AudioAsset) => {
    if (previewingAudioId === asset.id) {
      stopCustomSounds();
      stopMusic();
      setPreviewingAudioId(null);
      return;
    }
    stopCustomSounds();
    stopMusic();
    setPreviewingAudioId(asset.id);
    if (asset.category === "music") {
      startMusic(asset.url);
    } else {
      playSoundUrl(asset.url);
      window.setTimeout(() => {
        setPreviewingAudioId((curr) => (curr === asset.id ? null : curr));
      }, 2200);
    }
  };

  const handleSendToAi = async (customText?: string, chosenAudioAsset?: AudioAsset) => {
    const text = (customText ?? prompt).trim();
    if (!text || busy) return;

    // Detectar si el usuario pide poner música o sonido y tiene audios guardados en su biblioteca de ajustes
    const detection = detectAudioRequestAndCandidates(text, audioLibrary);
    if (!chosenAudioAsset && detection.needsDisambiguation && detection.candidates.length > 0) {
      if (!customText) setPrompt("");
      setError(null);
      setPendingAudioChoice({
        instruction: text,
        candidates: detection.candidates,
        question: buildAudioSelectionQuestion(detection.candidates, detection.intentKind),
      });
      return;
    }

    const activeAudioAsset = chosenAudioAsset ?? detection.matchedAsset;
    const effectiveText = activeAudioAsset
      ? applyChosenAudioToInstruction(text, activeAudioAsset)
      : text;

    setPendingAudioChoice(null);
    stopCustomSounds();
    stopMusic();
    setPreviewingAudioId(null);

    setBusy(true);
    setError(null);
    if (!customText) setPrompt("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const targetLabel = targetEntity ? entityKindLabel(targetEntity) : "";
      const contextualInstruction = targetEntity
        ? `[Script manual para la entidad "${targetLabel}" (id: "${targetEntity.id}", tipo: ${targetEntity.kind} en ${targetEntity.x},${targetEntity.y})]: ${effectiveText}`
        : effectiveText;

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
          let generatedScripts = [] as ReturnType<typeof normalizeScripts>;
          try {
            const scriptPrompt = buildGeminiScriptPrompt({
              userRequest: effectiveText,
              engineKnowledge: ENGINE_KNOWLEDGE,
              targetEntityKind: entAfter.kind,
              projectSummary: `Entidad ${entityKindLabel(entAfter)} (${entAfter.kind}) en ${entAfter.x},${entAfter.y} ${entAfter.w}x${entAfter.h}.`,
            });
            const scriptRes = await requestScriptAi(scriptPrompt, {
              signal: controller.signal,
            });
            generatedScripts = normalizeScripts(parseAiJson(scriptRes.text));
          } catch {
            generatedScripts = [];
          }
          if (generatedScripts.length === 0) {
            generatedScripts = normalizeScripts(synthesizeScriptsFromRequest(effectiveText));
          }
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
        }
      }

      // Si el usuario eligió (o mencionó por nombre) un audio de su biblioteca de Ajustes,
      // garantizamos que quede conectado en el script manual de la entidad objetivo (o del jugador/escena).
      if (activeAudioAsset) {
        const sceneAfter =
          updatedProject.scenes.find((s) => s.id === updatedProject.activeSceneId) ??
          updatedProject.scenes[0];
        if (sceneAfter) {
          const fallbackEntity =
            (targetEntity
              ? sceneAfter.entities.find((e) => e.id === targetEntity.id)
              : null) ??
            sceneAfter.entities.find((e) => e.kind === "player") ??
            sceneAfter.entities[0] ??
            null;

          if (fallbackEntity) {
            const nextScripts = injectAudioAssetIntoScripts(
              fallbackEntity.scripts ?? [],
              activeAudioAsset,
              text,
            );
            updatedProject = {
              ...updatedProject,
              assets: {
                sprites: updatedProject.assets?.sprites ?? [],
                audio: audioLibrary,
              },
              scenes: updatedProject.scenes.map((sc) =>
                sc.id === sceneAfter.id
                  ? {
                      ...sc,
                      entities: sc.entities.map((e) =>
                        e.id === fallbackEntity.id ? { ...e, scripts: nextScripts } : e,
                      ),
                    }
                  : sc,
              ),
            };
          }
        }
      }

      setActiveModelLabel(result.modelUsed);
      onChangeProject(updatedProject);
      setSyncNotice(
        activeAudioAsset
          ? `Audio «${activeAudioAsset.name}» conectado al script manual`
          : `Script manual aplicado (${result.changesSummary.length} cambios)`,
      );
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
  };

  const clearConversationHistory = () => {
    onChangeProject({
      ...project,
      customRuntime: {
        ...(project.customRuntime ?? {}),
        orionHistory: [],
      },
    });
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

  const quickPrompts = targetEntity ? ENTITY_QUICK_PROMPTS : ORION_QUICK_PROMPTS;

  return (
    <div
      data-testid="orion-ai-mode-fullscreen"
      className="fixed inset-0 z-50 flex h-dvh w-dvw flex-col bg-[#090D16] text-slate-100 overflow-hidden select-none"
    >
      {/* Barra superior negro con azul */}
      <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sky-500/20 bg-gradient-to-r from-[#0B1120] via-[#0D1528] to-[#0B1120] px-3 sm:px-4 shadow-[0_4px_24px_-6px_rgba(2,6,23,0.9),inset_0_1px_0_rgba(56,189,248,0.14)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onExit}
            data-testid="orion-back-to-editor"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-400/25 bg-[#121B2F] px-3 text-xs font-semibold text-slate-100 shadow-sm hover:border-sky-400/60 hover:bg-[#17233D] hover:text-white active:scale-95 transition whitespace-nowrap"
          >
            <ArrowLeft size={14} className="text-sky-400" />
            <span>Volver al editor</span>
          </button>

          <div className="h-5 w-px bg-white/10 hidden sm:block" />

          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-500/25 to-blue-600/20 border border-sky-400/40 text-sky-300 shadow-[0_0_15px_-3px_rgba(56,189,248,0.45)]">
              <Sparkles size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-sm font-bold tracking-tight text-white whitespace-nowrap">
                  Script manual · Inteligencia Artificial
                </span>
                {targetEntity && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 border border-sky-400/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-200 whitespace-nowrap">
                    <Target size={10} className="text-sky-400" />
                    <span>Objeto: {entityKindLabel(targetEntity)}</span>
                    <button
                      type="button"
                      onClick={() => setTargetEntityId(null)}
                      title="Aplicar a todo el juego"
                      className="ml-0.5 rounded hover:bg-sky-400/25 p-0.5 text-sky-300 hover:text-white"
                    >
                      <X size={10} />
                    </button>
                  </span>
                )}
                <span className="hidden xl:inline-flex items-center gap-1 rounded-md bg-[#121C32] border border-sky-400/25 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-300 whitespace-nowrap">
                  <Cpu size={10} className="text-sky-400" />
                  {activeModelLabel}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-slate-400">
                <span className="inline-flex items-center gap-1 text-sky-300/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                  Conectado a {activeScene?.name || "Escena"}
                </span>
                <span>·</span>
                <span>{totalScripts} {totalScripts === 1 ? "script manual activo" : "scripts manuales activos"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Selector de distribución en tableta/escritorio (sin vista previa) */}
        <div className="hidden md:flex items-center gap-1 rounded-xl border border-sky-500/20 bg-[#080C15] p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setWorkspaceView("split")}
            className={`h-7 rounded-lg px-3 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "split"
                ? "bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 font-bold shadow-[0_2px_10px_rgba(14,165,233,0.35)]"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
            }`}
          >
            IA + Scripts ({totalScripts})
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("chat")}
            className={`h-7 rounded-lg px-3 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "chat"
                ? "bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 font-bold shadow-[0_2px_10px_rgba(14,165,233,0.35)]"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
            }`}
          >
            Solo Asistente IA
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("scripts")}
            className={`h-7 rounded-lg px-3 text-xs font-medium transition whitespace-nowrap ${
              workspaceView === "scripts"
                ? "bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 font-bold shadow-[0_2px_10px_rgba(14,165,233,0.35)]"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
            }`}
          >
            Solo Scripts ({totalScripts})
          </button>
        </div>

        {/* Acciones rápidas derechas */}
        <div className="flex items-center gap-1.5">
          {syncNotice && (
            <span className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-200 whitespace-nowrap shadow-sm">
              <Check size={12} className="text-sky-400" />
              {syncNotice}
            </span>
          )}
          {onSaveProject && (
            <button
              type="button"
              onClick={onSaveProject}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 px-3.5 text-xs font-bold text-slate-950 shadow-[0_2px_12px_rgba(14,165,233,0.35)] hover:from-sky-400 hover:to-blue-400 active:scale-95 transition whitespace-nowrap"
            >
              Guardar
            </button>
          )}
        </div>
      </header>

      {/* Conmutador móvil en una sola fila (< 768px) */}
      <div className="flex md:hidden shrink-0 items-center border-b border-sky-500/20 bg-[#0B101E] px-2.5 py-1.5 gap-1.5">
        <button
          type="button"
          onClick={() => setMobilePane("chat")}
          className={`flex-1 h-8 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
            mobilePane === "chat"
              ? "bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 font-bold shadow-sm"
              : "bg-[#11192C] text-slate-400 hover:text-white border border-white/5"
          }`}
        >
          ✦ Crear con IA
        </button>
        <button
          type="button"
          onClick={() => setMobilePane("scripts")}
          className={`flex-1 h-8 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
            mobilePane === "scripts"
              ? "bg-gradient-to-r from-sky-500 to-blue-500 text-slate-950 font-bold shadow-sm"
              : "bg-[#11192C] text-slate-400 hover:text-white border border-white/5"
          }`}
        >
          Scripts manuales ({totalScripts})
        </button>
      </div>

      {/* Cuerpo principal sin vista previa */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* PANEL 1: Chat de creación de Script manual con IA */}
        {(workspaceView === "split" || workspaceView === "chat" || mobilePane === "chat") && (
          <section
            className={`${
              mobilePane === "chat" ? "flex" : "hidden"
            } ${
              workspaceView === "scripts" ? "md:hidden" : "md:flex"
            } w-full ${
              workspaceView === "split"
                ? "md:w-[50%] lg:w-[52%] border-r border-sky-500/15"
                : "md:flex-1"
            } shrink-0 flex-col bg-[#0C1222] min-h-0`}
          >
            {/* Selector de objeto objetivo para el Script manual */}
            <div className="flex flex-col gap-2.5 border-b border-sky-500/15 px-3.5 py-3 bg-gradient-to-b from-[#111A30] to-[#0D1426]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
                  <span className="text-xs font-display font-bold tracking-wide text-slate-100 truncate">
                    ASISTENTE DE SCRIPT MANUAL
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-sky-500/15 border border-sky-400/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 tabular-nums whitespace-nowrap">
                    {totalScripts} {totalScripts === 1 ? "activo" : "activos"}
                  </span>
                  {(project.customRuntime?.orionHistory?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={clearConversationHistory}
                      title="Limpiar conversación (conserva tus scripts manuales)"
                      className="rounded-md border border-white/10 bg-[#090D16] p-1 text-slate-400 hover:border-sky-400/40 hover:text-sky-300 transition"
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              </div>

              {activeScene && activeScene.entities.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-display font-semibold tracking-wider text-sky-300/80 shrink-0">
                    OBJETIVO:
                  </span>
                  <select
                    value={targetEntityId ?? ""}
                    onChange={(e) => setTargetEntityId(e.target.value || null)}
                    className="flex-1 h-8 rounded-lg border border-sky-400/25 bg-[#080C16] px-2.5 text-[11px] font-mono text-slate-100 outline-none focus:border-sky-400 transition"
                  >
                    <option value="">✦ Todo el juego / Escena activa</option>
                    {activeScene.entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {entityKindLabel(ent)} ({ent.x},{ent.y}) · {ent.scripts?.length ?? 0} script manual
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Historial de conversación con la IA */}
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto p-3.5 space-y-3 select-text bg-[#090D16]/60"
            >
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3.5 text-xs leading-relaxed shadow-sm transition ${
                    item.role === "assistant"
                      ? "border-sky-400/30 bg-gradient-to-br from-[#111B32] to-[#0D1527] text-slate-100"
                      : "ml-5 border-blue-400/25 bg-[#15223D] text-slate-100"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 font-display text-[11px] font-bold tracking-wide ${
                        item.role === "assistant" ? "text-sky-300" : "text-sky-200"
                      }`}
                    >
                      {item.role === "assistant" ? (
                        <>
                          <Sparkles size={11} className="text-sky-400" />
                          <span>IA · Script manual</span>
                        </>
                      ) : (
                        <span>Tu instrucción</span>
                      )}
                    </span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                      {item.role === "assistant" ? "Aplicado" : "Prompt"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-100/95">
                    {item.content}
                  </p>
                  {item.summary && item.summary.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5 rounded-lg border border-sky-400/20 bg-[#090F1E]/80 p-2.5">
                      {item.summary.map((line, i) => (
                        <li
                          key={`${item.id}-s-${i}`}
                          className="flex items-start gap-2 text-[11px] text-sky-200"
                        >
                          <Check size={12} className="mt-0.5 shrink-0 text-sky-400" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.role === "assistant" && item.id !== "script-manual-welcome" && (
                    <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMobilePane("scripts");
                          if (workspaceView === "chat") setWorkspaceView("split");
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/15 px-2.5 py-1 text-[10px] font-mono font-semibold text-sky-200 hover:bg-sky-500/25 hover:text-white transition"
                      >
                        Ver scripts manuales ({totalScripts})
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {pendingAudioChoice && (
                <div
                  data-testid="orion-audio-choice-prompt"
                  className="rounded-xl border border-sky-400/50 bg-gradient-to-br from-[#10203D] to-[#0B1528] p-3.5 space-y-3 shadow-[0_0_24px_-6px_rgba(56,189,248,0.35)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold tracking-wide text-sky-300">
                      <Sparkles size={12} className="text-sky-400" />
                      <span>♪ BIBLIOTECA DE AUDIO DETECTADA</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        stopCustomSounds();
                        stopMusic();
                        setPreviewingAudioId(null);
                        setPendingAudioChoice(null);
                      }}
                      className="rounded p-0.5 text-slate-400 hover:text-white"
                      title="Cancelar selección"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <div className="rounded-lg border border-blue-400/20 bg-[#081020] px-2.5 py-1.5 text-[11px] font-mono text-sky-200/90">
                    Tu petición: «{pendingAudioChoice.instruction}»
                  </div>

                  <p className="text-xs leading-relaxed text-slate-100">
                    {pendingAudioChoice.question}
                  </p>

                  <div className="space-y-1.5">
                    {pendingAudioChoice.candidates.map((asset) => {
                      const isPlaying = previewingAudioId === asset.id;
                      return (
                        <div
                          key={asset.id}
                          className="flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-[#0B1325] p-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => togglePreviewTrack(asset)}
                            className={`h-8 w-8 shrink-0 rounded-lg border font-mono text-xs grid place-items-center transition ${
                              isPlaying
                                ? "border-sky-400 bg-sky-400 text-slate-950 font-bold"
                                : "border-sky-400/30 bg-[#121E36] text-sky-300 hover:border-sky-400"
                            }`}
                            title={isPlaying ? "Detener vista previa" : "Escuchar pista"}
                          >
                            {isPlaying ? "■" : "▶"}
                          </button>

                          <button
                            type="button"
                            data-testid={`choose-audio-asset-${asset.id}`}
                            onClick={() =>
                              void handleSendToAi(pendingAudioChoice.instruction, asset)
                            }
                            className="flex-1 flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-sky-500/20 to-blue-600/20 border border-sky-400/40 px-3 py-1.5 text-left hover:from-sky-500/35 hover:to-blue-500/35 hover:border-sky-300 transition"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-display font-bold text-white truncate">
                                ♪ {asset.name}
                              </div>
                              <div className="text-[10px] font-mono text-sky-300/80">
                                {asset.category === "music" ? "Música (Asset)" : "Sonido (Asset)"}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-md bg-sky-400 px-2.5 py-1 font-display text-[10px] font-bold tracking-wider text-slate-950">
                              USAR ESTE
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {busy && (
                <div className="flex items-center gap-3 rounded-xl border border-sky-400/40 bg-gradient-to-r from-[#111C35] to-[#152442] p-3.5 text-xs text-sky-100 shadow-[0_0_20px_-5px_rgba(56,189,248,0.3)]">
                  <Loader2 size={16} className="animate-spin text-sky-400 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="font-semibold text-sky-200">Generando script manual con IA…</div>
                    <div className="text-[11px] text-slate-300">
                      Analizando escena y aplicando comportamientos al proyecto.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Ideas rápidas contextuales para crear scripts manuales con IA */}
            <div className="border-t border-sky-500/15 bg-[#0A101E] px-3.5 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-display font-bold tracking-wider uppercase text-sky-300/90">
                  {targetEntity
                    ? `Ideas para ${entityKindLabel(targetEntity)}:`
                    : "Ideas rápidas de Script manual:"}
                </span>
                <span className="text-[10px] font-mono text-slate-400">1 clic para aplicar</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {quickPrompts.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSendToAi(q.prompt)}
                    className="shrink-0 rounded-lg border border-sky-400/25 bg-[#121C33] px-2.5 py-1.5 text-[11px] font-medium text-slate-100 hover:border-sky-400/70 hover:bg-sky-500/20 hover:text-white active:scale-95 transition whitespace-nowrap disabled:opacity-50"
                  >
                    <Wand2 size={11} className="inline mr-1.5 text-sky-400" />
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
              className="border-t border-sky-500/20 bg-[#0D1426] p-3 space-y-2"
            >
              {error && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-rose-300 hover:text-white shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
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
                      ? `Describe qué debe hacer ${entityKindLabel(targetEntity)}: ej. al tocarlo impulsa al jugador, patrulla o dispara…`
                      : "Describe el script manual que quieres crear con IA: poderes, enemigos, reglas, sonidos o físicas…"
                  }
                  data-testid="orion-chat-input"
                  className="flex-1 resize-none rounded-xl border border-sky-400/25 bg-[#070B13] px-3 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 transition select-text"
                />
                <button
                  type="submit"
                  disabled={busy || !prompt.trim()}
                  data-testid="orion-chat-send"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-slate-950 font-bold shadow-[0_4px_14px_rgba(14,165,233,0.4)] hover:from-sky-300 hover:to-blue-500 disabled:opacity-40 disabled:shadow-none active:scale-95 transition"
                  title="Crear Script manual con IA"
                >
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-0.5">
                <span>Enter para enviar · Shift+Enter nueva línea</span>
                <span className="text-sky-400/90">100% IA · Sin código manual</span>
              </div>
            </form>
          </section>
        )}

        {/* PANEL 2: Lista de Scripts manuales creados por la IA */}
        {(workspaceView === "split" || workspaceView === "scripts" || mobilePane === "scripts") && (
          <section
            className={`${
              mobilePane === "scripts" ? "flex" : "hidden"
            } ${
              workspaceView === "chat" ? "md:hidden" : "md:flex"
            } w-full md:flex-1 flex-col min-w-0 min-h-0 bg-[#090D16]`}
          >
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-sky-500/15 bg-[#0C1324] px-3.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15 border border-sky-400/30 text-sky-400 shrink-0">
                  <Layers size={12} />
                </span>
                <span className="text-xs font-display font-bold tracking-wide text-slate-100 truncate">
                  SCRIPTS MANUALES ACTIVOS
                </span>
              </div>
              <span className="rounded-md bg-sky-500/15 border border-sky-400/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
                {totalScripts} {totalScripts === 1 ? "activo" : "activos"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {project.customRuntime?.jsCode?.trim() && (
                <div className="rounded-xl border border-sky-400/35 bg-gradient-to-br from-[#111C34] to-[#0C1426] p-3.5 space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-300">
                        <Sparkles size={12} />
                      </span>
                      <span className="font-display text-xs font-bold tracking-wide text-sky-200 truncate">
                        SCRIPT MANUAL GLOBAL DEL JUEGO
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          focusPromptForEntity(
                            null,
                            "Modifica el script manual global del juego para que además: ",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/25 transition"
                      >
                        <Wand2 size={10} />
                        Ajustar con IA
                      </button>
                      <button
                        type="button"
                        onClick={clearGlobalRuntimeScriptManual}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                      >
                        <Trash2 size={11} />
                        Quitar
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Mecánicas globales, controles especiales, sonidos sintetizados y reglas de escena gestionadas automáticamente por la inteligencia artificial.
                  </p>
                </div>
              )}

              {entitiesWithScripts.map((ent) => (
                <div
                  key={ent.id}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition ${
                    targetEntityId === ent.id
                      ? "border-sky-400/60 bg-gradient-to-br from-[#121F3B] to-[#0D162B] shadow-[0_0_20px_-6px_rgba(56,189,248,0.3)]"
                      : "border-white/10 bg-[#0F172A] hover:border-sky-400/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => focusPromptForEntity(ent.id)}
                      className="flex items-center gap-2 min-w-0 text-left group"
                    >
                      <span
                        className="h-3 w-3 rounded-sm shrink-0 border border-white/20"
                        style={{ background: ent.color }}
                      />
                      <span className="font-display text-xs font-bold tracking-wide text-white group-hover:text-sky-300 transition truncate">
                        {entityKindLabel(ent)}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">
                        ({ent.x}, {ent.y})
                      </span>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          focusPromptForEntity(
                            ent.id,
                            `Modifica el script manual de ${entityKindLabel(ent)} para que: `,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/25 transition"
                      >
                        <Wand2 size={10} />
                        Editar con IA
                      </button>
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-sky-300">
                        {ent.scripts?.length ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(ent.scripts ?? []).map((sc, idx) => (
                      <div
                        key={sc.id}
                        className="flex items-start justify-between gap-2.5 rounded-xl border border-sky-400/15 bg-[#090E1B] p-2.5"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-sky-500/20 border border-sky-400/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
                              #{idx + 1}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-100">
                              {EVENT_LABELS[sc.event]}
                              {sc.event === "onCollide" ? ` (${sc.withKind ?? "any"})` : ""}
                            </span>
                          </div>
                          {sc.blocks.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sc.blocks.map((b) => (
                                <span
                                  key={b.id}
                                  className="inline-flex items-center rounded-md border border-white/10 bg-[#121B2E] px-2 py-0.5 text-[10px] font-mono text-sky-200/90"
                                >
                                  {BLOCK_LABELS[b.kind] ?? b.kind}
                                  {b.soundName ? `: «${b.soundName}»` : ""}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              Comportamiento gestionado por IA
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeEntityScriptManual(ent.id, sc.id)}
                          title="Eliminar script manual"
                          className="shrink-0 rounded-lg border border-rose-500/35 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20 transition"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {totalScripts === 0 && (
                <div className="rounded-2xl border border-dashed border-sky-400/25 bg-[#0C1324]/70 p-6 text-center space-y-2.5">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400">
                    <Sparkles size={18} />
                  </div>
                  <div className="text-xs font-display font-bold tracking-wide text-slate-100">
                    AÚN NO HAY SCRIPTS MANUALES ACTIVOS
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                    Escribe en el asistente de Inteligencia Artificial a la izquierda o pulsa una idea rápida para crear un script manual al instante.
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
