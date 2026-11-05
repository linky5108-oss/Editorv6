import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CustomSoundSynth, Entity, EntityKind, Project, Scene } from "@/lib/engine/core";
import {
  compileScriptToHtml5Js,
  ENTITY_EVENTS,
  normalizeScripts,
  type Script,
} from "@/lib/engine/scripts";
import {
  buildGeminiScriptEditPrompt,
  buildGeminiScriptPrompt,
  extractScriptsFromAiPayload,
  parseAiJson,
  requestScriptAi,
  synthesizeScriptsFromRequest,
} from "@/lib/ai/gemini-provider";
import { ENGINE_KNOWLEDGE } from "@/lib/ai/engine-knowledge";
import {
  applyOrionPatchToProject,
  buildOrionIntelligentPatch,
  summarizeProjectForOrionArchitect,
  type OrionEditPatch,
} from "@/lib/ai/orion-game-architect";
import {
  compileUserLanguageLocally,
  isLegacyPlaceholderScriptJs,
  loadUserLanguage,
  sanitizeOrUpgradeHtml5ScriptJs,
  saveUserLanguageToStorage,
  type CustomLanguageProgram,
  type UserProgrammingLanguage,
} from "@/lib/ai/custom-language";
import { ArrowLeft, Code2, Layers, Loader2, Trash2, X } from "lucide-react";

export interface OrionAiModeScreenProps {
  project: Project;
  onChangeProject: (next: Project) => void;
  onSaveProject?: () => void;
  onExit?: () => void;
  onExitOrionMode?: () => void;
  initialTargetEntityId?: string | null;
}

const KIND_LABELS_ES: Record<EntityKind, string> = {
  player: "Jugador",
  platform: "Plataforma",
  coin: "Moneda",
  enemy: "Enemigo",
  goal: "Meta",
  decor: "Decoración",
};

function buildSceneIndependentRuntimeJs(
  existingJs: string | undefined,
  scenes: Scene[],
): string {
  const stripped = (existingJs || "")
    .replace(/\/\/ \[BEGIN_USER_LANG_PROGRAM:[^\]]+\][\s\S]*?\/\/ \[END_USER_LANG_PROGRAM:[^\]]+\]\n?/g, "")
    .trim();
  const cleanBase = isLegacyPlaceholderScriptJs(stripped)
    ? sanitizeOrUpgradeHtml5ScriptJs(stripped)
    : stripped;

  const scriptBlocks: string[] = [];
  const seenIds = new Set<string>();
  for (const sc of scenes) {
    for (const ent of sc.entities ?? []) {
      for (const s of ent.scripts ?? []) {
        if (seenIds.has(s.id)) continue;
        const js = sanitizeOrUpgradeHtml5ScriptJs(
          s.compiledJs,
          s.customLanguageCode,
          ent.id,
          ent.kind,
        ).trim();
        if (!js) continue;
        seenIds.add(s.id);
        const title = (s.customLanguageCode || s.event || "Script HTML5")
          .split(/\r?\n/)[0]
          .slice(0, 60);
        scriptBlocks.push(
          `// [BEGIN_USER_LANG_PROGRAM:${s.id}]\n` +
            `// Script HTML5 Independiente (${ent.name || ent.kind}) · ${title}\n` +
            `${js}\n` +
            `// [END_USER_LANG_PROGRAM:${s.id}]`,
        );
      }
    }
  }

  return [cleanBase, ...scriptBlocks].filter(Boolean).join("\n\n");
}

function stripScriptsFromPatch(patch: OrionEditPatch): OrionEditPatch {
  return {
    ...patch,
    customRuntimeJs: "",
    entityUpdates: patch.entityUpdates?.map((u) => {
      const rest = { ...u };
      delete rest.scriptsToAdd;
      return rest;
    }),
  };
}

