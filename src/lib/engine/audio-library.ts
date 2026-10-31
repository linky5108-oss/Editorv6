import type { AudioAsset, Project } from "./core";
import { uid } from "./core";
import type { Script } from "./scripts";
import { loadCustomSounds, saveCustomSounds } from "./sfx";

/**
 * Obtiene la biblioteca unificada de sonidos y música del proyecto:
 * combina `project.assets.audio`, `localStorage` (`asternal:sounds`) y
 * cualquier pista subida en `project.settings.musicUrl` para que todos los
 * assets de audio estén disponibles tanto en Ajustes como en los Scripts manuales.
 */
export function getProjectAudioLibrary(project?: Project | null): AudioAsset[] {
  const byKey = new Map<string, AudioAsset>();

  const pushAsset = (raw: {
    id?: string;
    name?: string;
    url?: string;
    category?: "music" | "sfx";
  }) => {
    if (!raw || typeof raw.url !== "string" || !raw.url.trim()) return;
    const url = raw.url.trim();
    const existing = Array.from(byKey.values()).find((item) => item.url === url);
    const category: "music" | "sfx" =
      raw.category === "music" || raw.category === "sfx"
        ? raw.category
        : existing?.category ?? "music";
    const id = (raw.id && raw.id.trim()) || existing?.id || uid();
    const name =
      (raw.name && raw.name.trim()) ||
      existing?.name ||
      (category === "music" ? "Pista de música" : "Efecto de sonido");

    byKey.set(url, { id, name, url, category });
  };

  for (const item of loadCustomSounds()) {
    pushAsset({
      id: item.id,
      name: item.name,
      url: item.url,
      category: item.category ?? "music",
    });
  }

  for (const item of project?.assets?.audio ?? []) {
    pushAsset(item);
  }

  if (project?.settings?.musicUrl) {
    pushAsset({
      id: "project_bg_music",
      name: project.settings.musicName || "Música principal",
      url: project.settings.musicUrl,
      category: "music",
    });
  }

  return Array.from(byKey.values());
}

/**
 * Guarda la biblioteca de sonidos y música tanto en `project.assets.audio`
 * como en el almacenamiento local (`asternal:sounds`) para que el runtime HTML5
 * y los scripts manuales siempre la tengan sincronizada.
 */
export function saveAudioLibraryToProject(project: Project, list: AudioAsset[]): Project {
  const cleanList: AudioAsset[] = list
    .filter((a) => a && typeof a.url === "string" && a.url.trim())
    .map((a) => ({
      id: a.id || uid(),
      name: a.name.trim() || (a.category === "sfx" ? "Sonido" : "Música"),
      url: a.url.trim(),
      category: a.category === "sfx" ? "sfx" : "music",
    }));

  saveCustomSounds(
    cleanList.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      category: a.category,
    })),
  );

  const currentBgUrl = project.settings.musicUrl ?? null;
  const activeBgMatch = currentBgUrl
    ? cleanList.find((a) => a.url === currentBgUrl)
    : null;

  const nextSettings = { ...project.settings };
  if (currentBgUrl && !activeBgMatch) {
    nextSettings.musicUrl = null;
    nextSettings.musicName = null;
    nextSettings.music = false;
  } else if (activeBgMatch) {
    nextSettings.musicName = activeBgMatch.name;
  }

  return {
    ...project,
    settings: nextSettings,
    assets: {
      sprites: project.assets?.sprites ?? [],
      audio: cleanList,
    },
  };
}

