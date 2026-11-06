import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Puzzle,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AudioAsset,
  Entity,
  EntityKind,
  Project,
  Scene,
  ScratchVariableDef,
  UIElement,
} from "@/lib/engine/core";
import { entityKindLabel, uid } from "@/lib/engine/core";
import type {
  Block,
  EventType,
  Script,
  VariableScope,
} from "@/lib/engine/scripts";
import { getProjectAudioLibrary } from "@/lib/engine/audio-library";
import {
  SCRATCH_BLOCK_SPECS,
  SCRATCH_CATEGORIES,
  SCRATCH_CATEGORY_MAP,
  SCRATCH_EVENT_TEMPLATES,
  collectAllVariableNames,
  getBlockShape,
  getScratchCategoryForBlock,
  type ScratchCategoryId,
} from "@/lib/engine/scratch-blocks-catalog";
import { entityToEditableSvgDataUrl } from "@/lib/engine/html5-game";

export interface HumanScratchScreenProps {
  project: Project;
  initialTargetEntityId?: string | null;
  initialTargetUiId?: string | null;
  onChangeProject: (next: Project) => void;
  onSaveProject?: () => void;
  onSwitchToManualAi?: () => void;
  onExit: () => void;
}

type InsertionTarget =
  | { kind: "script-root"; scriptId: string }
  | {
      kind: "c-branch";
      scriptId: string;
      parentBlockId: string;
      branch: "thenBlocks" | "elseBlocks";
    };

type MobileTab = "palette" | "workspace" | "variables";

const ENTITY_KIND_OPTIONS: { value: EntityKind | "any"; label: string }[] = [
  { value: "any", label: "cualquier objeto" },
  { value: "player", label: "jugador (player)" },
  { value: "enemy", label: "enemigo (enemy)" },
  { value: "coin", label: "moneda (coin)" },
  { value: "goal", label: "meta / objeto (goal)" },
  { value: "platform", label: "plataforma (platform)" },
  { value: "decor", label: "decoración (decor)" },
];