export const OrionAiModeScreen: React.FC<OrionAiModeScreenProps> = ({
  project,
  onChangeProject,
  onSaveProject,
  onExit,
  onExitOrionMode,
  initialTargetEntityId = null,
}) => {
  const handleExitScreen = () => {
    if (onExitOrionMode) onExitOrionMode();
    else if (onExit) onExit();
  };

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [targetEntityId, setTargetEntityId] = useState<string | "scene">(
    initialTargetEntityId ? initialTargetEntityId : "scene",
  );
  const [editingScriptKey, setEditingScriptKey] = useState<string | null>(null);
  const [scriptEditPrompt, setScriptEditPrompt] = useState<string>("");
  const [editingBusy, setEditingBusy] = useState<boolean>(false);

  const [userLanguage, setUserLanguage] = useState<UserProgrammingLanguage>(() =>
    loadUserLanguage(project),
  );

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setUserLanguage(loadUserLanguage(project));
  }, [project.customRuntime?.userLanguage]);

  useEffect(() => {
    if (initialTargetEntityId) {
      setTargetEntityId(initialTargetEntityId);
    }
  }, [initialTargetEntityId]);

  const activeScene: Scene = useMemo(() => {
    return project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  }, [project]);

  useEffect(() => {
    if (
      targetEntityId !== "scene" &&
      !activeScene?.entities.some((e) => e.id === targetEntityId)
    ) {
      setTargetEntityId("scene");
    }
  }, [activeScene, targetEntityId]);

  // Si hay algún script antiguo con el placeholder de ondas en el proyecto actual, actualizarlo a su versión HTML5 real
  useEffect(() => {
    if (!activeScene) return;
    let changed = false;
    const upgradedEntities = activeScene.entities.map((ent) => {
      if (!ent.scripts || ent.scripts.length === 0) return ent;
      let entChanged = false;
      const nextScripts = ent.scripts.map((sc) => {
        if (sc.compiledJs && isLegacyPlaceholderScriptJs(sc.compiledJs, sc.customLanguageCode)) {
          entChanged = true;
          changed = true;
          return {
            ...sc,
            compiledJs: sanitizeOrUpgradeHtml5ScriptJs(
              sc.compiledJs,
              sc.customLanguageCode,
              ent.id,
              ent.kind,
            ),
          };
        }
        return sc;
      });
      return entChanged ? { ...ent, scripts: nextScripts } : ent;
    });

    const rawRuntimeJs = project.customRuntime?.jsCode ?? "";
    const runtimeHasLegacy = rawRuntimeJs ? isLegacyPlaceholderScriptJs(rawRuntimeJs) : false;

    if (changed || runtimeHasLegacy) {
      const nextScenes = project.scenes.map((s) =>
        s.id === activeScene.id ? { ...activeScene, entities: upgradedEntities } : s,
      );
      onChangeProject({
        ...project,
        scenes: nextScenes,
        customRuntime: {
          ...(project.customRuntime ?? {}),
          jsCode: buildSceneIndependentRuntimeJs(project.customRuntime?.jsCode, nextScenes),
        },
      });
    }
  }, [activeScene, onChangeProject, project]);

  const targetEntity: Entity | null = useMemo(() => {
    if (targetEntityId === "scene" || !activeScene) return null;
    return activeScene.entities.find((e) => e.id === targetEntityId) ?? null;
  }, [activeScene, targetEntityId]);

  const allEntityScripts = useMemo(() => {
    if (!activeScene) return [];
    const items: Array<{ entity: Entity; script: Script; index: number }> = [];
    for (const ent of activeScene.entities) {
      (ent.scripts ?? []).forEach((sc, idx) => {
        items.push({ entity: ent, script: sc, index: idx });
      });
    }
    return items;
  }, [activeScene]);

  const visibleScripts = useMemo(() => {
    if (targetEntity) {
      return allEntityScripts.filter((item) => item.entity.id === targetEntity.id);
    }
    return allEntityScripts;
  }, [allEntityScripts, targetEntity]);

  const handleSelectScene = (sceneId: string) => {
    if (sceneId === project.activeSceneId) return;
    onChangeProject({
      ...project,
      activeSceneId: sceneId,
    });
  };

  const handleApplyCode = async () => {
    const code = input.trim();
    if (!code || busy || !activeScene) return;

    setBusy(true);
    setErrorMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const recipientEntity =
        targetEntity ??
        activeScene.entities.find((e) => e.controllable || e.kind === "player") ??
        activeScene.entities[0] ??
        null;

      const strippedHtmlScript = code
        .replace(/^<script[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();
      const isDirectJs =
        /(?:window\.AsternalRuntime|registerHook|document\.getElementById|requestAnimationFrame|\b(?:const|let|var|function)\s+[a-zA-Z_$]|\bapi\.(?:getPlayer|getEntities|spawnEntity|addScore|addLives|setGravity|setBg|shake|playSound)\b)/i.test(
          strippedHtmlScript,
        );

      // 1. Construir parche estructural determinista del proyecto (entidades, propiedades, escena, sonidos)
      const structuralPatch = buildOrionIntelligentPatch(
        code,
        project,
        targetEntity ? targetEntity.id : null,
      );

      const localCompiled = compileUserLanguageLocally(code, userLanguage, {
        targetEntityId: recipientEntity?.id ?? null,
        targetEntityKind: recipientEntity?.kind,
        allowedEvents: ENTITY_EVENTS,
      });

      let generated: Script[] = [];
      let aiCustomJs = isDirectJs ? strippedHtmlScript : "";
      let aiExplanation = "";
      let aiSynthSounds: Record<string, CustomSoundSynth> = {};
      let remoteStructuralPatch: OrionEditPatch | null = null;

      if (!isDirectJs) {
        try {
          const prompt = buildGeminiScriptPrompt({
            userRequest: code,
            engineKnowledge: ENGINE_KNOWLEDGE,
            targetEntityKind: recipientEntity?.kind,
            projectSummary: summarizeProjectForOrionArchitect(project),
          });
          const result = await requestScriptAi(prompt, {
            sessionId: `script-${recipientEntity?.id ?? "scene"}`,
            signal: controller.signal,
          });
          const parsed = parseAiJson<unknown>(result.text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            if (
              obj.scenePatch ||
              obj.entitiesToAdd ||
              obj.entityUpdates ||
              obj.kindsToRemove ||
              obj.replaceAllEntities ||
              obj.redistributeLayout
            ) {
              remoteStructuralPatch = obj as unknown as OrionEditPatch;
            }
          }
          const extracted = extractScriptsFromAiPayload(parsed);
          if (extracted.customRuntimeJs) aiCustomJs = extracted.customRuntimeJs;
          if (extracted.explanation) aiExplanation = extracted.explanation;
          if (extracted.synthSounds) {
            aiSynthSounds = extracted.synthSounds as Record<string, CustomSoundSynth>;
          }

          const aiScripts = normalizeScripts(extracted.scripts).filter((s) =>
            ENTITY_EVENTS.includes(s.event),
          );
          if (aiScripts.length > 0) {
            generated = aiScripts;
          }
        } catch {
          // Si la petición remota falla, se usa el compilador HTML5 y parche de proyecto local
        }
      }

      if (generated.length === 0 && aiCustomJs.trim()) {
        generated = [
          {
            id: `html5-${Date.now().toString(36)}`,
            event: "onUpdate",
            blocks: [],
            compiledJs: aiCustomJs.trim(),
            customLanguageCode: code,
          },
        ];
      }

      if (generated.length === 0 && localCompiled.compiledScripts.length > 0) {
        generated = localCompiled.compiledScripts;
      }

      if (generated.length === 0) {
        generated = normalizeScripts(
          synthesizeScriptsFromRequest(code, ENTITY_EVENTS),
        ).filter((s) => ENTITY_EVENTS.includes(s.event));
      }

      generated = generated.map((sc) => {
        const candidateAiJs = sc.compiledJs?.trim() || aiCustomJs.trim();
        const compiledFromBlocks =
          sc.blocks && sc.blocks.length > 0
            ? compileScriptToHtml5Js(sc, recipientEntity?.id ?? null, recipientEntity?.kind)
            : "";
        const rawHtml5Js =
          candidateAiJs ||
          compiledFromBlocks ||
          localCompiled.compiledJs ||
          compileScriptToHtml5Js(sc, recipientEntity?.id ?? null, recipientEntity?.kind);
        const html5Js = isDirectJs
          ? strippedHtmlScript
          : sanitizeOrUpgradeHtml5ScriptJs(
              rawHtml5Js,
              code,
              recipientEntity?.id ?? null,
              recipientEntity?.kind,
            );
        return {
          ...sc,
          blocks: [],
          customLanguageCode: code,
          languageName: userLanguage.name,
          compiledJs: html5Js,
          aiExplanation: aiExplanation || sc.aiExplanation || localCompiled.explanation,
        };
      });

      const primaryCompiledJs =
        generated[0]?.compiledJs ||
        sanitizeOrUpgradeHtml5ScriptJs(
          aiCustomJs || localCompiled.compiledJs,
          code,
          recipientEntity?.id ?? null,
          recipientEntity?.kind,
        );

      // 2. Aplicar verdaderamente las ediciones al proyecto (escena, nuevas entidades, colores, tamaños, posiciones, física)
      const mergedProjectPatch: OrionEditPatch = {
        ...stripScriptsFromPatch(structuralPatch),
        ...(remoteStructuralPatch ? stripScriptsFromPatch(remoteStructuralPatch) : {}),
      };
      const patchedProject = applyOrionPatchToProject(project, mergedProjectPatch);
      const patchedScene =
        patchedProject.scenes.find((s) => s.id === patchedProject.activeSceneId) ??
        patchedProject.scenes[0];

      const effectiveRecipient =
        (recipientEntity
          ? patchedScene.entities.find((e) => e.id === recipientEntity.id)
          : null) ??
        patchedScene.entities.find((e) => e.controllable || e.kind === "player") ??
        patchedScene.entities[0] ??
        null;

      let nextEntities = patchedScene.entities;
      if (effectiveRecipient && generated.length > 0) {
        nextEntities = patchedScene.entities.map((ent) =>
          ent.id === effectiveRecipient.id
            ? {
                ...ent,
                scripts: [...(ent.scripts ?? []), ...generated],
              }
            : ent,
        );
      }

      const newProgram: CustomLanguageProgram = {
        id: localCompiled.programId,
        title: localCompiled.title,
        sourceCode: code,
        compiledJs: primaryCompiledJs,
        compiledScripts: generated,
        explanation: aiExplanation || localCompiled.explanation,
        targetEntityId: effectiveRecipient?.id ?? null,
        updatedAt: Date.now(),
      };

      const nextLang: UserProgrammingLanguage = {
        ...userLanguage,
        dictionary: [
          ...userLanguage.dictionary,
          ...localCompiled.detectedKeywords.filter(
            (kw) =>
              !userLanguage.dictionary.some(
                (d) => d.keyword.toLowerCase() === kw.keyword.toLowerCase(),
              ),
          ),
        ],
        programs: [
          newProgram,
          ...userLanguage.programs.filter((p) => p.sourceCode.trim() !== code),
        ].slice(0, 30),
      };

      saveUserLanguageToStorage(nextLang);
      setUserLanguage(nextLang);

      const nextScene: Scene = {
        ...patchedScene,
        entities: nextEntities,
      };
      const nextScenes = patchedProject.scenes.map((s) =>
        s.id === patchedScene.id ? nextScene : s,
      );
      const mergedJs = buildSceneIndependentRuntimeJs(
        patchedProject.customRuntime?.jsCode,
        nextScenes,
      );

      const nextProject: Project = {
        ...patchedProject,
        scenes: nextScenes,
        customRuntime: {
          ...(patchedProject.customRuntime ?? {}),
          jsCode: mergedJs,
          synthSounds: {
            ...(patchedProject.customRuntime?.synthSounds ?? {}),
            ...localCompiled.synthSounds,
            ...aiSynthSounds,
          },
          userLanguage: nextLang,
        },
      };

      onChangeProject(nextProject);
      onSaveProject?.();
      setInput("");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo aplicar el script.",
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleEditExistingScript = async (entity: Entity, script: Script) => {
    const instruction = scriptEditPrompt.trim();
    if (!instruction || editingBusy || !activeScene) return;

    setEditingBusy(true);
    setErrorMessage(null);

    try {
      const strippedHtmlScript = instruction
        .replace(/^<script[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();
      const isDirectJs =
        /(?:window\.AsternalRuntime|registerHook|document\.getElementById|requestAnimationFrame|\b(?:const|let|var|function)\s+[a-zA-Z_$]|\bapi\.(?:getPlayer|getEntities|spawnEntity|addScore|addLives|setGravity|setBg|shake|playSound)\b)/i.test(
          strippedHtmlScript,
        );

      const structuralPatch = buildOrionIntelligentPatch(instruction, project, entity.id);
      const localCompiled = compileUserLanguageLocally(instruction, userLanguage, {
        programId: `ulp-${script.id}`,
        targetEntityId: entity.id,
        targetEntityKind: entity.kind,
        allowedEvents: [script.event],
      });

      let updatedScript: Script | null = isDirectJs
        ? {
            ...script,
            id: script.id,
            compiledJs: strippedHtmlScript,
          }
        : null;

      if (!updatedScript) {
        try {
          const prompt = buildGeminiScriptEditPrompt({
            instruction,
            engineKnowledge: ENGINE_KNOWLEDGE,
            currentScript: script,
            targetEntityKind: entity.kind,
            projectSummary: summarizeProjectForOrionArchitect(project),
          });
          const res = await requestScriptAi(prompt, {
            sessionId: `edit-script-${script.id}`,
          });
          const parsed = parseAiJson<unknown>(res.text);
          const extracted = extractScriptsFromAiPayload(parsed);
          const normalized = normalizeScripts(extracted.scripts);
          if (normalized.length > 0) {
            const compiledFromBlocks =
              normalized[0].blocks && normalized[0].blocks.length > 0
                ? compileScriptToHtml5Js(normalized[0], entity.id, entity.kind)
                : "";
            const rawCandidateJs =
              normalized[0].compiledJs?.trim() ||
              extracted.customRuntimeJs?.trim() ||
              compiledFromBlocks ||
              localCompiled.compiledJs ||
              compileScriptToHtml5Js(normalized[0], entity.id, entity.kind);
            const candidateJs = sanitizeOrUpgradeHtml5ScriptJs(
              rawCandidateJs,
              instruction,
              entity.id,
              entity.kind,
            );
            updatedScript = {
              ...normalized[0],
              id: script.id,
              event: normalized[0].event ?? script.event,
              blocks: [],
              customLanguageCode: instruction,
              languageName: userLanguage.name,
              compiledJs: candidateJs,
            };
          } else if (extracted.customRuntimeJs?.trim()) {
            updatedScript = {
              ...script,
              id: script.id,
              blocks: [],
              customLanguageCode: instruction,
              languageName: userLanguage.name,
              compiledJs: sanitizeOrUpgradeHtml5ScriptJs(
                extracted.customRuntimeJs.trim(),
                instruction,
                entity.id,
                entity.kind,
              ),
            };
          }
        } catch {
          // fallback local HTML5
        }
      }

      if (!updatedScript && localCompiled.compiledScripts.length > 0) {
        updatedScript = {
          ...localCompiled.compiledScripts[0],
          id: script.id,
          event: localCompiled.compiledScripts[0].event ?? script.event,
          blocks: [],
          customLanguageCode: instruction,
          languageName: userLanguage.name,
          compiledJs: sanitizeOrUpgradeHtml5ScriptJs(
            localCompiled.compiledJs,
            instruction,
            entity.id,
            entity.kind,
          ),
        };
      }

      if (!updatedScript) {
        const fallback = normalizeScripts(
          synthesizeScriptsFromRequest(instruction, [script.event]),
        );
        const base = fallback[0] ?? script;
        updatedScript = {
          ...base,
          id: script.id,
          event: script.event,
          blocks: [],
          customLanguageCode: instruction,
          languageName: userLanguage.name,
          compiledJs: sanitizeOrUpgradeHtml5ScriptJs(
            localCompiled.compiledJs || compileScriptToHtml5Js(base, entity.id, entity.kind),
            instruction,
            entity.id,
            entity.kind,
          ),
        };
      }

      const patchedProject = applyOrionPatchToProject(
        project,
        stripScriptsFromPatch(structuralPatch),
      );
      const patchedScene =
        patchedProject.scenes.find((s) => s.id === patchedProject.activeSceneId) ??
        patchedProject.scenes[0];

      const nextEntities = patchedScene.entities.map((e) => {
        if (e.id !== entity.id) return e;
        return {
          ...e,
          scripts: (e.scripts ?? []).map((s) => (s.id === script.id ? updatedScript! : s)),
        };
      });

      const nextScene: Scene = { ...patchedScene, entities: nextEntities };
      const nextScenes = patchedProject.scenes.map((s) =>
        s.id === patchedScene.id ? nextScene : s,
      );
      const mergedJs = buildSceneIndependentRuntimeJs(
        patchedProject.customRuntime?.jsCode,
        nextScenes,
      );

      onChangeProject({
        ...patchedProject,
        scenes: nextScenes,
        customRuntime: {
          ...(patchedProject.customRuntime ?? {}),
          jsCode: mergedJs,
        },
      });
      onSaveProject?.();
      setEditingScriptKey(null);
      setScriptEditPrompt("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo actualizar el script.");
    } finally {
      setEditingBusy(false);
    }
  };

  const handleDeleteScript = (entityId: string, scriptId: string) => {
    if (!activeScene) return;
    const targetEnt = activeScene.entities.find((e) => e.id === entityId);
    const removedScript = (targetEnt?.scripts ?? []).find((s) => s.id === scriptId);
    const nextEntities = activeScene.entities.map((e) => {
      if (e.id !== entityId) return e;
      return {
        ...e,
        scripts: (e.scripts ?? []).filter((s) => s.id !== scriptId),
      };
    });
    const nextScene: Scene = { ...activeScene, entities: nextEntities };
    const nextScenes = project.scenes.map((s) => (s.id === activeScene.id ? nextScene : s));

    let nextLang = userLanguage;
    if (removedScript?.customLanguageCode) {
      const filteredPrograms = userLanguage.programs.filter(
        (p) => p.sourceCode.trim() !== removedScript.customLanguageCode?.trim(),
      );
      if (filteredPrograms.length !== userLanguage.programs.length) {
        nextLang = { ...userLanguage, programs: filteredPrograms };
        saveUserLanguageToStorage(nextLang);
        setUserLanguage(nextLang);
      }
    }
    const mergedJs = buildSceneIndependentRuntimeJs(
      project.customRuntime?.jsCode,
      nextScenes,
    );

    onChangeProject({
      ...project,
      scenes: nextScenes,
      customRuntime: {
        ...(project.customRuntime ?? {}),
        jsCode: mergedJs,
        userLanguage: nextLang,
      },
    });
  };

  return (
    <div
      data-testid="orion-ai-mode-fullscreen"
      className="editor-shell fixed inset-0 z-[120] flex flex-col text-foreground select-none overflow-hidden"
    >
      {/* Barra superior en una sola línea */}
      <header className="editor-bar shrink-0 flex flex-nowrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            data-testid="orion-exit-btn"
            onClick={handleExitScreen}
            className="glass-control shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-foreground transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver</span>
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Code2 className="w-4 h-4 text-primary" />
            </span>
            <h1 className="text-xs sm:text-sm font-display font-bold tracking-tight text-foreground truncate">
              Scripts HTML5
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-nowrap">
          <div className="glass-control flex items-center gap-1 rounded-lg px-2 py-1">
            <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
            <select
              data-testid="orion-scene-selector"
              value={activeScene?.id ?? ""}
              onChange={(e) => handleSelectScene(e.target.value)}
              className="bg-transparent text-[11px] font-semibold text-foreground focus:outline-none pr-1 max-w-[95px] sm:max-w-[150px] truncate"
            >
              {project.scenes.map((sc) => (
                <option key={sc.id} value={sc.id} className="bg-popover text-foreground">
                  {sc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="glass-control flex items-center gap-1 rounded-lg px-2 py-1">
            <select
              data-testid="orion-entity-target-selector"
              value={targetEntityId}
              onChange={(e) => setTargetEntityId(e.target.value)}
              className="bg-transparent text-[11px] font-semibold text-foreground focus:outline-none max-w-[110px] sm:max-w-[180px] truncate"
            >
              <option value="scene" className="bg-popover text-foreground">
                Todos los objetos ({activeScene?.name ?? "Escena"})
              </option>
              {(activeScene?.entities ?? []).map((ent) => (
                <option key={ent.id} value={ent.id} className="bg-popover text-foreground">
                  {ent.name || KIND_LABELS_ES[ent.kind]} ({(ent.scripts ?? []).length})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Contenido único: Cuadro de scripts HTML5 + Recuadro para escribir código */}
      <div className="flex-1 min-h-0 flex flex-col max-w-3xl w-full mx-auto p-3 sm:p-5 gap-3 overflow-hidden">
        {/* Cuadro de scripts HTML5 */}
        <div
          data-testid="orion-scripts-drawer"
          className="panel flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <span className="text-xs font-display font-bold uppercase tracking-wider text-primary">
              Scripts HTML5 ({visibleScripts.length})
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            {visibleScripts.length === 0 ? (
              <div className="h-full min-h-[120px] flex items-center justify-center rounded-xl border border-dashed border-line-strong p-4 text-center">
                <p className="text-xs text-muted-foreground">Sin scripts activos.</p>
              </div>
            ) : (
              visibleScripts.map(({ entity, script }, idx) => {
                const key = `${entity.id}:${script.id}`;
                const isEditing = editingScriptKey === key;
                const html5Code =
                  script.compiledJs?.trim() ||
                  compileScriptToHtml5Js(script, entity.id, entity.kind);
                return (
                  <div
                    key={key}
                    className="glass-surface rounded-xl p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-nowrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                          #{idx + 1}
                        </span>
                        <span className="text-xs font-bold text-foreground truncate">
                          {entity.name || KIND_LABELS_ES[entity.kind]}
                        </span>
                        <span className="shrink-0 text-[10px] font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 border border-primary/25 text-primary">
                          HTML5
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingScriptKey(isEditing ? null : key);
                            setScriptEditPrompt(html5Code || script.customLanguageCode || "");
                          }}
                          className="glass-control px-2.5 py-1 rounded-lg text-[10px] font-semibold text-foreground transition"
                        >
                          {isEditing ? "Cerrar" : "Editar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteScript(entity.id, script.id)}
                          className="glass-control p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition"
                          title="Eliminar script"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {script.customLanguageCode &&
                      script.customLanguageCode.trim() !== html5Code.trim() && (
                        <pre className="rounded-lg bg-card border border-line px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap">
                          {script.customLanguageCode}
                        </pre>
                      )}

                    <pre className="max-h-40 overflow-y-auto rounded-lg bg-background/80 border border-line px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
                      {html5Code}
                    </pre>

                    {isEditing && (
                      <div className="pt-2 border-t border-line space-y-2">
                        <textarea
                          value={scriptEditPrompt}
                          onChange={(e) => setScriptEditPrompt(e.target.value)}
                          rows={5}
                          disabled={editingBusy}
                          placeholder="Edita el script HTML5 o escribe el código..."
                          className="w-full px-3 py-2 rounded-lg bg-card border border-line-strong font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={editingBusy || !scriptEditPrompt.trim()}
                          onClick={() => void handleEditExistingScript(entity, script)}
                          className="w-full py-2 rounded-lg text-xs font-display font-bold btn-grad text-primary-foreground disabled:opacity-40 transition"
                        >
                          {editingBusy ? "Aplicando..." : "Aplicar"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="shrink-0 rounded-xl px-3.5 py-2 bg-destructive/10 border border-destructive/35 text-xs text-destructive flex items-center justify-between gap-2">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-destructive hover:opacity-80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Recuadro para escribir código nada más + botón Aplicar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleApplyCode();
          }}
          className="panel shrink-0 rounded-xl border border-line-strong bg-card p-3 space-y-2.5"
        >
          <textarea
            data-testid="orion-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            rows={4}
            placeholder="Escribe tu código aquí..."
            className="w-full resize-none rounded-lg bg-surface-2/40 border border-line-strong px-3.5 py-2.5 font-mono text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />

          <button
            type="submit"
            data-testid="orion-send-btn"
            disabled={busy || !input.trim()}
            className="w-full h-10 rounded-lg btn-grad disabled:opacity-40 text-primary-foreground font-display text-xs font-bold tracking-wider inline-flex items-center justify-center gap-2 transition"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{busy ? "Aplicando..." : "Aplicar"}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

