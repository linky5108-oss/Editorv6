import type {
  CustomSoundSynth,
  Entity,
  EntityKind,
  OrionHistoryItem,
  Project,
  ProjectSettings,
  Scene,
  UIElement,
} from "@/lib/engine/core";
import { ensureSceneLayers, KIND_PRESETS, newUIElement, uid } from "@/lib/engine/core";
import {
  buildProjectGameHtml,
  parseStandaloneGameHtml,
  syncHtmlToProject,
  syncRuntimeAndTexturesToProject,
} from "@/lib/engine/html5-game";
import { normalizeScripts, type Script } from "@/lib/engine/scripts";
import { ENGINE_KNOWLEDGE } from "./engine-knowledge";
import { geminiChat, parseAiJson } from "./gemini-provider";

export interface OrionEntityUpdate {
  id?: string;
  name?: string;
  targetKind?: EntityKind | "all";
  kind?: EntityKind | "all";
  patch?: Partial<Entity>;
  scriptsToAdd?: Script[];
  [key: string]: unknown;
}

export interface OrionEditPatch {
  reply?: string;
  changesSummary?: string[];
  projectTitle?: string;
  scenePatch?: Partial<
    Pick<
      Scene,
      | "name"
      | "bg"
      | "bgImage"
      | "bgImageMode"
      | "gravity"
      | "width"
      | "height"
      | "timeLimit"
      | "startLives"
      | "variables"
      | "entities"
      | "ui"
    >
  >;
  settingsPatch?: Partial<ProjectSettings>;
  replaceAllEntities?: boolean;
  entitiesToAdd?: Array<Partial<Entity> & { kind?: EntityKind; type?: EntityKind }>;
  entityUpdates?: OrionEntityUpdate[];
  entityIdsToRemove?: string[];
  kindsToRemove?: EntityKind[];
  uiToAdd?: Array<Partial<UIElement>>;
  uiUpdates?: Array<{ id?: string; name?: string; patch?: Partial<UIElement>; [key: string]: unknown }>;
  uiIdsToRemove?: string[];
  spritesToAdd?: Array<{
    id?: string;
    name?: string;
    width?: number;
    height?: number;
    dataUrl?: string;
    texture?: string;
  }>;
  redistributeLayout?: "spiral" | "stairs" | "grid" | "arc" | "symmetrical" | null;
  customRuntimeJs?: string;
  appendRuntimeJs?: boolean;
  customCss?: string;
  synthSounds?: Record<string, CustomSoundSynth>;
}

export interface OrionEditResult {
  project: Project;
  html: string;
  reply: string;
  changesSummary: string[];
  modelUsed: string;
}

export const ORION_QUICK_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Dash con estela y sonido",
    prompt: "Orión, implementa en el juego que el jugador pueda hacer dash con Shift o tecla X dejando una estela luminosa y un sonido sintetizado.",
  },
  {
    label: "Disparo láser y enemigos",
    prompt: "Orión, añade 3 enemigos patrullando en el nivel y la mecánica de disparar proyectiles láser con la tecla Z o F que los destruyan con explosión de partículas.",
  },
  {
    label: "Crear nivel nuevo espacial",
    prompt: "Orión, transforma la escena en un nivel espacial nocturno con gravedad lunar, plataformas móviles, más monedas en arco y cielo estrellado animado.",
  },
  {
    label: "Gravedad cambiante y triple salto",
    prompt: "Orión, agrega triple salto con partículas en el aire y permite invertir la gravedad con la tecla G.",
  },
  {
    label: "Jefe gigante e imán de monedas",
    prompt: "Orión, crea un enemigo jefe grande patrullando cerca de la meta, activa imán de monedas cercanas para el jugador y añade contador de combos en pantalla.",
  },
  {
    label: "Sonorizar todo el juego",
    prompt: "Orión, añade efectos de sonido WebAudio automáticos al saltar, recoger monedas, recibir daño y ganar la partida, además de partículas al saltar.",
  },
];

/**
 * Resume el estado completo del proyecto y del archivo HTML5 para que Orión
 * conozca exactamente qué objetos, coordenadas, scripts, sonidos y código
 * personalizado están activos antes de modificar el juego.
 */
