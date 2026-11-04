import { uid, type CustomSoundSynth, type EntityKind, type Project } from "../engine/core";
import type { Block, EventType, Script } from "../engine/scripts";

export type CustomKeywordCategory = "evento" | "condicion" | "accion" | "regla";

export interface CustomKeywordRule {
  id: string;
  keyword: string;
  meaning: string;
  category: CustomKeywordCategory;
}

export interface CustomLanguageProgram {
  id: string;
  title: string;
  sourceCode: string;
  compiledJs: string;
  compiledScripts?: Script[];
  explanation: string;
  targetEntityId?: string | null;
  updatedAt: number;
}

export interface UserProgrammingLanguage {
  name: string;
  syntaxRules: string;
  dictionary: CustomKeywordRule[];
  programs: CustomLanguageProgram[];
}

export interface CompiledCustomLanguageResult {
  programId: string;
  title: string;
  sourceCode: string;
  expandedSourceCode: string;
  compiledJs: string;
  compiledScripts: Script[];
  synthSounds: Record<string, CustomSoundSynth>;
  explanation: string;
  detectedKeywords: CustomKeywordRule[];
  hasSpecificMatch?: boolean;
}

export const USER_LANGUAGE_STORAGE_KEY = "asternal_user_programming_language_v1";

export const DEFAULT_USER_LANGUAGE: UserProgrammingLanguage = {
  name: "AsternalLang Propio",
  syntaxRules:
    "Cada bloque inicia con una condición o instrucción de evento terminada en ':' (por ejemplo 'SI el jugador pierde:', 'CUANDO toque enemigo:', 'AL presionar ESPACIO:', 'CADA 2 segundos:') y debajo se escriben las acciones inventadas por el usuario (por ejemplo 'MOSTRAR sonido en el mapa', 'INVOCAR onda de energia', 'SUMAR 10 puntos'). Cada usuario puede inventar sus propias palabras clave, verbos y reglas.",
  dictionary: [
    {
      id: "kw-si-pierde",
      keyword: "SI el jugador pierde:",
      meaning: "Evento cuando el jugador pierde o queda sin vidas (onLose / state.dead)",
      category: "evento",
    },
    {
      id: "kw-mostrar-sonido-mapa",
      keyword: "MOSTRAR sonido en el mapa",
      meaning:
        "Emitir sonido sintetizado y dibujar una onda visual de radar sonoro en la posición del mapa HTML5",
      category: "accion",
    },
    {
      id: "kw-cuando-toca",
      keyword: "CUANDO el jugador toca enemigo:",
      meaning: "Evento de colisión entre el jugador y un enemigo (onCollide)",
      category: "evento",
    },
    {
      id: "kw-al-ganar",
      keyword: "SI el jugador gana:",
      meaning: "Evento cuando el jugador alcanza la meta o gana la partida (onWin)",
      category: "evento",
    },
    {
      id: "kw-cada-segundo",
      keyword: "CADA 2 segundos:",
      meaning: "Temporizador periódico que ejecuta las acciones cada N segundos (onTimer)",
      category: "evento",
    },
    {
      id: "kw-crear-explosion",
      keyword: "INVOCAR onda de energia",
      meaning: "Sacudir la cámara y emitir un pulso expansivo de energía en el mapa",
      category: "accion",
    },
  ],
  programs: [],
};

export const CUSTOM_LANGUAGE_TEMPLATES: Array<{
  id: string;
  label: string;
  badge: string;
  description: string;
  code: string;
}> = [
  {
    id: "tpl-lose-sound-map",
    label: "SI el jugador pierde → Sonido en el mapa",
    badge: "Ejemplo Base",
    description: "Detecta cuando el jugador pierde, reproduce una señal sonora y dibuja ondas de sonido en el mapa.",
    code: `SI el jugador pierde:\nMOSTRAR sonido en el mapa`,
  },
  {
    id: "tpl-lose-full",
    label: "Derrota con radar y cámara",
    badge: "Evento + Mapa",
    description: "Combina sonido en el mapa, sacudida de cámara y mensaje al perder.",
    code: `SI el jugador pierde:\nMOSTRAR sonido en el mapa\nSACUDIR camara 10\nDECIR "¡Señal de auxilio en el mapa!"`,
  },
  {
    id: "tpl-custom-combo",
    label: "Regla de impacto con enemigo",
    badge: "Colisión",
    description: "Define en tu propio lenguaje qué ocurre al tocar un enemigo.",
    code: `CUANDO el jugador toca enemigo:\nMOSTRAR sonido en el mapa\nEMPUJAR hacia atras\nRESTAR 1 vida`,
  },
  {
    id: "tpl-custom-power",
    label: "Poder especial al saltar",
    badge: "Habilidad",
    description: "Activa una onda de energía y puntos extra al presionar salto.",
    code: `AL presionar SALTO:\nINVOCAR onda de energia\nSALTAR con fuerza 520\nSUMAR 25 puntos`,
  },
  {
    id: "tpl-radar-timer",
    label: "Radar periódico cada 3s",
    badge: "Temporizador",
    description: "Emite un pulso sonoro en el mapa cada 3 segundos y persigue al jugador.",
    code: `CADA 3 segundos:\nMOSTRAR sonido en el mapa\nPERSEGUIR al jugador con velocidad 160`,
  },
];

function sanitizeUserLanguage(raw: unknown): UserProgrammingLanguage {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_USER_LANGUAGE,
      dictionary: DEFAULT_USER_LANGUAGE.dictionary.map((d) => ({ ...d })),
      programs: [],
    };
  }
  const obj = raw as Record<string, unknown>;
  const name =
    typeof obj.name === "string" && obj.name.trim().length > 0
      ? obj.name.trim().slice(0, 60)
      : DEFAULT_USER_LANGUAGE.name;
  const syntaxRules =
    typeof obj.syntaxRules === "string" && obj.syntaxRules.trim().length > 0
      ? obj.syntaxRules.trim().slice(0, 1200)
      : DEFAULT_USER_LANGUAGE.syntaxRules;

  const dictionary: CustomKeywordRule[] = Array.isArray(obj.dictionary)
    ? obj.dictionary
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item, idx): CustomKeywordRule => {
          const cat: CustomKeywordCategory =
            item.category === "evento" ||
            item.category === "condicion" ||
            item.category === "accion" ||
            item.category === "regla"
              ? item.category
              : "accion";
          return {
            id: typeof item.id === "string" && item.id ? item.id : `kw-${idx}-${uid()}`,
            keyword: typeof item.keyword === "string" ? item.keyword.trim() : "",
            meaning: typeof item.meaning === "string" ? item.meaning.trim() : "",
            category: cat,
          };
        })
        .filter((item) => item.keyword.length > 0)
    : DEFAULT_USER_LANGUAGE.dictionary.map((d) => ({ ...d }));

  const programs: CustomLanguageProgram[] = Array.isArray(obj.programs)
    ? obj.programs
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item, idx) => ({
          id: typeof item.id === "string" && item.id ? item.id : `prog-${idx}-${uid()}`,
          title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Programa #${idx + 1}`,
          sourceCode: typeof item.sourceCode === "string" ? item.sourceCode : "",
          compiledJs: typeof item.compiledJs === "string" ? item.compiledJs : "",
          compiledScripts: Array.isArray(item.compiledScripts) ? (item.compiledScripts as Script[]) : undefined,
          explanation: typeof item.explanation === "string" ? item.explanation : "",
          targetEntityId: typeof item.targetEntityId === "string" ? item.targetEntityId : null,
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        }))
        .filter((item) => item.sourceCode.trim().length > 0 || item.compiledJs.trim().length > 0)
    : [];

  return {
    name,
    syntaxRules,
    dictionary: dictionary.length > 0 ? dictionary : DEFAULT_USER_LANGUAGE.dictionary.map((d) => ({ ...d })),
    programs,
  };
}