export interface AudioIntentDetection {
  /** Si la instrucción pide poner/reproducir música o sonido. */
  isAudioRequest: boolean;
  /** Qué tipo de audio pide principalmente ("music" o "sfx"). */
  intentKind: "music" | "sfx";
  /** Si la persona ya escribió el nombre exacto de uno de los audios en su mensaje. */
  matchedAsset: AudioAsset | null;
  /**
   * Si hay audios guardados en la biblioteca y la instrucción pide música/sonido
   * sin especificar cuál, vale `true` para preguntarle cuál quiere usar.
   */
  needsDisambiguation: boolean;
  /** Lista de pistas/sonidos candidatos detectados en la biblioteca. */
  candidates: AudioAsset[];
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Detecta cuando el usuario pide a los scripts manuales poner música o sonido
 * y verifica si tiene pistas/sonidos en la biblioteca de Ajustes.
 */
export function detectAudioRequestAndCandidates(
  promptText: string,
  library: AudioAsset[],
): AudioIntentDetection {
  const norm = normalizeForMatch(promptText);
  if (!norm || library.length === 0) {
    return {
      isAudioRequest: false,
      intentKind: "music",
      matchedAsset: null,
      needsDisambiguation: false,
      candidates: [],
    };
  }

  const asksMusic =
    /\b(musica|cancion|pista|tema|melodia|soundtrack|bgm|fondo musical|poner musica|ponga musica|reproducir musica|suene musica|sonar musica|cambiar musica)\b/i.test(
      norm,
    );
  const asksSfx =
    /\b(sonido|efecto de sonido|sfx|audio|suene|sonar|reproducir|reproduce)\b/i.test(
      norm,
    );

  if (!asksMusic && !asksSfx) {
    return {
      isAudioRequest: false,
      intentKind: "music",
      matchedAsset: null,
      needsDisambiguation: false,
      candidates: [],
    };
  }

  const intentKind: "music" | "sfx" = asksMusic ? "music" : "sfx";

  // Comprobar si el usuario ya nombró explícitamente uno de los assets en su prompt
  const sortedByNameLen = [...library].sort((a, b) => b.name.length - a.name.length);
  for (const asset of sortedByNameLen) {
    const assetNorm = normalizeForMatch(asset.name);
    if (assetNorm.length >= 2 && norm.includes(assetNorm)) {
      return {
        isAudioRequest: true,
        intentKind: asset.category,
        matchedAsset: asset,
        needsDisambiguation: false,
        candidates: [asset],
      };
    }
  }

  // Filtrar candidatos priorizando la categoría pedida (si hay pistas de música cuando pide música),
  // o mostrando toda la biblioteca de audio si todas las pistas sirven.
  const sameCategory = library.filter((a) => a.category === intentKind);
  const candidates = sameCategory.length > 0 ? sameCategory : library;

  return {
    isAudioRequest: true,
    intentKind,
    matchedAsset: null,
    needsDisambiguation: candidates.length >= 1,
    candidates,
  };
}

/**
 * Construye la pregunta clara cuando el sistema detecta que tienes música/sonidos
 * en la biblioteca y te pregunta cuál quieres usar.
 */
export function buildAudioSelectionQuestion(
  candidates: AudioAsset[],
  intentKind: "music" | "sfx" = "music",
): string {
  const labelPlural = intentKind === "music" ? "pistas de música" : "audios";
  if (candidates.length === 2) {
    return `Detecté que tienes 2 ${labelPlural} en tu biblioteca de ajustes («${candidates[0].name}» y «${candidates[1].name}»). ¿Cuál de los dos quieres poner en el script manual?`;
  }
  if (candidates.length === 1) {
    return `Detecté «${candidates[0].name}» en tu biblioteca de sonidos y música. ¿Quieres usar este audio en el script manual o prefieres elegir otro?`;
  }
  const names = candidates.map((c) => `«${c.name}»`).join(", ");
  return `Detecté ${candidates.length} ${labelPlural} en tu biblioteca de ajustes (${names}). ¿Cuál quieres utilizar en este script manual?`;
}

/**
 * Enriquece la instrucción del usuario indicando a la IA exactamente qué asset de la
 * biblioteca eligió la persona para que el script manual lo conecte.
 */
export function applyChosenAudioToInstruction(
  originalInstruction: string,
  asset: AudioAsset,
): string {
  const blockKind = asset.category === "music" ? "playMusic" : "playSound";
  return `${originalInstruction}\n[Audio elegido de la biblioteca de Ajustes: nombre="${asset.name}", id="${asset.id}", categoría="${asset.category}". Usa el bloque "${blockKind}" con soundName="${asset.name}" y soundUrl="${asset.id}", o window.AsternalAudio.${asset.category === "music" ? "playMusic" : "play"}("${asset.name}").]`;
}

/**
 * Garantiza que los scripts generados por la IA para una petición con audio elegido
 * de la biblioteca tengan conectado el `soundUrl` y `soundName` reales del asset.
 */
export function injectAudioAssetIntoScripts(
  scripts: Script[],
  asset: AudioAsset,
  requestText = "",
): Script[] {
  const norm = normalizeForMatch(requestText);
  const defaultEvent: Script["event"] =
    /\b(chocar|choque|choca|tocar|toque|toca|colision|pisar|pise|pisa|recoger|recoja|recoge|golpear|golpee|golpea|entrar|entre|entra)\b/.test(norm)
      ? "onCollide"
      : /\b(tecla|pulsar|pulse|presionar|presione|boton)\b/.test(norm)
        ? "onKeyDown"
        : /\b(ganar|gane|meta|victoria)\b/.test(norm)
          ? "onWin"
          : /\b(perder|pierda|morir|muera|muerte)\b/.test(norm)
            ? "onLose"
            : "onStart";

  const inferredWithKind: Script["withKind"] = /\b(moneda|monedas|coin)\b/.test(norm)
    ? "coin"
    : /\b(enemigo|enemigos|enemy)\b/.test(norm)
      ? "enemy"
      : /\b(plataforma|platform)\b/.test(norm)
        ? "platform"
        : /\b(objeto|meta|goal)\b/.test(norm)
          ? "goal"
          : "player";

  const targetBlockKind = asset.category === "music" ? "playMusic" : "playSound";

  if (!scripts || scripts.length === 0) {
    return [
      {
        id: uid(),
        event: defaultEvent,
        ...(defaultEvent === "onCollide" ? { withKind: inferredWithKind } : {}),
        blocks: [
          {
            id: uid(),
            kind: targetBlockKind,
            soundUrl: asset.url,
            soundName: asset.name,
            text: asset.name,
          },
        ],
      },
    ];
  }

  let hasAudioBlock = false;
  const updated = scripts.map((sc) => ({
    ...sc,
    blocks: sc.blocks.map((b) => {
      if (b.kind === "playMusic" || b.kind === "playSound") {
        hasAudioBlock = true;
        return {
          ...b,
          kind: asset.category === "music" ? "playMusic" : b.kind,
          soundUrl: asset.url,
          soundName: asset.name,
          text: asset.name,
        };
      }
      return b;
    }),
  }));

  if (!hasAudioBlock) {
    updated[0] = {
      ...updated[0],
      blocks: [
        ...updated[0].blocks,
        {
          id: uid(),
          kind: targetBlockKind,
          soundUrl: asset.url,
          soundName: asset.name,
          text: asset.name,
        },
      ],
    };
  }

  return updated;
}