export function summarizeProjectForOrionArchitect(project: Project): string {
  const scene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  if (!scene) return "Proyecto sin escenas.";

  const entitiesSummary = scene.entities.slice(0, 60).map((e) => ({
    id: e.id,
    kind: e.kind,
    name: e.name,
    x: Math.round(e.x),
    y: Math.round(e.y),
    w: Math.round(e.w),
    h: Math.round(e.h),
    vx: Math.round(e.vx || 0),
    vy: Math.round(e.vy || 0),
    color: e.color,
    solid: e.solid,
    gravity: e.gravity,
    controllable: e.controllable,
    collectible: e.collectible,
    hazard: e.hazard,
    goal: e.goal,
    visible: e.visible !== false,
    opacity: e.opacity ?? 1,
    value: e.value,
    moving: e.moving ?? undefined,
    patrol: e.patrol ?? undefined,
    spring: e.spring ?? undefined,
    crumble: e.crumble ?? undefined,
    powerup: e.powerup ?? undefined,
    emitter: e.emitter ?? undefined,
    hasTexture: Boolean(e.texture),
    scripts: e.scripts && e.scripts.length > 0 ? e.scripts : undefined,
    layerId: e.layerId ?? "default",
  }));

  const uiSummary = (scene.ui ?? []).slice(0, 20).map((u) => ({
    id: u.id,
    kind: u.kind,
    name: u.name,
    x: u.x,
    y: u.y,
    w: u.w,
    h: u.h,
    anchor: u.anchor,
    text: u.text,
    color: u.color,
    bg: u.bg,
    action: u.action,
    bind: u.bind,
  }));

  const customJs = project.customRuntime?.jsCode?.trim() || "";
  const synthKeys = Object.keys(project.customRuntime?.synthSounds ?? {});

  return JSON.stringify(
    {
      projectName: project.name,
      activeScene: {
        id: scene.id,
        name: scene.name,
        width: scene.width,
        height: scene.height,
        gravity: scene.gravity,
        bg: scene.bg,
        startLives: scene.startLives ?? 1,
        timeLimit: scene.timeLimit ?? 0,
        variables: scene.variables ?? {},
        entitiesCount: scene.entities.length,
        entities: entitiesSummary,
        ui: uiSummary,
      },
      settings: project.settings,
      spritesRegistered: (project.assets?.sprites ?? []).slice(0, 24).map((s) => ({
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
      })),
      synthSoundsRegistered: synthKeys,
      currentCustomRuntimeJs: customJs.slice(0, 4500),
    },
    null,
    2,
  );
}

/**
 * Construye el prompt completo para que la IA real de Orión modifique el juego.
 */