export function loadUserLanguage(project?: Project | null): UserProgrammingLanguage {
  const fromProject = project?.customRuntime?.userLanguage;
  let stored: UserProgrammingLanguage | null = null;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(USER_LANGUAGE_STORAGE_KEY);
      if (raw) {
        stored = sanitizeUserLanguage(JSON.parse(raw));
      }
    } catch {
      // Ignore storage read errors
    }
  }

  if (fromProject) {
    const projectLang = sanitizeUserLanguage(fromProject);
    if (stored) {
      const seen = new Set(projectLang.dictionary.map((d) => d.keyword.toLowerCase()));
      const mergedDict = [...projectLang.dictionary];
      for (const item of stored.dictionary) {
        if (!seen.has(item.keyword.toLowerCase())) {
          seen.add(item.keyword.toLowerCase());
          mergedDict.push(item);
        }
      }
      return {
        ...projectLang,
        dictionary: mergedDict,
      };
    }
    return projectLang;
  }

  if (stored) {
    return stored;
  }

  return sanitizeUserLanguage(DEFAULT_USER_LANGUAGE);
}

export function saveUserLanguageToStorage(lang: UserProgrammingLanguage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_LANGUAGE_STORAGE_KEY, JSON.stringify(lang));
  } catch {
    // Ignore storage quota errors
  }
}

export function mergeCompiledProgramsIntoRuntimeJs(
  existingJs: string | undefined,
  programs: CustomLanguageProgram[]
): string {
  const base = (existingJs || "")
    .replace(/\/\/ \[BEGIN_USER_LANG_PROGRAM:[^\]]+\][\s\S]*?\/\/ \[END_USER_LANG_PROGRAM:[^\]]+\]\n?/g, "")
    .trim();

  const blocks = programs
    .filter((p) => p.compiledJs && p.compiledJs.trim().length > 0)
    .map(
      (p) =>
        `// [BEGIN_USER_LANG_PROGRAM:${p.id}]\n` +
        `// Lenguaje del usuario · ${p.title.replace(/\r?\n/g, " ")}\n` +
        `${p.compiledJs.trim()}\n` +
        `// [END_USER_LANG_PROGRAM:${p.id}]`
    );

  if (blocks.length === 0) return base;
  return [base, ...blocks].filter(Boolean).join("\n\n");
}

export function extractCustomKeywordsFromCode(
  code: string,
  existingDictionary: CustomKeywordRule[] = []
): CustomKeywordRule[] {
  const known = new Set(existingDictionary.map((d) => d.keyword.trim().toLowerCase()));
  const discovered: CustomKeywordRule[] = [];
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("//") || line.startsWith("#")) continue;
    const isHeader = line.endsWith(":") || /^(si|cuando|al|cada|if|when|on)\b/i.test(line);
    if (isHeader) {
      const normalized = line.endsWith(":") ? line : `${line}:`;
      const keyLower = normalized.toLowerCase();
      if (!known.has(keyLower)) {
        known.add(keyLower);
        discovered.push({
          id: `kw-auto-${uid()}`,
          keyword: normalized,
          meaning: inferMeaningForLine(normalized, "evento"),
          category: "evento",
        });
      }
      continue;
    }

    const upperVerbMatch = line.match(/^([A-ZÁÉÍÓÚÑ_]{2,}(?:\s+[a-záéíóúñA-ZÁÉÍÓÚÑ0-9_]+){0,4})/);
    const candidate = upperVerbMatch ? line : line.slice(0, 60);
    const keyLower = candidate.toLowerCase();
    if (candidate.length >= 3 && !known.has(keyLower)) {
      known.add(keyLower);
      discovered.push({
        id: `kw-auto-${uid()}`,
        keyword: candidate,
        meaning: inferMeaningForLine(candidate, "accion"),
        category: "accion",
      });
    }
  }

  return discovered;
}

function inferMeaningForLine(line: string, category: CustomKeywordCategory): string {
  const lower = line.toLowerCase();
  if (category === "evento") {
    if (/pierde|muere|derrota|sin vida|lose|game over/.test(lower)) {
      return "Disparar cuando el jugador pierde o queda sin vidas (onLose)";
    }
    if (/gana|meta|victoria|win/.test(lower)) {
      return "Disparar cuando el jugador gana o llega a la meta (onWin)";
    }
    if (/toca|choca|colision|enemigo|peligro/.test(lower)) {
      return "Disparar cuando ocurre una colisión entre entidades en el mapa (onCollide)";
    }
    if (/tecla|presiona|espacio|salto|boton|input/.test(lower)) {
      return "Disparar al presionar una tecla o control del jugador (onKeyDown)";
    }
    if (/cada|segundo|tiempo|timer/.test(lower)) {
      return "Disparar periódicamente por temporizador en el motor (onTimer)";
    }
    if (/iniciar|empezar|comienza|inicio/.test(lower)) {
      return "Disparar al iniciar la escena o partida (onStart)";
    }
    return "Condición o evento personalizado definido por el usuario en su lenguaje";
  }

  if (/mostrar\s+sonido.*mapa|sonido.*mapa|radar.*sonido|eco.*mapa/.test(lower)) {
    return "Emitir sonido sintetizado y renderizar ondas visuales de sonido en el mapa HTML5";
  }
  if (/sonido|audio|alarma|musica|beep|ruido/.test(lower)) {
    return "Reproducir un efecto de sonido sintetizado en el motor";
  }
  if (/sacudir|temblar|vibrar|camara/.test(lower)) {
    return "Sacudir la cámara del mapa con intensidad";
  }
  if (/saltar|impulso|brincar/.test(lower)) {
    return "Impulsar la entidad verticalmente hacia arriba";
  }
  if (/perseguir|seguir|buscar/.test(lower)) {
    return "Mover la entidad automáticamente hacia la posición del jugador";
  }
  if (/puntos|moneda|score|sumar/.test(lower)) {
    return "Modificar la puntuación global del jugador";
  }
  if (/vida|curar|daño|restar/.test(lower)) {
    return "Modificar las vidas o salud del jugador";
  }
  if (/decir|mostrar|mensaje|texto|alerta/.test(lower)) {
    return "Mostrar un mensaje flotante y marcador visual en el mapa";
  }
  return "Instrucción ejecutable en el motor HTML5 / JavaScript según la intención del usuario";
}

