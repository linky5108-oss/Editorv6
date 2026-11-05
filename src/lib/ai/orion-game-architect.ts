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
import { getProjectAudioLibrary } from "@/lib/engine/audio-library";
import { normalizeScripts, type Script } from "@/lib/engine/scripts";
import {
  buildUserLanguagePromptContext,
  compileUserLanguageLocally,
  loadUserLanguage,
  mergeCompiledProgramsIntoRuntimeJs,
  saveUserLanguageToStorage,
  type CustomLanguageProgram,
} from "./custom-language";
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
  const audioLibrary = getProjectAudioLibrary(project);

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
      audioAssetsRegistered: audioLibrary.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
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
  const userLang = loadUserLanguage(project);
  return [
    "Eres Orión (SIEMPRE escrito con tilde: Orión), el asistente y traductor de lenguaje de programación mediante inteligencia artificial de Asternal.",
    "Tu misión es MODIFICAR REALMENTE el juego y TRADUCIR el lenguaje de programación inventado por el usuario en código JavaScript/HTML5 funcional y bloques del motor. Puedes modificar escenas, colores, gravedad, entidades (jugador, plataformas, enemigos, monedas, meta, decoración), scripts de bloques, interfaz UI, sonidos sintetizados WebAudio y programar cualquier mecánica nueva en JavaScript dentro del runtime HTML5 (`window.AsternalRuntime.registerHook` y `window.AsternalAudio`).",
    "REGLAS ESTRICTAS DE EDICIÓN Y TRADUCCIÓN DE LENGUAJE PROPIO:",
    "1. NUNCA respondas solo con texto: SIEMPRE debes incluir los cambios reales en los campos JSON (`scenePatch`, `entitiesToAdd`, `entityUpdates`, `entityIdsToRemove`, `kindsToRemove`, `replaceAllEntities`, `uiToAdd`, `redistributeLayout`, `synthSounds` o `customRuntimeJs`) para que el juego cambie de verdad.",
    "2. En la escena activa, y=0 es la parte superior y y=height (normalmente 700) es el fondo. El suelo suele estar en y=500..640.",
    "3. Para cambiar tamaño, color, posición, velocidad o propiedades de objetos existentes (como el jugador, plataformas, enemigos o monedas), usa `entityUpdates`: [{ \"targetKind\": \"player\", \"patch\": { \"w\": 64, \"h\": 84, \"color\": \"#ef4444\" } }] o indica el `id` exacto del objeto.",
    "4. Para agregar nuevos objetos al mapa (enemigos, plataformas, monedas, jefes, trampas, decoración), usa `entitiesToAdd`: [{ \"kind\": \"enemy\", \"name\": \"Enemigo\", \"x\": 450, \"y\": 440, \"w\": 44, \"h\": 44, \"vx\": 90, \"color\": \"#f43f5e\", \"patrol\": { \"range\": 140, \"ledgeSafe\": true } }].",
    "5. Si el usuario pide crear un nivel nuevo desde cero o rehacer todo el mapa, pon `\"replaceAllEntities\": true` y define en `entitiesToAdd` el jugador (`kind: \"player\"`), las plataformas de suelo y aéreas (`kind: \"platform\"`), enemigos (`kind: \"enemy\"`), monedas (`kind: \"coin\"`) y la meta (`kind: \"goal\"`).",
    "6. CONEXIÓN OBLIGATORIA CON EL EDITOR NORMAL Y RESPETO A LOS ASSETS PREDETERMINADOS DEL MOTOR: TODO lo que agregues o modifiques DEBE quedar conectado con el editor normal para que el usuario pueda seguir editándolo visualmente. Las entidades nuevas o editadas deben ir en `entitiesToAdd` o `entityUpdates` usando los assets predeterminados del motor (`KIND_PRESETS` con `texture: null` por defecto para que el editor y el runtime muestren exactamente los mismos gráficos predeterminados del motor, salvo que el usuario pida expresamente dibujar o cambiar una textura personalizada, en cuyo caso usa `texture` y `spritesToAdd`). No inventes botones duplicados de control táctil (`ui_btn_left`, `ui_btn_right`, `ui_btn_jump`, `ui_btn_restart`) en `uiToAdd` porque el motor ya incluye sus controles táctiles predeterminados (`touchControls: true`); usa `uiToAdd`/`uiUpdates` solo cuando el usuario pida elementos de interfaz personalizados, y los sonidos en `synthSounds`.",
    "7. Para nuevas mecánicas de juego, controles por teclado, proyectiles, poderes, física personalizada, lluvia/estrellas en canvas o lógica avanzada, escribe código JavaScript válido y completo en `customRuntimeJs` usando `window.AsternalRuntime.registerHook({ onInit(api), onTick(api, dt), onCollide(a, b, api), onRender(ctx, api), onRenderBackground(ctx, api, W, H), onRenderOverlay(ctx, api, W, H), onKeyDown(code, key, api), onKeyUp(code, key, api) })`, operando sobre las entidades reales de la escena para que sigan siendo editables en el editor normal.",
    "8. TRADUCTOR DE LENGUAJE PROPIO DEL USUARIO: Cuando el usuario escriba instrucciones en su propio lenguaje inventado (por ejemplo: `SI el jugador pierde:\\nMOSTRAR sonido en el mapa`), comprende su intención usando el diccionario y las reglas de su lenguaje, genera el código JavaScript/HTML5 ejecutable en `customRuntimeJs` y añade también los `scriptsToAdd` equivalentes en `entityUpdates` (por ejemplo sobre `targetKind: \"player\"`).",
    buildUserLanguagePromptContext(userLang, userInstruction),
    "Conocimiento del motor Asternal:",
    ENGINE_KNOWLEDGE,
    "Estado actual del proyecto:",
    summarizeProjectForOrionArchitect(project),
    recentHistoryText ? `Contexto reciente de la conversación:\n${recentHistoryText}` : "",
    "Instrucción o código actual del creador para Orión:",
    userInstruction,
    `Devuelve ÚNICAMENTE un objeto JSON válido (sin texto fuera del JSON y sin bloques markdown):
{
  "reply": "Explicación en primera persona como Orión (con tilde) detallando cómo tradujiste su lenguaje/instrucción a código JavaScript/HTML5 y bloques del motor.",
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

function repairMangledRuntimeJs(code: string): string {
  let next = code
    .replace(/!>\s*>\s*/g, "!== ")
    .replace(/>\s*>\s*>\s*/g, "=== ")
    .replace(/!>\s+/g, "!= ")
    .replace(/<>\s*/g, "<= ")
    .replace(/\+>\s*/g, "+= ")
    .replace(/->\s*/g, "-= ")
    .replace(/\*>\s*/g, "*= ")
    .replace(/\/>\s*/g, "/= ")
    .replace(/(\))\s*>\s*>/g, "$1 =>")
    .replace(/([a-zA-Z_$][\w$]*)\s*>\s*>\s*(\{)/g, "$1 => $2")
    .replace(/>\s*>\s*/g, ">= ")
    .replace(/\b(const|let|var)\s+([a-zA-Z_$][\w$]*)\s*>\s+/g, "$1 $2 = ")
    .replace(
      /(^|[;\n{)]\s*)([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\[[^\]]+\])*)\s*>\s+/gm,
      "$1$2 = ",
    );
  next = next.replace(
    /(=\s*)([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\[[^\]]+\])*)\s*>\s+/g,
    "$1$2 = ",
  );
  return next;
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
    const repaired = repairMangledRuntimeJs(cleaned);
    try {
      new Function(repaired);
      return repaired;
    } catch {
      // Si hubiera algún bloque cercado interno, intenta extraerlo
      const match = /```(?:javascript|js)?\s*([\s\S]*?)```/i.exec(rawCode);
      if (match?.[1]) {
        const inner = match[1].trim();
        for (const candidate of [inner, repairMangledRuntimeJs(inner)]) {
          try {
            new Function(candidate);
            return candidate;
          } catch {
            /* intenta siguiente candidato */
          }
        }
      }
      return "";
    }
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
    const existingGoal = nextScene.entities.find((e) => e.goal === true);
    const addedHasPlayer = patch.entitiesToAdd.some(
      (e) => (e?.kind ?? e?.type) === "player" || e?.controllable === true,
    );
    const addedHasGoal = patch.entitiesToAdd.some((e) => e?.goal === true);
    nextScene.entities = [
      ...(!addedHasPlayer && existingPlayer ? [existingPlayer] : []),
      ...(!addedHasGoal && existingGoal ? [existingGoal] : []),
    ];
  }

  // Eliminación por ID o nombre
  if (Array.isArray(patch.entityIdsToRemove) && patch.entityIdsToRemove.length > 0) {
    const rmSet = new Set(patch.entityIdsToRemove.map((s) => String(s).toLowerCase()));
    nextScene.entities = nextScene.entities.filter((e) => {
      if (e.controllable && nextScene.entities.filter((x) => x.controllable).length <= 1) return true;
      if (e.goal && nextScene.entities.filter((x) => x.goal).length <= 1) return true;
      const byId = rmSet.has(e.id.toLowerCase());
      const byName = e.name ? rmSet.has(e.name.toLowerCase()) : false;
      return !byId && !byName;
    });
  }

  // Eliminación por tipo de entidad
  if (Array.isArray(patch.kindsToRemove) && patch.kindsToRemove.length > 0) {
    const rmKinds = new Set(patch.kindsToRemove);
    nextScene.entities = nextScene.entities.filter((e) => {
      if (e.kind === "player" || e.controllable || e.goal) return true;
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

  // Vincular cualquier bloque playMusic / playSound con los assets reales de la biblioteca de Ajustes
  const audioLib = getProjectAudioLibrary(project);
  if (audioLib.length > 0) {
    const resolveAudioAsset = (ref?: string) => {
      if (!ref) return null;
      const clean = ref.trim();
      if (!clean) return null;
      const lower = clean.toLowerCase();
      return (
        audioLib.find(
          (a) =>
            a.id === clean ||
            a.url === clean ||
            a.name.trim().toLowerCase() === lower ||
            lower.includes(a.name.trim().toLowerCase()),
        ) ?? null
      );
    };

    nextScene.entities = nextScene.entities.map((ent) => {
      if (!ent.scripts || ent.scripts.length === 0) return ent;
      return {
        ...ent,
        scripts: ent.scripts.map((sc) => ({
          ...sc,
          blocks: sc.blocks.map((b) => {
            if (b.kind !== "playMusic" && b.kind !== "playSound") return b;
            const match =
              resolveAudioAsset(b.soundUrl) ||
              resolveAudioAsset(b.soundName) ||
              resolveAudioAsset(b.text);
            if (!match) return b;
            return {
              ...b,
              soundUrl: match.url,
              soundName: match.name,
              text: match.name,
            };
          }),
        })),
      };
    });
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

const NAMED_COLORS_HEX: Array<{ rx: RegExp; hex: string; label: string }> = [
  { rx: /\b(rojo|roja|red|carmesi|escarlata)\b/i, hex: "#ef4444", label: "rojo (#ef4444)" },
  { rx: /\b(verde|green|esmeralda|lima)\b/i, hex: "#22c55e", label: "verde (#22c55e)" },
  { rx: /\b(azul|blue|celeste|cian|cyan|turquesa)\b/i, hex: "#38bdf8", label: "azul (#38bdf8)" },
  { rx: /\b(amarillo|amarilla|yellow|dorado|oro|gold)\b/i, hex: "#facc15", label: "amarillo (#facc15)" },
  { rx: /\b(morado|morada|violeta|purpura|púrpura|purple)\b/i, hex: "#a855f7", label: "morado (#a855f7)" },
  { rx: /\b(rosa|rosado|pink|magenta|fucsia)\b/i, hex: "#ec4899", label: "rosa (#ec4899)" },
  { rx: /\b(naranja|anaranjado|orange|ambar|ámbar)\b/i, hex: "#f97316", label: "naranja (#f97316)" },
  { rx: /\b(blanco|blanca|white|nieve)\b/i, hex: "#f8fafc", label: "blanco (#f8fafc)" },
  { rx: /\b(negro|negra|black|oscuro|oscura|noche)\b/i, hex: "#0f172a", label: "oscuro (#0f172a)" },
];

function detectColorFromInstruction(text: string): { hex: string; label: string } | null {
  const hexMatch = text.match(/#[0-9a-fA-F]{3,6}\b/);
  if (hexMatch) {
    return { hex: hexMatch[0], label: hexMatch[0] };
  }
  for (const item of NAMED_COLORS_HEX) {
    if (item.rx.test(text)) return item;
  }
  return null;
}

/**
 * Constructor programático de parches que edita verdaderamente el `Project`
 * (escena, entidades, propiedades físicas, niveles y scripts HTML5 independientes).
 */
export function buildOrionIntelligentPatch(
  instruction: string,
  project: Project,
  targetEntityId?: string | null,
): OrionEditPatch {
  const text = instruction.toLowerCase();
  const scene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  const sceneW = scene?.width || 1200;
  const sceneH = scene?.height || 660;
  const groundY = Math.max(240, sceneH - 120);

  const changesSummary: string[] = [];
  const jsSnippets: string[] = [];
  const synthSounds: Record<string, CustomSoundSynth> = {};
  const entitiesToAdd: Array<Partial<Entity> & { kind?: EntityKind }> = [];
  const entityUpdates: NonNullable<OrionEditPatch["entityUpdates"]> = [];
  const kindsToRemove: EntityKind[] = [];
  const scenePatch: NonNullable<OrionEditPatch["scenePatch"]> = {};
  const settingsPatch: Partial<ProjectSettings> = {};
  let replaceAllEntities = false;
  let redistributeLayout: OrionEditPatch["redistributeLayout"] = null;

  const targetEnt =
    (targetEntityId && targetEntityId !== "scene"
      ? scene?.entities.find((e) => e.id === targetEntityId)
      : null) ?? null;

  const inferredTargetKind: EntityKind = targetEnt
    ? targetEnt.kind
    : /\b(jugador|personaje|protagonista|player|h[eé]roe)\b/i.test(text)
    ? "player"
    : /\b(enemigo|enemigos|enemy|enemies|jefe|boss|monstruo)\b/i.test(text)
    ? "enemy"
    : /\b(plataforma|plataformas|suelo|piso|bloque|pared|muro|trampolin|trampolín)\b/i.test(text)
    ? "platform"
    : /\b(moneda|monedas|coin|coins|tesoro|gema|estrella)\b/i.test(text)
    ? "coin"
    : /\b(meta|bandera|goal|puerta|salida)\b/i.test(text)
    ? "goal"
    : "player";

  // 1. Edición real de propiedades de la Escena (fondo, gravedad, vidas, tiempo)
  if (/\b(fondo|background|cielo|ambiente|escenario)\b/i.test(text)) {
    const bgSegment = text.match(/\b(?:fondo|background|cielo|ambiente|escenario)\s+([^,.]+)/i)?.[1] ?? text;
    const col =
      !/\b(jugador|enemigo|plataforma|moneda)\b/i.test(bgSegment)
        ? detectColorFromInstruction(bgSegment)
        : null;
    if (/espaci|estrell|nocturn|noche/i.test(bgSegment)) {
      scenePatch.bg = "#050816";
      changesSummary.push("Fondo de la escena cambiado a noche espacial (#050816)");
    } else if (/lava|infierno|fuego|volcan|volcán/i.test(bgSegment)) {
      scenePatch.bg = "#2a0808";
      changesSummary.push("Fondo de la escena cambiado a volcán (#2a0808)");
    } else if (/bosque|selva|naturaleza/i.test(bgSegment)) {
      scenePatch.bg = "#062c1b";
      changesSummary.push("Fondo de la escena cambiado a bosque (#062c1b)");
    } else if (/atardecer|ocaso|tarde/i.test(bgSegment)) {
      scenePatch.bg = "#3b1d14";
      changesSummary.push("Fondo de la escena cambiado a atardecer (#3b1d14)");
    } else if (col) {
      scenePatch.bg = col.hex;
      changesSummary.push(`Fondo de la escena actualizado a ${col.label}`);
    }
  }

  if (/\b(gravedad|gravity|lunar|ingravidez)\b/i.test(text)) {
    const gravNum = text.match(/gravedad\s*(?:=|:|a|de)?\s*(-?\d+(?:\.\d+)?)/i);
    if (gravNum) {
      scenePatch.gravity = Math.max(-2500, Math.min(3500, Number(gravNum[1])));
    } else if (/sin\s+gravedad|gravedad\s+cero|ingravidez| flotar/i.test(text)) {
      scenePatch.gravity = 0;
    } else if (/lunar|baja|poca|suave|lenta/i.test(text)) {
      scenePatch.gravity = 460;
    } else if (/alta|fuerte|pesada|doble|mucha/i.test(text)) {
      scenePatch.gravity = 2200;
    } else if (/invertir|inversa|negativa|techo/i.test(text)) {
      scenePatch.gravity = -900;
    } else {
      scenePatch.gravity = 900;
    }
    changesSummary.push(`Gravedad de la escena editada a ${scenePatch.gravity}`);
  }

  const livesMatch =
    text.match(/(\d+)\s*vidas?\b/i) || text.match(/\bvidas?\s*(?:=|:|a|de)?\s*(\d+)/i);
  if (livesMatch) {
    const lives = Math.max(1, Math.min(99, Number(livesMatch[1])));
    scenePatch.startLives = lives;
    changesSummary.push(`Vidas iniciales del proyecto editadas a ${lives}`);
  }

  const timeMatch =
    text.match(/tiempo(?:\s+l[ií]mite)?\s*(?:=|:|a|de)?\s*(\d+)/i) ||
    text.match(/(\d+)\s*segundos\s+de\s+tiempo/i);
  if (timeMatch) {
    const secs = Math.max(0, Math.min(3600, Number(timeMatch[1])));
    scenePatch.timeLimit = secs;
    changesSummary.push(`Tiempo límite de la escena editado a ${secs}s`);
  }

  // 2. Creación de un nivel nuevo completo o reconstrucción del mapa
  if (/(crear?\s+(?:un\s+)?nivel|nuevo\s+nivel|rehacer\s+(?:el\s+)?(?:mapa|nivel)|transforma\s+la\s+escena\s+en\s+un\s+nivel)/i.test(text) && scene) {
    replaceAllEntities = true;
    const isSpace = /espaci|lunar|estrell|nocturn/i.test(text);
    const isLava = /lava|fuego|infierno/i.test(text);
    scenePatch.bg = isSpace ? "#050816" : isLava ? "#2a0808" : scenePatch.bg || "#0b1e3f";
    if (isSpace && scenePatch.gravity === undefined) scenePatch.gravity = 520;

    entitiesToAdd.push(
      {
        kind: "player",
        name: "Jugador",
        x: 90,
        y: groundY - 64,
        w: 40,
        h: 56,
        color: "#38bdf8",
        controllable: true,
        gravity: true,
        solid: true,
      },
      {
        kind: "platform",
        name: "Suelo Principal",
        x: 40,
        y: groundY,
        w: Math.round(sceneW * 0.42),
        h: 36,
        color: isLava ? "#7f1d1d" : "#1e3a8a",
        solid: true,
      },
      {
        kind: "platform",
        name: "Plataforma Móvil",
        x: Math.round(sceneW * 0.48),
        y: groundY - 90,
        w: 170,
        h: 26,
        color: "#2563eb",
        solid: true,
        moving: { axis: "x", range: 130, speed: 85 },
      },
      {
        kind: "platform",
        name: "Plataforma Superior",
        x: Math.round(sceneW * 0.68),
        y: groundY - 165,
        w: 240,
        h: 28,
        color: isLava ? "#991b1b" : "#1d4ed8",
        solid: true,
      },
      {
        kind: "enemy",
        name: "Guardián",
        x: Math.round(sceneW * 0.72),
        y: groundY - 210,
        w: 44,
        h: 44,
        vx: 85,
        color: "#f43f5e",
        hazard: true,
        patrol: { range: 120, ledgeSafe: true },
      },
      {
        kind: "goal",
        name: "Meta",
        x: Math.round(sceneW * 0.84),
        y: groundY - 230,
        w: 36,
        h: 64,
        color: "#7dd3fc",
        goal: true,
      },
    );
    for (let i = 0; i < 6; i++) {
      entitiesToAdd.push({
        kind: "coin",
        name: `Moneda ${i + 1}`,
        x: 180 + i * 135,
        y: groundY - 120 - (i % 3) * 55,
        w: 22,
        h: 22,
        color: "#fbbf24",
        collectible: true,
        value: 10,
      });
    }
    changesSummary.push("Nivel del proyecto reconstruido con nuevas plataformas, monedas, enemigo y meta");
  }

  // 3. Eliminación de entidades en el proyecto
  if (/\b(eliminar|elimina|borrar|borra|quitar|quita|remover|sin)\b/i.test(text)) {
    if (/\b(enemigos?|enemies|jefe|boss|monstruos?)\b/i.test(text)) {
      kindsToRemove.push("enemy");
      changesSummary.push("Enemigos eliminados de la escena del proyecto");
    }
    if (/\b(monedas?|coins?)\b/i.test(text)) {
      kindsToRemove.push("coin");
      changesSummary.push("Monedas eliminadas de la escena del proyecto");
    }
    if (/\b(plataformas?|bloques?)\b/i.test(text)) {
      kindsToRemove.push("platform");
      changesSummary.push("Plataformas secundarias eliminadas de la escena del proyecto");
    }
  }

  // 4. Adición de nuevas entidades al proyecto (monedas, enemigos, plataformas, jefe)
  const wantsToAdd =
    /\b(a[ñn]ad[ie]r?|agrega[r]?|crear?|crea|pon(?:er)?|coloca[r]?|spawnea[r]?|genera[r]?|mas|más)\b/i.test(text) ||
    /\b(monedas?|enemigos?|plataformas?)\s*[:=]\s*\d+/i.test(text);

  if (!replaceAllEntities && scene) {
    if ((wantsToAdd || /\b(jefe|boss)\b/i.test(text)) && /\b(jefe|boss|enemigo|enemigos|patrulla)\b/i.test(text) && !kindsToRemove.includes("enemy")) {
      const countMatch = text.match(/(\d+)\s*(?:enemigos?|jefes?)/i) || text.match(/enemigos?\s*[:=]\s*(\d+)/i);
      const isBoss = /\b(jefe|boss|gigante)\b/i.test(text);
      const count = countMatch ? Math.max(1, Math.min(12, Number(countMatch[1]))) : 1;
      for (let i = 0; i < count; i++) {
        entitiesToAdd.push({
          kind: "enemy",
          name: isBoss ? "Jefe" : `Enemigo ${i + 1}`,
          x: Math.min(sceneW - 140, 380 + i * 150),
          y: Math.max(100, groundY - (isBoss ? 72 : 44)),
          w: isBoss ? 68 : 42,
          h: isBoss ? 68 : 42,
          vx: isBoss ? 115 : 90,
          color: "#f43f5e",
          hazard: true,
          patrol: { range: 150, ledgeSafe: true },
        });
      }
      changesSummary.push(`${count} ${isBoss ? "jefe(s)" : "enemigo(s)"} añadido(s) al proyecto`);
    }

    if (wantsToAdd && /\b(moneda|monedas|coin|coins|oros?|estrellas?)\b/i.test(text) && !kindsToRemove.includes("coin")) {
      const countMatch = text.match(/(\d+)\s*(?:monedas?|coins?)/i) || text.match(/monedas?\s*[:=]\s*(\d+)/i);
      const count = countMatch ? Math.max(1, Math.min(20, Number(countMatch[1]))) : 5;
      for (let i = 0; i < count; i++) {
        entitiesToAdd.push({
          kind: "coin",
          name: `Moneda ${i + 1}`,
          x: Math.min(sceneW - 80, 200 + i * 95),
          y: Math.max(80, groundY - 110 - (i % 3) * 45),
          w: 22,
          h: 22,
          color: "#fbbf24",
          collectible: true,
          value: 10,
        });
      }
      changesSummary.push(`${count} moneda(s) añadida(s) a la escena del proyecto`);
    }

    if (wantsToAdd && /\b(plataforma|plataformas|escalon|escalón|trampolin|trampolín|resorte)\b/i.test(text) && !kindsToRemove.includes("platform")) {
      const countMatch = text.match(/(\d+)\s*plataformas?/i) || text.match(/plataformas?\s*[:=]\s*(\d+)/i);
      const count = countMatch ? Math.max(1, Math.min(10, Number(countMatch[1]))) : 2;
      const isMoving = /\b(movil|móvil|mueve|mueven)\b/i.test(text);
      const isSpring = /\b(trampolin|trampolín|resorte|rebote|rebota)\b/i.test(text);
      for (let i = 0; i < count; i++) {
        entitiesToAdd.push({
          kind: "platform",
          name: isSpring ? `Trampolín ${i + 1}` : `Plataforma ${i + 1}`,
          x: Math.min(sceneW - 200, 240 + i * 210),
          y: Math.max(120, groundY - 95 - i * 65),
          w: isSpring ? 90 : 160,
          h: 26,
          color: isSpring ? "#f59e0b" : "#2563eb",
          solid: true,
          ...(isMoving ? { moving: { axis: "x" as const, range: 130, speed: 85 } } : {}),
          ...(isSpring ? { spring: { force: 680 } } : {}),
        });
      }
      changesSummary.push(`${count} plataforma(s) añadida(s) a la escena del proyecto`);
    }
  }

  // 5. Edición directa de propiedades de las entidades existentes en el proyecto (`entityUpdates`)
  const entityPatch: Partial<Entity> = {};
  const baseRefEnt =
    targetEnt ??
    scene?.entities.find((e) => e.kind === inferredTargetKind) ??
    scene?.entities[0];

  // Color de la entidad (si no fue solo "cambiar fondo")
  if (!/\b(fondo|background|cielo)\b/i.test(text) || /\b(jugador|enemigo|plataforma|moneda|color\s+del)\b/i.test(text)) {
    const col = detectColorFromInstruction(text);
    if (col && (/\b(color|pintar|pinta|cambiar|hacer|pon|rojo|verde|azul|amarillo|morado|rosa|naranja|blanco|negro|#)\b/i.test(text))) {
      entityPatch.color = col.hex;
      changesSummary.push(`Color de ${targetEnt?.name || inferredTargetKind} editado en el proyecto a ${col.label}`);
    }
  }

  // Tamaño (ancho / alto / escala)
  const wMatch = text.match(/\b(?:ancho|w|width)\s*(?:=|:|a|de)?\s*(\d+)/i);
  const hMatch = text.match(/\b(?:alto|altura|h|height)\s*(?:=|:|a|de)?\s*(\d+)/i);
  const sizeMatch = text.match(/\b(?:tama[ñn]o|escala|size)\s*(?:=|:|a|de)?\s*(\d+)/i);
  if (wMatch) entityPatch.w = Math.max(10, Math.min(600, Number(wMatch[1])));
  if (hMatch) entityPatch.h = Math.max(10, Math.min(600, Number(hMatch[1])));
  if (sizeMatch && !wMatch && !hMatch) {
    const s = Math.max(10, Math.min(400, Number(sizeMatch[1])));
    entityPatch.w = s;
    entityPatch.h = s;
  } else if (!wMatch && !hMatch && /\b(gigante|enorme|grande|agrandar|crecer|doble\s+tama[ñn]o)\b/i.test(text) && !/\bjefe\b/i.test(text)) {
    const bw = baseRefEnt?.w || 40;
    const bh = baseRefEnt?.h || 56;
    const mult = /\b(gigante|enorme)\b/i.test(text) ? 1.8 : 1.45;
    entityPatch.w = Math.round(bw * mult);
    entityPatch.h = Math.round(bh * mult);
    changesSummary.push(`Tamaño de ${targetEnt?.name || inferredTargetKind} aumentado a ${entityPatch.w}x${entityPatch.h} en el proyecto`);
  } else if (!wMatch && !hMatch && /\b(peque[ñn]o|chico|mini|miniatura|encoger|reducir)\b/i.test(text)) {
    const bw = baseRefEnt?.w || 40;
    const bh = baseRefEnt?.h || 56;
    entityPatch.w = Math.max(14, Math.round(bw * 0.65));
    entityPatch.h = Math.max(16, Math.round(bh * 0.65));
    changesSummary.push(`Tamaño de ${targetEnt?.name || inferredTargetKind} reducido a ${entityPatch.w}x${entityPatch.h} en el proyecto`);
  }

  // Posición (x, y)
  const posPairMatch = text.match(/\b(?:mover\s+a|posici[oó]n|coordenadas?|en)\s*\(?\s*(\d+)\s*[,y]\s*(\d+)\s*\)?/i);
  const xExplicit = text.match(/\bx\s*[:=]\s*(\d+)/i);
  const yExplicit = text.match(/\by\s*[:=]\s*(\d+)/i);
  if (posPairMatch) {
    entityPatch.x = Number(posPairMatch[1]);
    entityPatch.y = Number(posPairMatch[2]);
    changesSummary.push(`Posición de ${targetEnt?.name || inferredTargetKind} actualizada a (${entityPatch.x}, ${entityPatch.y})`);
  } else {
    if (xExplicit) entityPatch.x = Number(xExplicit[1]);
    if (yExplicit) entityPatch.y = Number(yExplicit[1]);
  }

  // Velocidad / Salto / Comportamientos en la entidad del proyecto
  if (/\b(salta|saltar|salte|salto|brinca|brincar|jump|rebota|rebotar)\b/i.test(text)) {
    const jumpNum = text.match(/(?:salto|saltar|jump|fuerza)\s*(?:=|:|a|de)?\s*(\d+)/i);
    const force = jumpNum ? Math.max(200, Math.min(1200, Number(jumpNum[1]))) : /alto|super|súper|gran/i.test(text) ? 680 : 560;
    if (inferredTargetKind === "platform") {
      entityPatch.spring = { force };
      changesSummary.push(`Plataforma configurada con trampolín de potencia ${force} en el proyecto`);
    } else {
      entityPatch.gravity = true;
      entityPatch.vy = -Math.min(force, 320);
      changesSummary.push(`Propiedad de salto (${force}) aplicada sobre ${targetEnt?.name || "Jugador"} en el proyecto`);
    }
  }

  if (/\b(velocidad|rapido|rápido|lento|correr|corre|vx|speed)\b/i.test(text)) {
    const speedNum = text.match(/(?:velocidad|vx|speed|corre|correr)\s*(?:=|:|a|de)?\s*(-?\d+)/i);
    const spd = speedNum ? Number(speedNum[1]) : /lento|despacio/i.test(text) ? 110 : 340;
    entityPatch.vx = spd;
    changesSummary.push(`Velocidad horizontal de ${targetEnt?.name || inferredTargetKind} editada a ${spd} en el proyecto`);
  }

  if (/\b(movil|móvil|se\s+mueve|oscila)\b/i.test(text) && inferredTargetKind === "platform") {
    entityPatch.moving = {
      axis: /vertical|arriba|abajo|eje\s*y/i.test(text) ? "y" : "x",
      range: 150,
      speed: 90,
    };
    changesSummary.push("Comportamiento de plataforma móvil activado en el proyecto");
  }

  if (/\b(patrulla|patrullar|camina\s+de\s+lado)\b/i.test(text) && (inferredTargetKind === "enemy" || targetEnt)) {
    entityPatch.patrol = { range: 160, ledgeSafe: true };
    if (!entityPatch.vx) entityPatch.vx = 95;
    changesSummary.push("Patrulla activada en la entidad del proyecto");
  }

  if (/\b(rompible|fragil|frágil|se\s+cae|desmorona)\b/i.test(text) && inferredTargetKind === "platform") {
    entityPatch.crumble = { delay: 0.45, respawn: 3 };
    changesSummary.push("Plataforma frágil configurada en el proyecto");
  }

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

  // Compilar siempre el script HTML5 independiente para que la instrucción quede activa tanto en el proyecto como en el runtime HTML5
  const userLang = loadUserLanguage(project);
  const compiled = compileUserLanguageLocally(instruction, userLang, {
    targetEntityId: targetEnt?.id ?? null,
    targetEntityKind: inferredTargetKind,
  });
  if (compiled.compiledJs && jsSnippets.length === 0) {
    jsSnippets.push(compiled.compiledJs);
  }
  Object.assign(synthSounds, compiled.synthSounds);

  if (Object.keys(entityPatch).length > 0 || compiled.compiledScripts.length > 0) {
    entityUpdates.push({
      ...(targetEnt ? { id: targetEnt.id } : { targetKind: inferredTargetKind }),
      ...(Object.keys(entityPatch).length > 0 ? { patch: entityPatch } : {}),
      ...(compiled.compiledScripts.length > 0 ? { scriptsToAdd: compiled.compiledScripts } : {}),
    });
  }

  if (changesSummary.length === 0) {
    changesSummary.push(
      `Proyecto y script HTML5 actualizados (${compiled.explanation})`,
    );
  }

  return {
    reply: `Soy Orión. He editado el proyecto y el archivo HTML5 de tu juego aplicando: ${changesSummary.join("; ")}.`,
    changesSummary,
    scenePatch: Object.keys(scenePatch).length > 0 ? scenePatch : undefined,
    settingsPatch: Object.keys(settingsPatch).length > 0 ? settingsPatch : undefined,
    replaceAllEntities: replaceAllEntities || undefined,
    entitiesToAdd: entitiesToAdd.length > 0 ? entitiesToAdd : undefined,
    entityUpdates: entityUpdates.length > 0 ? entityUpdates : undefined,
    kindsToRemove: kindsToRemove.length > 0 ? kindsToRemove : undefined,
    redistributeLayout,
    synthSounds: Object.keys(synthSounds).length > 0 ? synthSounds : undefined,
    customRuntimeJs: jsSnippets.join("\n\n"),
    appendRuntimeJs: true,
  };
}

/**
 * Ejecuta una petición de edición de juego o traducción del lenguaje propio del usuario con la IA de Orión:
 * 1. Consulta el endpoint del servidor `/api/orion/edit-game` (respaldado por `@google/genai` Gemini 3.8 Flash).
 * 2. Si el servidor no está accesible en el entorno actual, consulta directamente el servicio Gemini (`geminiChat`) con una sesión limpia.
 * 3. Combina con el parche estructural del proyecto (`buildOrionIntelligentPatch`) para garantizar que las entidades, propiedades de escena y scripts HTML5 independientes se editen realmente en el proyecto.
 */
export async function runOrionGameEdit(args: {
  instruction: string;
  project: Project;
  targetEntityId?: string | null;
  currentHtml?: string;
  signal?: AbortSignal;
}): Promise<OrionEditResult> {
  const { instruction, signal, targetEntityId } = args;
  const trimmed = instruction.trim();
  if (!trimmed) {
    throw new Error("Escribe una instrucción o código en tu lenguaje para que Orión lo traduzca y aplique.");
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

  const userLang = loadUserLanguage(workingProject);
  const promptWithLanguageContext = `${trimmed}\n\n${buildUserLanguagePromptContext(userLang, trimmed)}`;

  const recentHistoryText = (workingProject.customRuntime?.orionHistory ?? [])
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Orión" : "Creador"}: ${m.content}`)
    .join("\n");

  let aiPatch: OrionEditPatch | null = null;
  let modelUsed = "Orión · Gemini";

  // 1) Consultar el servidor real de Orión (/api/orion/edit-game con @google/genai)
  try {
    const serverResp = await fetch("/api/orion/edit-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: promptWithLanguageContext,
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
    }
  } catch (err) {
    if (signal?.aborted) throw err;
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
    }
  }

  // 3) Construir parche estructural determinista para garantizar que el proyecto (escena, entidades, física y script HTML5) siempre se edite de verdad
  const structuralPatch = buildOrionIntelligentPatch(trimmed, workingProject, targetEntityId);
  if (!aiPatch) {
    aiPatch = structuralPatch;
    modelUsed = `Orión · Traductor ${userLang.name}`;
  } else {
    if (!aiPatch.scenePatch && structuralPatch.scenePatch) {
      aiPatch.scenePatch = structuralPatch.scenePatch;
    }
    if ((!aiPatch.entitiesToAdd || aiPatch.entitiesToAdd.length === 0) && structuralPatch.entitiesToAdd) {
      aiPatch.entitiesToAdd = structuralPatch.entitiesToAdd;
    }
    if ((!aiPatch.entityUpdates || aiPatch.entityUpdates.length === 0) && structuralPatch.entityUpdates) {
      aiPatch.entityUpdates = structuralPatch.entityUpdates;
    }
    if ((!aiPatch.kindsToRemove || aiPatch.kindsToRemove.length === 0) && structuralPatch.kindsToRemove) {
      aiPatch.kindsToRemove = structuralPatch.kindsToRemove;
    }
    if (!aiPatch.redistributeLayout && structuralPatch.redistributeLayout) {
      aiPatch.redistributeLayout = structuralPatch.redistributeLayout;
    }
    if (!aiPatch.customRuntimeJs?.trim() && structuralPatch.customRuntimeJs) {
      aiPatch.customRuntimeJs = structuralPatch.customRuntimeJs;
    }
    aiPatch.synthSounds = {
      ...(structuralPatch.synthSounds ?? {}),
      ...(aiPatch.synthSounds ?? {}),
    };
  }

  const compiledLocal = compileUserLanguageLocally(trimmed, userLang, {
    targetEntityId: targetEntityId && targetEntityId !== "scene" ? targetEntityId : null,
  });

  if (compiledLocal) {
    if (!aiPatch.customRuntimeJs || !aiPatch.customRuntimeJs.trim()) {
      aiPatch.customRuntimeJs = compiledLocal.compiledJs;
    }
    aiPatch.synthSounds = {
      ...(compiledLocal.synthSounds ?? {}),
      ...(aiPatch.synthSounds ?? {}),
    };
    const hasEntityScripts = (aiPatch.entityUpdates ?? []).some(
      (u) => Array.isArray(u.scriptsToAdd) && u.scriptsToAdd.length > 0
    );
    if (!hasEntityScripts && compiledLocal.compiledScripts.length > 0) {
      aiPatch.entityUpdates = [
        ...(aiPatch.entityUpdates ?? []),
        {
          ...(targetEntityId && targetEntityId !== "scene"
            ? { id: targetEntityId }
            : { targetKind: "player" }),
          scriptsToAdd: compiledLocal.compiledScripts,
        },
      ];
    }
  }

  const updatedProject = applyOrionPatchToProject(workingProject, aiPatch);

  const rawReply = typeof aiPatch.reply === "string" ? aiPatch.reply.trim() : "";
  const replyText = rawReply
    ? rawReply.includes("Orión")
      ? rawReply
      : `Soy Orión. ${rawReply}`
    : "Soy Orión. He traducido tus instrucciones a código JavaScript/HTML5 y las he aplicado a tu juego.";

  const summaryList =
    Array.isArray(aiPatch.changesSummary) && aiPatch.changesSummary.length > 0
      ? aiPatch.changesSummary.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : ["Lenguaje traducido a JavaScript/HTML5 y bloques del motor por Orión"];

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

  let nextUserLanguage = loadUserLanguage(updatedProject);
  if (compiledLocal) {
    const newProgram: CustomLanguageProgram = {
      id: compiledLocal.programId,
      title: compiledLocal.title,
      sourceCode: trimmed,
      compiledJs: aiPatch.customRuntimeJs?.trim() || compiledLocal.compiledJs,
      compiledScripts: compiledLocal.compiledScripts,
      explanation: compiledLocal.explanation,
      targetEntityId: null,
      updatedAt: Date.now(),
    };
    const mergedDict = [
      ...nextUserLanguage.dictionary,
      ...compiledLocal.detectedKeywords.filter(
        (kw) => !nextUserLanguage.dictionary.some((d) => d.keyword.toLowerCase() === kw.keyword.toLowerCase())
      ),
    ];
    nextUserLanguage = {
      ...nextUserLanguage,
      dictionary: mergedDict,
      programs: [newProgram, ...nextUserLanguage.programs.filter((p) => p.sourceCode.trim() !== trimmed)].slice(0, 30),
    };
    saveUserLanguageToStorage(nextUserLanguage);
  }

  const prevHistory = updatedProject.customRuntime?.orionHistory ?? [];
  const mergedJsWithPrograms = mergeCompiledProgramsIntoRuntimeJs(
    updatedProject.customRuntime?.jsCode,
    nextUserLanguage.programs
  );

  const finalProject: Project = {
    ...updatedProject,
    customRuntime: {
      ...(updatedProject.customRuntime ?? {}),
      jsCode: mergedJsWithPrograms,
      orionHistory: [...prevHistory, userMsg, assistantMsg].slice(-40),
      userLanguage: nextUserLanguage,
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