export function buildOrionArchitectPrompt(
  userInstruction: string,
  project: Project,
  recentHistoryText?: string,
): string {
  return [
    "Eres Orión (SIEMPRE escrito con tilde: Orión), el asistente de inteligencia artificial oficial de Asternal.",
    "Tu misión es MODIFICAR REALMENTE el juego cumpliendo exactamente la petición del creador. Puedes modificar escenas, colores, gravedad, entidades (jugador, plataformas, enemigos, monedas, meta, decoración), scripts de bloques, interfaz UI, sonidos sintetizados WebAudio y programar cualquier mecánica nueva en JavaScript dentro del runtime HTML5 (`window.AsternalRuntime.registerHook` y `window.AsternalAudio`).",
    "REGLAS ESTRICTAS DE EDICIÓN:",
    "1. NUNCA respondas solo con texto: SIEMPRE debes incluir los cambios reales en los campos JSON (`scenePatch`, `entitiesToAdd`, `entityUpdates`, `entityIdsToRemove`, `kindsToRemove`, `replaceAllEntities`, `uiToAdd`, `redistributeLayout`, `synthSounds` o `customRuntimeJs`) para que el juego cambie de verdad.",
    "2. En la escena activa, y=0 es la parte superior y y=height (normalmente 700) es el fondo. El suelo suele estar en y=500..640.",
    "3. Para cambiar tamaño, color, posición, velocidad o propiedades de objetos existentes (como el jugador, plataformas, enemigos o monedas), usa `entityUpdates`: [{ \"targetKind\": \"player\", \"patch\": { \"w\": 64, \"h\": 84, \"color\": \"#ef4444\" } }] o indica el `id` exacto del objeto.",
    "4. Para agregar nuevos objetos al mapa (enemigos, plataformas, monedas, jefes, trampas, decoración), usa `entitiesToAdd`: [{ \"kind\": \"enemy\", \"name\": \"Enemigo\", \"x\": 450, \"y\": 440, \"w\": 44, \"h\": 44, \"vx\": 90, \"color\": \"#f43f5e\", \"patrol\": { \"range\": 140, \"ledgeSafe\": true } }].",
    "5. Si el usuario pide crear un nivel nuevo desde cero o rehacer todo el mapa, pon `\"replaceAllEntities\": true` y define en `entitiesToAdd` el jugador (`kind: \"player\"`), las plataformas de suelo y aéreas (`kind: \"platform\"`), enemigos (`kind: \"enemy\"`), monedas (`kind: \"coin\"`) y la meta (`kind: \"goal\"`).",
    "6. CONEXIÓN OBLIGATORIA CON EL EDITOR NORMAL Y RESPETO A LOS ASSETS PREDETERMINADOS DEL MOTOR: TODO lo que agregues o modifiques DEBE quedar conectado con el editor normal para que el usuario pueda seguir editándolo visualmente. Las entidades nuevas o editadas deben ir en `entitiesToAdd` o `entityUpdates` usando los assets predeterminados del motor (`KIND_PRESETS` con `texture: null` por defecto para que el editor y el runtime muestren exactamente los mismos gráficos predeterminados del motor, salvo que el usuario pida expresamente dibujar o cambiar una textura personalizada, en cuyo caso usa `texture` y `spritesToAdd`). No inventes botones duplicados de control táctil (`ui_btn_left`, `ui_btn_right`, `ui_btn_jump`, `ui_btn_restart`) en `uiToAdd` porque el motor ya incluye sus controles táctiles predeterminados (`touchControls: true`); usa `uiToAdd`/`uiUpdates` solo cuando el usuario pida elementos de interfaz personalizados, y los sonidos en `synthSounds`.",
    "7. Para nuevas mecánicas de juego, controles por teclado, proyectiles, poderes, física personalizada, lluvia/estrellas en canvas o lógica avanzada, escribe código JavaScript válido y completo en `customRuntimeJs` usando `window.AsternalRuntime.registerHook({ onInit(api), onTick(api, dt), onCollide(a, b, api), onRender(ctx, api), onRenderBackground(ctx, api, W, H), onRenderOverlay(ctx, api, W, H), onKeyDown(code, key, api), onKeyUp(code, key, api) })`, operando sobre las entidades reales de la escena para que sigan siendo editables en el editor normal.",
    "Conocimiento del motor Asternal:",
    ENGINE_KNOWLEDGE,
    "Estado actual del proyecto:",
    summarizeProjectForOrionArchitect(project),
    recentHistoryText ? `Contexto reciente de la conversación:\n${recentHistoryText}` : "",
    "Instrucción actual del creador para Orión:",
    userInstruction,
    `Devuelve ÚNICAMENTE un objeto JSON válido (sin texto fuera del JSON y sin bloques markdown):
{
  "reply": "Explicación en primera persona como Orión (con tilde) detallando los cambios reales aplicados y conectados con el editor.",
  "changesSummary": ["Cambio real 1", "Cambio real 2"],
  "projectTitle": "",
  "scenePatch": {},
  "settingsPatch": {},
  "replaceAllEntities": false,
  "entitiesToAdd": [],
  "entityUpdates": [],
  "entityIdsToRemove": [],
  "kindsToRemove": [],
  "uiToAdd": [],
  "spritesToAdd": [],
  "redistributeLayout": null,
  "synthSounds": {},
  "customRuntimeJs": "",
  "appendRuntimeJs": true
}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Redistribuye los recursos/entidades de la escena según un patrón geométrico limpio.
 */
export function redistributeSceneEntities(
  scene: Scene,
  layout: "spiral" | "stairs" | "grid" | "arc" | "symmetrical",
): Scene {
  const nextEntities = scene.entities.map((e) => ({ ...e }));
  const coins = nextEntities.filter((e) => e.kind === "coin" || e.collectible);
  const platforms = nextEntities.filter((e) => e.kind === "platform" && e.w < scene.width * 0.7);
  const cx = Math.round(scene.width * 0.5);
  const cy = Math.round(scene.height * 0.48);

  if (layout === "spiral") {
    coins.forEach((c, idx) => {
      const angle = idx * 0.65;
      const radius = 45 + idx * 18;
      c.x = Math.max(40, Math.min(scene.width - 60, Math.round(cx + Math.cos(angle) * radius)));
      c.y = Math.max(60, Math.min(scene.height - 140, Math.round(cy + Math.sin(angle) * radius * 0.7)));
    });
  } else if (layout === "arc") {
    const count = Math.max(1, coins.length);
    coins.forEach((c, idx) => {
      const t = count === 1 ? 0.5 : idx / (count - 1);
      c.x = Math.round(140 + t * (scene.width - 280));
      c.y = Math.round(scene.height - 180 - Math.sin(t * Math.PI) * 210);
    });
  } else if (layout === "stairs") {
    platforms.forEach((p, idx) => {
      p.x = Math.round(140 + idx * 150);
      p.y = Math.round(scene.height - 150 - idx * 65);
    });
    coins.forEach((c, idx) => {
      c.x = Math.round(160 + idx * 95);
      c.y = Math.round(scene.height - 200 - (idx % 5) * 55);
    });
  } else if (layout === "grid") {
    const cols = Math.max(3, Math.ceil(Math.sqrt(coins.length || 6)));
    coins.forEach((c, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      c.x = Math.round(180 + col * 72);
      c.y = Math.round(160 + row * 64);
    });
  } else if (layout === "symmetrical") {
    platforms.forEach((p, idx) => {
      const side = idx % 2 === 0 ? -1 : 1;
      const tier = Math.floor(idx / 2);
      p.x = Math.round(cx + side * (140 + tier * 110) - p.w / 2);
      p.y = Math.round(scene.height - 170 - tier * 80);
    });
    coins.forEach((c, idx) => {
      const side = idx % 2 === 0 ? -1 : 1;
      const step = Math.floor(idx / 2);
      c.x = Math.round(cx + side * (80 + step * 60) - c.w / 2);
      c.y = Math.round(scene.height - 220 - (step % 4) * 55);
    });
  }

  return { ...scene, entities: nextEntities };
}

function cleanRuntimeJsCode(rawCode: string): string {
  const cleaned = rawCode
    .trim()
    .replace(/^```(?:javascript|js|ts)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return "";
  try {
    // Verifica que el código JS generado por la IA tenga sintaxis válida
    new Function(cleaned);
    return cleaned;
  } catch {
    // Si hubiera algún bloque cercado interno, intenta extraerlo
    const match = /```(?:javascript|js)?\s*([\s\S]*?)```/i.exec(rawCode);
    if (match?.[1]) {
      try {
        new Function(match[1].trim());
        return match[1].trim();
      } catch {
        return "";
      }
    }
    return "";
  }
}

function normalizeAddedEntity(raw: Partial<Entity> & { kind?: EntityKind; type?: EntityKind }): Entity {
  const rawKind = (raw.kind ?? raw.type ?? "coin") as EntityKind;
  const kind: EntityKind = rawKind in KIND_PRESETS ? rawKind : "coin";
  const base = KIND_PRESETS[kind];
  const normalizedScripts: Script[] | undefined = raw.scripts
    ? normalizeScripts(raw.scripts)
    : undefined;
  return {
    ...base,
    ...raw,
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid(),
    kind,
    x: typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : 200,
    y: typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : 240,
    w: typeof raw.w === "number" && Number.isFinite(raw.w) ? Math.max(8, raw.w) : base.w,
    h: typeof raw.h === "number" && Number.isFinite(raw.h) ? Math.max(8, raw.h) : base.h,
    vx: typeof raw.vx === "number" && Number.isFinite(raw.vx) ? raw.vx : base.vx,
    vy: typeof raw.vy === "number" && Number.isFinite(raw.vy) ? raw.vy : base.vy,
    color: typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : base.color,
    scripts: normalizedScripts,
  };
}

/**
 * Aplica un parche estructurado (`OrionEditPatch`) sobre el proyecto actual y
 * recompila el documento HTML5 manteniendo sincronizados tanto el editor visual
 * como las extensiones de runtime HTML5.
 */
export function applyOrionPatchToProject(project: Project, patch: OrionEditPatch): Project {
  const activeScene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  if (!activeScene) return project;

  const { entities: scenePatchEntities, ui: scenePatchUi, ...scalarScenePatch } = patch.scenePatch ?? {};

  let nextScene: Scene = ensureSceneLayers({
    ...activeScene,
    ...scalarScenePatch,
    entities: Array.isArray(scenePatchEntities) && scenePatchEntities.length > 0
      ? scenePatchEntities.map((e) => normalizeAddedEntity(e))
      : activeScene.entities.map((e) => ({ ...e })),
    ui: Array.isArray(scenePatchUi)
      ? scenePatchUi.map((u) => ({ ...newUIElement(u.kind ?? "label"), ...u, id: u.id || uid() }))
      : (activeScene.ui ?? []).map((u) => ({ ...u })),
  });

  // Si la IA pidió reemplazar todas las entidades para construir un nivel nuevo
  if (patch.replaceAllEntities && Array.isArray(patch.entitiesToAdd) && patch.entitiesToAdd.length > 0) {
    const existingPlayer = nextScene.entities.find((e) => e.controllable || e.kind === "player");
    const addedHasPlayer = patch.entitiesToAdd.some(
      (e) => (e?.kind ?? e?.type) === "player" || e?.controllable === true,
    );
    nextScene.entities = addedHasPlayer || !existingPlayer ? [] : [existingPlayer];
  }

  // Eliminación por ID o nombre
  if (Array.isArray(patch.entityIdsToRemove) && patch.entityIdsToRemove.length > 0) {
    const rmSet = new Set(patch.entityIdsToRemove.map((s) => String(s).toLowerCase()));
    nextScene.entities = nextScene.entities.filter((e) => {
      if (e.controllable && nextScene.entities.filter((x) => x.controllable).length <= 1) return true;
      const byId = rmSet.has(e.id.toLowerCase());
      const byName = e.name ? rmSet.has(e.name.toLowerCase()) : false;
      return !byId && !byName;
    });
  }

  // Eliminación por tipo de entidad
  if (Array.isArray(patch.kindsToRemove) && patch.kindsToRemove.length > 0) {
    const rmKinds = new Set(patch.kindsToRemove);
    nextScene.entities = nextScene.entities.filter((e) => {
      if (e.kind === "player" || e.controllable) return true;
      return !rmKinds.has(e.kind);
    });
  }

  // Actualizaciones sobre entidades existentes (acepta campos en `patch` o en el nivel raíz del objeto)
  if (Array.isArray(patch.entityUpdates)) {
    for (const upd of patch.entityUpdates) {
      if (!upd || typeof upd !== "object") continue;
      const {
        id: targetId,
        name: targetName,
        targetKind,
        kind: updKind,
        patch: nestedPatch,
        scriptsToAdd,
        ...directFields
      } = upd;

      const effectiveTargetKind = targetKind ?? updKind;
      const combinedPatch: Partial<Entity> = {
        ...(directFields as Partial<Entity>),
        ...(nestedPatch ?? {}),
      };

      if (Object.keys(combinedPatch).length === 0 && !scriptsToAdd) continue;

      nextScene.entities = nextScene.entities.map((ent) => {
        const matchById = typeof targetId === "string" && targetId.trim() !== "" && ent.id === targetId;
        const matchByName =
          !matchById &&
          typeof targetName === "string" &&
          targetName.trim() !== "" &&
          ent.name?.toLowerCase() === targetName.trim().toLowerCase();
        const matchByKind =
          !targetId &&
          !targetName &&
          (effectiveTargetKind === "all" ||
            (effectiveTargetKind && ent.kind === effectiveTargetKind));

        if (!matchById && !matchByName && !matchByKind) return ent;

        let nextScripts = ent.scripts;
        if (combinedPatch.scripts) {
          nextScripts = normalizeScripts(combinedPatch.scripts);
        }
        if (Array.isArray(scriptsToAdd) && scriptsToAdd.length > 0) {
          nextScripts = [...(nextScripts ?? []), ...normalizeScripts(scriptsToAdd)];
        }

        const nextW =
          typeof combinedPatch.w === "number" && Number.isFinite(combinedPatch.w)
            ? Math.max(8, combinedPatch.w)
            : ent.w;
        const nextH =
          typeof combinedPatch.h === "number" && Number.isFinite(combinedPatch.h)
            ? Math.max(8, combinedPatch.h)
            : ent.h;

        // Si crece la altura de una entidad con gravedad y no se especificó `y`,
        // ajustamos `y` hacia arriba para que no quede enterrada en el suelo.
        let nextY =
          typeof combinedPatch.y === "number" && Number.isFinite(combinedPatch.y)
            ? combinedPatch.y
            : ent.y;
        if (combinedPatch.y === undefined && nextH > ent.h && (ent.gravity || ent.controllable)) {
          nextY = Math.max(0, ent.y - (nextH - ent.h));
        }

        return {
          ...ent,
          ...combinedPatch,
          id: ent.id,
          kind:
            combinedPatch.kind && combinedPatch.kind in KIND_PRESETS
              ? combinedPatch.kind
              : ent.kind,
          w: nextW,
          h: nextH,
          y: nextY,
          scripts: nextScripts,
        };
      });
    }
  }

  // Adición de nuevas entidades
  if (Array.isArray(patch.entitiesToAdd)) {
    for (const raw of patch.entitiesToAdd) {
      if (!raw || typeof raw !== "object") continue;
      const created = normalizeAddedEntity(raw);
      // Si ya existe un jugador controlable y la IA añade otro "player" sin replaceAllEntities,
      // actualizamos el jugador existente para evitar dos jugadores duplicados.
      const existingPlayerIdx =
        created.kind === "player" && !patch.replaceAllEntities
          ? nextScene.entities.findIndex((e) => e.controllable || e.kind === "player")
          : -1;
      if (existingPlayerIdx >= 0) {
        const prevPlayer = nextScene.entities[existingPlayerIdx];
        nextScene.entities[existingPlayerIdx] = {
          ...prevPlayer,
          ...raw,
          id: prevPlayer.id,
          kind: "player",
          controllable: true,
          w: typeof raw.w === "number" ? Math.max(8, raw.w) : prevPlayer.w,
          h: typeof raw.h === "number" ? Math.max(8, raw.h) : prevPlayer.h,
          scripts: raw.scripts
            ? [...(prevPlayer.scripts ?? []), ...normalizeScripts(raw.scripts)]
            : prevPlayer.scripts,
        };
      } else {
        const existingIdIdx = nextScene.entities.findIndex((e) => e.id === created.id);
        if (existingIdIdx >= 0) {
          nextScene.entities[existingIdIdx] = { ...nextScene.entities[existingIdIdx], ...created };
        } else {
          nextScene.entities.push(created);
        }
      }
    }
  }

  // Operaciones sobre elementos de interfaz (UI)
  if (Array.isArray(patch.uiIdsToRemove) && patch.uiIdsToRemove.length > 0) {
    const rmUi = new Set(patch.uiIdsToRemove);
    nextScene.ui = (nextScene.ui ?? []).filter((u) => !rmUi.has(u.id));
  }
  if (Array.isArray(patch.uiUpdates) && patch.uiUpdates.length > 0) {
    for (const upd of patch.uiUpdates) {
      if (!upd || typeof upd !== "object") continue;
      const { id, name, patch: uiPatch, ...rest } = upd;
      const mergedUiPatch = { ...(rest as Partial<UIElement>), ...(uiPatch ?? {}) };
      nextScene.ui = (nextScene.ui ?? []).map((u) => {
        if ((id && u.id === id) || (name && u.name?.toLowerCase() === name.toLowerCase())) {
          return { ...u, ...mergedUiPatch, id: u.id };
        }
        return u;
      });
    }
  }
  if (Array.isArray(patch.uiToAdd) && patch.uiToAdd.length > 0) {
    const currentUi = [...(nextScene.ui ?? [])];
    for (const rawUi of patch.uiToAdd) {
      if (!rawUi || typeof rawUi !== "object") continue;
      const baseUi = newUIElement(rawUi.kind ?? "label");
      const targetId = typeof rawUi.id === "string" && rawUi.id.trim() ? rawUi.id.trim() : "";
      const existingIdx = targetId ? currentUi.findIndex((u) => u.id === targetId) : -1;
      if (existingIdx >= 0) {
        currentUi[existingIdx] = {
          ...currentUi[existingIdx],
          ...rawUi,
          id: currentUi[existingIdx].id,
        };
      } else {
        currentUi.push({
          ...baseUi,
          ...rawUi,
          id: targetId || uid(),
        });
      }
    }
    nextScene.ui = currentUi;
  }

  if (patch.redistributeLayout) {
    nextScene = redistributeSceneEntities(nextScene, patch.redistributeLayout);
  }

  nextScene = ensureSceneLayers(nextScene);

  const prevRuntime = project.customRuntime ?? {};
  let nextJs = prevRuntime.jsCode ?? "";
  if (typeof patch.customRuntimeJs === "string" && patch.customRuntimeJs.trim()) {
    const incoming = cleanRuntimeJsCode(patch.customRuntimeJs);
    if (incoming) {
      if (patch.appendRuntimeJs !== false && nextJs.trim() && !nextJs.includes(incoming)) {
        nextJs = `${nextJs.trim()}\n\n${incoming}`;
      } else {
        nextJs = incoming;
      }
    }
  }

  const nextCss =
    typeof patch.customCss === "string"
      ? patch.customCss
      : prevRuntime.cssCode ?? "";

  const nextSynthSounds: Record<string, CustomSoundSynth> = {
    ...(prevRuntime.synthSounds ?? {}),
    ...(patch.synthSounds ?? {}),
  };

  const updatedProject: Project = {
    ...project,
    name: patch.projectTitle?.trim() || project.name,
    scenes: project.scenes.map((s) => (s.id === nextScene.id ? nextScene : s)),
    settings: {
      ...project.settings,
      ...(patch.settingsPatch ?? {}),
    },
    customRuntime: {
      ...prevRuntime,
      jsCode: nextJs,
      cssCode: nextCss,
      synthSounds: nextSynthSounds,
      customHtmlOverride: null,
    },
  };

  return syncRuntimeAndTexturesToProject(updatedProject, patch.spritesToAdd);
}

/**
 * Constructor programático de parches para pruebas unitarias y utilidades rápidas del motor.
 */
export function buildOrionIntelligentPatch(instruction: string, project: Project): OrionEditPatch {
  const text = instruction.toLowerCase();
  const scene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  const changesSummary: string[] = [];
  const jsSnippets: string[] = [];
  const synthSounds: Record<string, CustomSoundSynth> = {};
  const entitiesToAdd: Array<Partial<Entity> & { kind?: EntityKind }> = [];
  const entityUpdates: OrionEditPatch["entityUpdates"] = [];
  const scenePatch: OrionEditPatch["scenePatch"] = {};
  const settingsPatch: Partial<ProjectSettings> = {};
  let redistributeLayout: OrionEditPatch["redistributeLayout"] = null;

  if (/(dash|impulso|esquivar|estela|velocidad turbo)/i.test(text)) {
    synthSounds.dash = { name: "dash", wave: "triangle", freq: 190, endFreq: 720, duration: 0.14, volume: 0.4 };
    jsSnippets.push(`// [Orión] Mecánica de Dash con estela luminosa y sonido (Shift o tecla X)
(function() {
  var dashCooldown = 0;
  var dashTimer = 0;
  var dashTrail = [];
  window.AsternalRuntime.registerHook({
    onKeyDown: function(code, key, api) {
      if ((code === "ShiftLeft" || code === "ShiftRight" || code === "KeyX" || key === "x" || key === "X") && dashCooldown <= 0) {
        var p = api.getPlayer();
        if (!p) return;
        var dir = p.facing === -1 ? -1 : 1;
        p.vx = dir * 680;
        p.vy = 0;
        dashTimer = 0.18;
        dashCooldown = 0.55;
        api.playSound("synth:dash");
        api.emitBurst(p.x + p.w / 2, p.y + p.h / 2, "#38bdf8", 12);
      }
    },
    onTick: function(api, dt) {
      if (dashCooldown > 0) dashCooldown = Math.max(0, dashCooldown - dt);
      var p = api.getPlayer();
      if (dashTimer > 0 && p) {
        dashTimer = Math.max(0, dashTimer - dt);
        dashTrail.push({ x: p.x, y: p.y, w: p.w, h: p.h, life: 0.22 });
      }
      for (var i = dashTrail.length - 1; i >= 0; i--) {
        dashTrail[i].life -= dt;
        if (dashTrail[i].life <= 0) dashTrail.splice(i, 1);
      }
    },
    onRender: function(ctx) {
      for (var i = 0; i < dashTrail.length; i++) {
        var t = dashTrail[i];
        ctx.save();
        ctx.globalAlpha = Math.max(0, t.life * 2.2);
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.restore();
      }
    }
  });
})();`);
    changesSummary.push("Nueva lógica HTML5: Dash con estela visual y sonido sintetizado (tecla Shift o X)");
  }

  if (/(dispar|proyectil|laser|láser|bala|arma|ataque)/i.test(text)) {
    synthSounds.laser = { name: "laser", wave: "sawtooth", freq: 820, endFreq: 150, duration: 0.16, volume: 0.32 };
    synthSounds.explosion = { name: "explosion", wave: "sawtooth", freq: 140, endFreq: 35, duration: 0.34, volume: 0.42 };
    jsSnippets.push(`// [Orión] Sistema de proyectiles láser en el runtime HTML5 (tecla Z o F)
(function() {
  var bullets = [];
  var fireCooldown = 0;
  window.AsternalRuntime.registerHook({
    onKeyDown: function(code, key, api) {
      if ((code === "KeyZ" || code === "KeyF" || key === "z" || key === "f") && fireCooldown <= 0) {
        var p = api.getPlayer();
        if (!p) return;
        var dir = p.facing === -1 ? -1 : 1;
        bullets.push({
          x: dir > 0 ? p.x + p.w + 4 : p.x - 16,
          y: p.y + p.h * 0.42,
          vx: dir * 640,
          w: 14,
          h: 6,
          life: 1.4
        });
        fireCooldown = 0.2;
        api.playSound("synth:laser");
      }
    },
    onTick: function(api, dt) {
      if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - dt);
      var enemies = api.getEntities("enemy");
      for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i];
        b.x += b.vx * dt;
        b.life -= dt;
        var hit = false;
        for (var j = 0; j < enemies.length; j++) {
          var en = enemies[j];
          if (b.x < en.x + en.w && b.x + b.w > en.x && b.y < en.y + en.h && b.y + b.h > en.y) {
            en.x = -99999;
            api.addScore(25);
            api.emitBurst(b.x, b.y, "#f43f5e", 16);
            api.playSound("synth:explosion");
            api.shake(6, 0.18);
            hit = true;
            break;
          }
        }
        if (hit || b.life <= 0) bullets.splice(i, 1);
      }
    },
    onRender: function(ctx) {
      ctx.save();
      ctx.fillStyle = "#38bdf8";
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 10;
      for (var i = 0; i < bullets.length; i++) {
        var b = bullets[i];
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      ctx.restore();
    }
  });
})();`);
    changesSummary.push("Nueva lógica HTML5: Disparo de proyectiles láser (tecla Z o F) con colisión y explosión");
  }

  if (/(redistribu|reorganiz|distribu|espiral|escalera|arco|cuadrícula|grid|simétric|simetric|ordenar)/i.test(text)) {
    if (/espiral/i.test(text)) redistributeLayout = "spiral";
    else if (/escalera/i.test(text)) redistributeLayout = "stairs";
    else if (/(cuadrícula|grid|rejilla)/i.test(text)) redistributeLayout = "grid";
    else if (/sim[eé]tric/i.test(text)) redistributeLayout = "symmetrical";
    else redistributeLayout = "arc";
    changesSummary.push(`Distribución de assets actualizada en el HTML5 (patrón: ${redistributeLayout})`);
  }

  if (/(sonido|audio|sfx|efectos de sonido|música|musica|sonoriz)/i.test(text)) {
    synthSounds.jump = { name: "jump", wave: "sine", freq: 240, endFreq: 560, duration: 0.15, volume: 0.35 };
    synthSounds.coin = { name: "coin", wave: "sine", freq: 587, endFreq: 1175, duration: 0.18, volume: 0.38 };
    changesSummary.push("Sintetizador WebAudio activado en HTML5");
  }

  if (/(jefe|boss|enemigo|patrulla|perseguir)/i.test(text) && scene) {
    entitiesToAdd.push({
      kind: "enemy",
      name: "Jefe Orión",
      x: Math.min(scene.width - 180, 620),
      y: Math.max(120, scene.height - 220),
      w: 64,
      h: 64,
      vx: 95,
      color: "#f43f5e",
      patrol: { range: 160, ledgeSafe: true },
    });
    changesSummary.push("Nuevo enemigo añadido a la escena");
  }

  return {
    reply: `Soy Orión. He actualizado el archivo HTML5 de tu juego aplicando: ${changesSummary.join("; ") || "edición en el runtime HTML5"}.`,
    changesSummary,
    scenePatch: Object.keys(scenePatch).length > 0 ? scenePatch : undefined,
    settingsPatch: Object.keys(settingsPatch).length > 0 ? settingsPatch : undefined,
    entitiesToAdd: entitiesToAdd.length > 0 ? entitiesToAdd : undefined,
    entityUpdates: entityUpdates.length > 0 ? entityUpdates : undefined,
    redistributeLayout,
    synthSounds: Object.keys(synthSounds).length > 0 ? synthSounds : undefined,
    customRuntimeJs: jsSnippets.join("\n\n"),
    appendRuntimeJs: true,
  };
}

/**
 * Ejecuta una petición de edición de juego con la Inteligencia Artificial real de Orión:
 * 1. Consulta el endpoint del servidor `/api/orion/edit-game` (respaldado por `@google/genai` Gemini 3.8 Flash).
 * 2. Si el servidor no está accesible en el entorno actual, consulta directamente el servicio Gemini (`geminiChat`) con una sesión limpia.
 * 3. Aplica el parche devuelto por la IA sobre las escenas, entidades, scripts, sonidos y runtime HTML5 del proyecto.
 */
export async function runOrionGameEdit(args: {
  instruction: string;
  project: Project;
  currentHtml?: string;
  signal?: AbortSignal;
}): Promise<OrionEditResult> {
  const { instruction, signal } = args;
  const trimmed = instruction.trim();
  if (!trimmed) {
    throw new Error("Escribe una instrucción para que Orión edite el juego.");
  }

  // Si el usuario editó antes el HTML manualmente, partimos del proyecto sincronizado
  let workingProject = args.project;
  if (args.currentHtml?.trim()) {
    try {
      workingProject = syncHtmlToProject(args.currentHtml, workingProject);
    } catch {
      /* conserva workingProject */
    }
  }

  const recentHistoryText = (workingProject.customRuntime?.orionHistory ?? [])
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Orión" : "Creador"}: ${m.content}`)
    .join("\n");

  let aiPatch: OrionEditPatch | null = null;
  let modelUsed = "Orión · Gemini";
  let lastError: Error | null = null;

  // 1) Consultar el servidor real de Orión (/api/orion/edit-game con @google/genai)
  try {
    const serverResp = await fetch("/api/orion/edit-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: trimmed,
        projectSummary: summarizeProjectForOrionArchitect(workingProject),
        recentHistory: recentHistoryText,
      }),
      signal,
    });
    const contentType = serverResp.headers.get("content-type") ?? "";
    if (serverResp.ok && contentType.includes("application/json")) {
      const data = (await serverResp.json()) as { patch?: OrionEditPatch; model?: string; error?: string };
      if (data?.patch && typeof data.patch === "object") {
        aiPatch = data.patch;
        modelUsed = data.model ? `Orión · ${data.model}` : "Orión · Gemini 3.8 Flash";
      }
    } else if (!serverResp.ok && contentType.includes("application/json")) {
      const errData = (await serverResp.json().catch(() => null)) as { error?: string } | null;
      if (errData?.error) lastError = new Error(errData.error);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof Error) lastError = err;
  }

  // 2) Si el endpoint de servidor no estuvo disponible, llamar directamente a Gemini (geminiChat) con un turno único limpio
  if (!aiPatch) {
    try {
      const prompt = buildOrionArchitectPrompt(trimmed, workingProject, recentHistoryText);
      const res = await geminiChat([{ role: "user", content: prompt }], {
        sessionId: `orion-edit-${uid()}`,
        signal,
      });
      const parsed = parseAiJson<OrionEditPatch>(res.text);
      if (parsed && typeof parsed === "object") {
        aiPatch = parsed;
        modelUsed = `Orión · ${res.model}`;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof Error) lastError = err;
    }
  }

  if (!aiPatch) {
    throw lastError ?? new Error("No se pudo conectar con la inteligencia artificial de Orión. Inténtalo de nuevo.");
  }

  // Si la IA pidió además patrones complementarios (como sonidos o redistribución) pero dejó vacío algún detalle técnico,
  // respetamos íntegramente lo que decidió la IA en `aiPatch`.
  const updatedProject = applyOrionPatchToProject(workingProject, aiPatch);

  const rawReply = typeof aiPatch.reply === "string" ? aiPatch.reply.trim() : "";
  const replyText = rawReply
    ? rawReply.includes("Orión")
      ? rawReply
      : `Soy Orión. ${rawReply}`
    : "Soy Orión. He aplicado las modificaciones directamente en tu juego y en su archivo HTML5.";

  const summaryList =
    Array.isArray(aiPatch.changesSummary) && aiPatch.changesSummary.length > 0
      ? aiPatch.changesSummary.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : ["Juego y documento HTML5 actualizados por Orión"];

  const userMsg: OrionHistoryItem = {
    id: uid(),
    role: "user",
    content: trimmed,
    createdAt: Date.now(),
  };
  const assistantMsg: OrionHistoryItem = {
    id: uid(),
    role: "assistant",
    content: replyText,
    summary: summaryList,
    createdAt: Date.now() + 1,
  };

  const prevHistory = updatedProject.customRuntime?.orionHistory ?? [];
  const finalProject: Project = {
    ...updatedProject,
    customRuntime: {
      ...(updatedProject.customRuntime ?? {}),
      orionHistory: [...prevHistory, userMsg, assistantMsg].slice(-40),
    },
  };

  const html = buildProjectGameHtml(finalProject, true);
  parseStandaloneGameHtml(html);

  return {
    project: finalProject,
    html,
    reply: replyText,
    changesSummary: summaryList,
    modelUsed,
  };
}