export function expandCodeWithUserDictionary(
  code: string,
  dictionary: CustomKeywordRule[]
): { expandedCode: string; matchedRules: CustomKeywordRule[] } {
  const matchedRules: CustomKeywordRule[] = [];
  let expandedCode = code;

  for (const rule of dictionary) {
    const kw = rule.keyword.trim();
    if (!kw) continue;
    const strippedKw = kw.replace(/:$/, "").trim();
    if (!strippedKw) continue;
    if (code.toLowerCase().includes(strippedKw.toLowerCase())) {
      matchedRules.push(rule);
      expandedCode += `\n// [DICCIONARIO "${kw}" => ${rule.meaning}]`;
    }
  }

  return { expandedCode, matchedRules };
}

export function buildUserLanguagePromptContext(
  lang: UserProgrammingLanguage,
  userCode: string
): string {
  const { matchedRules } = expandCodeWithUserDictionary(userCode, lang.dictionary);
  const dictLines = lang.dictionary
    .slice(0, 30)
    .map((d) => `  - "${d.keyword}" (${d.category.toUpperCase()}) => ${d.meaning}`)
    .join("\n");

  const matchedLines =
    matchedRules.length > 0
      ? matchedRules.map((d) => `  * COINCIDENCIA ACTIVA: "${d.keyword}" significa: ${d.meaning}`).join("\n")
      : "  * Interpreta directamente las palabras y sintaxis inventadas por el usuario.";

  return [
    `=== SISTEMA DE LENGUAJE DE PROGRAMACIÓN INVENTADO POR EL USUARIO ===`,
    `Nombre del lenguaje del usuario: "${lang.name}"`,
    `Reglas de sintaxis definidas por el usuario: ${lang.syntaxRules}`,
    `Diccionario de instrucciones del usuario:\n${dictLines || "  (Sin reglas predefinidas; interpreta libremente)"}`,
    `Instrucciones del diccionario detectadas en este código:\n${matchedLines}`,
    `Código escrito por el usuario en su propio lenguaje:\n\`\`\`\n${userCode.trim()}\n\`\`\``,
    `OBJETIVO DEL TRADUCTOR IA:`,
    `1. Comprende exactamente qué quiso expresar el usuario en su lenguaje inventado (por ejemplo: "SI el jugador pierde:\\nMOSTRAR sonido en el mapa").`,
    `2. Tradúcelo en código JavaScript/HTML5 100% funcional en "customRuntimeJs" usando window.AsternalRuntime.registerHook({...}) y window.AsternalAudio.registerSound(...) para que se ejecute a 60 FPS en el motor HTML5.`,
    `3. Además, genera los bloques "scripts" equivalentes del motor (onLose, onCollide, onUpdate, onStart, onKeyDown, onTimer, etc.) para las entidades correspondientes.`,
  ].join("\n");
}

interface ParsedUserBlock {
  header: string;
  eventType: EventType;
  key?: "left" | "right" | "jump";
  intervalMs?: number;
  withKind?: EntityKind | "any";
  actions: string[];
}

function parseUserLanguageBlocks(code: string, dictionary: CustomKeywordRule[]): ParsedUserBlock[] {
  const rawLines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("#"));

  const enrichLine = (line: string): string => {
    let enriched = line;
    for (const rule of dictionary) {
      const kwClean = rule.keyword.replace(/:$/, "").trim();
      if (kwClean && line.toLowerCase().includes(kwClean.toLowerCase())) {
        enriched = `${enriched} (${rule.meaning})`;
      }
    }
    return enriched;
  };

  const blocks: ParsedUserBlock[] = [];
  let current: ParsedUserBlock | null = null;

  for (const rawLine of rawLines) {
    const inlineSplit = rawLine.match(
      /^(?:(si|cuando|al|cada|if|when|on)\b[^:>-]*?)(?:\s*(?::|->|=>|\bentonces\b)\s*)(.+)$/i
    );
    if (inlineSplit && inlineSplit[2] && !rawLine.endsWith(":")) {
      const headerPart = rawLine.slice(0, rawLine.indexOf(inlineSplit[2])).trim();
      const actionPart = inlineSplit[2].trim();
      const headerInfo = classifyHeaderEvent(enrichLine(headerPart));
      current = {
        header: headerPart,
        ...headerInfo,
        actions: [enrichLine(actionPart)],
      };
      blocks.push(current);
      continue;
    }

    const enriched = enrichLine(rawLine);
    const looksLikeHeader =
      rawLine.endsWith(":") ||
      /^(si|cuando|al|cada|if|when|on|mientras|siempre\s+que)\b/i.test(rawLine) ||
      /\b(onLose|onWin|onCollide|onKeyDown|onTimer|onStart|onUpdate)\b/i.test(enriched);

    if (looksLikeHeader && (rawLine.endsWith(":") || current === null)) {
      const headerInfo = classifyHeaderEvent(enriched);
      current = {
        header: rawLine,
        ...headerInfo,
        actions: [],
      };
      blocks.push(current);
    } else {
      if (!current) {
        current = {
          header: "AL iniciar o actualizar en el juego:",
          eventType: "onUpdate",
          actions: [],
        };
        blocks.push(current);
      }
      current.actions.push(enriched);
    }
  }

  if (blocks.length === 0 && rawLines.length > 0) {
    blocks.push({
      header: rawLines[0],
      ...classifyHeaderEvent(enrichLine(rawLines[0])),
      actions: rawLines.map(enrichLine),
    });
  }

  for (const b of blocks) {
    if (b.actions.length === 0) {
      b.actions.push(enrichLine(b.header));
    }
  }

  return blocks;
}