export function HumanScratchScreen({
  project,
  initialTargetEntityId = null,
  initialTargetUiId = null,
  onChangeProject,
  onSaveProject,
  onSwitchToManualAi,
  onExit,
}: HumanScratchScreenProps) {
  const activeScene: Scene | undefined = useMemo(
    () => project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0],
    [project]
  );

  const [targetType, setTargetType] = useState<"entity" | "ui">(
    initialTargetUiId ? "ui" : "entity"
  );
  const [selectedEntityId, setSelectedEntityId] = useState<string>(() => {
    if (initialTargetEntityId && activeScene?.entities.some((e) => e.id === initialTargetEntityId)) {
      return initialTargetEntityId;
    }
    const player = activeScene?.entities.find((e) => e.controllable || e.kind === "player");
    return player?.id ?? activeScene?.entities[0]?.id ?? "";
  });
  const [selectedUiId, setSelectedUiId] = useState<string>(() => {
    if (initialTargetUiId && (activeScene?.ui ?? []).some((u) => u.id === initialTargetUiId)) {
      return initialTargetUiId;
    }
    return activeScene?.ui?.[0]?.id ?? "";
  });

  const [selectedCategory, setSelectedCategory] = useState<ScratchCategoryId>("motion");
  const [mobileTab, setMobileTab] = useState<MobileTab>("workspace");
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [newVarName, setNewVarName] = useState("");
  const [newVarScope, setNewVarScope] = useState<VariableScope>("scene");
  const [newVarInitial, setNewVarInitial] = useState<string>("0");
  const [newVarVisible, setNewVarVisible] = useState<boolean>(true);

  const selectedEntity: Entity | null = useMemo(() => {
    if (!activeScene) return null;
    return (
      activeScene.entities.find((e) => e.id === selectedEntityId) ??
      activeScene.entities[0] ??
      null
    );
  }, [activeScene, selectedEntityId]);

  const selectedUi: UIElement | null = useMemo(() => {
    if (!activeScene) return null;
    return (
      (activeScene.ui ?? []).find((u) => u.id === selectedUiId) ??
      activeScene.ui?.[0] ??
      null
    );
  }, [activeScene, selectedUiId]);

  const activeScripts: Script[] = useMemo(() => {
    if (targetType === "ui") return selectedUi?.scripts ?? [];
    return selectedEntity?.scripts ?? [];
  }, [targetType, selectedEntity, selectedUi]);

  const [activeScriptId, setActiveScriptId] = useState<string | null>(
    () => activeScripts[0]?.id ?? null
  );
  const [insertionTarget, setInsertionTarget] = useState<InsertionTarget | null>(null);

  const effectiveScriptId = useMemo(() => {
    if (activeScriptId && activeScripts.some((s) => s.id === activeScriptId)) {
      return activeScriptId;
    }
    return activeScripts[0]?.id ?? null;
  }, [activeScriptId, activeScripts]);

  const audioLibrary: AudioAsset[] = useMemo(
    () => getProjectAudioLibrary(project),
    [project]
  );

  const customSynthKeys = useMemo(
    () => Object.keys(project.customRuntime?.synthSounds ?? {}),
    [project.customRuntime?.synthSounds]
  );

  const sceneVariableDefs: ScratchVariableDef[] = useMemo(
    () => activeScene?.variableDefinitions ?? [],
    [activeScene?.variableDefinitions]
  );

  const allVariableNames: string[] = useMemo(
    () =>
      collectAllVariableNames(
        sceneVariableDefs,
        selectedEntity?.variables,
        activeScene?.variables,
        activeScripts
      ),
    [sceneVariableDefs, selectedEntity?.variables, activeScene?.variables, activeScripts]
  );

  const showToast = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const updateActiveScene = (updater: (scene: Scene) => Scene) => {
    if (!activeScene) return;
    const nextScene = updater(activeScene);
    onChangeProject({
      ...project,
      scenes: project.scenes.map((s) => (s.id === activeScene.id ? nextScene : s)),
    });
  };

  const updateTargetScripts = (nextScripts: Script[]) => {
    updateActiveScene((sc) => {
      if (targetType === "ui" && selectedUi) {
        return {
          ...sc,
          ui: (sc.ui ?? []).map((u) =>
            u.id === selectedUi.id ? { ...u, scripts: nextScripts } : u
          ),
        };
      }
      if (selectedEntity) {
        return {
          ...sc,
          entities: sc.entities.map((e) =>
            e.id === selectedEntity.id ? { ...e, scripts: nextScripts } : e
          ),
        };
      }
      return sc;
    });
  };

  // ---- Variable Management (Scratch Stage Watchers + Scene/Entity Variables) ----
  const handleCreateVariable = () => {
    const clean = newVarName.trim();
    if (!clean || !activeScene) return;
    const parsedNum = Number(newVarInitial);
    const initialVal: string | number | boolean =
      newVarInitial.trim() !== "" && Number.isFinite(parsedNum)
        ? parsedNum
        : newVarInitial;

    const existing = sceneVariableDefs.find(
      (v) => v.name.toLowerCase() === clean.toLowerCase()
    );
    const newDef: ScratchVariableDef = {
      id: existing?.id ?? uid(),
      name: clean,
      scope: newVarScope,
      entityId: newVarScope === "entity" ? selectedEntity?.id : undefined,
      initialValue: initialVal,
      visibleOnStage: newVarVisible,
    };

    updateActiveScene((sc) => {
      const nextDefs = existing
        ? (sc.variableDefinitions ?? []).map((v) => (v.id === existing.id ? newDef : v))
        : [...(sc.variableDefinitions ?? []), newDef];

      if (newVarScope === "scene") {
        return {
          ...sc,
          variableDefinitions: nextDefs,
          variables: { ...(sc.variables ?? {}), [clean]: initialVal },
        };
      }
      return {
        ...sc,
        variableDefinitions: nextDefs,
        entities: sc.entities.map((ent) =>
          ent.id === selectedEntity?.id
            ? { ...ent, variables: { ...(ent.variables ?? {}), [clean]: initialVal } }
            : ent
        ),
      };
    });

    setNewVarName("");
    showToast(
      `Variable «${clean}» creada ${newVarVisible ? "y visible en pantalla" : ""}`
    );
  };

  const toggleVariableStageMonitor = (varDef: ScratchVariableDef) => {
    updateActiveScene((sc) => ({
      ...sc,
      variableDefinitions: (sc.variableDefinitions ?? []).map((v) =>
        v.id === varDef.id ? { ...v, visibleOnStage: !v.visibleOnStage } : v
      ),
    }));
  };

  const updateVariableInitialValue = (varDef: ScratchVariableDef, rawVal: string) => {
    const num = Number(rawVal);
    const val: string | number =
      rawVal.trim() !== "" && Number.isFinite(num) ? num : rawVal;
    updateActiveScene((sc) => {
      const nextDefs = (sc.variableDefinitions ?? []).map((v) =>
        v.id === varDef.id ? { ...v, initialValue: val } : v
      );
      if (varDef.scope === "scene") {
        return {
          ...sc,
          variableDefinitions: nextDefs,
          variables: { ...(sc.variables ?? {}), [varDef.name]: val },
        };
      }
      return {
        ...sc,
        variableDefinitions: nextDefs,
        entities: sc.entities.map((ent) =>
          ent.id === (varDef.entityId ?? selectedEntity?.id)
            ? { ...ent, variables: { ...(ent.variables ?? {}), [varDef.name]: val } }
            : ent
        ),
      };
    });
  };

  const deleteVariableDef = (varDef: ScratchVariableDef) => {
    updateActiveScene((sc) => {
      const nextSceneVars = { ...(sc.variables ?? {}) };
      delete nextSceneVars[varDef.name];
      return {
        ...sc,
        variableDefinitions: (sc.variableDefinitions ?? []).filter(
          (v) => v.id !== varDef.id
        ),
        variables: nextSceneVars,
      };
    });
    showToast(`Variable «${varDef.name}» eliminada`);
  };

  // ---- Hat Event / Script Creation ----
  const addHatScript = (event: EventType) => {
    const created: Script = {
      id: uid(),
      event,
      withKind: event === "onCollide" ? "any" : undefined,
      key: event === "onKeyDown" ? "jump" : undefined,
      interval: event === "onTimer" ? 1000 : undefined,
      threshold: event === "onScoreReach" ? 10 : undefined,
      message: event === "onMessage" ? "evento_1" : undefined,
      blocks: [],
    };
    const next = [...activeScripts, created];
    updateTargetScripts(next);
    setActiveScriptId(created.id);
    setInsertionTarget({ kind: "script-root", scriptId: created.id });
    setMobileTab("workspace");
    showToast("Nuevo sombrero de evento Scratch añadido");
  };

  const removeScript = (scriptId: string) => {
    const next = activeScripts.filter((s) => s.id !== scriptId);
    updateTargetScripts(next);
    if (effectiveScriptId === scriptId) {
      setActiveScriptId(next[0]?.id ?? null);
    }
    if (insertionTarget?.scriptId === scriptId) {
      setInsertionTarget(null);
    }
  };

  const duplicateScript = (script: Script) => {
    const cloneBlocks = (blocks: Block[]): Block[] =>
      blocks.map((b) => ({
        ...b,
        id: uid(),
        thenBlocks: b.thenBlocks ? cloneBlocks(b.thenBlocks) : undefined,
        elseBlocks: b.elseBlocks ? cloneBlocks(b.elseBlocks) : undefined,
      }));
    const copy: Script = {
      ...script,
      id: uid(),
      blocks: cloneBlocks(script.blocks),
    };
    const next = [...activeScripts, copy];
    updateTargetScripts(next);
    setActiveScriptId(copy.id);
    showToast("Pila de bloques duplicada");
  };

  const updateScriptMeta = (scriptId: string, patch: Partial<Script>) => {
    updateTargetScripts(
      activeScripts.map((s) => (s.id === scriptId ? { ...s, ...patch } : s))
    );
  };

  // ---- Recursive Block Helpers for C-Blocks & Stack Blocks ----
  const mapBlocksRecursive = (
    blocks: Block[],
    targetId: string,
    fn: (b: Block) => Block
  ): Block[] =>
    blocks.map((b) => {
      if (b.id === targetId) return fn(b);
      return {
        ...b,
        thenBlocks: b.thenBlocks
          ? mapBlocksRecursive(b.thenBlocks, targetId, fn)
          : b.thenBlocks,
        elseBlocks: b.elseBlocks
          ? mapBlocksRecursive(b.elseBlocks, targetId, fn)
          : b.elseBlocks,
      };
    });

  const removeBlockRecursive = (blocks: Block[], targetId: string): Block[] =>
    blocks
      .filter((b) => b.id !== targetId)
      .map((b) => ({
        ...b,
        thenBlocks: b.thenBlocks
          ? removeBlockRecursive(b.thenBlocks, targetId)
          : b.thenBlocks,
        elseBlocks: b.elseBlocks
          ? removeBlockRecursive(b.elseBlocks, targetId)
          : b.elseBlocks,
      }));

  const moveBlockInList = (
    blocks: Block[],
    targetId: string,
    dir: -1 | 1
  ): Block[] => {
    const idx = blocks.findIndex((b) => b.id === targetId);
    if (idx >= 0) {
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= blocks.length) return blocks;
      const copy = [...blocks];
      [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
      return copy;
    }
    return blocks.map((b) => ({
      ...b,
      thenBlocks: b.thenBlocks
        ? moveBlockInList(b.thenBlocks, targetId, dir)
        : b.thenBlocks,
      elseBlocks: b.elseBlocks
        ? moveBlockInList(b.elseBlocks, targetId, dir)
        : b.elseBlocks,
    }));
  };

  const insertBlockFromTemplate = (rawBlock: Omit<Block, "id">) => {
    const newBlock: Block = { ...rawBlock, id: uid() };
    if (
      (newBlock.kind === "setVariable" ||
        newBlock.kind === "changeVariable" ||
        newBlock.kind === "showVariable" ||
        newBlock.kind === "hideVariable" ||
        newBlock.kind === "ifVariable") &&
      sceneVariableDefs.length > 0
    ) {
      newBlock.text = sceneVariableDefs[0].name;
      newBlock.scope = sceneVariableDefs[0].scope;
    }

    if (activeScripts.length === 0) {
      const defaultEvent: EventType = targetType === "ui" ? "onTap" : "onStart";
      const createdScript: Script = {
        id: uid(),
        event: defaultEvent,
        blocks: [newBlock],
      };
      updateTargetScripts([createdScript]);
      setActiveScriptId(createdScript.id);
      setInsertionTarget({ kind: "script-root", scriptId: createdScript.id });
      setMobileTab("workspace");
      showToast("Pila de bloques iniciada automáticamente");
      return;
    }

    const targetScriptId =
      insertionTarget?.scriptId &&
      activeScripts.some((s) => s.id === insertionTarget.scriptId)
        ? insertionTarget.scriptId
        : effectiveScriptId ?? activeScripts[0].id;

    if (
      insertionTarget &&
      insertionTarget.kind === "c-branch" &&
      insertionTarget.scriptId === targetScriptId
    ) {
      const { parentBlockId, branch } = insertionTarget;
      updateTargetScripts(
        activeScripts.map((s) => {
          if (s.id !== targetScriptId) return s;
          return {
            ...s,
            blocks: mapBlocksRecursive(s.blocks, parentBlockId, (parent) => ({
              ...parent,
              [branch]: [...(parent[branch] ?? []), newBlock],
            })),
          };
        })
      );
      setMobileTab("workspace");
      return;
    }

    updateTargetScripts(
      activeScripts.map((s) =>
        s.id === targetScriptId ? { ...s, blocks: [...s.blocks, newBlock] } : s
      )
    );
    setActiveScriptId(targetScriptId);
    setMobileTab("workspace");
  };

  const updateBlockInScript = (
    scriptId: string,
    blockId: string,
    patch: Partial<Block>
  ) => {
    updateTargetScripts(
      activeScripts.map((s) =>
        s.id === scriptId
          ? {
              ...s,
              blocks: mapBlocksRecursive(s.blocks, blockId, (b) => ({
                ...b,
                ...patch,
              })),
            }
          : s
      )
    );
  };

  const deleteBlockFromScript = (scriptId: string, blockId: string) => {
    updateTargetScripts(
      activeScripts.map((s) =>
        s.id === scriptId
          ? { ...s, blocks: removeBlockRecursive(s.blocks, blockId) }
          : s
      )
    );
    if (
      insertionTarget?.kind === "c-branch" &&
      insertionTarget.parentBlockId === blockId
    ) {
      setInsertionTarget({ kind: "script-root", scriptId });
    }
  };

  const moveBlockInScript = (scriptId: string, blockId: string, dir: -1 | 1) => {
    updateTargetScripts(
      activeScripts.map((s) =>
        s.id === scriptId
          ? { ...s, blocks: moveBlockInList(s.blocks, blockId, dir) }
          : s
      )
    );
  };

  // ---- Hand-crafted Scratch Presets (No AI) ----
  const applyHumanPreset = (presetId: string) => {
    if (presetId === "var-counter") {
      const varName = "puntos_extra";
      updateActiveScene((sc) => {
        const hasDef = (sc.variableDefinitions ?? []).some(
          (v) => v.name === varName
        );
        const nextDefs: ScratchVariableDef[] = hasDef
          ? sc.variableDefinitions ?? []
          : [
              ...(sc.variableDefinitions ?? []),
              {
                id: uid(),
                name: varName,
                scope: "scene",
                initialValue: 0,
                visibleOnStage: true,
              },
            ];
        const newScript: Script = {
          id: uid(),
          event: "onCollide",
          withKind: "player",
          blocks: [
            {
              id: uid(),
              kind: "changeVariable",
              scope: "scene",
              text: varName,
              value: 10,
            },
            {
              id: uid(),
              kind: "showVariable",
              scope: "scene",
              text: varName,
            },
            {
              id: uid(),
              kind: "sayForSecs",
              text: "+10 Puntos!",
              value: 1200,
            },
          ],
        };
        if (targetType === "entity" && selectedEntity) {
          return {
            ...sc,
            variableDefinitions: nextDefs,
            variables: { ...(sc.variables ?? {}), [varName]: 0 },
            entities: sc.entities.map((e) =>
              e.id === selectedEntity.id
                ? { ...e, scripts: [...(e.scripts ?? []), newScript] }
                : e
            ),
          };
        }
        return sc;
      });
      showToast("Plantilla Scratch: Variable en pantalla + Contador añadida");
      return;
    }

    if (presetId === "patrol-bounce") {
      const sStart: Script = {
        id: uid(),
        event: "onStart",
        blocks: [{ id: uid(), kind: "setVx", value: 130 }],
      };
      const sUpdate: Script = {
        id: uid(),
        event: "onUpdate",
        blocks: [
          { id: uid(), kind: "ifOnEdgeBounce" },
          {
            id: uid(),
            kind: "ifSensing",
            sensingCond: "touchingKind",
            text: "player",
            thenBlocks: [{ id: uid(), kind: "hurtPlayer" }],
            elseBlocks: [],
          },
        ],
      };
      updateTargetScripts([...activeScripts, sStart, sUpdate]);
      setActiveScriptId(sUpdate.id);
      showToast("Plantilla Scratch: Rebote en bordes + Sensor de colisión añadida");
      return;
    }

    if (presetId === "jump-talk") {
      const sKey: Script = {
        id: uid(),
        event: "onKeyDown",
        key: "jump",
        blocks: [
          { id: uid(), kind: "jump", value: 440 },
          { id: uid(), kind: "sayForSecs", text: "¡Salto!", value: 900 },
        ],
      };
      updateTargetScripts([...activeScripts, sKey]);
      setActiveScriptId(sKey.id);
      showToast("Plantilla Scratch: Salto + Bocadillo añadida");
    }
  };

  const filteredSpecs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return SCRATCH_BLOCK_SPECS.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.subtitle && b.subtitle.toLowerCase().includes(q)) ||
          b.kind.toLowerCase().includes(q)
      );
    }
    return SCRATCH_BLOCK_SPECS.filter((b) => b.category === selectedCategory);
  }, [selectedCategory, searchQuery]);

  const totalHumanScriptsInScene = useMemo(() => {
    if (!activeScene) return 0;
    const entCount = activeScene.entities.reduce(
      (sum, e) => sum + (e.scripts?.length ?? 0),
      0
    );
    const uiCount = (activeScene.ui ?? []).reduce(
      (sum, u) => sum + (u.scripts?.length ?? 0),
      0
    );
    return entCount + uiCount;
  }, [activeScene]);

  const activeCategoryMeta = SCRATCH_CATEGORY_MAP[selectedCategory];

  return (
    <div
      data-testid="human-scratch-screen"
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-[#070B14] text-slate-100 select-none"
    >
      {/* Top Bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/25 bg-[#0B1120] px-3 py-2.5 shadow-[0_4px_24px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onExit}
            data-testid="exit-human-scratch-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-400/30 bg-[#111A2E] px-3 text-xs font-semibold text-amber-100 hover:border-amber-400/60 hover:bg-amber-500/15 active:scale-95 transition"
          >
            <ArrowLeft size={14} className="text-amber-400" />
            <span>Editor</span>
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFBF00] via-[#FF8C1A] to-[#4C97FF] text-slate-950 shadow-[0_0_16px_rgba(255,191,0,0.35)]">
              <Puzzle size={18} strokeWidth={2.3} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-sm font-bold tracking-wider text-white">
                  SCRIPTS HUMANOS
                </h1>
                <span className="rounded-md border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-amber-300">
                  SCRATCH BLOCKS · SIN IA
                </span>
              </div>
              <p className="hidden sm:block truncate text-[10px] font-mono text-slate-400">
                Hechos 100% a mano con bloques Scratch, sensores, operadores y variables en pantalla
              </p>
            </div>
          </div>
        </div>

        {/* Selector de Objeto / UI a programar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-700/80 bg-[#090E1A] p-0.5">
            <button
              type="button"
              onClick={() => setTargetType("entity")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-display font-bold tracking-wider transition ${
                targetType === "entity"
                  ? "bg-[#4C97FF] text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              OBJETOS ({activeScene?.entities.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setTargetType("ui")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-display font-bold tracking-wider transition ${
                targetType === "ui"
                  ? "bg-[#9966FF] text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              UI ({(activeScene?.ui ?? []).length})
            </button>
          </div>

          {targetType === "entity" ? (
            <select
              data-testid="human-scratch-entity-select"
              value={selectedEntity?.id ?? ""}
              onChange={(e) => {
                setSelectedEntityId(e.target.value);
                setInsertionTarget(null);
              }}
              className="h-9 rounded-xl border border-sky-400/35 bg-[#0D1527] px-3 text-xs font-mono text-white outline-none focus:border-amber-400"
            >
              {(activeScene?.entities ?? []).map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {entityKindLabel(ent)} ({Math.round(ent.x)},{Math.round(ent.y)}) ·{" "}
                  {ent.scripts?.length ?? 0} scripts
                </option>
              ))}
            </select>
          ) : (
            <select
              data-testid="human-scratch-ui-select"
              value={selectedUi?.id ?? ""}
              onChange={(e) => {
                setSelectedUiId(e.target.value);
                setInsertionTarget(null);
              }}
              className="h-9 rounded-xl border border-purple-400/35 bg-[#0D1527] px-3 text-xs font-mono text-white outline-none focus:border-amber-400"
            >
              {(activeScene?.ui ?? []).length === 0 ? (
                <option value="">Sin elementos UI en la escena</option>
              ) : (
                (activeScene?.ui ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    UI {u.kind.toUpperCase()} · {u.name} ({u.scripts?.length ?? 0} scripts)
                  </option>
                ))
              )}
            </select>
          )}

          {notice && (
            <span className="hidden lg:inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-mono text-emerald-300">
              <Check size={12} />
              {notice}
            </span>
          )}

          {onSwitchToManualAi && (
            <button
              type="button"
              onClick={onSwitchToManualAi}
              data-testid="switch-to-manual-ai-btn"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/10 px-3 text-xs font-display font-semibold tracking-wider text-sky-300 hover:bg-sky-500/20 active:scale-95 transition"
              title="Cambiar a Scripts Manuales con IA"
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">Scripts Manuales (IA)</span>
            </button>
          )}

          {onSaveProject && (
            <button
              type="button"
              onClick={() => {
                onSaveProject();
                showToast("Proyecto y bloques Scratch guardados");
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FFBF00] to-[#FF8C1A] px-3.5 text-xs font-display font-bold tracking-wider text-slate-950 shadow-[0_2px_12px_rgba(255,191,0,0.3)] hover:brightness-110 active:scale-95 transition"
            >
              Guardar
            </button>
          )}
        </div>
      </header>

      {/* Mobile Tab Switcher (< md) */}
      <div className="flex md:hidden shrink-0 items-center gap-1.5 border-b border-slate-800 bg-[#0B1120] px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setMobileTab("palette")}
          className={`flex-1 rounded-lg py-1.5 text-[11px] font-display font-bold tracking-wider transition ${
            mobileTab === "palette"
              ? "bg-[#4C97FF] text-white"
              : "bg-[#111A2E] text-slate-400"
          }`}
        >
          🧩 Bloques Scratch
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("workspace")}
          className={`flex-1 rounded-lg py-1.5 text-[11px] font-display font-bold tracking-wider transition ${
            mobileTab === "workspace"
              ? "bg-[#FFBF00] text-slate-950"
              : "bg-[#111A2E] text-slate-400"
          }`}
        >
          ⚡ Mi Código ({activeScripts.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("variables")}
          className={`flex-1 rounded-lg py-1.5 text-[11px] font-display font-bold tracking-wider transition ${
            mobileTab === "variables"
              ? "bg-[#FF8C1A] text-slate-950"
              : "bg-[#111A2E] text-slate-400"
          }`}
        >
          📦 Variables ({sceneVariableDefs.length})
        </button>
      </div>

      {/* Main 3-Column Scratch Layout */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* COLUMN 1 & 2: Scratch Category Rail + Block Toolbox */}
        <aside
          className={`${
            mobileTab === "palette" || mobileTab === "variables" ? "flex" : "hidden"
          } md:flex w-full md:w-[400px] lg:w-[440px] shrink-0 border-r border-slate-800/90 bg-[#0B1120] min-h-0 overflow-hidden`}
        >
          {/* Vertical Category Rail (Official Scratch 3.0 Colors) */}
          <nav
            aria-label="Categorías de Scratch"
            className="flex w-[86px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-slate-800/80 bg-[#080D18] py-2.5 px-1.5"
          >
            {SCRATCH_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.id && !searchQuery.trim();
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-testid={`scratch-cat-${cat.id}`}
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setSearchQuery("");
                    if (cat.id !== "variables" && mobileTab === "variables") {
                      setMobileTab("palette");
                    }
                  }}
                  className={`flex w-full flex-col items-center gap-1 rounded-xl py-2 px-1 transition ${
                    active
                      ? "bg-white/10 ring-1 ring-white/25 shadow-sm"
                      : "hover:bg-white/[0.04] opacity-80 hover:opacity-100"
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-full border-2 border-white/30 shadow-sm"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-center font-display text-[9.5px] font-bold tracking-tight text-slate-100 leading-tight">
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Toolbox Blocks List */}
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-[#0D1425]">
            <div
              className="shrink-0 border-b border-slate-800/80 p-2.5 space-y-2"
              style={{
                borderTop: `3px solid ${activeCategoryMeta.color}`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: activeCategoryMeta.color }}
                  />
                  <span className="font-display text-xs font-bold tracking-wider uppercase text-white">
                    {searchQuery.trim()
                      ? `Búsqueda (${filteredSpecs.length})`
                      : activeCategoryMeta.label}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  Toca un bloque para añadirlo
                </span>
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar bloque Scratch (ej. mover, decir, variable, si)..."
                className="w-full h-8 rounded-lg border border-slate-700/80 bg-[#070B14] px-2.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* EVENTS CATEGORY: Hat Blocks */}
              {selectedCategory === "events" && !searchQuery.trim() && (
                <div className="space-y-2">
                  <div className="text-[10px] font-display font-bold tracking-widest uppercase text-amber-300/90">
                    SOMBREROS DE EVENTO (INICIAN PILA DE BLOQUES)
                  </div>
                  {SCRATCH_EVENT_TEMPLATES.filter((ev) =>
                    targetType === "ui" ? !ev.entityOnly : !ev.uiOnly
                  ).map((ev) => (
                    <button
                      key={ev.event}
                      type="button"
                      data-testid={`add-hat-${ev.event}`}
                      onClick={() => addHatScript(ev.event)}
                      className="group relative w-full text-left transition active:scale-[0.98]"
                    >
                      <div
                        className="h-3 w-28 rounded-t-[18px] border-t border-x border-black/30 ml-2"
                        style={{ backgroundColor: "#FFBF00" }}
                      />
                      <div
                        className="flex items-center justify-between gap-2 rounded-r-xl rounded-bl-xl border border-black/30 px-3 py-2.5 text-slate-950 shadow-[0_3px_0_#CC9900]"
                        style={{ backgroundColor: "#FFBF00" }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-display text-xs font-extrabold tracking-wide">
                            <span className="rounded bg-black/15 px-1.5 py-0.5 text-xs">
                              {ev.badge}
                            </span>
                            <span>{ev.scratchText}</span>
                          </div>
                          <div className="mt-0.5 text-[10px] font-medium text-slate-900/80">
                            {ev.label}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-lg bg-black/15 px-2 py-1 font-mono text-[10px] font-bold">
                          + PILA
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* VARIABLES CATEGORY: Create & Manage Scratch Stage Watchers */}
              {(selectedCategory === "variables" || mobileTab === "variables") &&
                !searchQuery.trim() && (
                  <div
                    data-testid="scratch-variables-manager"
                    className="rounded-xl border border-[#FF8C1A]/40 bg-[#141118] p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-xs font-bold tracking-wider text-[#FF8C1A]">
                        📦 CREAR VARIABLE DE SCRATCH
                      </span>
                      <span className="text-[10px] font-mono text-amber-200/80">
                        Monitores en pantalla
                      </span>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="text"
                        data-testid="new-scratch-var-name"
                        value={newVarName}
                        onChange={(e) => setNewVarName(e.target.value)}
                        placeholder="Nombre de la variable (ej. puntos, energia, llaves)"
                        className="w-full h-8 rounded-lg border border-orange-500/40 bg-[#090D16] px-2.5 text-xs font-mono text-white outline-none focus:border-[#FF8C1A]"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={newVarScope}
                          onChange={(e) =>
                            setNewVarScope(e.target.value as VariableScope)
                          }
                          className="h-8 rounded-lg border border-slate-700 bg-[#090D16] px-2 text-[11px] font-mono text-slate-200"
                        >
                          <option value="scene">🌍 Para todos (Escena)</option>
                          <option value="entity">👤 Solo este objeto</option>
                        </select>
                        <input
                          type="text"
                          value={newVarInitial}
                          onChange={(e) => setNewVarInitial(e.target.value)}
                          placeholder="Valor inicial (0)"
                          className="h-8 rounded-lg border border-slate-700 bg-[#090D16] px-2.5 text-xs font-mono text-slate-200"
                        />
                      </div>

                      <label className="flex items-center justify-between rounded-lg border border-orange-500/25 bg-orange-500/10 px-2.5 py-1.5 cursor-pointer">
                        <span className="text-[11px] font-medium text-orange-200">
                          ☑ Mostrar variable en la pantalla del juego
                        </span>
                        <input
                          type="checkbox"
                          checked={newVarVisible}
                          onChange={(e) => setNewVarVisible(e.target.checked)}
                          className="h-4 w-4 accent-[#FF8C1A]"
                        />
                      </label>

                      <button
                        type="button"
                        data-testid="create-scratch-var-btn"
                        onClick={handleCreateVariable}
                        className="w-full rounded-lg bg-[#FF8C1A] py-2 font-display text-xs font-extrabold tracking-wider text-slate-950 shadow-[0_2px_0_#DB6E00] hover:brightness-110 active:scale-[0.98] transition"
                      >
                        + CREAR VARIABLE
                      </button>
                    </div>

                    {sceneVariableDefs.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-white/10">
                        <div className="text-[10px] font-display font-bold tracking-wider text-slate-400">
                          VARIABLES DEL JUEGO ({sceneVariableDefs.length})
                        </div>
                        {sceneVariableDefs.map((v) => (
                          <div
                            key={v.id}
                            data-testid={`scratch-var-item-${v.name}`}
                            className="flex flex-col gap-1.5 rounded-lg border border-orange-500/30 bg-[#0D1322] p-2"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleVariableStageMonitor(v)}
                                title={
                                  v.visibleOnStage
                                    ? "Ocultar monitor de la pantalla del juego"
                                    : "Mostrar monitor en la pantalla del juego"
                                }
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-mono font-bold transition ${
                                  v.visibleOnStage
                                    ? "bg-[#FF8C1A] text-slate-950"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {v.visibleOnStage ? (
                                  <Eye size={11} />
                                ) : (
                                  <EyeOff size={11} />
                                )}
                                <span>{v.name}</span>
                              </button>

                              <input
                                type="text"
                                value={String(v.initialValue ?? 0)}
                                onChange={(e) =>
                                  updateVariableInitialValue(v, e.target.value)
                                }
                                title="Valor inicial"
                                className="w-16 h-6 rounded border border-slate-700 bg-[#070B14] px-1.5 text-center font-mono text-[11px] text-amber-300"
                              />

                              <span className="text-[9px] font-mono text-slate-400">
                                {v.scope === "scene" ? "Global" : "Local"}
                              </span>

                              <button
                                type="button"
                                onClick={() => deleteVariableDef(v)}
                                className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
                                title="Eliminar variable"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  insertBlockFromTemplate({
                                    kind: "setVariable",
                                    scope: v.scope,
                                    text: v.name,
                                    value:
                                      typeof v.initialValue === "number"
                                        ? v.initialValue
                                        : 0,
                                  })
                                }
                                className="rounded bg-[#FF8C1A]/20 border border-[#FF8C1A]/40 px-1.5 py-0.5 text-[9.5px] font-mono text-orange-200 hover:bg-[#FF8C1A]/30"
                              >
                                + dar a [{v.name}] valor
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  insertBlockFromTemplate({
                                    kind: "changeVariable",
                                    scope: v.scope,
                                    text: v.name,
                                    value: 1,
                                  })
                                }
                                className="rounded bg-[#FF8C1A]/20 border border-[#FF8C1A]/40 px-1.5 py-0.5 text-[9.5px] font-mono text-orange-200 hover:bg-[#FF8C1A]/30"
                              >
                                + sumar a [{v.name}] (1)
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              {/* STACK & C-BLOCKS PALETTE */}
              <div className="space-y-2">
                {filteredSpecs.map((spec) => {
                  const cat = SCRATCH_CATEGORY_MAP[spec.category];
                  return (
                    <button
                      key={spec.kind}
                      type="button"
                      data-testid={`palette-block-${spec.kind}`}
                      onClick={() => insertBlockFromTemplate(spec.createDefault())}
                      className="group relative w-full text-left transition active:scale-[0.98]"
                    >
                      <div
                        className="ml-4 h-1.5 w-7 rounded-t-sm"
                        style={{ backgroundColor: cat.color }}
                      />
                      <div
                        className="flex items-center justify-between gap-2 rounded-xl border border-black/30 px-3 py-2 text-white shadow-md transition group-hover:brightness-110"
                        style={{
                          backgroundColor: cat.color,
                          boxShadow: `0 3px 0 ${cat.tertiaryColor}`,
                        }}
                      >
                        <div className="min-w-0">
                          <div className="font-display text-xs font-bold tracking-wide text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                            {spec.title}
                          </div>
                          {spec.subtitle && (
                            <div className="mt-0.5 text-[10px] text-white/85 leading-snug">
                              {spec.subtitle}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 rounded-md bg-black/25 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase">
                          {spec.shape === "c-block" || spec.shape === "c-if-else"
                            ? "C-BLOCK"
                            : "+"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* COLUMN 3: Scratch Visual Workspace */}
        <main
          className={`${
            mobileTab === "workspace" ? "flex" : "hidden"
          } md:flex flex-1 flex-col min-w-0 min-h-0 bg-[#070B14] overflow-hidden`}
        >
          <div className="shrink-0 border-b border-slate-800/90 bg-[#0B1120]/90 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {targetType === "entity" && selectedEntity && (
                <img
                  src={
                    selectedEntity.texture ||
                    entityToEditableSvgDataUrl(selectedEntity)
                  }
                  alt={entityKindLabel(selectedEntity)}
                  className="h-8 w-8 rounded-lg border border-slate-700 bg-slate-900 p-1 object-contain"
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-xs font-bold tracking-wider text-white truncate">
                    {targetType === "entity"
                      ? selectedEntity
                        ? `PROGRAMANDO OBJETO: ${entityKindLabel(selectedEntity).toUpperCase()}`
                        : "SIN OBJETO SELECCIONADO"
                      : selectedUi
                      ? `PROGRAMANDO UI: ${selectedUi.name.toUpperCase()}`
                      : "SIN ELEMENTO UI"}
                  </span>
                  <span className="rounded-full bg-amber-500/15 border border-amber-400/35 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                    {activeScripts.length}{" "}
                    {activeScripts.length === 1 ? "pila activa" : "pilas activas"}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  Total en escena: {totalHumanScriptsInScene} scripts ·{" "}
                  {sceneVariableDefs.filter((v) => v.visibleOnStage).length} variables
                  visibles en pantalla
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-display font-semibold tracking-wider text-slate-400 mr-1">
                PLANTILLAS SCRATCH:
              </span>
              <button
                type="button"
                onClick={() => applyHumanPreset("jump-talk")}
                className="rounded-lg border border-[#4C97FF]/40 bg-[#4C97FF]/15 px-2.5 py-1 text-[10px] font-display font-bold tracking-wider text-sky-200 hover:bg-[#4C97FF]/25 transition"
              >
                + Salto + Diálogo
              </button>
              <button
                type="button"
                onClick={() => applyHumanPreset("var-counter")}
                className="rounded-lg border border-[#FF8C1A]/40 bg-[#FF8C1A]/15 px-2.5 py-1 text-[10px] font-display font-bold tracking-wider text-orange-200 hover:bg-[#FF8C1A]/25 transition"
              >
                + Variable en Pantalla
              </button>
              <button
                type="button"
                onClick={() => applyHumanPreset("patrol-bounce")}
                className="rounded-lg border border-[#FFAB19]/40 bg-[#FFAB19]/15 px-2.5 py-1 text-[10px] font-display font-bold tracking-wider text-amber-200 hover:bg-[#FFAB19]/25 transition"
              >
                + Rebote + Sensor
              </button>
            </div>
          </div>

          {/* Live Preview Bar of Scratch Stage Variable Monitors */}
          {sceneVariableDefs.some((v) => v.visibleOnStage) && (
            <div className="shrink-0 border-b border-slate-800/70 bg-[#090F1D] px-4 py-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-display font-bold tracking-wider text-orange-300">
                MONITORES EN PANTALLA DEL JUEGO:
              </span>
              {sceneVariableDefs
                .filter((v) => v.visibleOnStage)
                .map((v) => (
                  <div
                    key={v.id}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-[#FF8C1A] bg-[#0f172a] px-2.5 py-0.5 text-xs font-mono shadow-sm"
                  >
                    <span className="font-bold text-slate-100">{v.name}</span>
                    <span className="rounded bg-[#FF8C1A] px-1.5 py-0.5 font-extrabold text-white">
                      {String(v.initialValue ?? 0)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Dotted Scratch Canvas */}
          <div
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
            style={{
              backgroundImage:
                "radial-gradient(rgba(148, 163, 184, 0.16) 1.5px, transparent 1.5px)",
              backgroundSize: "22px 22px",
            }}
          >
            {activeScripts.length === 0 ? (
              <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-amber-400/35 bg-[#0C1324]/90 p-6 text-center space-y-4 my-8">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-300">
                  <Puzzle size={28} />
                </div>
                <div className="space-y-1">
                  <h2 className="font-display text-base font-bold tracking-wider text-white">
                    LIENZO DE SCRIPTS HUMANOS (SCRATCH)
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Construye la lógica de tu juego encajando bloques hechos a mano.
                    Elige un <strong>Sombrero de Evento</strong> para empezar una pila o
                    toca cualquier bloque de la izquierda.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="empty-start-onstart-btn"
                    onClick={() => addHatScript(targetType === "ui" ? "onTap" : "onStart")}
                    className="rounded-xl bg-[#FFBF00] px-4 py-2 font-display text-xs font-extrabold tracking-wider text-slate-950 shadow-[0_3px_0_#CC9900] hover:brightness-110 active:scale-95 transition"
                  >
                    ⚑ {targetType === "ui" ? "Al tocar este botón UI" : "Al presionar bandera verde"}
                  </button>
                  {targetType === "entity" && (
                    <>
                      <button
                        type="button"
                        onClick={() => addHatScript("onUpdate")}
                        className="rounded-xl bg-[#FFAB19] px-4 py-2 font-display text-xs font-extrabold tracking-wider text-slate-950 shadow-[0_3px_0_#CF8B17] hover:brightness-110 active:scale-95 transition"
                      >
                        ↻ Por siempre (60 FPS)
                      </button>
                      <button
                        type="button"
                        onClick={() => addHatScript("onCollide")}
                        className="rounded-xl bg-[#4C97FF] px-4 py-2 font-display text-xs font-extrabold tracking-wider text-white shadow-[0_3px_0_#3373CC] hover:brightness-110 active:scale-95 transition"
                      >
                        💥 Al tocar otro objeto
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {activeScripts.map((script, idx) => {
                  const isSelectedScript = effectiveScriptId === script.id;
                  const isRootTarget =
                    (insertionTarget?.kind === "script-root" &&
                      insertionTarget.scriptId === script.id) ||
                    (!insertionTarget && isSelectedScript);
                  const eventMeta =
                    SCRATCH_EVENT_TEMPLATES.find((e) => e.event === script.event) ??
                    SCRATCH_EVENT_TEMPLATES[0];

                  return (
                    <div
                      key={script.id}
                      data-testid={`scratch-script-stack-${idx}`}
                      onClick={() => setActiveScriptId(script.id)}
                      className={`rounded-2xl border p-4 transition ${
                        isSelectedScript
                          ? "border-amber-400/50 bg-[#0C1426]/95 shadow-[0_0_28px_rgba(255,191,0,0.08)]"
                          : "border-slate-800/80 bg-[#0A101E]/85 hover:border-slate-700"
                      }`}
                    >
                      {/* SCRATCH HAT BLOCK */}
                      <div className="relative select-none">
                        <div
                          className="ml-3 h-4 w-36 rounded-t-[22px] border-t border-x border-black/30"
                          style={{ backgroundColor: "#FFBF00" }}
                        />
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 rounded-r-2xl rounded-bl-xl border border-black/30 px-3.5 py-2.5 text-slate-950 shadow-[0_4px_0_#CC9900]"
                          style={{ backgroundColor: "#FFBF00" }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-black/15 px-2 py-0.5 font-mono text-xs font-black">
                              {eventMeta.badge}
                            </span>
                            <select
                              value={script.event}
                              onChange={(e) =>
                                updateScriptMeta(script.id, {
                                  event: e.target.value as EventType,
                                })
                              }
                              className="h-7 rounded-full border border-black/25 bg-white/95 px-3 font-display text-xs font-extrabold text-slate-900 outline-none"
                            >
                              {SCRATCH_EVENT_TEMPLATES.filter((ev) =>
                                targetType === "ui" ? !ev.entityOnly : !ev.uiOnly
                              ).map((ev) => (
                                <option key={ev.event} value={ev.event}>
                                  {ev.scratchText}
                                </option>
                              ))}
                            </select>

                            {script.event === "onCollide" && (
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                <span>con</span>
                                <select
                                  value={script.withKind ?? "any"}
                                  onChange={(e) =>
                                    updateScriptMeta(script.id, {
                                      withKind: e.target.value as EntityKind | "any",
                                    })
                                  }
                                  className="h-7 rounded-full border border-black/25 bg-white/95 px-2.5 font-mono text-xs font-bold text-slate-900"
                                >
                                  {ENTITY_KIND_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {script.event === "onKeyDown" && (
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                <span>tecla:</span>
                                <select
                                  value={script.key ?? "jump"}
                                  onChange={(e) =>
                                    updateScriptMeta(script.id, {
                                      key: e.target.value as "left" | "right" | "jump",
                                    })
                                  }
                                  className="h-7 rounded-full border border-black/25 bg-white/95 px-2.5 font-mono text-xs font-bold text-slate-900"
                                >
                                  <option value="jump">Saltar / Espacio</option>
                                  <option value="left">Izquierda (←)</option>
                                  <option value="right">Derecha (→)</option>
                                </select>
                              </div>
                            )}

                            {script.event === "onTimer" && (
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                <span>cada (ms):</span>
                                <input
                                  type="number"
                                  value={script.interval ?? 1000}
                                  onChange={(e) =>
                                    updateScriptMeta(script.id, {
                                      interval: Math.max(50, Number(e.target.value) || 1000),
                                    })
                                  }
                                  className="h-7 w-20 rounded-full border border-black/25 bg-white/95 px-2 text-center font-mono text-xs font-bold text-slate-900"
                                />
                              </div>
                            )}

                            {script.event === "onScoreReach" && (
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                <span>puntos ≥</span>
                                <input
                                  type="number"
                                  value={script.threshold ?? 10}
                                  onChange={(e) =>
                                    updateScriptMeta(script.id, {
                                      threshold: Number(e.target.value) || 0,
                                    })
                                  }
                                  className="h-7 w-20 rounded-full border border-black/25 bg-white/95 px-2 text-center font-mono text-xs font-bold text-slate-900"
                                />
                              </div>
                            )}

                            {script.event === "onMessage" && (
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                <span>mensaje:</span>
                                <input
                                  type="text"
                                  value={script.message ?? "evento_1"}
                                  onChange={(e) =>
                                    updateScriptMeta(script.id, {
                                      message: e.target.value,
                                    })
                                  }
                                  className="h-7 w-32 rounded-full border border-black/25 bg-white/95 px-2.5 font-mono text-xs font-bold text-slate-900"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveScriptId(script.id);
                                setInsertionTarget({
                                  kind: "script-root",
                                  scriptId: script.id,
                                });
                              }}
                              className={`rounded-lg px-2.5 py-1 font-display text-[10px] font-extrabold tracking-wider transition ${
                                isRootTarget
                                  ? "bg-slate-950 text-amber-300"
                                  : "bg-black/15 text-slate-950 hover:bg-black/25"
                              }`}
                            >
                              {isRootTarget ? "● INSERTANDO AQUÍ" : "+ AÑADIR AL FINAL"}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateScript(script);
                              }}
                              title="Duplicar pila de bloques"
                              className="rounded-lg bg-black/15 p-1.5 text-slate-950 hover:bg-black/25"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeScript(script.id);
                              }}
                              title="Eliminar pila de bloques"
                              className="rounded-lg bg-rose-600/90 p-1.5 text-white hover:bg-rose-500"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div
                          className="ml-6 h-2 w-8 rounded-b-md"
                          style={{ backgroundColor: "#CC9900" }}
                        />
                      </div>

                      {/* STACK OF SCRATCH BLOCKS */}
                      <div className="mt-0.5 space-y-1 pl-1">
                        {script.blocks.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveScriptId(script.id);
                              setInsertionTarget({
                                kind: "script-root",
                                scriptId: script.id,
                              });
                              setMobileTab("palette");
                            }}
                            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-400/30 bg-amber-500/5 py-3 text-xs font-mono text-amber-200/80 hover:border-amber-400/60"
                          >
                            <Plus size={14} />
                            <span>
                              Pila vacía: toca un bloque Scratch en la paleta izquierda para encajarlo aquí
                            </span>
                          </button>
                        ) : (
                          script.blocks.map((block: Block) => (
                            <ScratchBlockNode
                              key={block.id}
                              block={block}
                              scriptId={script.id}
                              insertionTarget={insertionTarget}
                              onSelectInsertion={setInsertionTarget}
                              onUpdate={(blockId, patch) =>
                                updateBlockInScript(script.id, blockId, patch)
                              }
                              onDelete={(blockId) =>
                                deleteBlockFromScript(script.id, blockId)
                              }
                              onMove={(blockId, dir) =>
                                moveBlockInScript(script.id, blockId, dir)
                              }
                              allVariableNames={allVariableNames}
                              audioLibrary={audioLibrary}
                              customSynthKeys={customSynthKeys}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// Recursive Visual Scratch Block Component (Stack Blocks + C-Blocks)
// ============================================================================

interface ScratchBlockNodeProps {
  block: Block;
  scriptId: string;
  insertionTarget: InsertionTarget | null;
  onSelectInsertion: (target: InsertionTarget) => void;
  onUpdate: (blockId: string, patch: Partial<Block>) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, dir: -1 | 1) => void;
  allVariableNames: string[];
  audioLibrary: AudioAsset[];
  customSynthKeys: string[];
}

function ScratchBlockNode({
  block,
  scriptId,
  insertionTarget,
  onSelectInsertion,
  onUpdate,
  onDelete,
  onMove,
  allVariableNames,
  audioLibrary,
  customSynthKeys,
}: ScratchBlockNodeProps) {
  const cat = getScratchCategoryForBlock(block.kind);
  const shape = getBlockShape(block.kind);
  const set = (patch: Partial<Block>) => onUpdate(block.id, patch);

  const isCBlock = shape === "c-block" || shape === "c-if-else";
  const primaryChildren: Block[] = block.thenBlocks ?? [];
  const elseChildren: Block[] = block.elseBlocks ?? [];

  const isPrimaryTarget =
    insertionTarget?.kind === "c-branch" &&
    insertionTarget.scriptId === scriptId &&
    insertionTarget.parentBlockId === block.id &&
    insertionTarget.branch === "thenBlocks";

  const isElseTarget =
    insertionTarget?.kind === "c-branch" &&
    insertionTarget.scriptId === scriptId &&
    insertionTarget.parentBlockId === block.id &&
    insertionTarget.branch === "elseBlocks";

  return (
    <div className="relative select-none" data-testid={`scratch-block-${block.kind}`}>
      {/* Main Block Header Row */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/35 px-3 py-2 text-white shadow-sm"
        style={{
          backgroundColor: cat.color,
          boxShadow: `0 3px 0 ${cat.tertiaryColor}`,
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
          <ScratchBlockInlineFields
            block={block}
            set={set}
            allVariableNames={allVariableNames}
            audioLibrary={audioLibrary}
            customSynthKeys={customSynthKeys}
          />
        </div>

        {/* Reorder & Delete Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(block.id, -1);
            }}
            title="Subir bloque"
            className="rounded bg-black/20 p-1 text-white/90 hover:bg-black/35"
          >
            <ArrowUp size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(block.id, 1);
            }}
            title="Bajar bloque"
            className="rounded bg-black/20 p-1 text-white/90 hover:bg-black/35"
          >
            <ArrowDown size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(block.id);
            }}
            title="Quitar bloque"
            className="rounded bg-black/25 p-1 text-white hover:bg-rose-600"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* C-BLOCK MOUTH */}
      {isCBlock && (
        <div
          className="ml-3 border-l-[10px] pl-2.5 py-1.5 space-y-1 rounded-bl-xl"
          style={{ borderColor: cat.secondaryColor }}
        >
          <div className="flex items-center justify-between pr-2">
            <span className="font-mono text-[10px] font-bold uppercase text-amber-200/90">
              ↳ hacer dentro ({primaryChildren.length}):
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectInsertion({
                  kind: "c-branch",
                  scriptId,
                  parentBlockId: block.id,
                  branch: "thenBlocks",
                });
              }}
              className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                isPrimaryTarget
                  ? "bg-amber-400 text-slate-950 shadow-sm"
                  : "bg-white/10 text-slate-200 hover:bg-white/20"
              }`}
            >
              {isPrimaryTarget
                ? "● Insertando en esta rama"
                : "+ Insertar bloques aquí"}
            </button>
          </div>

          {primaryChildren.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 text-[10px] font-mono text-slate-400">
              Vacío — activa «+ Insertar bloques aquí» y toca un bloque de la paleta.
            </div>
          ) : (
            <div className="space-y-1">
              {primaryChildren.map((child: Block) => (
                <ScratchBlockNode
                  key={child.id}
                  block={child}
                  scriptId={scriptId}
                  insertionTarget={insertionTarget}
                  onSelectInsertion={onSelectInsertion}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onMove={onMove}
                  allVariableNames={allVariableNames}
                  audioLibrary={audioLibrary}
                  customSynthKeys={customSynthKeys}
                />
              ))}
            </div>
          )}

          {/* ELSE BRANCH FOR IF-ELSE C-BLOCKS */}
          {shape === "c-if-else" && (
            <div className="pt-1.5 space-y-1">
              <div
                className="flex items-center justify-between rounded-lg px-2.5 py-1 text-white"
                style={{ backgroundColor: cat.secondaryColor }}
              >
                <span className="font-display text-[11px] font-extrabold tracking-wider">
                  si no (else)
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectInsertion({
                      kind: "c-branch",
                      scriptId,
                      parentBlockId: block.id,
                      branch: "elseBlocks",
                    });
                  }}
                  className={`rounded px-2 py-0.5 font-mono text-[9.5px] font-bold ${
                    isElseTarget
                      ? "bg-slate-950 text-amber-300"
                      : "bg-black/25 text-white hover:bg-black/40"
                  }`}
                >
                  {isElseTarget ? "● Insertando en SI NO" : "+ Insertar en SI NO"}
                </button>
              </div>

              {elseChildren.length > 0 && (
                <div className="space-y-1 pl-1">
                  {elseChildren.map((child: Block) => (
                    <ScratchBlockNode
                      key={child.id}
                      block={child}
                      scriptId={scriptId}
                      insertionTarget={insertionTarget}
                      onSelectInsertion={onSelectInsertion}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onMove={onMove}
                      allVariableNames={allVariableNames}
                      audioLibrary={audioLibrary}
                      customSynthKeys={customSynthKeys}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            className="h-3 w-24 rounded-r-md rounded-bl-md"
            style={{ backgroundColor: cat.color }}
          />
        </div>
      )}

      {shape !== "cap" && (
        <div
          className="ml-6 h-1.5 w-7 rounded-b-sm"
          style={{ backgroundColor: cat.tertiaryColor }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Inline Scratch Oval / Pill Inputs for All Block Kinds
// ============================================================================

const PILL_INPUT =
  "h-6 rounded-full border border-black/25 bg-white px-2 text-center font-mono text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-amber-300";

const PILL_SELECT =
  "h-6 rounded-full border border-black/25 bg-white/95 px-2 font-mono text-xs font-bold text-slate-900 outline-none";

function ScratchBlockInlineFields({
  block,
  set,
  allVariableNames,
  audioLibrary,
  customSynthKeys,
}: {
  block: Block;
  set: (patch: Partial<Block>) => void;
  allVariableNames: string[];
  audioLibrary: AudioAsset[];
  customSynthKeys: string[];
}) {
  const numField = (
    val: number | undefined,
    fallback: number,
    key: "value" | "x" | "y" | "w" | "h" | "repeat",
    widthClass = "w-16"
  ) => (
    <input
      type="number"
      step="any"
      value={val ?? fallback}
      onChange={(e) => set({ [key]: Number(e.target.value) })}
      className={`${PILL_INPUT} ${widthClass}`}
    />
  );

  const varPicker = (
    currentName: string | undefined,
    scope: VariableScope | undefined
  ) => (
    <>
      <select
        value={scope ?? "scene"}
        onChange={(e) =>
          set({ scope: e.target.value as VariableScope })
        }
        className={PILL_SELECT}
        title="Ámbito de la variable"
      >
        <option value="scene">global</option>
        <option value="entity">objeto</option>
      </select>
      <input
        type="text"
        list="scratch-vars-datalist"
        value={currentName ?? "puntos"}
        onChange={(e) => set({ text: e.target.value })}
        className={`${PILL_INPUT} w-28`}
        placeholder="variable"
      />
      <datalist id="scratch-vars-datalist">
        {allVariableNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );

  switch (block.kind) {
    // ---- MOTION ----
    case "moveSteps":
      return (
        <>
          <span>mover</span>
          {numField(block.value, 10, "value")}
          <span>pasos</span>
        </>
      );
    case "turnRight":
      return (
        <>
          <span>girar ↻</span>
          {numField(block.value, 15, "value")}
          <span>grados</span>
        </>
      );
    case "turnLeft":
      return (
        <>
          <span>girar ↺</span>
          {numField(block.value, 15, "value")}
          <span>grados</span>
        </>
      );
    case "pointInDirection":
      return (
        <>
          <span>apuntar en dirección</span>
          {numField(block.value, 90, "value")}
          <span>°</span>
        </>
      );
    case "faceTarget":
      return (
        <>
          <span>apuntar hacia</span>
          <select
            value={block.text ?? "player"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            {ENTITY_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      );
    case "gotoTarget":
      return (
        <>
          <span>ir a</span>
          <select
            value={block.text ?? "random"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            <option value="random">🎲 posición aleatoria</option>
            {ENTITY_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      );
    case "teleport":
      return (
        <>
          <span>ir a x:</span>
          {numField(block.x, 100, "x")}
          <span>y:</span>
          {numField(block.y, 100, "y")}
        </>
      );
    case "glideTo":
      return (
        <>
          <span>deslizar en</span>
          {numField(block.value, 500, "value", "w-16")}
          <span>ms a x:</span>
          {numField(block.x, 180, "x")}
          <span>y:</span>
          {numField(block.y, 300, "y")}
        </>
      );
    case "moveX":
      return (
        <>
          <span>sumar a x</span>
          {numField(block.value, 10, "value")}
        </>
      );
    case "setX":
      return (
        <>
          <span>fijar x a</span>
          {numField(block.value, 180, "value")}
        </>
      );
    case "moveY":
      return (
        <>
          <span>sumar a y</span>
          {numField(block.value, -10, "value")}
        </>
      );
    case "setY":
      return (
        <>
          <span>fijar y a</span>
          {numField(block.value, 300, "value")}
        </>
      );
    case "ifOnEdgeBounce":
      return <span>si toca un borde, rebotar</span>;
    case "wrapScreen":
      return <span>envolver bordes de pantalla</span>;
    case "setFacing":
      return (
        <>
          <span>orientar hacia</span>
          <select
            value={block.value ?? 1}
            onChange={(e) => set({ value: Number(e.target.value) })}
            className={PILL_SELECT}
          >
            <option value={1}>derecha (→)</option>
            <option value={-1}>izquierda (←)</option>
          </select>
        </>
      );

    // ---- LOOKS ----
    case "sayForSecs":
      return (
        <>
          <span>decir</span>
          <input
            type="text"
            value={block.text ?? "¡Hola!"}
            onChange={(e) => set({ text: e.target.value })}
            className={`${PILL_INPUT} w-32`}
          />
          <span>durante</span>
          {numField(block.value, 2000, "value", "w-16")}
          <span>ms</span>
        </>
      );
    case "say":
      return (
        <>
          <span>decir</span>
          <input
            type="text"
            value={block.text ?? "¡Hola!"}
            onChange={(e) => set({ text: e.target.value })}
            className={`${PILL_INPUT} w-36`}
          />
        </>
      );
    case "thinkForSecs":
      return (
        <>
          <span>pensar</span>
          <input
            type="text"
            value={block.text ?? "Hmm..."}
            onChange={(e) => set({ text: e.target.value })}
            className={`${PILL_INPUT} w-32`}
          />
          <span>durante</span>
          {numField(block.value, 2000, "value", "w-16")}
          <span>ms</span>
        </>
      );
    case "clearBubble":
      return <span>quitar burbuja de diálogo</span>;
    case "changeSizeBy":
      return (
        <>
          <span>cambiar tamaño por</span>
          {numField(block.value, 10, "value")}
          <span>%</span>
        </>
      );
    case "setSizePercent":
      return (
        <>
          <span>fijar tamaño al</span>
          {numField(block.value, 100, "value")}
          <span>%</span>
        </>
      );
    case "setObjectSize":
    case "setSize":
      return (
        <>
          <span>dimensiones ancho:</span>
          {numField(block.w ?? block.x, 48, "w")}
          <span>alto:</span>
          {numField(block.h ?? block.y, 48, "h")}
          <span>px</span>
        </>
      );
    case "setColor":
      return (
        <>
          <span>fijar color a</span>
          <input
            type="color"
            value={block.color ?? "#38bdf8"}
            onChange={(e) => set({ color: e.target.value })}
            className="h-6 w-10 rounded-full border border-white bg-transparent cursor-pointer"
          />
        </>
      );
    case "setOpacity":
      return (
        <>
          <span>fijar opacidad al</span>
          {numField(block.value, 80, "value")}
          <span>%</span>
        </>
      );
    case "clearGraphicEffects":
      return <span>quitar efectos gráficos (100% normal)</span>;
    case "setVisible":
      return (
        <>
          <select
            value={block.bool === false ? "false" : "true"}
            onChange={(e) => set({ bool: e.target.value === "true" })}
            className={PILL_SELECT}
          >
            <option value="true">mostrar objeto</option>
            <option value="false">esconder objeto</option>
          </select>
        </>
      );
    case "setBg":
      return (
        <>
          <span>cambiar fondo de escena a</span>
          <input
            type="color"
            value={block.color ?? "#0f172a"}
            onChange={(e) => set({ color: e.target.value })}
            className="h-6 w-10 rounded-full border border-white bg-transparent cursor-pointer"
          />
        </>
      );
    case "goToFrontBack":
      return (
        <>
          <span>ir a la capa</span>
          <select
            value={block.text ?? "front"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            <option value="front">delantera (frente)</option>
            <option value="back">trasera (fondo)</option>
          </select>
        </>
      );
    case "goForwardBackwardLayers":
      return (
        <>
          <span>cambiar capa Z en</span>
          {numField(block.value, 1, "value")}
        </>
      );

    // ---- SOUND ----
    case "playSound":
      return (
        <>
          <span>tocar sonido</span>
          <select
            value={block.soundUrl || block.soundName || ""}
            onChange={(e) => {
              const val = e.target.value;
              const asset = audioLibrary.find((a) => a.url === val || a.name === val);
              set({
                soundName: asset ? asset.name : val,
                soundUrl: asset ? asset.url : val,
              });
            }}
            className={PILL_SELECT}
          >
            <option value="">Seleccionar audio...</option>
            {audioLibrary.length > 0 && (
              <optgroup label="Tu Biblioteca de Audio (Ajustes)">
                {audioLibrary.map((a) => (
                  <option key={a.id} value={a.url}>
                    🎵 {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {customSynthKeys.length > 0 && (
              <optgroup label="Sintetizador Runtime">
                {customSynthKeys.map((k) => (
                  <option key={k} value={`synth:${k}`}>
                    synth:{k}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </>
      );
    case "playMusic":
      return (
        <>
          <span>tocar música en bucle</span>
          <select
            value={block.soundUrl || block.text || ""}
            onChange={(e) => {
              const val = e.target.value;
              const asset = audioLibrary.find(
                (a) => a.url === val || a.name === val
              );
              set({
                soundUrl: asset ? asset.url : val,
                soundName: asset ? asset.name : val,
                text: asset ? asset.name : val,
              });
            }}
            className={PILL_SELECT}
          >
            <option value="">Seleccionar pista...</option>
            {audioLibrary.length > 0 && (
              <optgroup label="Tu Biblioteca de Música (Ajustes)">
                {audioLibrary.map((a) => (
                  <option key={a.id} value={a.url}>
                    🎵 {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </>
      );
    case "stopMusic":
      return <span>detener toda la música</span>;
    case "playRandomSound":
      return <span>tocar sonido aleatorio</span>;
    case "vibrate":
      return (
        <>
          <span>vibrar</span>
          {numField(block.value, 80, "value")}
          <span>ms</span>
        </>
      );

    // ---- EVENTS ----
    case "broadcast":
      return (
        <>
          <span>enviar mensaje</span>
          <input
            type="text"
            value={block.text ?? "evento_1"}
            onChange={(e) => set({ text: e.target.value })}
            className={`${PILL_INPUT} w-28`}
          />
        </>
      );

    // ---- CONTROL ----
    case "wait":
      return (
        <>
          <span>esperar</span>
          {numField(block.value, 500, "value", "w-16")}
          <span>ms</span>
        </>
      );
    case "repeat":
      return (
        <>
          <span>repetir</span>
          {numField(block.repeat ?? block.value, 5, "repeat", "w-14")}
          <span>veces</span>
        </>
      );
    case "ifSensing":
      return (
        <>
          <span>si</span>
          <select
            value={block.sensingCond ?? "touchingKind"}
            onChange={(e) =>
              set({
                sensingCond: e.target.value as Block["sensingCond"],
              })
            }
            className={PILL_SELECT}
          >
            <option value="touchingKind">¿tocando objeto?</option>
            <option value="touchingEdge">¿tocando borde de pantalla?</option>
            <option value="keyPressed">¿tecla presionada?</option>
            <option value="distanceLt">¿distancia menor que...?</option>
          </select>
          {(block.sensingCond ?? "touchingKind") === "touchingKind" && (
            <select
              value={block.text ?? "enemy"}
              onChange={(e) => set({ text: e.target.value })}
              className={PILL_SELECT}
            >
              {ENTITY_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {block.sensingCond === "keyPressed" && (
            <select
              value={block.sensingKey ?? "jump"}
              onChange={(e) =>
                set({ sensingKey: e.target.value as Block["sensingKey"] })
              }
              className={PILL_SELECT}
            >
              <option value="jump">saltar / espacio</option>
              <option value="left">flecha izquierda</option>
              <option value="right">flecha derecha</option>
            </select>
          )}
          {block.sensingCond === "distanceLt" && (
            <>
              <select
                value={block.text ?? "player"}
                onChange={(e) => set({ text: e.target.value })}
                className={PILL_SELECT}
              >
                {ENTITY_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span>&lt;</span>
              {numField(block.value, 120, "value")}
              <span>px</span>
            </>
          )}
          <span>entonces</span>
        </>
      );
    case "ifVariable":
    case "repeatUntilVariable":
      return (
        <>
          <span>
            {block.kind === "repeatUntilVariable" ? "repetir hasta que" : "si"}
          </span>
          {varPicker(block.text, block.scope)}
          <select
            value={block.operator ?? "gte"}
            onChange={(e) => set({ operator: e.target.value as Block["operator"] })}
            className={PILL_SELECT}
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          {numField(block.value, 10, "value")}
          <span>entonces</span>
        </>
      );
    case "if":
      return (
        <>
          <span>si</span>
          <select
            value={block.cond ?? "scoreGte"}
            onChange={(e) => set({ cond: e.target.value as Block["cond"] })}
            className={PILL_SELECT}
          >
            <option value="scoreGte">puntos ≥</option>
            <option value="scoreLte">puntos ≤</option>
          </select>
          {numField(block.value, 50, "value")}
          <span>entonces</span>
        </>
      );
    case "cloneSelf":
      return (
        <>
          <span>crear clon de mí en Δx:</span>
          {numField(block.x, 24, "x")}
          <span>Δy:</span>
          {numField(block.y, 0, "y")}
        </>
      );
    case "spawnEntity":
      return (
        <>
          <span>generar clon de</span>
          <select
            value={block.text ?? "coin"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            {ENTITY_KIND_OPTIONS.filter((o) => o.value !== "any").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span>x:</span>
          {numField(block.x, 100, "x")}
          <span>y:</span>
          {numField(block.y, 100, "y")}
        </>
      );
    case "destroySelf":
      return <span>eliminar este clon / objeto</span>;
    case "destroyOther":
      return <span>eliminar el otro objeto colisionado</span>;
    case "removeAllOf":
      return (
        <>
          <span>eliminar todos los</span>
          <select
            value={block.text ?? "enemy"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            {ENTITY_KIND_OPTIONS.filter((o) => o.value !== "any").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      );
    case "restartScene":
      return <span>reiniciar escena actual</span>;
    case "win":
      return <span>🏆 ganar la partida</span>;
    case "lose":
      return <span>💀 declarar Game Over</span>;

    // ---- SENSING ----
    case "senseDistanceToVariable":
      return (
        <>
          <span>guardar distancia a</span>
          <select
            value={block.varA ?? "player"}
            onChange={(e) => set({ varA: e.target.value })}
            className={PILL_SELECT}
          >
            {ENTITY_KIND_OPTIONS.filter((o) => o.value !== "any").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span>en</span>
          {varPicker(block.text, block.scope)}
        </>
      );
    case "sensePropertyToVariable":
      return (
        <>
          <span>leer</span>
          <select
            value={block.varB ?? "x"}
            onChange={(e) => set({ varB: e.target.value })}
            className={PILL_SELECT}
          >
            <option value="x">posición X</option>
            <option value="y">posición Y</option>
            <option value="vx">velocidad Vx</option>
            <option value="vy">velocidad Vy</option>
            <option value="rotation">dirección / rotación</option>
            <option value="score">marcador SCORE</option>
            <option value="lives">vidas ♥</option>
            <option value="time">cronómetro (s)</option>
          </select>
          <span>de</span>
          <select
            value={block.varA ?? "self"}
            onChange={(e) => set({ varA: e.target.value })}
            className={PILL_SELECT}
          >
            <option value="self">este objeto</option>
            <option value="player">jugador</option>
            <option value="enemy">enemigo</option>
          </select>
          <span>en</span>
          {varPicker(block.text, block.scope)}
        </>
      );
    case "resetTimer":
      return <span>reiniciar cronómetro a 0</span>;
    case "setHitbox":
      return (
        <>
          <span>fijar hitbox W:</span>
          {numField(block.w, 32, "w")}
          <span>H:</span>
          {numField(block.h, 32, "h")}
        </>
      );
    case "clearHitbox":
      return <span>restaurar hitbox original</span>;

    // ---- OPERATORS ----
    case "mathOperation":
      return (
        <>
          <span>fijar</span>
          {varPicker(block.text, block.scope)}
          <span>=</span>
          <input
            type="text"
            value={block.varA ?? "10"}
            onChange={(e) => set({ varA: e.target.value })}
            title="Número o $variable"
            className={`${PILL_INPUT} w-16`}
          />
          <select
            value={block.mathOp ?? "add"}
            onChange={(e) =>
              set({ mathOp: e.target.value as Block["mathOp"] })
            }
            className={PILL_SELECT}
          >
            <option value="add">+</option>
            <option value="sub">−</option>
            <option value="mul">×</option>
            <option value="div">÷</option>
            <option value="mod">mod</option>
          </select>
          <input
            type="text"
            value={block.varB ?? "5"}
            onChange={(e) => set({ varB: e.target.value })}
            title="Número o $variable"
            className={`${PILL_INPUT} w-16`}
          />
        </>
      );
    case "setRandomVariable":
      return (
        <>
          <span>fijar</span>
          {varPicker(block.text, block.scope)}
          <span>al azar entre</span>
          {numField(block.x, 1, "x")}
          <span>y</span>
          {numField(block.y, 10, "y")}
        </>
      );
    case "mathFunctionVariable":
      return (
        <>
          <span>fijar</span>
          {varPicker(block.text, block.scope)}
          <span>a</span>
          <select
            value={block.mathFn ?? "round"}
            onChange={(e) =>
              set({ mathFn: e.target.value as Block["mathFn"] })
            }
            className={PILL_SELECT}
          >
            <option value="abs">abs</option>
            <option value="floor">floor (piso)</option>
            <option value="ceil">ceil (techo)</option>
            <option value="round">redondear</option>
            <option value="sqrt">raíz cuadrada</option>
            <option value="sin">seno (sin)</option>
            <option value="cos">coseno (cos)</option>
          </select>
          <span>de</span>
          <input
            type="text"
            value={block.varA ?? "10"}
            onChange={(e) => set({ varA: e.target.value })}
            className={`${PILL_INPUT} w-16`}
          />
        </>
      );
    case "joinTextVariable":
      return (
        <>
          <span>fijar</span>
          {varPicker(block.text, block.scope)}
          <span>a unir</span>
          <input
            type="text"
            value={block.varA ?? "Puntos: "}
            onChange={(e) => set({ varA: e.target.value })}
            className={`${PILL_INPUT} w-24`}
          />
          <span>con</span>
          <input
            type="text"
            value={block.varB ?? "$puntos"}
            onChange={(e) => set({ varB: e.target.value })}
            className={`${PILL_INPUT} w-24`}
          />
        </>
      );

    // ---- VARIABLES ----
    case "setVariable":
      return (
        <>
          <span>dar a</span>
          {varPicker(block.text, block.scope)}
          <span>el valor</span>
          {numField(block.value, 0, "value", "w-20")}
        </>
      );
    case "changeVariable":
      return (
        <>
          <span>sumar a</span>
          {varPicker(block.text, block.scope)}
          {numField(block.value, 1, "value")}
        </>
      );
    case "showVariable":
      return (
        <>
          <span>mostrar variable</span>
          {varPicker(block.text, block.scope)}
          <span>en pantalla</span>
        </>
      );
    case "hideVariable":
      return (
        <>
          <span>esconder variable</span>
          {varPicker(block.text, block.scope)}
        </>
      );
    case "addScore":
      return (
        <>
          <span>sumar a SCORE</span>
          {numField(block.value, 10, "value")}
        </>
      );
    case "setScore":
      return (
        <>
          <span>fijar SCORE a</span>
          {numField(block.value, 0, "value")}
        </>
      );
    case "addLives":
      return (
        <>
          <span>sumar vidas ♥</span>
          {numField(block.value, 1, "value")}
        </>
      );
    case "setLives":
      return (
        <>
          <span>fijar vidas ♥ a</span>
          {numField(block.value, 3, "value")}
        </>
      );

    // ---- PHYSICS / MY BLOCKS ----
    case "jump":
      return (
        <>
          <span>saltar con fuerza</span>
          {numField(block.value, 420, "value")}
        </>
      );
    case "impulse":
      return (
        <>
          <span>impulso vx:</span>
          {numField(block.x, 200, "x")}
          <span>vy:</span>
          {numField(block.y, -300, "y")}
        </>
      );
    case "setVx":
      return (
        <>
          <span>fijar Vx a</span>
          {numField(block.value, 160, "value")}
        </>
      );
    case "setVy":
      return (
        <>
          <span>fijar Vy a</span>
          {numField(block.value, -260, "value")}
        </>
      );
    case "flipVx":
      return <span>invertir velocidad horizontal (rebote X)</span>;
    case "flipVy":
      return <span>invertir velocidad vertical (rebote Y)</span>;
    case "bounceY":
      return (
        <>
          <span>rebotar verticalmente</span>
          {numField(block.value, 80, "value")}
          <span>%</span>
        </>
      );
    case "chase":
      return (
        <>
          <span>perseguir a</span>
          <select
            value={block.text ?? "player"}
            onChange={(e) => set({ text: e.target.value })}
            className={PILL_SELECT}
          >
            {ENTITY_KIND_OPTIONS.filter((o) => o.value !== "any").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span>vel:</span>
          {numField(block.value, 110, "value")}
        </>
      );
    case "knockback":
      return (
        <>
          <span>knockback X:</span>
          {numField(block.x, 240, "x")}
          <span>Y:</span>
          {numField(block.y, -300, "y")}
        </>
      );
    case "hurtPlayer":
      return <span>dañar al jugador</span>;
    case "shake":
      return (
        <>
          <span>sacudir cámara</span>
          {numField(block.value, 8, "value", "w-14")}
        </>
      );
    case "stop":
      return <span>frenar velocidades a cero</span>;
    default:
      return <span>{block.kind}</span>;
  }
}