function classifyHeaderEvent(header: string): {
  eventType: EventType;
  key?: "left" | "right" | "jump";
  intervalMs?: number;
  withKind?: EntityKind | "any";
} {
  const lower = header.toLowerCase();
  if (/pierde|muere|derrota|sin\s+vida|game\s*over|onlose|caer|cae\s+al\s+vacio/.test(lower)) {
    return { eventType: "onLose" };
  }
  if (/gana|victoria|meta|onwin|completar|trofeo/.test(lower)) {
    return { eventType: "onWin" };
  }
  if (/cada|segundo|segundos|intervalo|ontimer|reloj/.test(lower)) {
    const numMatch = lower.match(/(\d+(?:\.\d+)?)/);
    const seconds = numMatch ? Math.max(0.2, Math.min(30, Number(numMatch[1]))) : 2;
    return { eventType: "onTimer", intervalMs: Math.round(seconds * 1000) };
  }
  if (/tecla|presiona|presionar|pulsar|onkeydown|espacio|space|salto|flecha/.test(lower)) {
    let key: "left" | "right" | "jump" = "jump";
    if (/izquierda|left|tecla\s+a\b/.test(lower)) key = "left";
    else if (/derecha|right|tecla\s+d\b/.test(lower)) key = "right";
    return { eventType: "onKeyDown", key };
  }
  if (/toca|choca|colision|colisiona|oncollide|enemigo|peligro|moneda|bloque/.test(lower)) {
    let withKind: EntityKind | "any" = "any";
    if (/enemigo|enemy|jefe|peligro/.test(lower)) withKind = "enemy";
    else if (/moneda|coin/.test(lower)) withKind = "coin";
    else if (/jugador|player/.test(lower)) withKind = "player";
    else if (/meta|goal/.test(lower)) withKind = "goal";
    return { eventType: "onCollide", withKind };
  }
  if (/aterriza|suelo|onland/.test(lower)) {
    return { eventType: "onLand" };
  }
  if (/sale.*pantalla|onleavescreen/.test(lower)) {
    return { eventType: "onLeaveScreen" };
  }
  if (/iniciar|inicio|empieza|comienza|onstart/.test(lower)) {
    return { eventType: "onStart" };
  }
  return { eventType: "onUpdate" };
}

export function compileUserLanguageLocally(
  userCode: string,
  lang: UserProgrammingLanguage,
  opts?: {
    programId?: string;
    title?: string;
    targetEntityId?: string | null;
    targetEntityKind?: EntityKind;
    allowedEvents?: EventType[];
  }
): CompiledCustomLanguageResult {
  const programId = opts?.programId || `ulp-${uid()}`;
  const cleanCode = userCode.trim();
  const firstLine = cleanCode.split(/\r?\n/)[0]?.replace(/:$/, "").trim() || "Programa personalizado";
  const title = opts?.title?.trim() || firstLine.slice(0, 48);

  const detectedKeywords = extractCustomKeywordsFromCode(cleanCode, lang.dictionary);
  const fullDictionary = [...lang.dictionary, ...detectedKeywords];
  const { expandedCode } = expandCodeWithUserDictionary(cleanCode, fullDictionary);
  const parsedBlocks = parseUserLanguageBlocks(cleanCode, fullDictionary);

  const compiledScripts: Script[] = [];
  const synthSounds: Record<string, CustomSoundSynth> = {};
  const jsHookSections: string[] = [];
  const jsCollideSections: string[] = [];
  const jsKeyDownSections: string[] = [];
  const explanations: string[] = [];
  let hasSpecificMatch = false;

  parsedBlocks.forEach((block, blockIndex) => {
    let eventType: EventType = block.eventType;
    if (opts?.allowedEvents && opts.allowedEvents.length > 0 && !opts.allowedEvents.includes(eventType)) {
      eventType = opts.allowedEvents[0];
    }

    const scriptBlocks: Block[] = [];
    const jsActionStatements: string[] = [];

    // Expand compound instructions from custom dictionary meanings (e.g. "Sumar 500 puntos y sacudir camara 12")
    const atomicActions: string[] = [];
    for (const rawAction of block.actions) {
      const baseCmd = rawAction.split(" (")[0].trim();
      const isDirectMapSound = /sonido.*mapa|mostrar.*sonido|onda.*sonora|radar.*sonido|eco.*mapa|alarma.*mapa/i.test(baseCmd);
      const dictParens = rawAction.match(/\(([^)]+)\)/);
      if (!isDirectMapSound && dictParens && /\s+y\s+|;/i.test(dictParens[1])) {
        const subParts = dictParens[1]
          .split(/\s+y\s+|;/i)
          .map((s) => s.trim())
          .filter(Boolean);
        atomicActions.push(...subParts);
      } else {
        atomicActions.push(rawAction);
      }
    }

    for (const rawAction of atomicActions) {
      const lower = rawAction.toLowerCase();
      const quotedMatch = rawAction.match(/["“”'«»]([^"“”'«»]+)["“”'«»]/);
      const numMatch = rawAction.match(/(-?\d+(?:\.\d+)?)/);
      const numVal = numMatch ? Number(numMatch[1]) : null;

      // 1. MOSTRAR sonido en el mapa / Radar sonoro visual + acústico
      if (/sonido.*mapa|mostrar.*sonido|onda.*sonora|radar.*sonido|eco.*mapa|alarma.*mapa/.test(lower)) {
        hasSpecificMatch = true;
        const soundName = `user_lang_map_sound_${blockIndex + 1}`;
        synthSounds[soundName] = {
          name: soundName,
          wave: eventType === "onLose" ? "sawtooth" : "triangle",
          freq: eventType === "onLose" ? 240 : 520,
          endFreq: eventType === "onLose" ? 95 : 880,
          duration: 0.55,
          volume: 0.36,
        };
        scriptBlocks.push({
          id: uid(),
          kind: "playSound",
          text: eventType === "onLose" ? "lose" : "powerup",
          soundName: "Sonido en el mapa",
        });
        scriptBlocks.push({
          id: uid(),
          kind: "shake",
          value: 7,
        });
        scriptBlocks.push({
          id: uid(),
          kind: "sayForSecs",
          text: "🔊 SONIDO EN EL MAPA",
          value: 2,
        });

        jsActionStatements.push(`
          if (api && typeof api.playSound === "function") {
            api.playSound("synth:${soundName}");
          } else if (window.AsternalAudio && typeof window.AsternalAudio.play === "function") {
            window.AsternalAudio.play("${soundName}");
          }
          var srcEnt = (api && typeof api.getPlayer === "function" && api.getPlayer()) || { x: 320, y: 200, w: 36, h: 48 };
          state.soundWaves.push({
            x: (srcEnt.x || 0) + ((srcEnt.w || 36) / 2),
            y: (srcEnt.y || 0) + ((srcEnt.h || 48) / 2),
            radius: 12,
            maxRadius: 280,
            alpha: 1,
            label: "🔊 SONIDO EN EL MAPA",
            color: "${eventType === "onLose" ? "#fb7185" : "#38bdf8"}"
          });
        `);
        explanations.push(
          `Tradujo "${rawAction.split(" (")[0].trim()}" a un emisor de sonido WebAudio + radar visual de ondas acústicas en el mapa HTML5.`
        );
        continue;
      }

      // 2. Reproducir sonido general
      if (/sonido|audio|alarma|beep|musica|efecto\s+sonoro/.test(lower)) {
        hasSpecificMatch = true;
        const soundKey = /moneda|coin/.test(lower)
          ? "coin"
          : /salto|jump/.test(lower)
          ? "jump"
          : /explosion|bomba|laser/.test(lower)
          ? "hit"
          : eventType === "onLose"
          ? "lose"
          : "powerup";
        scriptBlocks.push({
          id: uid(),
          kind: "playSound",
          text: soundKey,
        });
        jsActionStatements.push(`
          if (api && typeof api.playSound === "function") {
            api.playSound("${soundKey}");
          }
        `);
        explanations.push(`Reproduce el sonido "${soundKey}" cuando se cumple la condición.`);
        continue;
      }

      // 3. Sacudir cámara / pantalla
      if (/sacudir|temblar|vibrar|terremoto|shake/.test(lower)) {
        hasSpecificMatch = true;
        const intensity = numVal ? Math.max(2, Math.min(25, Math.abs(numVal))) : 9;
        scriptBlocks.push({
          id: uid(),
          kind: "shake",
          value: intensity,
        });
        jsActionStatements.push(`
          if (api && typeof api.shake === "function") {
            api.shake(${intensity}, 0.35);
          }
        `);
        explanations.push(`Sacude la cámara del mapa con intensidad ${intensity}.`);
        continue;
      }

      // 4. Saltar / Impulso vertical
      if (/saltar|brincar|impulso|elevar|volar/.test(lower)) {
        hasSpecificMatch = true;
        const force = numVal ? Math.abs(numVal) : 480;
        scriptBlocks.push({
          id: uid(),
          kind: "jump",
          value: force,
        });
        scriptBlocks.push({
          id: uid(),
          kind: "playSound",
          text: "jump",
        });
        jsActionStatements.push(`
          var pJump = api && typeof api.getPlayer === "function" ? api.getPlayer() : null;
          if (pJump) { pJump.vy = -${force}; }
        `);
        explanations.push(`Impulsa la entidad hacia arriba con fuerza ${force}.`);
        continue;
      }

      // 5. Empujar / Mover / Velocidad / Dash
      if (/empujar|mover|avanzar|desplazar|velocidad|dash|esquivar|turbo|correr/.test(lower)) {
        hasSpecificMatch = true;
        const isDash = /dash|esquivar|turbo/.test(lower);
        const vx = /atras|izquierda|left/.test(lower)
          ? -(numVal ? Math.abs(numVal) : isDash ? 580 : 240)
          : numVal || (isDash ? 580 : 240);
        scriptBlocks.push({
          id: uid(),
          kind: "setVx",
          value: vx,
        });
        if (isDash) {
          scriptBlocks.push({ id: uid(), kind: "playSound", text: "powerup" });
        }
        jsActionStatements.push(`
          var pMove = api && typeof api.getPlayer === "function" ? api.getPlayer() : null;
          if (pMove) {
            var dirMove = pMove.facing === -1 ? -1 : 1;
            pMove.vx = ${isDash ? `dirMove * ${Math.abs(vx)}` : vx};
            if (${isDash} && api && typeof api.emitBurst === "function") {
              api.emitBurst(pMove.x + pMove.w / 2, pMove.y + pMove.h / 2, "#38bdf8", 12);
            }
          }
        `);
        explanations.push(`Aplica velocidad horizontal (${vx} px/s).`);
        continue;
      }

      // 6. Perseguir al jugador
      if (/perseguir|seguir|cazar|buscar\s+jugador/.test(lower)) {
        hasSpecificMatch = true;
        const speed = numVal ? Math.max(40, Math.min(500, Math.abs(numVal))) : 140;
        scriptBlocks.push({
          id: uid(),
          kind: "chase",
          text: "player",
          value: speed,
        });
        jsActionStatements.push(`
          var chaser = getTargetEntity(api, "enemy");
          var pTarget = api && typeof api.getPlayer === "function" ? api.getPlayer() : null;
          if (chaser && pTarget && chaser.id !== pTarget.id) {
            var dx = (pTarget.x + pTarget.w / 2) - (chaser.x + chaser.w / 2);
            chaser.vx = dx === 0 ? 0 : (dx > 0 ? ${speed} : -${speed});
            chaser.facing = dx >= 0 ? 1 : -1;
          }
        `);
        explanations.push(`Activa persecución hacia el jugador a velocidad ${speed}.`);
        continue;
      }

      // 7. Puntos / Score
      if (/punto|puntos|score|moneda|recompensa/.test(lower)) {
        hasSpecificMatch = true;
        const delta = /restar|quitar|perder/.test(lower)
          ? -(numVal ? Math.abs(numVal) : 10)
          : numVal || 10;
        scriptBlocks.push({
          id: uid(),
          kind: "addScore",
          value: delta,
        });
        jsActionStatements.push(`
          if (api && typeof api.addScore === "function") { api.addScore(${delta}); }
        `);
        explanations.push(`Modifica el puntaje en ${delta > 0 ? `+${delta}` : delta} puntos.`);
        continue;
      }

      // 8. Vidas / Salud / Daño
      if (/vida|vidas|salud|curar|daño|restar\s+vida|hurt/.test(lower)) {
        hasSpecificMatch = true;
        const delta = /restar|quitar|daño|perder|hurt/.test(lower)
          ? -(numVal ? Math.abs(numVal) : 1)
          : numVal || 1;
        scriptBlocks.push({
          id: uid(),
          kind: "addLives",
          value: delta,
        });
        jsActionStatements.push(`
          if (api && typeof api.addLives === "function") { api.addLives(${delta}); }
        `);
        explanations.push(`Cambia las vidas del jugador en ${delta > 0 ? `+${delta}` : delta}.`);
        continue;
      }

      // 9. Disparar / Proyectil / Láser / Ataque
      if (/dispar|proyectil|bala|laser|láser|fuego|lanzar/.test(lower)) {
        hasSpecificMatch = true;
        synthSounds.laser = {
          name: "laser",
          wave: "sawtooth",
          freq: 780,
          endFreq: 160,
          duration: 0.16,
          volume: 0.34,
        };
        scriptBlocks.push({
          id: uid(),
          kind: "playSound",
          text: "powerup",
        });
        scriptBlocks.push({
          id: uid(),
          kind: "shake",
          value: 4,
        });
        jsActionStatements.push(`
          var pShot = getTargetEntity(api, "player");
          if (pShot) {
            if (api && typeof api.playSound === "function") api.playSound("synth:laser");
            if (api && typeof api.emitBurst === "function") {
              api.emitBurst(pShot.x + pShot.w / 2, pShot.y + pShot.h / 2, "#38bdf8", 14);
            }
            var enemiesNow = api && typeof api.getEntities === "function" ? api.getEntities("enemy") : [];
            for (var ei = 0; ei < enemiesNow.length; ei++) {
              var en = enemiesNow[ei];
              if (Math.abs((en.x || 0) - (pShot.x || 0)) < 320 && Math.abs((en.y || 0) - (pShot.y || 0)) < 140) {
                en.x = -99999;
                if (api && typeof api.addScore === "function") api.addScore(25);
                break;
              }
            }
          }
        `);
        explanations.push(`Dispara un pulso láser que impacta enemigos cercanos.`);
        continue;
      }

      // 10. Onda de energía / Explosión / Partículas
      if (/onda|energia|explosion|particula|destello|rayo|magia/.test(lower)) {
        hasSpecificMatch = true;
        scriptBlocks.push({
          id: uid(),
          kind: "shake",
          value: 8,
        });
        scriptBlocks.push({
          id: uid(),
          kind: "playSound",
          text: "powerup",
        });
        jsActionStatements.push(`
          var pWave = getTargetEntity(api, "player") || { x: 320, y: 200, w: 36, h: 48 };
          if (api && typeof api.playSound === "function") api.playSound("powerup");
          if (api && typeof api.shake === "function") api.shake(8, 0.25);
          if (api && typeof api.emitBurst === "function") {
            api.emitBurst((pWave.x || 0) + 18, (pWave.y || 0) + 24, "#38bdf8", 18);
          }
          state.soundWaves.push({
            x: (pWave.x || 0) + ((pWave.w || 36) / 2),
            y: (pWave.y || 0) + ((pWave.h || 48) / 2),
            radius: 10,
            maxRadius: 240,
            alpha: 1,
            label: "⚡ ONDA DE ENERGÍA",
            color: "#38bdf8"
          });
        `);
        explanations.push(`Genera una onda de energía visual y partículas en el mapa.`);
        continue;
      }

      // 11. Decir / Mostrar texto o mensaje
      if (/decir|mostrar|mensaje|texto|avisar|alerta/.test(lower) || quotedMatch) {
        hasSpecificMatch = true;
        const msg =
          quotedMatch?.[1]?.trim() ||
          rawAction
            .replace(/^(decir|mostrar|mensaje|avisar|alerta)\s*:?\s*/i, "")
            .split(" (")[0]
            .trim() ||
          "¡Acción activada!";
        scriptBlocks.push({
          id: uid(),
          kind: "sayForSecs",
          text: msg,
          value: 2.5,
        });
        jsActionStatements.push(`
          var pMsg = getTargetEntity(api, "player") || { x: 320, y: 180, w: 36, h: 48 };
          if (pMsg && typeof pMsg === "object") {
            pMsg._bubbleText = ${JSON.stringify(msg.slice(0, 64))};
            pMsg._bubbleKind = "say";
            pMsg._bubbleUntil = ((api && api.state && api.state.time) || 0) + 2.5;
          }
          state.soundWaves.push({
            x: (pMsg.x || 0) + ((pMsg.w || 36) / 2),
            y: (pMsg.y || 0),
            radius: 10,
            maxRadius: 190,
            alpha: 1,
            label: ${JSON.stringify(msg.slice(0, 48))},
            color: "#60a5fa"
          });
        `);
        explanations.push(`Muestra el mensaje "${msg}" en el mapa.`);
        continue;
      }

      // 12. Teletransportar / Posición
      if (/teletransport|transportar|mover\s+a|posicion/.test(lower)) {
        hasSpecificMatch = true;
        const coords = rawAction.match(/(-?\d+)\s*[,x\s]\s*(-?\d+)/);
        const tx = coords ? Number(coords[1]) : numVal ?? 200;
        const ty = coords ? Number(coords[2]) : 240;
        scriptBlocks.push({
          id: uid(),
          kind: "teleport",
          x: tx,
          y: ty,
        });
        jsActionStatements.push(`
          var entTp = getTargetEntity(api, "player");
          if (entTp) { entTp.x = ${tx}; entTp.y = ${ty}; entTp.vx = 0; entTp.vy = 0; }
        `);
        explanations.push(`Teletransporta la entidad a (${tx}, ${ty}).`);
        continue;
      }

      // 13. Cambiar color / tamaño
      if (/color|pintar/.test(lower)) {
        hasSpecificMatch = true;
        const hexMatch = rawAction.match(/#[0-9a-fA-F]{3,6}/);
        const color = hexMatch
          ? hexMatch[0]
          : /rojo|red/.test(lower)
            ? "#ef4444"
            : /verde|green/.test(lower)
              ? "#22c55e"
              : /amarillo|oro|yellow/.test(lower)
                ? "#eab308"
                : /morado|purple/.test(lower)
                  ? "#a855f7"
                  : "#38bdf8";
        scriptBlocks.push({
          id: uid(),
          kind: "setColor",
          text: color,
        });
        jsActionStatements.push(`
          var entCol = getTargetEntity(api, "player");
          if (entCol) { entCol.color = ${JSON.stringify(color)}; }
        `);
        explanations.push(`Cambia el color a ${color}.`);
        continue;
      }

      if (/tamaño|escala|agrandar|encoger|gigante|pequeño/.test(lower)) {
        hasSpecificMatch = true;
        const factor = /encoger|pequeño/.test(lower) ? 0.7 : /gigante/.test(lower) ? 1.8 : 1.35;
        scriptBlocks.push({
          id: uid(),
          kind: "setSize",
          value: factor,
        });
        jsActionStatements.push(`
          var entSz = getTargetEntity(api, "player");
          if (entSz) {
            entSz.w = Math.max(8, Math.round((entSz.w || 40) * ${factor}));
            entSz.h = Math.max(8, Math.round((entSz.h || 40) * ${factor}));
          }
        `);
        explanations.push(`Escala el tamaño por ${factor}.`);
        continue;
      }

      // 14. Ganar / Perder
      if (/\b(ganar|victoria|completar\s+nivel)\b/.test(lower)) {
        hasSpecificMatch = true;
        scriptBlocks.push({ id: uid(), kind: "win" });
        jsActionStatements.push(`
          if (api && typeof api.win === "function") { api.win(); }
        `);
        explanations.push(`Activa la victoria de la partida.`);
        continue;
      }

      if (/\b(perder|derrota|morir|game\s*over)\b/.test(lower)) {
        hasSpecificMatch = true;
        scriptBlocks.push({ id: uid(), kind: "lose" });
        jsActionStatements.push(`
          if (api && typeof api.lose === "function") { api.lose(); }
        `);
        explanations.push(`Activa el fin de partida (derrota).`);
        continue;
      }

      // 15. Gravedad / Destruir
      if (/gravedad/.test(lower)) {
        hasSpecificMatch = true;
        const gVal = numVal !== null ? Math.max(0, numVal) : 800;
        scriptBlocks.push({
          id: uid(),
          kind: "setSceneGravity",
          value: gVal,
        });
        jsActionStatements.push(`
          if (api && typeof api.setGravity === "function") { api.setGravity(${gVal}); }
        `);
        explanations.push(`Ajusta la gravedad de la escena a ${gVal}.`);
        continue;
      }

      if (/destruir|eliminar|borrar|desaparecer/.test(lower)) {
        hasSpecificMatch = true;
        scriptBlocks.push({
          id: uid(),
          kind: "destroySelf",
        });
        jsActionStatements.push(`
          var entRm = getTargetEntity(api);
          if (entRm && api && typeof api.removeEntity === "function") { api.removeEntity(entRm.id); }
        `);
        explanations.push(`Destruye la entidad objetivo al cumplirse la regla.`);
        continue;
      }

      // Fallback universal: cualquier instrucción inventada por el usuario se traduce en HTML5 ejecutable
      const cleanLabel = rawAction.split(" (")[0].trim().slice(0, 44);
      scriptBlocks.push({
        id: uid(),
        kind: "sayForSecs",
        text: cleanLabel,
        value: 2,
      });
      scriptBlocks.push({
        id: uid(),
        kind: "playSound",
        text: "powerup",
      });
      jsActionStatements.push(`
        var pCustom = getTargetEntity(api, "player") || { x: 320, y: 200, w: 36, h: 48 };
        if (api && typeof api.playSound === "function") api.playSound("powerup");
        state.soundWaves.push({
          x: (pCustom.x || 0) + ((pCustom.w || 36) / 2),
          y: (pCustom.y || 0) + ((pCustom.h || 48) / 2),
          radius: 10,
          maxRadius: 210,
          alpha: 1,
          label: ${JSON.stringify(cleanLabel)},
          color: "#38bdf8"
        });
      `);
      explanations.push(
        `Ejecuta la instrucción personalizada "${cleanLabel}" en HTML5.`
      );
    }

    const scriptObj: Script = {
      id: uid(),
      event: eventType,
      key: block.key,
      interval: block.intervalMs,
      withKind: block.withKind,
      blocks: scriptBlocks,
      customLanguageCode: `${block.header}\n${block.actions.map((a) => a.split(" (")[0]).join("\n")}`,
      languageName: lang.name,
      aiExplanation: explanations[explanations.length - 1] || `Traducido a HTML5 desde ${lang.name}`,
    };
    compiledScripts.push(scriptObj);

    const jsTriggerBody = jsActionStatements.join("\n");
    if (eventType === "onLose") {
      jsHookSections.push(`
        // Bloque ${blockIndex + 1}: ${block.header.replace(/\r?\n/g, " ")}
        var isDeadNow_${blockIndex} = Boolean(
          (api && api.state && (api.state.dead || api.state.lives <= 0 || api.state.status === "lost")) ||
          (api && typeof api.getLives === "function" && api.getLives() <= 0)
        );
        var playerNow_${blockIndex} = api && typeof api.getPlayer === "function" ? api.getPlayer() : null;
        var fellInAbyss_${blockIndex} = Boolean(playerNow_${blockIndex} && typeof playerNow_${blockIndex}.y === "number" && playerNow_${blockIndex}.y > 680);
        if ((isDeadNow_${blockIndex} || fellInAbyss_${blockIndex}) && !state.loseTriggered_${blockIndex}) {
          state.loseTriggered_${blockIndex} = true;
          ${jsTriggerBody}
        } else if (!isDeadNow_${blockIndex} && !fellInAbyss_${blockIndex}) {
          state.loseTriggered_${blockIndex} = false;
        }
      `);
    } else if (eventType === "onWin") {
      jsHookSections.push(`
        var isWonNow_${blockIndex} = Boolean(api && api.state && (api.state.win || api.state.won || api.state.status === "won"));
        if (isWonNow_${blockIndex} && !state.winTriggered_${blockIndex}) {
          state.winTriggered_${blockIndex} = true;
          ${jsTriggerBody}
        } else if (!isWonNow_${blockIndex}) {
          state.winTriggered_${blockIndex} = false;
        }
      `);
    } else if (eventType === "onTimer") {
      const intervalSec = (block.intervalMs || 2000) / 1000;
      jsHookSections.push(`
        state.timerAcc_${blockIndex} = (state.timerAcc_${blockIndex} || 0) + (dt || 0.016);
        if (state.timerAcc_${blockIndex} >= ${intervalSec}) {
          state.timerAcc_${blockIndex} = 0;
          ${jsTriggerBody}
        }
      `);
    } else if (eventType === "onStart" || eventType === "onCreate") {
      jsHookSections.push(`
        if (!state.started_${blockIndex}) {
          state.started_${blockIndex} = true;
          ${jsTriggerBody}
        }
      `);
    } else if (eventType === "onUpdate") {
      jsHookSections.push(`
        ${jsTriggerBody}
      `);
    } else if (eventType === "onLand") {
      jsHookSections.push(`
        var landEnt_${blockIndex} = getTargetEntity(api, "player");
        var prevVy_${blockIndex} = state.prevVy_${blockIndex} || 0;
        var curVy_${blockIndex} = landEnt_${blockIndex} ? (landEnt_${blockIndex}.vy || 0) : 0;
        if (prevVy_${blockIndex} > 80 && curVy_${blockIndex} === 0) {
          ${jsTriggerBody}
        }
        state.prevVy_${blockIndex} = curVy_${blockIndex};
      `);
    } else if (eventType === "onLeaveScreen") {
      jsHookSections.push(`
        var leaveEnt_${blockIndex} = getTargetEntity(api, "player");
        var sc_${blockIndex} = api && typeof api.getScene === "function" ? api.getScene() : null;
        if (leaveEnt_${blockIndex} && sc_${blockIndex}) {
          var outNow_${blockIndex} = leaveEnt_${blockIndex}.x + leaveEnt_${blockIndex}.w < 0 || leaveEnt_${blockIndex}.x > sc_${blockIndex}.width || leaveEnt_${blockIndex}.y > sc_${blockIndex}.height + 200;
          if (outNow_${blockIndex} && !state.leftScreen_${blockIndex}) {
            state.leftScreen_${blockIndex} = true;
            ${jsTriggerBody}
          } else if (!outNow_${blockIndex}) {
            state.leftScreen_${blockIndex} = false;
          }
        }
      `);
    } else if (eventType === "onCollide") {
      const wantKind = block.withKind && block.withKind !== "any" ? JSON.stringify(block.withKind) : "null";
      jsCollideSections.push(`
        var wantKind_${blockIndex} = ${wantKind};
        var tgtEnt_${blockIndex} = getTargetEntity(api, "player");
        var matchPair_${blockIndex} = !tgtEnt_${blockIndex} || (a && a.id === tgtEnt_${blockIndex}.id) || (b && b.id === tgtEnt_${blockIndex}.id);
        var otherEnt_${blockIndex} = (tgtEnt_${blockIndex} && a && a.id === tgtEnt_${blockIndex}.id) ? b : a;
        var matchKind_${blockIndex} = !wantKind_${blockIndex} || (otherEnt_${blockIndex} && otherEnt_${blockIndex}.kind === wantKind_${blockIndex}) || (a && a.kind === wantKind_${blockIndex}) || (b && b.kind === wantKind_${blockIndex});
        if (matchPair_${blockIndex} && matchKind_${blockIndex}) {
          ${jsTriggerBody}
        }
      `);
    } else if (eventType === "onKeyDown") {
      const wantKey = block.key || "jump";
      const keyCond =
        wantKey === "left"
          ? `code === "ArrowLeft" || code === "KeyA" || key === "a" || key === "A"`
          : wantKey === "right"
            ? `code === "ArrowRight" || code === "KeyD" || key === "d" || key === "D"`
            : `code === "ArrowUp" || code === "KeyW" || code === "Space" || key === " "`;
      jsKeyDownSections.push(`
        if (${keyCond}) {
          ${jsTriggerBody}
        }
      `);
    }
  });

  const soundRegistrations = Object.entries(synthSounds)
    .map(
      ([name, spec]) =>
        `  if (window.AsternalAudio && typeof window.AsternalAudio.registerSound === "function") {\n` +
        `    window.AsternalAudio.registerSound(${JSON.stringify(name)}, ${JSON.stringify(spec)});\n` +
        `  }`
    )
    .join("\n");

  const targetIdLiteral = opts?.targetEntityId ? JSON.stringify(opts.targetEntityId) : "null";
  const targetKindLiteral = opts?.targetEntityKind ? JSON.stringify(opts.targetEntityKind) : "null";

  const compiledJs = [
    `// Script HTML5 · ${cleanCode.replace(/\r?\n/g, " | ")}`,
    `(function() {`,
    `  if (typeof window === "undefined" || !window.AsternalRuntime) return;`,
    soundRegistrations,
    `  var targetEntityId = ${targetIdLiteral};`,
    `  var targetEntityKind = ${targetKindLiteral};`,
    `  function getTargetEntity(api, fallbackKind) {`,
    `    if (!api) return null;`,
    `    var all = typeof api.getEntities === "function" ? api.getEntities() : [];`,
    `    if (targetEntityId) {`,
    `      for (var i = 0; i < all.length; i++) { if (all[i].id === targetEntityId) return all[i]; }`,
    `    }`,
    `    var k = targetEntityKind || fallbackKind;`,
    `    if (k) {`,
    `      for (var j = 0; j < all.length; j++) { if (all[j].kind === k) return all[j]; }`,
    `    }`,
    `    return typeof api.getPlayer === "function" ? api.getPlayer() : (all[0] || null);`,
    `  }`,
    `  var state = { soundWaves: [], flashAlpha: 0 };`,
    `  window.AsternalRuntime.registerHook({`,
    `    id: ${JSON.stringify(programId)},`,
    `    onInit: function(api) {`,
    `      state.soundWaves = [];`,
    `    },`,
    jsKeyDownSections.length > 0
      ? `    onKeyDown: function(code, key, api) {\n${jsKeyDownSections.join("\n")}\n    },`
      : "",
    jsCollideSections.length > 0
      ? `    onCollide: function(a, b, api) {\n${jsCollideSections.join("\n")}\n    },`
      : "",
    `    onTick: function(api, dt) {`,
    `      ${jsHookSections.join("\n")}`,
    `      for (var i = state.soundWaves.length - 1; i >= 0; i--) {`,
    `        var w = state.soundWaves[i];`,
    `        w.radius += (dt || 0.016) * 210;`,
    `        w.alpha = Math.max(0, 1 - (w.radius / (w.maxRadius || 260)));`,
    `        if (w.alpha <= 0.02) state.soundWaves.splice(i, 1);`,
    `      }`,
    `    },`,
    `    onRenderOverlay: function(ctx, api, W, H) {`,
    `      if (!ctx || !state.soundWaves.length) return;`,
    `      var camX = (api && api.camera && api.camera.x) || 0;`,
    `      var camY = (api && api.camera && api.camera.y) || 0;`,
    `      ctx.save();`,
    `      for (var i = 0; i < state.soundWaves.length; i++) {`,
    `        var w = state.soundWaves[i];`,
    `        var sx = w.x - camX;`,
    `        var sy = w.y - camY;`,
    `        ctx.strokeStyle = w.color || "#38bdf8";`,
    `        ctx.globalAlpha = w.alpha;`,
    `        ctx.lineWidth = 3;`,
    `        ctx.beginPath();`,
    `        ctx.arc(sx, sy, w.radius, 0, Math.PI * 2);`,
    `        ctx.stroke();`,
    `        ctx.beginPath();`,
    `        ctx.arc(sx, sy, Math.max(4, w.radius * 0.55), 0, Math.PI * 2);`,
    `        ctx.stroke();`,
    `        if (w.label) {`,
    `          ctx.font = "bold 12px Inter, system-ui, sans-serif";`,
    `          ctx.fillStyle = "#f8fafc";`,
    `          ctx.textAlign = "center";`,
    `          ctx.fillText(w.label, sx, sy - Math.min(48, w.radius * 0.45) - 10);`,
    `        }`,
    `      }`,
    `      ctx.restore();`,
    `    }`,
    `  });`,
    `})();`,
  ]
    .filter(Boolean)
    .join("\n");

  for (const s of compiledScripts) {
    s.compiledJs = compiledJs;
  }

  return {
    programId,
    title,
    sourceCode: cleanCode,
    expandedSourceCode: expandedCode,
    compiledJs,
    compiledScripts,
    synthSounds,
    explanation:
      explanations.join(" ") ||
      `Código en "${lang.name}" interpretado y traducido a JavaScript/HTML5 + ${compiledScripts.length} bloque(s) del motor.`,
    detectedKeywords,
    hasSpecificMatch,
  };
}
