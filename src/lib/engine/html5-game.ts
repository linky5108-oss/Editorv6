import type { CustomRuntimeConfig, CustomSoundSynth, Entity, Project, Scene, SpriteAsset } from "./core";
import { ensureSceneLayers, uid } from "./core";
import { loadCustomSounds, type CustomSound } from "./sfx";

export interface Html5GameOptions {
  /** Escena inicial que se va a ejecutar. */
  scene: Scene;
  /** Lista completa de escenas del proyecto (para transiciones entre niveles dentro del HTML5). */
  scenes?: Scene[];
  /** Recursos del proyecto (sprites, animaciones, etc.) distribuidos en el archivo HTML5. */
  assets?: Project["assets"];
  /** Título del juego para el documento HTML5. */
  title?: string;
  /** Tope de FPS (30, 60, 120). El bucle corre de forma nativa en el dispositivo con subpasos físicos. */
  fpsCap?: 30 | 60 | 120;
  showHUD?: boolean;
  showFPS?: boolean;
  volume?: number;
  muted?: boolean;
  music?: boolean;
  musicUrl?: string | null;
  touchControls?: boolean;
  autoPause?: boolean;
  showHitboxes?: boolean;
  /** Sonidos personalizados de la biblioteca local para bloques playSound / playRandomSound. */
  customSounds?: CustomSound[];
  /** Extensiones personalizadas del runtime HTML5 (nuevas lógicas, sonidos sintetizados, CSS, overrides). */
  customRuntime?: CustomRuntimeConfig;
  /** Si es true, muestra el botón para volver al editor / cerrar vista previa. */
  embedded?: boolean;
}

/**
 * Serializa datos de forma segura para incrustarlos dentro de una etiqueta <script> HTML5,
 * escapando secuencias como `</script>` o separadores de línea Unicode.
 */
export function serializeForHtmlScript(data: unknown, pretty = false): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unescapeHtmlText(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export const DEFAULT_CUSTOM_RUNTIME_COMMENT = [
  "// Espacio editable del runtime HTML5 de Asternal (gestionado por Orión y el editor).",
  "// Puedes registrar nuevas lógicas, mecánicas, físicas, controles, renderizado y sonidos",
  "// usando window.AsternalRuntime.registerHook({ onInit, onTick, onCollide, onRender, onKeyDown, customBlocks })",
  "// y window.AsternalAudio.registerSound(nombre, { wave, freq, endFreq, duration, volume }).",
].join("\n");

/**
 * Compila una escena o proyecto completo en un documento HTML5 autónomo (`<!DOCTYPE html>...`).
 *
 * El archivo resultante no depende de React, ni del DOM del editor, ni de la infraestructura
 * de la aplicación: ejecuta el motor de juego directamente sobre HTML5 Canvas y WebAudio
 * aprovechando el `requestAnimationFrame` nativo y la potencia real del dispositivo.
 * Además, toda su distribución de assets, escenas, lógicas, sonidos y comportamientos
 * es 100% editable desde el propio archivo HTML5.
 */
export function buildStandaloneGameHtml(options: Html5GameOptions): string {
  const {
    scene,
    scenes,
    assets,
    title = scene.name || "Asternal HTML5 Game",
    fpsCap = 60,
    showHUD = true,
    showFPS = true,
    volume = 0.8,
    muted = false,
    music = false,
    musicUrl = null,
    touchControls = true,
    autoPause = true,
    showHitboxes = false,
    customSounds = loadCustomSounds(),
    customRuntime,
    embedded = true,
  } = options;

  const allScenes = scenes && scenes.length > 0 ? scenes : [scene];
  const payloadJson = serializeForHtmlScript(
    {
      initialSceneId: scene.id,
      scenes: allScenes,
      assets: assets ?? { sprites: [] },
      config: {
        fpsCap,
        showHUD,
        showFPS,
        volume,
        muted,
        music,
        musicUrl,
        touchControls,
        autoPause,
        showHitboxes,
        embedded,
      },
      customSounds,
      synthSounds: customRuntime?.synthSounds ?? {},
    },
    true,
  );

  const safeTitle = escapeHtmlText(title);
  const customCss = (customRuntime?.cssCode ?? "").trim();
  const customJs = (customRuntime?.jsCode ?? "").trim() || DEFAULT_CUSTOM_RUNTIME_COMMENT;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
<title>${safeTitle}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #020617;
    color: #f8fafc;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  #game-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  #game-canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .top-bar {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    right: max(12px, env(safe-area-inset-right));
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    z-index: 20;
  }
  .badge-fps {
    background: rgba(2, 6, 23, 0.78);
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 6px;
    padding: 4px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    font-weight: 600;
    color: #7dd3fc;
    letter-spacing: 0.04em;
  }
  .btn-stop {
    pointer-events: auto;
    cursor: pointer;
    background: rgba(2, 6, 23, 0.82);
    border: 1px solid rgba(56, 189, 248, 0.55);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #f8fafc;
    transition: transform 0.1s ease, background 0.15s ease;
  }
  .btn-stop:active { transform: scale(0.95); background: rgba(56, 189, 248, 0.25); }
  .touch-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 16px max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    pointer-events: none;
    z-index: 15;
  }
  .touch-group { display: flex; gap: 12px; }
  .touch-btn {
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    width: 64px;
    height: 64px;
    border-radius: 9999px;
    background: rgba(2, 6, 23, 0.72);
    border: 1.5px solid rgba(56, 189, 248, 0.55);
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.18);
    color: #7dd3fc;
    font-size: 22px;
    font-weight: 700;
    display: grid;
    place-items: center;
    transition: transform 0.08s ease, background 0.1s ease;
  }
  .touch-btn.big { width: 80px; height: 80px; font-size: 15px; letter-spacing: 0.06em; }
  .touch-btn.active { transform: scale(0.94); background: rgba(56, 189, 248, 0.3); }
  .overlay-end {
    position: absolute;
    inset: 0;
    background: rgba(2, 6, 23, 0.72);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 30;
  }
  .overlay-end.visible { display: flex; }
  .end-card {
    background: rgba(9, 14, 28, 0.95);
    border: 1px solid rgba(56, 189, 248, 0.5);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 24px rgba(56, 189, 248, 0.2);
    border-radius: 16px;
    padding: 24px 32px;
    text-align: center;
    min-width: 260px;
  }
  .end-title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #7dd3fc;
    text-shadow: 0 0 14px rgba(56, 189, 248, 0.45);
    margin-bottom: 8px;
  }
  .end-score {
    font-size: 14px;
    color: #94a3b8;
    margin-bottom: 18px;
  }
  .end-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .btn-primary {
    cursor: pointer;
    background: #0ea5e9;
    color: #020617;
    border: 1px solid #7dd3fc;
    border-radius: 8px;
    padding: 9px 18px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }
  .btn-secondary {
    cursor: pointer;
    background: rgba(30, 41, 59, 0.8);
    color: #e2e8f0;
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }
  .dialog-wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 14px;
    z-index: 25;
    display: none;
  }
  .dialog-wrap.visible { display: block; }
  .dialog-card {
    max-width: 720px;
    margin: 0 auto;
    background: rgba(2, 6, 23, 0.94);
    border: 1px solid rgba(56, 189, 248, 0.38);
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
    overflow: hidden;
    cursor: pointer;
  }
  .dialog-header {
    padding: 12px 16px 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dialog-portrait {
    width: 36px;
    height: 36px;
    border-radius: 9999px;
    object-fit: cover;
    border: 1px solid rgba(56, 189, 248, 0.45);
    display: none;
  }
  .dialog-speaker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #38bdf8;
    text-transform: uppercase;
  }
  .dialog-text {
    padding: 4px 16px 12px;
    font-size: 15px;
    line-height: 1.4;
    color: #f8fafc;
  }
  .dialog-footer {
    padding: 0 16px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    color: #94a3b8;
  }
  /* __ASTERNAL_CUSTOM_CSS_START__ */
  ${customCss}
  /* __ASTERNAL_CUSTOM_CSS_END__ */
</style>
</head>
<body>
<div id="game-root">
  <canvas id="game-canvas"></canvas>

  <div class="top-bar">
    <div id="fps-badge" class="badge-fps" style="display:none">60 FPS</div>
    <button id="btn-stop" type="button" class="btn-stop" style="display:none">STOP</button>
  </div>

  <div id="touch-bar" class="touch-bar" style="display:none">
    <div class="touch-group">
      <button id="touch-left" type="button" class="touch-btn">◀</button>
      <button id="touch-right" type="button" class="touch-btn">▶</button>
    </div>
    <button id="touch-jump" type="button" class="touch-btn big">JUMP</button>
  </div>

  <div id="overlay-end" class="overlay-end">
    <div class="end-card">
      <div id="end-title" class="end-title">LEVEL CLEAR</div>
      <div id="end-score" class="end-score">Score: 0</div>
      <div class="end-actions">
        <button id="btn-retry" type="button" class="btn-secondary">REINTENTAR</button>
        <button id="btn-back" type="button" class="btn-primary">BACK TO EDITOR</button>
      </div>
    </div>
  </div>

  <div id="dialog-wrap" class="dialog-wrap">
    <div id="dialog-card" class="dialog-card">
      <div id="dialog-header" class="dialog-header">
        <img id="dialog-portrait" class="dialog-portrait" alt="" />
        <div id="dialog-speaker" class="dialog-speaker"></div>
      </div>
      <div id="dialog-text" class="dialog-text"></div>
      <div class="dialog-footer">
        <span id="dialog-count">1 / 1</span>
        <span>▶ tap to continue</span>
      </div>
    </div>
  </div>
</div>

<script id="asternal-game-payload" type="application/json">${payloadJson}</script>
<script>
(function() {
  "use strict";

  var payloadEl = document.getElementById("asternal-game-payload");
  var PAYLOAD = JSON.parse(payloadEl ? payloadEl.textContent : "{}");
  var SCENES = Array.isArray(PAYLOAD.scenes) && PAYLOAD.scenes.length ? PAYLOAD.scenes : [];
  var CONFIG = PAYLOAD.config || {};
  var CUSTOM_SOUNDS = Array.isArray(PAYLOAD.customSounds) ? PAYLOAD.customSounds : [];

  var KIND_PRESETS = {
    player: { kind: "player", w: 40, h: 56, vx: 0, vy: 0, color: "#38bdf8", solid: true, gravity: true, controllable: true, collectible: false, hazard: false, goal: false, visible: true, opacity: 1, texture: null },
    platform: { kind: "platform", w: 40, h: 40, vx: 0, vy: 0, color: "#1e3a8a", solid: true, gravity: false, controllable: false, collectible: false, hazard: false, goal: false, visible: true, opacity: 1, texture: null },
    enemy: { kind: "enemy", w: 40, h: 40, vx: 60, vy: 0, color: "#f43f5e", solid: false, gravity: true, controllable: false, collectible: false, hazard: true, goal: false, visible: true, opacity: 1, texture: null },
    coin: { kind: "coin", w: 22, h: 22, vx: 0, vy: 0, color: "#fbbf24", solid: false, gravity: false, controllable: false, collectible: true, hazard: false, goal: false, visible: true, opacity: 1, texture: null },
    goal: { kind: "goal", w: 36, h: 64, vx: 0, vy: 0, color: "#7dd3fc", solid: false, gravity: false, controllable: false, collectible: false, hazard: false, goal: true, visible: true, opacity: 1, texture: null },
    decor: { kind: "decor", w: 64, h: 64, vx: 0, vy: 0, color: "#a78bfa", solid: false, gravity: false, controllable: false, collectible: false, hazard: false, goal: false, visible: true, opacity: 1, texture: null, z: -1 }
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // --- Image Cache ---
  var imgCache = new Map();
  function getRenderableImage(src) {
    if (!src) return null;
    var img = imgCache.get(src);
    if (img) return (img.complete && img.naturalWidth > 0) ? img : null;
    img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.src = src;
    imgCache.set(src, img);
    return (img.complete && img.naturalWidth > 0) ? img : null;
  }

  function preloadSceneImages(scene) {
    if (!scene) return;
    if (scene.bgImage) getRenderableImage(scene.bgImage);
    var ents = scene.entities || [];
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.texture) getRenderableImage(e.texture);
      if (e.animations) {
        for (var a = 0; a < e.animations.length; a++) {
          var frames = e.animations[a].frames || [];
          for (var f = 0; f < frames.length; f++) getRenderableImage(frames[f]);
        }
      }
      if (e.dialog && e.dialog.lines) {
        for (var l = 0; l < e.dialog.lines.length; l++) {
          if (e.dialog.lines[l].portrait) getRenderableImage(e.dialog.lines[l].portrait);
        }
      }
    }
    var ui = scene.ui || [];
    for (var u = 0; u < ui.length; u++) {
      if (ui[u].image) getRenderableImage(ui[u].image);
    }
  }
  for (var si = 0; si < SCENES.length; si++) preloadSceneImages(SCENES[si]);

  // --- Audio & WebAudio Procedural Synthesizer ---
  var volume = typeof CONFIG.volume === "number" ? CONFIG.volume : 0.8;
  var muted = !!CONFIG.muted;
  var playingAudio = [];
  var musicEl = null;
  var musicSrc = null;
  var audioCtx = null;

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try { audioCtx = new Ctx(); } catch (e) { audioCtx = null; }
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try { audioCtx.resume(); } catch (e) {}
    }
    return audioCtx;
  }

  var SYNTH_PRESETS = {
    jump: { wave: "sine", freq: 240, endFreq: 560, duration: 0.16, volume: 0.35 },
    coin: { wave: "sine", freq: 587.33, endFreq: 1174.66, duration: 0.18, volume: 0.35 },
    laser: { wave: "sawtooth", freq: 780, endFreq: 160, duration: 0.18, volume: 0.3 },
    dash: { wave: "triangle", freq: 180, endFreq: 680, duration: 0.14, volume: 0.4 },
    explosion: { wave: "sawtooth", freq: 140, endFreq: 32, duration: 0.38, volume: 0.45 },
    powerup: { wave: "triangle", freq: 330, endFreq: 880, duration: 0.28, volume: 0.35 },
    hit: { wave: "square", freq: 160, endFreq: 65, duration: 0.15, volume: 0.35 },
    victory: { wave: "triangle", freq: 440, endFreq: 880, duration: 0.42, volume: 0.4 },
    bounce: { wave: "sine", freq: 190, endFreq: 480, duration: 0.22, volume: 0.38 },
    portal: { wave: "sine", freq: 320, endFreq: 960, duration: 0.32, volume: 0.35 }
  };

  var registeredSounds = Object.assign({}, SYNTH_PRESETS, PAYLOAD.synthSounds || {});

  function playSynthSpec(spec) {
    if (muted || !spec) return false;
    if (typeof spec === "function") {
      try { spec(getAudioContext(), volume); return true; } catch (e) { return false; }
    }
    if (spec.url && !spec.freq) return playRawAudioUrl(spec.url);
    var actx = getAudioContext();
    if (!actx) return false;
    try {
      var now = actx.currentTime;
      var dur = Math.max(0.03, Math.min(3, Number(spec.duration) || 0.18));
      var osc = actx.createOscillator();
      var gain = actx.createGain();
      osc.type = spec.wave || "sine";
      var startF = Math.max(20, Number(spec.freq) || 440);
      var endF = Math.max(20, Number(spec.endFreq !== undefined ? spec.endFreq : startF));
      osc.frequency.setValueAtTime(startF, now);
      if (endF !== startF) {
        osc.frequency.exponentialRampToValueAtTime(endF, now + dur);
      }
      var peak = Math.max(0.01, Math.min(1, (spec.volume !== undefined ? spec.volume : 0.35) * volume));
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.01);
      return true;
    } catch (e) {
      return false;
    }
  }

  function playRawAudioUrl(url) {
    if (muted || !url || typeof Audio === "undefined") return false;
    try {
      var a = new Audio(url);
      a.volume = Math.max(0, Math.min(1, volume));
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function() {});
      playingAudio.push(a);
      playingAudio = playingAudio.filter(function(el) { return !el.ended && !el.paused; }).slice(-8);
      return true;
    } catch (e) {
      return false;
    }
  }

  function playSoundUrl(urlOrName) {
    if (muted || !urlOrName) return false;
    var key = String(urlOrName).trim();
    if (key.indexOf("synth:") === 0) key = key.slice(6);
    if (registeredSounds[key]) return playSynthSpec(registeredSounds[key]);
    for (var i = 0; i < CUSTOM_SOUNDS.length; i++) {
      if (CUSTOM_SOUNDS[i] && (CUSTOM_SOUNDS[i].name === key || CUSTOM_SOUNDS[i].id === key)) {
        return playRawAudioUrl(CUSTOM_SOUNDS[i].url);
      }
    }
    return playRawAudioUrl(urlOrName);
  }

  function playRandomCustomSound() {
    if (CUSTOM_SOUNDS.length) {
      var pick = CUSTOM_SOUNDS[Math.floor(Math.random() * CUSTOM_SOUNDS.length)];
      if (pick && pick.url) return playSoundUrl(pick.url);
    }
    var keys = Object.keys(registeredSounds);
    if (!keys.length) return false;
    var rKey = keys[Math.floor(Math.random() * keys.length)];
    return playSynthSpec(registeredSounds[rKey]);
  }

  window.AsternalAudio = {
    play: function(nameOrUrl) { return playSoundUrl(nameOrNameOrSpec(nameOrUrl)); },
    synth: function(spec) { return playSynthSpec(spec); },
    registerSound: function(name, spec) {
      if (name && spec) registeredSounds[name] = spec;
    },
    getRegisteredSounds: function() { return registeredSounds; }
  };
  function nameOrNameOrSpec(v) {
    if (v && typeof v === "object") { playSynthSpec(v); return ""; }
    return v;
  }

  // --- Runtime Extension & Hook Registry (Editable in HTML5) ---
  var runtimeHooksList = [];
  var customBlockHandlers = {};
  var runtimePhysics = {
    baseSpeed: 220,
    jumpForce: 520,
    terminalVelocity: 1200,
    coyoteTime: 0.10,
    jumpBuffer: 0.12,
    jumpCut: 0.45
  };

  window.AsternalRuntime = {
    physics: runtimePhysics,
    hooks: runtimeHooksList,
    customBlocks: customBlockHandlers,
    registerHook: function(hook) {
      if (typeof hook === "function") {
        runtimeHooksList.push({ onTick: hook });
        return;
      }
      if (!hook || typeof hook !== "object") return;
      var normalized = Object.assign({}, hook);
      if (!normalized.onTick && typeof normalized.onUpdate === "function") normalized.onTick = normalized.onUpdate;
      if (!normalized.onRender && typeof normalized.onDraw === "function") normalized.onRender = normalized.onDraw;
      if (!normalized.onKeyDown && typeof normalized.onKey === "function") normalized.onKeyDown = normalized.onKey;
      if (!normalized.onInit && typeof normalized.onStart === "function") normalized.onInit = normalized.onStart;
      runtimeHooksList.push(normalized);
      if (normalized.customBlocks && typeof normalized.customBlocks === "object") {
        Object.keys(normalized.customBlocks).forEach(function(k) {
          customBlockHandlers[k] = normalized.customBlocks[k];
        });
      }
    },
    registerBlock: function(kind, fn) {
      if (kind && typeof fn === "function") customBlockHandlers[kind] = fn;
    }
  };

  function vibrate(ms) {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  function stopMusic() {
    if (musicEl) {
      try { musicEl.pause(); } catch (e) {}
      musicEl = null;
      musicSrc = null;
    }
  }

  function startMusic(url) {
    if (muted || !url) { stopMusic(); return; }
    if (musicEl && musicSrc === url) {
      musicEl.volume = Math.max(0, Math.min(1, volume));
      if (musicEl.paused) musicEl.play().catch(function() {});
      return;
    }
    stopMusic();
    try {
      var a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(function() {});
      musicEl = a;
      musicSrc = url;
    } catch (e) {}
  }

  function syncAudioConfig() {
    if (musicEl) musicEl.volume = Math.max(0, Math.min(1, volume));
    if (CONFIG.music && !muted && CONFIG.musicUrl) startMusic(CONFIG.musicUrl);
    else stopMusic();
  }
  syncAudioConfig();

  // --- Animations ---
  function pickAnimState(e) {
    if (e.controllable || e.kind === "enemy") {
      if (e.vy < -60) return "jump";
      if (e.vy > 80) return "fall";
      if (Math.abs(e.vx) > 10) return "walk";
      return "idle";
    }
    return "idle";
  }

  function findClip(e, st) {
    var list = e.animations || [];
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) if (list[i].name === st) return list[i];
    for (var j = 0; j < list.length; j++) if (list[j].name === "idle") return list[j];
    return list[0];
  }

  function currentFrameRenderable(e, time, state) {
    var st = state || pickAnimState(e);
    var clip = findClip(e, st);
    var src = null;
    if (!clip || !clip.frames || !clip.frames.length) {
      src = e.texture || null;
    } else {
      var total = clip.frames.length;
      var fps = Math.max(1, clip.fps || 8);
      var idx = Math.floor(time * fps);
      var i = clip.loop ? ((idx % total) + total) % total : Math.min(idx, total - 1);
      src = clip.frames[i];
    }
    return src ? getRenderableImage(src) : null;
  }

  // --- Layers & Hierarchy ---
  function sortedForRender(scene) {
    var layerZ = new Map();
    var layers = scene.layers || [];
    for (var i = 0; i < layers.length; i++) layerZ.set(layers[i].id, layers[i].z);
    return scene.entities.slice().sort(function(a, b) {
      var az = (a.layerId && layerZ.has(a.layerId)) ? layerZ.get(a.layerId) : 0;
      var bz = (b.layerId && layerZ.has(b.layerId)) ? layerZ.get(b.layerId) : 0;
      if (az !== bz) return az - bz;
      return (a.z || 0) - (b.z || 0);
    });
  }

  function isOnHiddenLayer(scene, e) {
    if (!e.layerId || !scene.layers) return false;
    for (var i = 0; i < scene.layers.length; i++) {
      if (scene.layers[i].id === e.layerId) return scene.layers[i].visible === false;
    }
    return false;
  }

  function layerOpacityFor(scene, e) {
    if (!e.layerId || !scene.layers) return 1;
    for (var i = 0; i < scene.layers.length; i++) {
      if (scene.layers[i].id === e.layerId) {
        return scene.layers[i].opacity !== undefined ? scene.layers[i].opacity : 1;
      }
    }
    return 1;
  }

  function entityById(scene, id) {
    if (!id) return null;
    for (var i = 0; i < scene.entities.length; i++) {
      if (scene.entities[i].id === id) return scene.entities[i];
    }
    return null;
  }

  function hierarchyDepth(scene, e) {
    var depth = 0;
    var current = e;
    var seen = new Set([e.id]);
    while (current && current.parentId) {
      var parent = entityById(scene, current.parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth += 1;
      current = parent;
    }
    return depth;
  }

  function syncChildrenWithParents(scene) {
    var byId = new Map();
    for (var i = 0; i < scene.entities.length; i++) byId.set(scene.entities[i].id, scene.entities[i]);
    var childrenByParent = new Map();
    for (var j = 0; j < scene.entities.length; j++) {
      var ent = scene.entities[j];
      var pid = (ent.parentId && ent.parentId !== ent.id && byId.has(ent.parentId)) ? ent.parentId : null;
      if (!pid) continue;
      var list = childrenByParent.get(pid) || [];
      list.push(ent);
      childrenByParent.set(pid, list);
    }
    if (childrenByParent.size === 0) {
      for (var k = 0; k < scene.entities.length; k++) {
        scene.entities[k]._px = scene.entities[k].x;
        scene.entities[k]._py = scene.entities[k].y;
      }
      return;
    }
    var order = scene.entities.slice().sort(function(a, b) {
      return hierarchyDepth(scene, a) - hierarchyDepth(scene, b);
    });
    for (var m = 0; m < order.length; m++) {
      var e = order[m];
      var dx = e.x - (e._px !== undefined ? e._px : e.x);
      var dy = e.y - (e._py !== undefined ? e._py : e.y);
      if ((dx || dy) && e.x > -9000 && e.y > -9000) {
        var ch = childrenByParent.get(e.id) || [];
        for (var c = 0; c < ch.length; c++) {
          ch[c].x += dx;
          ch[c].y += dy;
        }
      }
      e._px = e.x;
      e._py = e.y;
    }
  }

  // --- Physics & Step ---
  function aabb(e) {
    var hb = e.hitbox;
    if (hb) return { x: e.x + hb.x, y: e.y + hb.y, w: hb.w, h: hb.h };
    return { x: e.x, y: e.y, w: e.w, h: e.h };
  }

  function intersects(a, b) {
    var A = aabb(a), B = aabb(b);
    return A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y;
  }

  function newRuntimeState(scene) {
    return {
      score: 0,
      lives: (scene && scene.startLives) ? scene.startLives : 1,
      win: false,
      dead: false,
      cameraX: 0,
      time: 0,
      jumpPrev: false,
      djumpAvailable: false,
      canDjump: false,
      coyoteT: 0,
      jumpBufferT: 0,
      invulnT: 0,
      speedT: 0,
      switches: {},
      checkpoint: null,
      particles: [],
      dialog: null,
      dialogQueue: [],
      dialogAdvance: false
    };
  }

  function startDialog(state, ent) {
    var d = ent.dialog;
    if (!d || !d.lines || !d.lines.length) return;
    var line = d.lines[0];
    state.dialog = {
      entityId: ent.id,
      speaker: line.speaker || (d.lines[0] && d.lines[0].speaker) || ent.name || ent.kind,
      text: line.text,
      portrait: line.portrait || null,
      lineIndex: 0,
      totalLines: d.lines.length,
      pauses: !!d.pausesGame
    };
    ent._dialogPlayed = true;
  }

  function advanceDialog(state, scene) {
    if (!state.dialog) return;
    var ent = entityById(scene, state.dialog.entityId);
    if (!ent || !ent.dialog) { state.dialog = null; return; }
    var next = state.dialog.lineIndex + 1;
    if (next >= ent.dialog.lines.length) {
      state.dialog = null;
      return;
    }
    var line = ent.dialog.lines[next];
    state.dialog = {
      entityId: state.dialog.entityId,
      lineIndex: next,
      totalLines: state.dialog.totalLines,
      pauses: state.dialog.pauses,
      speaker: line.speaker || state.dialog.speaker,
      text: line.text,
      portrait: line.portrait !== undefined ? line.portrait : state.dialog.portrait
    };
  }

  function emitBurst(state, p) {
    if (!state.particles) state.particles = [];
    state.particles.push(p);
  }

  function stepScene(scene, input, state, dt, onGoalReached) {
    var BASE_SPEED = runtimePhysics.baseSpeed || 220;
    var JUMP = runtimePhysics.jumpForce || 520;

    for (var i0 = 0; i0 < scene.entities.length; i0++) {
      var e0 = scene.entities[i0];
      if (e0._px === undefined) { e0._px = e0.x; e0._py = e0.y; }
    }

    for (var idg = 0; idg < scene.entities.length; idg++) {
      var ed = scene.entities[idg];
      if (!ed.dialog || ed._dialogPlayed) continue;
      if (ed.dialog.trigger === "auto" && !state.dialog) {
        startDialog(state, ed);
        break;
      }
    }

    if (state.dialog) {
      if (state.dialogAdvance) {
        state.dialogAdvance = false;
        advanceDialog(state, scene);
      }
      if (state.dialog && state.dialog.pauses) {
        state.time += dt;
        state.jumpPrev = input.jump;
        return;
      }
    }

    state.time += dt;

    if (scene.timeLimit && scene.timeLimit > 0 && state.time > scene.timeLimit && !state.win) {
      state.dead = true;
    }

    if (state.invulnT > 0) state.invulnT = Math.max(0, state.invulnT - dt);
    if (state.speedT > 0) state.speedT = Math.max(0, state.speedT - dt);

    // Moving platforms
    for (var im = 0; im < scene.entities.length; im++) {
      var em = scene.entities[im];
      var m = em.moving;
      if (!m) continue;
      if (m._origin === undefined) { m._origin = m.axis === "x" ? em.x : em.y; m._dir = 1; }
      var v = (m.speed || 60) * (m._dir !== undefined ? m._dir : 1);
      if (m.axis === "x") {
        em.x += v * dt;
        if (em.x - m._origin > m.range) { em.x = m._origin + m.range; m._dir = -1; }
        else if (em.x - m._origin < -m.range) { em.x = m._origin - m.range; m._dir = 1; }
      } else {
        em.y += v * dt;
        if (em.y - m._origin > m.range) { em.y = m._origin + m.range; m._dir = -1; }
        else if (em.y - m._origin < -m.range) { em.y = m._origin - m.range; m._dir = 1; }
      }
    }

    // Crumble
    for (var ic = 0; ic < scene.entities.length; ic++) {
      var ec = scene.entities[ic];
      var c = ec.crumble;
      if (!c) continue;
      if (c._state === "gone") {
        c._rt = (c._rt || 0) + dt;
        if (c._rt >= (c.respawn || 3)) { c._state = "idle"; c._t = 0; c._rt = 0; ec.solid = true; ec.visible = true; ec.opacity = 1; }
      } else if (c._state === "break") {
        c._t = (c._t || 0) + dt;
        ec.opacity = Math.max(0.2, 1 - (c._t / (c.delay || 1)));
        if (c._t >= (c.delay || 1)) { c._state = "gone"; ec.solid = false; ec.visible = false; }
      }
    }

    var speedMul = state.speedT > 0 ? 1.6 : 1;
    var TERMINAL = runtimePhysics.terminalVelocity || 1200;
    for (var ip = 0; ip < scene.entities.length; ip++) {
      var ep = scene.entities[ip];
      if (ep.controllable) {
        var wasGrounded = !!ep._grounded;
        var entSpeed = typeof ep.speed === "number" && ep.speed > 0 ? ep.speed : BASE_SPEED;
        var target = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * entSpeed * speedMul;
        var floorEnt = ep._floor;
        var slippery = !!(floorEnt && floorEnt.slippery);
        var groundAccel = slippery ? 6 : 22;
        var airAccel = 10;
        var accel = wasGrounded ? groundAccel : airAccel;
        ep.vx += (target - ep.vx) * Math.min(1, accel * dt);
        if (wasGrounded && !input.left && !input.right && !slippery) {
          ep.vx *= Math.max(0, 1 - 18 * dt);
          if (Math.abs(ep.vx) < 4) ep.vx = 0;
        }
      }
      if (ep.gravity) {
        ep.vy += scene.gravity * dt;
        if (ep.vy > TERMINAL) ep.vy = TERMINAL;
        if (ep.vy < -TERMINAL) ep.vy = -TERMINAL;
      }
      if ((ep.controllable || ep.kind === "enemy") && Math.abs(ep.vx) > 1) {
        ep.facing = ep.vx > 0 ? 1 : -1;
      }
    }

    var solids = scene.entities.filter(function(e) { return e.solid; });
    var interactables = scene.entities.filter(function(e) {
      return e.collectible || e.hazard || e.goal || e.switchId || e.checkpoint || e.crumble;
    });

    // Predictive ledge detection for enemies
    for (var il = 0; il < scene.entities.length; il++) {
      var el = scene.entities[il];
      if (el.kind !== "enemy" || Math.abs(el.vx) <= 0.1) continue;
      var wasG = !!el._grounded;
      var ledgeSafe = el.patrol ? (el.patrol.ledgeSafe !== undefined ? el.patrol.ledgeSafe : true) : true;
      if (!wasG || !ledgeSafe) continue;
      var nextX = el.x + el.vx * dt;
      var ahead = el.vx >= 0 ? nextX + el.w + 1 : nextX - 1;
      var probeY = el.y + el.h + 2;
      var probeW = 3, probeH = 6;
      var hasGround = false;
      for (var sl = 0; sl < solids.length; sl++) {
        var o = solids[sl];
        if (o === el || !o.solid) continue;
        if (ahead < o.x + o.w && ahead + probeW > o.x && probeY < o.y + o.h && probeY + probeH > o.y) {
          hasGround = true;
          break;
        }
      }
      if (!hasGround) el.vx = -el.vx;
    }

    var grounded = new Set();
    var groundedOn = new Map();
    var EPS = 0.001;

    for (var ii = 0; ii < scene.entities.length; ii++) {
      var ei = scene.entities[ii];
      if (ei.kind === "platform") continue;
      ei.x += ei.vx * dt;
      ei.y += ei.vy * dt;
    }

    function collidesWithSolids(e) {
      return e.kind !== "platform" && (e.gravity || e.controllable || e.kind === "enemy");
    }

    for (var iter = 0; iter < 4; iter++) {
      var anyHit = false;
      for (var ie = 0; ie < scene.entities.length; ie++) {
        var e = scene.entities[ie];
        if (!collidesWithSolids(e)) continue;
        for (var is = 0; is < solids.length; is++) {
          var os = solids[is];
          if (os === e || !os.solid) continue;
          if ((os.hazard && e.controllable) || (e.hazard && os.controllable)) continue;
          if (!intersects(e, os)) continue;
          anyHit = true;
          var A = aabb(e), B = aabb(os);
          var pushLeft = A.x + A.w - B.x;
          var pushRight = B.x + B.w - A.x;
          var pushUp = A.y + A.h - B.y;
          var pushDown = B.y + B.h - A.y;
          var minX = Math.min(pushLeft, pushRight);
          var minY = Math.min(pushUp, pushDown);
          if (minY <= minX) {
            if (pushUp <= pushDown) {
              e.y -= pushUp + EPS;
              if (os.spring) {
                e.vy = -(os.spring.force || 720);
              } else {
                if (e.vy > 0) e.vy = 0;
                grounded.add(e.id);
                groundedOn.set(e.id, os);
              }
            } else {
              e.y += pushDown + EPS;
              if (e.vy < 0) e.vy = 0;
            }
          } else {
            if (pushLeft <= pushRight) {
              e.x -= pushLeft + EPS;
              if (e.kind === "enemy") e.vx = -Math.abs(e.vx || 60);
              else if (e.vx > 0) e.vx = 0;
            } else {
              e.x += pushRight + EPS;
              if (e.kind === "enemy") e.vx = Math.abs(e.vx || 60);
              else if (e.vx < 0) e.vx = 0;
            }
          }
        }
      }
      if (!anyHit) break;
    }

    for (var ig = 0; ig < scene.entities.length; ig++) {
      var eg = scene.entities[ig];
      if (eg.kind === "platform") continue;
      eg._grounded = grounded.has(eg.id);
      eg._floor = groundedOn.get(eg.id);
    }

    // Enemy patrol
    for (var ipt = 0; ipt < scene.entities.length; ipt++) {
      var ept = scene.entities[ipt];
      if (ept.kind !== "enemy" || !ept.patrol) continue;
      if (ept.patrol._origin === undefined) ept.patrol._origin = ept.x;
      if (ept.x - ept.patrol._origin > ept.patrol.range) { ept.x = ept.patrol._origin + ept.patrol.range; ept.vx = -Math.abs(ept.vx || 60); }
      else if (ept.x - ept.patrol._origin < -ept.patrol.range) { ept.x = ept.patrol._origin - ept.patrol.range; ept.vx = Math.abs(ept.vx || 60); }

      if (grounded.has(ept.id) && (ept.patrol.ledgeSafe !== undefined ? ept.patrol.ledgeSafe : true)) {
        var ahead2 = ept.vx >= 0 ? ept.x + ept.w + 2 : ept.x - 2;
        var probeY2 = ept.y + ept.h + 2;
        var hasGround2 = false;
        for (var s2 = 0; s2 < solids.length; s2++) {
          var o2 = solids[s2];
          if (o2 === ept) continue;
          if (ahead2 < o2.x + o2.w && ahead2 + 4 > o2.x && probeY2 < o2.y + o2.h && probeY2 + 6 > o2.y) {
            hasGround2 = true;
            break;
          }
        }
        if (!hasGround2) {
          ept.vx = ept.vx >= 0 ? -Math.abs(ept.vx || 60) : Math.abs(ept.vx || 60);
          ept.x += ept.vx >= 0 ? 2 : -2;
        }
      }
    }

    var COYOTE = runtimePhysics.coyoteTime !== undefined ? runtimePhysics.coyoteTime : 0.10;
    var JUMP_BUFFER = runtimePhysics.jumpBuffer !== undefined ? runtimePhysics.jumpBuffer : 0.12;
    var JUMP_CUT = runtimePhysics.jumpCut !== undefined ? runtimePhysics.jumpCut : 0.45;
    for (var ipl = 0; ipl < scene.entities.length; ipl++) {
      var epl = scene.entities[ipl];
      if (!epl.controllable) continue;
      var onGround = grounded.has(epl.id);
      if (onGround) {
        state.djumpAvailable = true;
        state.coyoteT = COYOTE;
      } else {
        state.coyoteT = Math.max(0, state.coyoteT - dt);
      }

      var jumpEdge = input.jump && !state.jumpPrev;
      if (jumpEdge) state.jumpBufferT = JUMP_BUFFER;
      else state.jumpBufferT = Math.max(0, state.jumpBufferT - dt);

      var entJump = typeof epl.jumpForce === "number" && epl.jumpForce > 0 ? epl.jumpForce : JUMP;
      var jumpDir = scene.gravity < 0 ? 1 : -1;
      if (state.jumpBufferT > 0 && state.coyoteT > 0) {
        epl.vy = jumpDir * entJump;
        state.jumpBufferT = 0;
        state.coyoteT = 0;
      } else if (jumpEdge && !onGround && state.djumpAvailable) {
        if (state.canDjump) {
          epl.vy = jumpDir * entJump;
          state.canDjump = false;
        }
      }

      if (state.jumpPrev && !input.jump && epl.vy < 0) {
        epl.vy *= JUMP_CUT;
      }

      if (epl.y > scene.height + 200) {
        if (state.checkpoint) {
          epl.x = state.checkpoint.x;
          epl.y = state.checkpoint.y;
          epl.vx = 0;
          epl.vy = 0;
        } else {
          state.dead = true;
        }
      }

      if (!state.dialog) {
        for (var idl = 0; idl < scene.entities.length; idl++) {
          var odl = scene.entities[idl];
          if (!odl.dialog || odl === epl) continue;
          if (odl.dialog.once && odl._dialogPlayed) continue;
          if (odl.dialog.trigger !== "touch" && odl.dialog.trigger !== "interact") continue;
          if (!intersects(epl, odl)) continue;
          if (odl.dialog.trigger === "interact" && !jumpEdge) continue;
          startDialog(state, odl);
          break;
        }
      }

      for (var iin = 0; iin < interactables.length; iin++) {
        var oi = interactables[iin];
        if (oi === epl || oi.x < -9000) continue;
        if (!intersects(epl, oi)) continue;
        if (oi.crumble && grounded.has(epl.id) && groundedOn.get(epl.id) === oi && oi.crumble._state !== "break" && oi.crumble._state !== "gone") {
          oi.crumble._state = "break";
          oi.crumble._t = 0;
        }
        if (oi.checkpoint) {
          state.checkpoint = { x: oi.x, y: oi.y - epl.h };
          oi.color = "#22c55e";
        }
        if (oi.collectible) {
          emitBurst(state, { x: oi.x + oi.w / 2, y: oi.y + oi.h / 2, color: oi.color, count: 8 });
          var pu = oi.powerup;
          if (pu === "speed") state.speedT = 6;
          else if (pu === "djump") state.canDjump = true;
          else if (pu === "invuln") state.invulnT = 5;
          else state.score += oi.value !== undefined ? oi.value : 10;
          oi.x = -9999;
        } else if (oi.hazard) {
          if (state.invulnT <= 0) {
            emitBurst(state, { x: epl.x + epl.w / 2, y: epl.y + epl.h / 2, color: "#f43f5e", count: 14 });
            var Ah = aabb(epl), Bh = aabb(oi);
            var dirX = (Ah.x + Ah.w / 2) < (Bh.x + Bh.w / 2) ? -1 : 1;
            epl.vx = dirX * 260;
            epl.vy = -320;
            if (state.lives > 1) {
              state.lives -= 1;
              state.invulnT = 1.2;
              if (state.checkpoint) { epl.x = state.checkpoint.x; epl.y = state.checkpoint.y; epl.vx = 0; epl.vy = 0; }
            } else {
              state.dead = true;
            }
          }
        } else if (oi.goal) {
          state.win = true;
          if (onGoalReached) onGoalReached(oi.nextSceneId || null, !!oi.endsGame);
        } else if (oi.switchId) {
          if (!state.switches[oi.switchId]) {
            state.switches[oi.switchId] = true;
            oi.color = "#22c55e";
            for (var idr = 0; idr < scene.entities.length; idr++) {
              var dr = scene.entities[idr];
              if (dr.doorId === oi.switchId) { dr.solid = false; dr.opacity = 0.25; }
            }
          }
        }
      }

      state.cameraX = Math.max(0, Math.min(scene.width - 360, epl.x - 160));
    }

    syncChildrenWithParents(scene);
    state.jumpPrev = input.jump;
  }

  // --- Block Script Runner ---
  var UI_EVENT_FOR_PHASE = { tap: "onTap", hold: "onHold", release: "onRelease" };

  function variableBag(ctx, scope) {
    if (scope === "scene") {
      if (!ctx.scene.variables) ctx.scene.variables = {};
      return ctx.scene.variables;
    }
    if (!ctx.self.variables) ctx.self.variables = {};
    return ctx.self.variables;
  }

  function targetFor(ctx, target) {
    if (target === "scene") return ctx.scene;
    if (target === "other") return ctx.other || null;
    return ctx.self;
  }

  function applyGenericProperty(target, property, value, mode) {
    if (typeof value === "boolean") { target[property] = value; return; }
    var previous = typeof target[property] === "number" ? target[property] : 0;
    var next = mode === "change" ? previous + value : value;
    if (property === "w" || property === "h") target[property] = Math.max(1, next);
    else if (property === "opacity") target[property] = Math.max(0, Math.min(1, next > 1 ? next / 100 : next));
    else target[property] = next;
  }

  function variablePasses(current, operator, expected) {
    var num = typeof current === "number" ? current : Number(current || 0);
    var exp = expected !== undefined ? expected : 0;
    var op = operator || "gte";
    if (op === "eq") return num === exp;
    if (op === "neq") return num !== exp;
    return op === "lte" ? num <= exp : num >= exp;
  }

  function findFirstOfKind(scene, kind) {
    for (var i = 0; i < scene.entities.length; i++) {
      var e = scene.entities[i];
      if (e.kind === kind && e.x > -9000) return e;
    }
    return null;
  }

  function execBlock(b, ctx) {
    switch (b.kind) {
      case "jump": ctx.self.vy = -(b.value !== undefined ? b.value : 520); break;
      case "setVx": ctx.self.vx = b.value !== undefined ? b.value : 0; break;
      case "setVy": ctx.self.vy = b.value !== undefined ? b.value : 0; break;
      case "impulse":
        ctx.self.vx += b.x || 0;
        ctx.self.vy += b.y || 0;
        break;
      case "addScore": ctx.state.score += b.value !== undefined ? b.value : 1; break;
      case "destroySelf": ctx.self.x = -99999; break;
      case "destroyOther": if (ctx.other) ctx.other.x = -99999; break;
      case "win": ctx.state.win = true; break;
      case "lose": ctx.state.dead = true; break;
      case "restartScene": ctx.hooks.restart(); break;
      case "teleport":
        if (b.x !== undefined) ctx.self.x = b.x;
        if (b.y !== undefined) ctx.self.y = b.y;
        break;
      case "log": console.log("[script]", b.text || "", ctx.self.kind); break;
      case "playSound": playSoundUrl(b.soundUrl); break;
      case "vibrate": vibrate(Math.max(1, b.value !== undefined ? b.value : 50)); break;
      case "shake": ctx.hooks.shake(Math.max(1, b.value !== undefined ? b.value : 8), 0.3); break;
      case "setColor": if (b.color) ctx.self.color = b.color; break;
      case "setBg": if (b.color) ctx.scene.bg = b.color; break;
      case "setVisible": ctx.self.visible = b.bool !== undefined ? b.bool : !(ctx.self.visible !== undefined ? ctx.self.visible : true); break;
      case "setSize":
        if (b.x) ctx.self.w = Math.max(4, b.x);
        if (b.y) ctx.self.h = Math.max(4, b.y);
        break;
      case "setObjectSize": {
        var w = (typeof b.w === "number" && b.w > 0) ? Math.max(4, b.w) : undefined;
        var h = (typeof b.h === "number" && b.h > 0) ? Math.max(4, b.h) : undefined;
        if (w === undefined && h === undefined) break;
        var applySize = function(t) { if (w !== undefined) t.w = w; if (h !== undefined) t.h = h; };
        var kind = b.text;
        if (!kind || kind === "self") { applySize(ctx.self); break; }
        if (b.bool) {
          for (var i = 0; i < ctx.scene.entities.length; i++) {
            var e = ctx.scene.entities[i];
            if (e.kind === kind && e.x > -9000) applySize(e);
          }
        } else {
          var first = findFirstOfKind(ctx.scene, kind);
          if (first) applySize(first);
        }
        break;
      }
      case "setGravity": ctx.self.gravity = b.bool !== undefined ? b.bool : !ctx.self.gravity; break;
      case "setControllable": ctx.self.controllable = b.bool !== undefined ? b.bool : !ctx.self.controllable; break;
      case "setX": if (b.value !== undefined) ctx.self.x = b.value; break;
      case "setY": if (b.value !== undefined) ctx.self.y = b.value; break;
      case "moveX": ctx.self.x += b.value || 0; break;
      case "moveY": ctx.self.y += b.value || 0; break;
      case "flipVx": ctx.self.vx = -ctx.self.vx; break;
      case "flipVy": ctx.self.vy = -ctx.self.vy; break;
      case "bounceY": ctx.self.vy = -ctx.self.vy * ((b.value !== undefined ? b.value : 80) / 100); break;
      case "stop": ctx.self.vx = 0; ctx.self.vy = 0; break;
      case "setSpeed": {
        var s = b.value || 0;
        var dir = ctx.self.vx === 0 ? 1 : Math.sign(ctx.self.vx);
        ctx.self.vx = s * dir;
        break;
      }
      case "setOpacity": ctx.self.opacity = Math.max(0, Math.min(1, (b.value !== undefined ? b.value : 100) / 100)); break;
      case "setHazard": ctx.self.hazard = b.bool !== undefined ? b.bool : !ctx.self.hazard; break;
      case "setSolid": ctx.self.solid = b.bool !== undefined ? b.bool : !ctx.self.solid; break;
      case "setCollectible": ctx.self.collectible = b.bool !== undefined ? b.bool : !ctx.self.collectible; break;
      case "setGoalFlag": ctx.self.goal = b.bool !== undefined ? b.bool : !ctx.self.goal; break;
      case "addLives": ctx.state.lives += b.value !== undefined ? b.value : 1; break;
      case "setLives": ctx.state.lives = b.value !== undefined ? b.value : 1; break;
      case "setScore": ctx.state.score = b.value || 0; break;
      case "resetScore": ctx.state.score = 0; break;
      case "spawnEntity": {
        var k = b.text || "coin";
        var preset = KIND_PRESETS[k];
        if (preset) {
          ctx.scene.entities.push(Object.assign({}, cloneDeep(preset), {
            id: uid(),
            x: b.x !== undefined ? b.x : ctx.self.x,
            y: b.y !== undefined ? b.y : ctx.self.y
          }));
        }
        break;
      }
      case "cloneSelf": {
        ctx.scene.entities.push(Object.assign({}, cloneDeep(ctx.self), {
          id: uid(),
          x: ctx.self.x + (b.x !== undefined ? b.x : 20),
          y: ctx.self.y + (b.y !== undefined ? b.y : 0),
          scripts: []
        }));
        break;
      }
      case "setSceneGravity": ctx.scene.gravity = Math.max(0, b.value !== undefined ? b.value : 1400); break;
      case "playRandomSound": playRandomCustomSound(); break;
      case "wrapScreen": {
        var ew = ctx.self;
        if (ew.x + ew.w < 0) ew.x = ctx.scene.width;
        else if (ew.x > ctx.scene.width) ew.x = -ew.w;
        if (ew.y + ew.h < 0) ew.y = ctx.scene.height;
        else if (ew.y > ctx.scene.height) ew.y = -ew.h;
        break;
      }
      case "faceTarget": {
        var ft = findFirstOfKind(ctx.scene, b.text || "player");
        if (ft) ctx.self.vx = Math.sign(ft.x - ctx.self.x) * Math.abs(ctx.self.vx || 60);
        break;
      }
      case "chase": {
        var ct = findFirstOfKind(ctx.scene, b.text || "player");
        if (ct) ctx.self.vx = Math.sign(ct.x - ctx.self.x) * (b.value !== undefined ? b.value : 80);
        break;
      }
      case "setHitbox":
        ctx.self.hitbox = { x: b.x || 0, y: b.y || 0, w: Math.max(1, b.w || ctx.self.w), h: Math.max(1, b.h || ctx.self.h) };
        break;
      case "clearHitbox": ctx.self.hitbox = null; break;
      case "removeAllOf": {
        var rk = b.text || "coin";
        for (var r = 0; r < ctx.scene.entities.length; r++) {
          if (ctx.scene.entities[r].kind === rk) ctx.scene.entities[r].x = -99999;
        }
        break;
      }
      case "hurtPlayer": ctx.state.dead = true; break;
      case "setFacing": {
        var f = (b.value !== undefined ? b.value : 1) >= 0 ? 1 : -1;
        ctx.self.facing = f;
        ctx.self.flipX = f === -1;
        break;
      }
      case "knockback": {
        var kbTarget = ctx.other || ctx.self;
        kbTarget.vx = b.x !== undefined ? b.x : 240;
        kbTarget.vy = b.y !== undefined ? b.y : -320;
        break;
      }
      case "pushAway": {
        var p = findFirstOfKind(ctx.scene, "player");
        if (p) {
          var force = b.value !== undefined ? b.value : 280;
          var pdir = ctx.self.x < p.x ? -1 : 1;
          ctx.self.vx = pdir * force;
          ctx.self.vy = -180;
        }
        break;
      }
      case "setVariable": {
        variableBag(ctx, b.scope)[(b.text || "").trim() || "variable"] = b.value !== undefined ? b.value : 0;
        break;
      }
      case "changeVariable": {
        var bag = variableBag(ctx, b.scope);
        var key = (b.text || "").trim() || "variable";
        var cur = typeof bag[key] === "number" ? bag[key] : 0;
        bag[key] = cur + (b.value !== undefined ? b.value : 1);
        break;
      }
      case "setProperty":
      case "changeProperty": {
        var tgt = targetFor(ctx, b.target);
        if (tgt && b.property) {
          var val = b.bool !== undefined ? b.bool : (b.value !== undefined ? b.value : 0);
          applyGenericProperty(tgt, b.property, val, b.kind === "changeProperty" ? "change" : "set");
        }
        break;
      }
      case "broadcast":
        if (ctx.emitMessage) ctx.emitMessage((b.text || "").trim() || "message");
        break;
      default:
        if (customBlockHandlers[b.kind]) {
          try { customBlockHandlers[b.kind](b, ctx, runtimeApi); } catch (err) { console.error("[customBlock]", err); }
        }
        break;
    }
  }

  function blockList(blocks) {
    return Array.isArray(blocks) ? blocks.filter(function(b) { return b && typeof b.kind === "string"; }) : [];
  }

  function execFrames(stack, ctx, now, suspend) {
    while (stack.length) {
      var frame = stack[stack.length - 1];
      if (frame.index >= frame.blocks.length) {
        stack.pop();
        if (frame.repeatLeft > 1) {
          frame.repeatLeft -= 1;
          frame.index = 0;
          stack.push(frame);
        }
        continue;
      }
      var block = frame.blocks[frame.index];
      frame.index += 1;
      if (block.kind === "wait") {
        var seconds = Math.max(0, Number(block.value) || 0) / 1000;
        if (seconds > 0) {
          suspend(stack, now + seconds);
          return;
        }
        continue;
      }
      if (block.kind === "if") {
        var v = block.value || 0;
        var pass = (block.cond === "scoreGte" && ctx.state.score >= v) || (block.cond === "scoreLte" && ctx.state.score <= v);
        if (pass) stack.push({ blocks: blockList(block.thenBlocks), index: 0, repeatLeft: 1 });
        continue;
      }
      if (block.kind === "ifVariable") {
        var cur = variableBag(ctx, block.scope)[(block.text || "").trim() || "variable"];
        var branch = variablePasses(cur, block.operator, block.value || 0) ? block.thenBlocks : block.elseBlocks;
        stack.push({ blocks: blockList(branch), index: 0, repeatLeft: 1 });
        continue;
      }
      if (block.kind === "repeat") {
        var amount = Math.min(100, Math.max(0, Math.floor(block.repeat !== undefined ? block.repeat : (block.value !== undefined ? block.value : 1))));
        if (amount > 0) stack.push({ blocks: blockList(block.thenBlocks), index: 0, repeatLeft: amount });
        continue;
      }
      execBlock(block, ctx);
    }
  }

  function createScriptRunner() {
    var started = new Set();
    var destroyed = new Set();
    var left = new Set();
    var colliding = new Set();
    var prevVy = new Map();
    var timerAcc = new Map();
    var suspended = new Map();
    var uiSuspended = new Map();
    var uiMessages = new Set();
    var last = null;
    var execKeys = new WeakMap();
    var execKeySeq = 0;
    var clock = 0;
    var prevInput = { left: false, right: false, jump: false };
    var prevScore = 0;
    var prevWin = false;
    var prevDead = false;

    return {
      runUI: function(element, phase) {
        if (!last) return;
        var want = UI_EVENT_FOR_PHASE[phase];
        var scripts = (element.scripts || []).filter(function(s) { return s.event === want; });
        if (!scripts.length) return;
        var ctx = {
          self: element,
          scene: last.scene,
          state: last.state,
          hooks: last.hooks,
          emitMessage: function(msg) { uiMessages.add(msg); }
        };
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          var key = element.id + "|" + s.id;
          if (uiSuspended.has(key)) continue;
          (function(k) {
            execFrames(
              [{ blocks: blockList(s.blocks), index: 0, repeatLeft: 1 }],
              ctx,
              clock,
              function(stack, until) { uiSuspended.set(k, { stack: stack, until: until, elementId: element.id }); }
            );
          })(key);
        }
      },
      step: function(scene, state, input, hooks, dt) {
        clock += dt;
        last = { scene: scene, state: state, hooks: hooks };
        var messages = new Set(uiMessages);
        uiMessages.clear();

        function keyFor(script, self) {
          var base = execKeys.get(script);
          if (!base) { base = "k" + (++execKeySeq); execKeys.set(script, base); }
          return self.id + "|" + base;
        }

        function run(script, self, other) {
          var key = keyFor(script, self);
          if (suspended.has(key)) return;
          var ctx = {
            self: self,
            other: other,
            scene: scene,
            state: state,
            hooks: hooks,
            emitMessage: function(msg) { messages.add(msg); }
          };
          execFrames(
            [{ blocks: blockList(script.blocks), index: 0, repeatLeft: 1 }],
            ctx,
            clock,
            function(stack, until) { suspended.set(key, { stack: stack, until: until, entityId: self.id, otherId: other ? other.id : undefined }); }
          );
        }

        var live = scene.entities;
        var keyEdges = {
          left: input.left && !prevInput.left,
          right: input.right && !prevInput.right,
          jump: input.jump && !prevInput.jump
        };
        var winEdge = state.win && !prevWin;
        var loseEdge = state.dead && !prevDead;

        for (var i = 0; i < live.length; i++) {
          var e = live[i];
          var scripts = e.scripts || [];
          if (!scripts.length) { prevVy.set(e.id, e.vy); continue; }

          if (e.x < -9000 && !destroyed.has(e.id)) {
            destroyed.add(e.id);
            for (var d = 0; d < scripts.length; d++) {
              suspended.delete(keyFor(scripts[d], e));
              if (scripts[d].event === "onDestroyed" || scripts[d].event === "onDestroy") run(scripts[d], e);
            }
          }
          if (e.x < -9000) continue;

          var outside = e.x + e.w < 0 || e.x > scene.width || e.y > scene.height + 200 || e.y + e.h < -200;
          if (outside && !left.has(e.id)) {
            left.add(e.id);
            for (var l = 0; l < scripts.length; l++) if (scripts[l].event === "onLeaveScreen") run(scripts[l], e);
          } else if (!outside) {
            left.delete(e.id);
          }

          if (!started.has(e.id)) {
            for (var st = 0; st < scripts.length; st++) {
              if (scripts[st].event === "onStart" || scripts[st].event === "onCreate") run(scripts[st], e);
            }
            started.add(e.id);
          }

          var pv = prevVy.get(e.id) || 0;
          var landed = pv > 80 && e.vy === 0;

          for (var sc = 0; sc < scripts.length; sc++) {
            var s = scripts[sc];
            if (s.event === "onUpdate") run(s, e);
            else if (s.event === "onKeyDown" && s.key && keyEdges[s.key]) run(s, e);
            else if (s.event === "onScoreReach") {
              var th = s.threshold || 0;
              if (prevScore < th && state.score >= th) run(s, e);
            } else if (s.event === "onTimer") {
              var iv = Math.max(0.05, (s.interval || 1000) / 1000);
              var acc = (timerAcc.get(s.id) || 0) + dt;
              if (acc + 1e-6 >= iv) { timerAcc.set(s.id, acc - iv); run(s, e); }
              else timerAcc.set(s.id, acc);
            } else if (s.event === "onLand" && landed) run(s, e);
            else if (s.event === "onWin" && winEdge) run(s, e);
            else if (s.event === "onLose" && loseEdge) run(s, e);
          }
          prevVy.set(e.id, e.vy);
        }

        // onCollide
        var nowColl = new Set();
        var hasCollideHooks = runtimeHooksList.some(function(h) { return typeof h.onCollide === "function"; });
        for (var ia = 0; ia < live.length; ia++) {
          var a = live[ia];
          if (a.x < -9000) continue;
          var aScripts = (a.scripts || []).filter(function(s) { return s.event === "onCollide"; });
          if (!aScripts.length && !hasCollideHooks) continue;
          for (var ib = 0; ib < live.length; ib++) {
            if (ia === ib) continue;
            var b = live[ib];
            if (b.x < -9000) continue;
            if (!intersects(a, b)) continue;
            var cKey = a.id + "|" + b.id;
            nowColl.add(cKey);
            if (colliding.has(cKey)) continue;
            for (var cs = 0; cs < aScripts.length; cs++) {
              var as = aScripts[cs];
              if (!as.withKind || as.withKind === "any" || as.withKind === b.kind) run(as, a, b);
            }
            if (hasCollideHooks) {
              for (var chi = 0; chi < runtimeHooksList.length; chi++) {
                if (typeof runtimeHooksList[chi].onCollide === "function") {
                  try { runtimeHooksList[chi].onCollide(a, b, runtimeApi); } catch (err) {}
                }
              }
            }
          }
        }
        colliding.clear();
        nowColl.forEach(function(k) { colliding.add(k); });

        if (suspended.size) {
          Array.from(suspended.entries()).forEach(function(entry) {
            var key = entry[0], paused = entry[1];
            if (clock < paused.until) return;
            var self = entityById(scene, paused.entityId);
            if (!self || self.x < -9000) { suspended.delete(key); return; }
            var other = paused.otherId ? entityById(scene, paused.otherId) : undefined;
            suspended.delete(key);
            execFrames(
              paused.stack,
              { self: self, other: other, scene: scene, state: state, hooks: hooks, emitMessage: function(m) { messages.add(m); } },
              clock,
              function(stack, until) { suspended.set(key, { stack: stack, until: until, entityId: self.id, otherId: other ? other.id : undefined }); }
            );
          });
        }

        if (uiSuspended.size) {
          Array.from(uiSuspended.entries()).forEach(function(entry) {
            var key = entry[0], paused = entry[1];
            if (clock < paused.until) return;
            uiSuspended.delete(key);
            var uiList = scene.ui || [];
            var element = null;
            for (var u = 0; u < uiList.length; u++) if (uiList[u].id === paused.elementId) { element = uiList[u]; break; }
            if (!element || element.visible === false) return;
            execFrames(
              paused.stack,
              { self: element, scene: scene, state: state, hooks: hooks, emitMessage: function(m) { uiMessages.add(m); } },
              clock,
              function(stack, until) { uiSuspended.set(key, { stack: stack, until: until, elementId: element.id }); }
            );
          });
        }

        messages.forEach(function(message) {
          for (var emi = 0; emi < live.length; emi++) {
            var ent = live[emi];
            if (ent.x < -9000) continue;
            var es = ent.scripts || [];
            for (var si2 = 0; si2 < es.length; si2++) {
              if (es[si2].event === "onMessage" && es[si2].message === message) run(es[si2], ent);
            }
          }
        });

        prevInput = { left: input.left, right: input.right, jump: input.jump };
        prevScore = state.score;
        prevWin = state.win;
        prevDead = state.dead;
      }
    };
  }

  // --- Rendering Helpers ---
  function shadeColor(hex, amount) {
    var match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!match) return hex;
    var body = match[1];
    if (body.length === 3) body = body.split("").map(function(c) { return c + c; }).join("");
    var n = parseInt(body, 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    var mix = function(v) { return Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)); };
    return "rgb(" + mix(r) + ", " + mix(g) + ", " + mix(b) + ")";
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawChibiCharacter(ctx, x, y, w, h, color, facing) {
    ctx.save();
    ctx.translate(x, y);
    var c = color || "#38bdf8";
    var r = Math.min(w, h) * 0.32;
    var footH = Math.max(4, h * 0.11);
    var bodyH = h - footH * 0.6;

    var footW = Math.max(6, w * 0.24);
    ctx.fillStyle = "#0f172a";
    roundRect(ctx, w * 0.18, h - footH, footW, footH, 2);
    ctx.fill();
    roundRect(ctx, w - w * 0.18 - footW, h - footH, footW, footH, 2);
    ctx.fill();

    var grad = ctx.createLinearGradient(0, 0, 0, bodyH);
    grad.addColorStop(0, "#7dd3fc");
    grad.addColorStop(0.55, c);
    grad.addColorStop(1, "#0284c7");
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, w, bodyH, r);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0f172a";
    roundRect(ctx, 0, 0, w, bodyH, r);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(ctx, w * 0.14, bodyH * 0.08, w * 0.72, Math.max(3, bodyH * 0.14), r * 0.4);
    ctx.fill();

    var dir = facing === -1 ? -1 : 1;
    var shift = dir * w * 0.06;
    var eyeY = bodyH * 0.42;
    var eyeSpacing = w * 0.2;
    var cx = w / 2 + shift;

    var eyeW = Math.max(3, w * 0.11);
    var eyeH = Math.max(4, bodyH * 0.16);
    var sides = [-1, 1];
    for (var si = 0; si < sides.length; si++) {
      var ex = cx + sides[si] * eyeSpacing;
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeW * 0.7, eyeH * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.ellipse(ex + dir * 0.8, eyeY + 0.5, eyeW * 0.45, eyeH * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex - 0.8, eyeY - eyeH * 0.2, Math.max(1, eyeW * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(244,114,182,0.55)";
    ctx.beginPath();
    ctx.ellipse(cx - eyeSpacing * 1.35, eyeY + eyeH * 0.55, eyeW * 0.55, eyeH * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + eyeSpacing * 1.35, eyeY + eyeH * 0.55, eyeW * 0.55, eyeH * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEntity(ctx, e, time, visualEffects) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var rot = ((e.rotation || 0) * Math.PI) / 180;
    if (rot) {
      var cx = e.x + e.w / 2;
      var cy = e.y + e.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.translate(-cx, -cy);
    }
    var flip = (e.facing === -1) !== !!e.flipX;
    if (flip) {
      ctx.translate(e.x + e.w, e.y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(e.x, e.y);
    }
    var animImg = currentFrameRenderable(e, time);
    function drawFit(img) {
      var fit = e.textureFit || "stretch";
      if (fit === "stretch") { ctx.drawImage(img, 0, 0, e.w, e.h); return; }
      var sa = img.width / img.height;
      var da = e.w / e.h;
      var cover = fit === "cover" ? sa > da : sa < da;
      var dw = cover ? e.h * sa : e.w;
      var dh = cover ? e.h : e.w / sa;
      ctx.drawImage(img, (e.w - dw) / 2, (e.h - dh) / 2, dw, dh);
    }
    if (animImg) { drawFit(animImg); ctx.restore(); return; }
    if (e.texture) {
      var img = getRenderableImage(e.texture);
      if (img) { drawFit(img); ctx.restore(); return; }
    }
    ctx.restore();
    ctx.save();
    if (rot) {
      var rcx = e.x + e.w / 2;
      var rcy = e.y + e.h / 2;
      ctx.translate(rcx, rcy);
      ctx.rotate(rot);
      ctx.translate(-rcx, -rcy);
    }
    if (visualEffects) {
      ctx.shadowColor = e.color;
      ctx.shadowBlur = e.kind === "coin" ? 10 : e.kind === "goal" ? 12 : 4;
    }
    ctx.fillStyle = e.color;
    if (e.kind === "coin") {
      ctx.beginPath();
      ctx.arc(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === "goal") {
      ctx.fillStyle = "rgba(125,211,252,0.3)";
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x + e.w / 2 - 2, e.y, 4, e.h);
      ctx.beginPath();
      ctx.moveTo(e.x + e.w / 2 + 2, e.y + 4);
      ctx.lineTo(e.x + e.w / 2 + 22, e.y + 12);
      ctx.lineTo(e.x + e.w / 2 + 2, e.y + 20);
      ctx.closePath();
      ctx.fill();
    } else if (e.kind === "player") {
      ctx.shadowBlur = 0;
      drawChibiCharacter(ctx, e.x, e.y, e.w, e.h, e.color, e.facing || 1);
    } else {
      var r = e.kind === "platform" ? 4 : 6;
      roundRect(ctx, e.x, e.y, e.w, e.h, r);
      ctx.fill();
    }
    ctx.restore();
  }

  function resolveUIRect(el, screenW, screenH) {
    var ax = 0, ay = 0;
    var a = el.anchor || "tl";
    if (a.indexOf("c") !== -1 && a.length === 1) { ax = screenW / 2; ay = screenH / 2; }
    else {
      if (a[0] === "t") ay = 0;
      else if (a[0] === "c") ay = screenH / 2;
      else if (a[0] === "b") ay = screenH;
      if (a[1] === "l") ax = 0;
      else if (a[1] === "c") ax = screenW / 2;
      else if (a[1] === "r") ax = screenW;
    }
    return { x: ax + el.x, y: ay + el.y, w: el.w, h: el.h };
  }

  function drawUIElement(ctx, el, W, H, tick, state) {
    var r = resolveUIRect(el, W, H);
    ctx.save();
    ctx.globalAlpha = el.opacity !== undefined ? el.opacity : 1;
    var radius = el.radius !== undefined ? el.radius : 8;
    var path = function() { roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(radius, Math.min(r.w, r.h) / 2)); };

    if (el.kind === "image" && el.image) {
      var img = getRenderableImage(el.image);
      if (img) {
        ctx.save(); path(); ctx.clip();
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(125,211,252,0.15)"; path(); ctx.fill();
      }
    } else if (el.kind === "bar") {
      ctx.fillStyle = el.bg || "rgba(2,6,23,0.6)"; path(); ctx.fill();
      var v = 1;
      if (state && el.bind && el.bind !== "none") {
        var max = (el.max && el.max > 0) ? el.max : (el.bind === "lives" ? Math.max(1, state.lives) : 100);
        var cur = 0;
        if (el.bind === "score") cur = state.score;
        else if (el.bind === "lives") cur = state.lives;
        else if (el.bind === "time") cur = state.timeLimit ? Math.max(0, state.timeLimit - state.time) : state.time;
        v = Math.max(0, Math.min(1, cur / Math.max(1, max)));
      }
      ctx.save(); path(); ctx.clip();
      ctx.fillStyle = el.color || "#22c55e";
      ctx.fillRect(r.x, r.y, r.w * v, r.h);
      ctx.restore();
      if (el.border) { ctx.lineWidth = 1; ctx.strokeStyle = el.border; path(); ctx.stroke(); }
    } else if (el.kind === "label") {
      var text = el.text || "";
      if (state && el.bind && el.bind !== "none") {
        if (el.bind === "score") text = text.replace(/\\{v\\}/g, String(state.score)) || ("SCORE: " + state.score);
        else if (el.bind === "lives") text = text.replace(/\\{v\\}/g, String(state.lives)) || ("♥ " + state.lives);
        else if (el.bind === "time") {
          var t = state.timeLimit ? Math.max(0, Math.ceil(state.timeLimit - state.time)) : Math.floor(state.time);
          text = text.replace(/\\{v\\}/g, String(t)) || ("⏱ " + t);
        }
      }
      ctx.fillStyle = el.color || "#7dd3fc";
      ctx.font = "600 " + (el.fontSize || 14) + "px Rajdhani, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(text, r.x, r.y + r.h / 2);
    } else {
      ctx.fillStyle = el.bg || "rgba(2,6,23,0.6)";
      path(); ctx.fill();
      if (el.border) { ctx.lineWidth = 1.5; ctx.strokeStyle = el.border; path(); ctx.stroke(); }
      if (el.text) {
        ctx.fillStyle = el.color || "#ffffff";
        ctx.font = "700 " + (el.fontSize || 14) + "px Rajdhani, system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(el.text, r.x + r.w / 2, r.y + r.h / 2);
        ctx.textAlign = "start";
      }
    }

    if (el.kind === "button" && (el.action === "jump" || el.action === "restart")) {
      var pulse = (Math.sin(tick * 0.05) + 1) / 2 * 0.4 + 0.6;
      ctx.globalAlpha = (el.opacity !== undefined ? el.opacity : 1) * pulse * 0.3;
      ctx.strokeStyle = el.border || "#7dd3fc";
      ctx.lineWidth = 2;
      path(); ctx.stroke();
    }
    ctx.restore();
  }

  // --- Runtime Loop & State ---
  var canvas = document.getElementById("game-canvas");
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }) || canvas.getContext("2d");

  var activeSceneId = PAYLOAD.initialSceneId || (SCENES[0] && SCENES[0].id);
  function findInitialScene(id) {
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i];
    return SCENES[0];
  }

  var initialScene = cloneDeep(findInitialScene(activeSceneId));
  var work = cloneDeep(initialScene);
  var drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
  var state = newRuntimeState(initialScene);
  var scripts = createScriptRunner();
  var shake = { intensity: 0, time: 0 };
  var particles = [];

  var hooks = {
    shake: function(intensity, duration) {
      shake.intensity = Math.max(shake.intensity, intensity);
      shake.time = Math.max(shake.time, duration);
    },
    restart: function() {
      work = cloneDeep(initialScene);
      drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
      Object.assign(state, newRuntimeState(initialScene));
      scripts = createScriptRunner();
      particles.length = 0;
      for (var rhi = 0; rhi < runtimeHooksList.length; rhi++) {
        if (typeof runtimeHooksList[rhi].onInit === "function") {
          try { runtimeHooksList[rhi].onInit(runtimeApi); } catch (err) {}
        }
      }
      drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
      updateEndOverlay();
      updateDialogOverlay();
      updateTouchControlsVisibility();
    }
  };

  function switchScene(nextSceneId) {
    var found = findInitialScene(nextSceneId);
    if (!found) return false;
    activeSceneId = found.id;
    initialScene = cloneDeep(found);
    hooks.restart();
    return true;
  }

  function exitRuntime() {
    stopMusic();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "asternal:runtime", action: "exit" }, "*");
    }
  }

  function onGoalReached(nextSceneId, endsGame) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: "asternal:runtime",
        action: "goal",
        nextSceneId: nextSceneId,
        endsGame: endsGame
      }, "*");
    }
    if (nextSceneId && !endsGame && switchScene(nextSceneId)) {
      return;
    }
  }

  // --- DOM UI Elements ---
  var fpsBadge = document.getElementById("fps-badge");
  var btnStop = document.getElementById("btn-stop");
  var touchBar = document.getElementById("touch-bar");
  var touchLeft = document.getElementById("touch-left");
  var touchRight = document.getElementById("touch-right");
  var touchJump = document.getElementById("touch-jump");
  var overlayEnd = document.getElementById("overlay-end");
  var endTitle = document.getElementById("end-title");
  var endScore = document.getElementById("end-score");
  var btnRetry = document.getElementById("btn-retry");
  var btnBack = document.getElementById("btn-back");
  var dialogWrap = document.getElementById("dialog-wrap");
  var dialogHeader = document.getElementById("dialog-header");
  var dialogPortrait = document.getElementById("dialog-portrait");
  var dialogSpeaker = document.getElementById("dialog-speaker");
  var dialogText = document.getElementById("dialog-text");
  var dialogCount = document.getElementById("dialog-count");

  if (CONFIG.showFPS !== false) fpsBadge.style.display = "block";
  if (CONFIG.embedded !== false) {
    btnStop.style.display = "block";
    btnStop.addEventListener("click", exitRuntime);
    btnBack.addEventListener("click", exitRuntime);
  } else {
    btnBack.style.display = "none";
  }
  btnRetry.addEventListener("click", function() { hooks.restart(); });

  dialogWrap.addEventListener("pointerdown", function(e) {
    e.stopPropagation();
    state.dialogAdvance = true;
  });

  function updateTouchControlsVisibility() {
    var ui = work.ui || [];
    var uiButtons = ui.filter(function(e) { return e.kind === "button" && e.visible !== false; });
    var uiJoysticks = ui.filter(function(e) { return e.kind === "joystick" && e.visible !== false; });
    var hasLeft = uiButtons.some(function(b) { return b.action === "left"; }) || uiJoysticks.length > 0;
    var hasRight = uiButtons.some(function(b) { return b.action === "right"; }) || uiJoysticks.length > 0;
    var hasJump = uiButtons.some(function(b) { return b.action === "jump"; });
    var hasAny = hasLeft || hasRight || hasJump;
    if (CONFIG.touchControls !== false && !hasAny) {
      touchBar.style.display = "flex";
      touchLeft.style.display = hasLeft ? "none" : "grid";
      touchRight.style.display = hasRight ? "none" : "grid";
      touchJump.style.display = hasJump ? "none" : "grid";
    } else {
      touchBar.style.display = "none";
    }
  }
  updateTouchControlsVisibility();

  var lastOverlayState = { win: false, dead: false, score: -1 };
  function updateEndOverlay() {
    if (state.win === lastOverlayState.win && state.dead === lastOverlayState.dead && state.score === lastOverlayState.score) return;
    lastOverlayState = { win: state.win, dead: state.dead, score: state.score };
    if (state.win || state.dead) {
      endTitle.textContent = state.win ? "LEVEL CLEAR" : "GAME OVER";
      endScore.textContent = "Score: " + state.score;
      overlayEnd.classList.add("visible");
    } else {
      overlayEnd.classList.remove("visible");
    }
  }

  var lastDialogKey = "";
  function updateDialogOverlay() {
    var d = state.dialog;
    var key = d ? (d.entityId + ":" + d.lineIndex + ":" + d.text) : "";
    if (key === lastDialogKey) return;
    lastDialogKey = key;
    if (!d) {
      dialogWrap.classList.remove("visible");
      return;
    }
    dialogWrap.classList.add("visible");
    if (d.speaker) {
      dialogHeader.style.display = "flex";
      dialogSpeaker.textContent = d.speaker;
      if (d.portrait) {
        dialogPortrait.src = d.portrait;
        dialogPortrait.style.display = "block";
      } else {
        dialogPortrait.style.display = "none";
      }
    } else {
      dialogHeader.style.display = "none";
    }
    dialogText.textContent = d.text || "";
    dialogCount.textContent = (d.lineIndex + 1) + " / " + d.totalLines;
  }

  // --- Input Handling (Keyboard + Touch + Custom UI) ---
  var input = { left: false, right: false, jump: false };
  var btnSrc = { left: false, right: false, jump: false };
  var joySrc = { left: false, right: false, jump: false };
  var keySrc = { left: false, right: false, jump: false };

  function recomputeInput() {
    input.left = btnSrc.left || joySrc.left || keySrc.left;
    input.right = btnSrc.right || joySrc.right || keySrc.right;
    input.jump = btnSrc.jump || joySrc.jump || keySrc.jump;
  }

  function pressBtn(k, v) {
    btnSrc[k] = v;
    recomputeInput();
  }

  function bindTouchBtn(el, key) {
    if (!el) return;
    el.addEventListener("pointerdown", function(e) {
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add("active");
      pressBtn(key, true);
      e.preventDefault();
    });
    var up = function(e) {
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      el.classList.remove("active");
      pressBtn(key, false);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", function(e) { e.preventDefault(); });
  }
  bindTouchBtn(touchLeft, "left");
  bindTouchBtn(touchRight, "right");
  bindTouchBtn(touchJump, "jump");

  function handleKeyDown(code, key) {
    if (code === "ArrowLeft" || code === "KeyA" || key === "a" || key === "A") { keySrc.left = true; recomputeInput(); }
    else if (code === "ArrowRight" || code === "KeyD" || key === "d" || key === "D") { keySrc.right = true; recomputeInput(); }
    else if (code === "ArrowUp" || code === "KeyW" || code === "Space" || key === " ") {
      if (state.dialog) state.dialogAdvance = true;
      keySrc.jump = true;
      recomputeInput();
    } else if (code === "Enter" && state.dialog) {
      state.dialogAdvance = true;
    } else if (code === "KeyR") {
      hooks.restart();
    } else if (code === "Escape" && CONFIG.embedded !== false) {
      exitRuntime();
    }
  }

  function handleKeyUp(code, key) {
    if (code === "ArrowLeft" || code === "KeyA" || key === "a" || key === "A") { keySrc.left = false; recomputeInput(); }
    else if (code === "ArrowRight" || code === "KeyD" || key === "d" || key === "D") { keySrc.right = false; recomputeInput(); }
    else if (code === "ArrowUp" || code === "KeyW" || code === "Space" || key === " ") { keySrc.jump = false; recomputeInput(); }
  }

  window.addEventListener("keydown", function(e) {
    handleKeyDown(e.code || e.key, e.key);
    for (var hi = 0; hi < runtimeHooksList.length; hi++) {
      if (typeof runtimeHooksList[hi].onKeyDown === "function") {
        try { runtimeHooksList[hi].onKeyDown(e.code || e.key, e.key, runtimeApi); } catch (err) {}
      }
    }
  });

  window.addEventListener("keyup", function(e) {
    handleKeyUp(e.code || e.key, e.key);
    for (var hi = 0; hi < runtimeHooksList.length; hi++) {
      if (typeof runtimeHooksList[hi].onKeyUp === "function") {
        try { runtimeHooksList[hi].onKeyUp(e.code || e.key, e.key, runtimeApi); } catch (err) {}
      }
    }
  });

  var activePointers = new Map();
  var joyKnobs = new Map();

  function liveUI() {
    return work.ui || [];
  }

  function hitUIButton(sx, sy) {
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var tappable = liveUI().filter(function(e) {
      return e.visible !== false && e.kind !== "joystick" && (e.kind === "button" || (e.scripts && e.scripts.length > 0));
    });
    for (var i = tappable.length - 1; i >= 0; i--) {
      var b = tappable[i];
      var r = resolveUIRect(b, W, H);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return b;
    }
    return null;
  }

  function hitJoystick(sx, sy) {
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var joysticks = liveUI().filter(function(e) { return e.kind === "joystick" && e.visible !== false; });
    for (var i = joysticks.length - 1; i >= 0; i--) {
      var j = joysticks[i];
      var r = resolveUIRect(j, W, H);
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) / 2;
      var dx = sx - cx, dy = sy - cy;
      var grab = rad * 1.3;
      if (dx * dx + dy * dy <= grab * grab) return { el: j, cx: cx, cy: cy, r: rad };
    }
    return null;
  }

  function applyJoystick(id, dx, dy, r) {
    var len = Math.hypot(dx, dy);
    var nx = len > r ? (dx / len) * r : dx;
    var ny = len > r ? (dy / len) * r : dy;
    joyKnobs.set(id, { dx: nx, dy: ny });
    var ax = nx / r;
    joySrc.left = ax < -0.25;
    joySrc.right = ax > 0.25;
    recomputeInput();
  }

  function releaseJoystick(id) {
    joyKnobs.delete(id);
    joySrc.left = false;
    joySrc.right = false;
    joySrc.jump = false;
    recomputeInput();
  }

  function handleUIButton(b, down) {
    var act = b.kind === "button" ? (b.action || "none") : "none";
    if (act === "left" || act === "right" || act === "jump") pressBtn(act, down);
    else if (down && act === "restart") hooks.restart();
    else if (down && act === "exit") exitRuntime();
    else if (down && act === "event" && b.eventName) window.dispatchEvent(new CustomEvent("asternal:ui-event", { detail: b.eventName }));
    if (b.scripts && b.scripts.length) scripts.runUI(b, down ? "tap" : "release");
  }

  canvas.addEventListener("pointerdown", function(ev) {
    var rect = canvas.getBoundingClientRect();
    var sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    var b = hitUIButton(sx, sy);
    if (b) {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      activePointers.set(ev.pointerId, { kind: "btn", el: b });
      handleUIButton(b, true);
      ev.preventDefault();
      return;
    }
    var j = hitJoystick(sx, sy);
    if (j) {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      activePointers.set(ev.pointerId, { kind: "joy", el: j.el, cx: j.cx, cy: j.cy, r: j.r });
      applyJoystick(j.el.id, sx - j.cx, sy - j.cy, j.r);
      ev.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", function(ev) {
    var d = activePointers.get(ev.pointerId);
    if (!d || d.kind !== "joy") return;
    var rect = canvas.getBoundingClientRect();
    var sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    applyJoystick(d.el.id, sx - d.cx, sy - d.cy, d.r);
  });

  function onCanvasPointerEnd(ev) {
    var d = activePointers.get(ev.pointerId);
    if (!d) return;
    if (d.kind === "btn") handleUIButton(d.el, false);
    else releaseJoystick(d.el.id);
    activePointers.delete(ev.pointerId);
  }
  canvas.addEventListener("pointerup", onCanvasPointerEnd);
  canvas.addEventListener("pointercancel", onCanvasPointerEnd);

  // --- Resize & Particle Helpers ---
  var cssW = 0, cssH = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    var nextW = Math.round(cssW * dpr);
    var nextH = Math.round(cssH * dpr);
    if (canvas.width !== nextW) canvas.width = nextW;
    if (canvas.height !== nextH) canvas.height = nextH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }
  resize();
  window.addEventListener("resize", resize);

  function flushParticles() {
    var list = state.particles || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var n = p.count || 8;
      for (var j = 0; j < n; j++) {
        var a = Math.random() * Math.PI * 2;
        var s = 60 + Math.random() * 140;
        particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.6, max: 0.6, color: p.color, size: 3, gravity: 400 });
      }
    }
    if (list.length) state.particles = [];
  }

  function tickEmitters(dt) {
    for (var i = 0; i < work.entities.length; i++) {
      var e = work.entities[i];
      var em = e.emitter;
      if (!em || !em.enabled) continue;
      em._acc = (em._acc || 0) + (em.rate || 0) * dt;
      while (em._acc >= 1) {
        em._acc -= 1;
        var dir = ((em.direction || 0) + (Math.random() - 0.5) * (em.spread || 0)) * Math.PI / 180;
        var sp = em.speed || 80;
        particles.push({
          x: e.x + e.w / 2,
          y: e.y + e.h / 2,
          vx: Math.cos(dir) * sp,
          vy: Math.sin(dir) * sp,
          life: em.lifetime || 1,
          max: em.lifetime || 1,
          color: em.color || "#7dd3fc",
          size: em.size || 3,
          gravity: em.gravity || 0
        });
      }
    }
  }

  function draw() {
    var W = cssW || canvas.clientWidth;
    var H = cssH || canvas.clientHeight;
    drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
    ctx.fillStyle = work.bg || "#0b1e3f";
    ctx.fillRect(0, 0, W, H);

    if (work.bgImage) {
      var bgImg = getRenderableImage(work.bgImage);
      if (bgImg && bgImg.width) {
        var mode = work.bgImageMode || "cover";
        if (mode === "stretch") {
          ctx.drawImage(bgImg, 0, 0, W, H);
        } else if (mode === "tile") {
          for (var tx = 0; tx < W; tx += bgImg.width) {
            for (var ty = 0; ty < H; ty += bgImg.height) ctx.drawImage(bgImg, tx, ty);
          }
        } else {
          var sa = bgImg.width / bgImg.height;
          var da = W / H;
          var fit = mode === "cover" ? sa > da : sa < da;
          var dw = fit ? H * sa : W;
          var dh = fit ? H : W / sa;
          ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }
      }
    }

    for (var bghi = 0; bghi < runtimeHooksList.length; bghi++) {
      if (typeof runtimeHooksList[bghi].onRenderBackground === "function") {
        try { runtimeHooksList[bghi].onRenderBackground(ctx, runtimeApi, W, H); } catch (err) {}
      }
    }

    ctx.strokeStyle = "rgba(56,189,248,0.10)";
    ctx.lineWidth = 1;
    var off = -state.cameraX * 0.4;
    ctx.beginPath();
    for (var gx = (off % 40); gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = 0; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    var VIEW_H = 700;
    var scale = H / VIEW_H;
    var viewW = W / scale;
    var viewH = VIEW_H;
    var player = null;
    for (var pi = 0; pi < work.entities.length; pi++) {
      if (work.entities[pi].controllable) { player = work.entities[pi]; break; }
    }
    var camX = state.cameraX;
    var camY = 0;
    if (player) {
      camX = player.x + player.w / 2 - viewW / 2;
      camY = player.y + player.h / 2 - viewH / 2;
      if (work.width > viewW) camX = Math.max(0, Math.min(work.width - viewW, camX));
      else camX = (work.width - viewW) / 2;
      if (work.height > viewH) camY = Math.max(0, Math.min(work.height - viewH, camY));
      else camY = (work.height - viewH) / 2;
      state.cameraX = camX;
    }

    var sx = shake.time > 0 ? (Math.random() - 0.5) * shake.intensity : 0;
    var sy = shake.time > 0 ? (Math.random() - 0.5) * shake.intensity : 0;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);

    var tSec = performance.now() / 1000;
    var visualEffects = W >= 700;
    for (var di = 0; di < drawList.length; di++) {
      var e = drawList[di];
      if (e.visible === false || e.x < -9000) continue;
      var la = layerOpacityFor(work, e);
      var a = (e.opacity !== undefined ? e.opacity : 1) * la;
      if (e.controllable && state.invulnT > 0 && Math.floor(state.invulnT * 16) % 2 === 0) {
        ctx.globalAlpha = 0.4 * la;
      } else if (a !== 1) {
        ctx.globalAlpha = a;
      }
      drawEntity(ctx, e, tSec, visualEffects);
      ctx.globalAlpha = 1;
    }

    flushParticles();
    for (var pti = particles.length - 1; pti >= 0; pti--) {
      var pt = particles[pti];
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    if (CONFIG.showHitboxes) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#f43f5e";
      ctx.setLineDash([4, 3]);
      for (var hi = 0; hi < work.entities.length; hi++) {
        var he = work.entities[hi];
        if (he.x < -9000) continue;
        var hb = he.hitbox;
        if (hb) ctx.strokeRect(he.x + hb.x, he.y + hb.y, hb.w, hb.h);
        else ctx.strokeRect(he.x, he.y, he.w, he.h);
      }
      ctx.setLineDash([]);
    }
    for (var rhi = 0; rhi < runtimeHooksList.length; rhi++) {
      if (typeof runtimeHooksList[rhi].onRender === "function") {
        try { runtimeHooksList[rhi].onRender(ctx, runtimeApi); } catch (err) {}
      }
    }
    ctx.restore();

    if (CONFIG.showHUD !== false) {
      ctx.fillStyle = "rgba(2,6,23,0.6)";
      ctx.fillRect(12, 12, 260, 36);
      ctx.strokeStyle = "rgba(125,211,252,0.5)";
      ctx.strokeRect(12, 12, 260, 36);
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "600 14px Rajdhani, system-ui, sans-serif";
      ctx.fillText("SCORE " + state.score, 22, 35);
      ctx.fillText("♥ " + state.lives, 130, 35);
      if (work.timeLimit && work.timeLimit > 0) {
        var left = Math.max(0, Math.ceil(work.timeLimit - state.time));
        ctx.fillStyle = left < 10 ? "#f43f5e" : "#7dd3fc";
        ctx.fillText("⏱ " + left, 190, 35);
      }
    }

    var tick = performance.now() / 16;
    var uiState = { score: state.score, lives: state.lives, time: state.time, timeLimit: work.timeLimit, startLives: work.startLives };
    var uiElements = work.ui || [];
    for (var uiIdx = 0; uiIdx < uiElements.length; uiIdx++) {
      var uel = uiElements[uiIdx];
      if (uel.visible === false) continue;
      if (uel.kind === "joystick") {
        var jr = resolveUIRect(uel, W, H);
        var rad = Math.min(jr.w, jr.h) / 2;
        var jcx = jr.x + jr.w / 2, jcy = jr.y + jr.h / 2;
        ctx.globalAlpha = uel.opacity !== undefined ? uel.opacity : 1;
        ctx.fillStyle = uel.bg || "rgba(2,6,23,0.4)";
        ctx.beginPath(); ctx.arc(jcx, jcy, rad, 0, Math.PI * 2); ctx.fill();
        var k = joyKnobs.get(uel.id);
        var kx = jcx + (k ? k.dx : 0);
        var ky = jcy + (k ? k.dy : 0);
        ctx.fillStyle = uel.color || "#7dd3fc";
        ctx.beginPath(); ctx.arc(kx, ky, rad / 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      drawUIElement(ctx, uel, W, H, tick, uiState);
    }

    for (var ro = 0; ro < runtimeHooksList.length; ro++) {
      if (typeof runtimeHooksList[ro].onRenderOverlay === "function") {
        try { runtimeHooksList[ro].onRenderOverlay(ctx, runtimeApi, W, H); } catch (err) {}
      }
    }
  }

  var runtimeApi = {
    getScene: function() { return work; },
    getState: function() { return state; },
    getInput: function() { return input; },
    getPlayer: function() { return findFirstOfKind(work, "player"); },
    getEntities: function(kind) {
      if (!kind) return work.entities.filter(function(e) { return e.x > -9000; });
      return work.entities.filter(function(e) { return e.kind === kind && e.x > -9000; });
    },
    spawnEntity: function(kindOrPreset, overrides) {
      var base = typeof kindOrPreset === "string"
        ? (KIND_PRESETS[kindOrPreset] || KIND_PRESETS.coin)
        : kindOrPreset;
      var ent = Object.assign({}, cloneDeep(base), { id: uid(), x: 100, y: 100 }, overrides || {});
      work.entities.push(ent);
      drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
      return ent;
    },
    removeEntity: function(entityOrId) {
      var targetId = typeof entityOrId === "string" ? entityOrId : (entityOrId && entityOrId.id);
      if (!targetId) return false;
      for (var i = 0; i < work.entities.length; i++) {
        if (work.entities[i].id === targetId) {
          work.entities[i].x = -99999;
          return true;
        }
      }
      return false;
    },
    destroyEntity: function(entityOrId) {
      return runtimeApi.removeEntity(entityOrId);
    },
    addScore: function(delta) { state.score += Number(delta) || 0; return state.score; },
    setScore: function(val) { state.score = Number(val) || 0; return state.score; },
    addLives: function(delta) { state.lives = Math.max(0, state.lives + (Number(delta) || 0)); if (state.lives <= 0) state.dead = true; return state.lives; },
    setLives: function(val) { state.lives = Math.max(0, Number(val) || 0); if (state.lives <= 0) state.dead = true; return state.lives; },
    win: function() { state.win = true; },
    lose: function() { state.dead = true; },
    setGravity: function(g) { if (typeof g === "number") work.gravity = g; },
    setBg: function(color) { if (typeof color === "string") work.bg = color; },
    emitBurst: function(x, y, color, count) {
      emitBurst(state, { x: x, y: y, color: color || "#38bdf8", count: count || 10 });
    },
    playSound: function(nameOrUrl) { return playSoundUrl(nameOrUrl); },
    synthSound: function(spec) { return playSynthSpec(spec); },
    shake: function(intensity, duration) { hooks.shake(intensity || 8, duration || 0.25); },
    restart: function() { hooks.restart(); },
    switchScene: function(sceneId) { return switchScene(sceneId); },
    physics: runtimePhysics,
    audio: window.AsternalAudio
  };
  window.AsternalRuntime.api = runtimeApi;

  try {
  /* __ASTERNAL_CUSTOM_RUNTIME_START__ */
${customJs}
  /* __ASTERNAL_CUSTOM_RUNTIME_END__ */
  } catch (customRuntimeError) {
    console.error("[Asternal Custom Runtime]", customRuntimeError);
  }

  if (typeof window.AsternalRuntime.onInit === "function" || typeof window.AsternalRuntime.onTick === "function" || typeof window.AsternalRuntime.onRender === "function" || typeof window.AsternalRuntime.onKeyDown === "function") {
    window.AsternalRuntime.registerHook({
      onInit: window.AsternalRuntime.onInit,
      onTick: window.AsternalRuntime.onTick,
      onRender: window.AsternalRuntime.onRender,
      onRenderOverlay: window.AsternalRuntime.onRenderOverlay,
      onKeyDown: window.AsternalRuntime.onKeyDown,
      onKeyUp: window.AsternalRuntime.onKeyUp,
      onCollide: window.AsternalRuntime.onCollide
    });
  }

  for (var initIdx = 0; initIdx < runtimeHooksList.length; initIdx++) {
    if (typeof runtimeHooksList[initIdx].onInit === "function") {
      try { runtimeHooksList[initIdx].onInit(runtimeApi); } catch (err) { console.error("[onInit]", err); }
    }
  }

  // --- Parent Bridge & Visibility ---
  var paused = false;
  document.addEventListener("visibilitychange", function() {
    if (CONFIG.autoPause !== false) paused = document.hidden;
  });

  window.addEventListener("message", function(ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "asternal:runtime-restart") {
      hooks.restart();
      for (var ri = 0; ri < runtimeHooksList.length; ri++) {
        if (typeof runtimeHooksList[ri].onInit === "function") {
          try { runtimeHooksList[ri].onInit(runtimeApi); } catch (err) {}
        }
      }
    } else if (msg.type === "asternal:runtime-config") {
      if (typeof msg.volume === "number") volume = msg.volume;
      if (typeof msg.muted === "boolean") muted = msg.muted;
      if (typeof msg.music === "boolean") CONFIG.music = msg.music;
      if (msg.musicUrl !== undefined) CONFIG.musicUrl = msg.musicUrl;
      syncAudioConfig();
    } else if (msg.type === "asternal:key") {
      if (msg.kind === "keydown") {
        handleKeyDown(msg.code || msg.key, msg.key);
        for (var ki = 0; ki < runtimeHooksList.length; ki++) {
          if (typeof runtimeHooksList[ki].onKeyDown === "function") {
            try { runtimeHooksList[ki].onKeyDown(msg.code || msg.key, msg.key, runtimeApi); } catch (err) {}
          }
        }
      } else if (msg.kind === "keyup") {
        handleKeyUp(msg.code || msg.key, msg.key);
        for (var ku = 0; ku < runtimeHooksList.length; ku++) {
          if (typeof runtimeHooksList[ku].onKeyUp === "function") {
            try { runtimeHooksList[ku].onKeyUp(msg.code || msg.key, msg.key, runtimeApi); } catch (err) {}
          }
        }
      }
    }
  });

  // --- Hardware-Native Game Loop ---
  // El bucle corre directamente con el requestAnimationFrame nativo del dispositivo,
  // integrando la física con subpasos de alta precisión (máx 1/120 s) para que la
  // respuesta y suavidad dependan únicamente de la potencia real del hardware.
  var last = performance.now();
  var frames = 0;
  var fpsT = last;
  var MAX_SUBSTEP = 1 / 120;

  function loop(now) {
    requestAnimationFrame(loop);
    var elapsed = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (!paused) {
      var remaining = elapsed;
      var steps = 0;
      while (remaining > 1e-6 && steps < 8) {
        var stepDt = Math.min(remaining, MAX_SUBSTEP);
        if (!state.win && !state.dead) {
          stepScene(work, input, state, stepDt, onGoalReached);
          scripts.step(work, state, input, hooks, stepDt);
          for (var ti = 0; ti < runtimeHooksList.length; ti++) {
            if (typeof runtimeHooksList[ti].onTick === "function") {
              try { runtimeHooksList[ti].onTick(runtimeApi, stepDt); } catch (err) {}
            }
          }
          if (drawList.length !== work.entities.length) {
            drawList = sortedForRender(work).filter(function(e) { return !isOnHiddenLayer(work, e); });
          }
        }
        if (shake.time > 0) shake.time = Math.max(0, shake.time - stepDt);
        tickEmitters(stepDt);
        for (var i = particles.length - 1; i >= 0; i--) {
          var p = particles[i];
          p.x += p.vx * stepDt;
          p.y += p.vy * stepDt;
          p.vy += p.gravity * stepDt;
          p.life -= stepDt;
          if (p.life <= 0) particles.splice(i, 1);
        }
        remaining -= stepDt;
        steps++;
      }

      activePointers.forEach(function(d) {
        if (d.kind === "btn") scripts.runUI(d.el, "hold");
      });
    }

    draw();
    updateEndOverlay();
    updateDialogOverlay();

    frames++;
    if (now - fpsT >= 500) {
      var fps = Math.round((frames * 1000) / (now - fpsT));
      fpsBadge.textContent = fps + " FPS";
      frames = 0;
      fpsT = now;
    }
  }

  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
}

export interface ParsedGameHtmlResult {
  title?: string;
  initialSceneId?: string;
  scenes?: Scene[];
  assets?: Project["assets"];
  config?: Partial<Html5GameOptions>;
  customSounds?: CustomSound[];
  synthSounds?: Record<string, CustomSoundSynth>;
  customJs?: string;
  customCss?: string;
}

/**
 * Extrae todas las partes editables de un documento HTML5 de Asternal:
 * escenas, distribución de assets, entidades, scripts, configuración, sonidos
 * sintetizados, CSS y nuevas lógicas en el bloque `ASTERNAL_CUSTOM_RUNTIME`.
 */
export function parseStandaloneGameHtml(html: string): ParsedGameHtmlResult {
  const result: ParsedGameHtmlResult = {};
  if (!html || typeof html !== "string") return result;

  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    result.title = unescapeHtmlText(titleMatch[1].trim());
  }

  const payloadMatch = /<script\s+id=["']asternal-game-payload["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i.exec(html);
  if (payloadMatch) {
    const rawJson = payloadMatch[1].trim();
    const parsed = JSON.parse(rawJson) as {
      initialSceneId?: string;
      scenes?: Scene[];
      assets?: Project["assets"];
      config?: Partial<Html5GameOptions>;
      customSounds?: CustomSound[];
      synthSounds?: Record<string, CustomSoundSynth>;
    };
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.initialSceneId === "string") result.initialSceneId = parsed.initialSceneId;
      if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
        result.scenes = parsed.scenes.map((s) => ensureSceneLayers(s));
      }
      if (parsed.assets && typeof parsed.assets === "object") {
        result.assets = parsed.assets;
      }
      if (parsed.config && typeof parsed.config === "object") {
        result.config = parsed.config;
      }
      if (Array.isArray(parsed.customSounds)) {
        result.customSounds = parsed.customSounds;
      }
      if (parsed.synthSounds && typeof parsed.synthSounds === "object") {
        result.synthSounds = parsed.synthSounds;
      }
    }
  }

  const jsMatch = /\/\*\s*__ASTERNAL_CUSTOM_RUNTIME_START__\s*\*\/([\s\S]*?)\/\*\s*__ASTERNAL_CUSTOM_RUNTIME_END__\s*\*\//.exec(html);
  if (jsMatch) {
    result.customJs = jsMatch[1].trim();
  }

  const cssMatch = /\/\*\s*__ASTERNAL_CUSTOM_CSS_START__\s*\*\/([\s\S]*?)\/\*\s*__ASTERNAL_CUSTOM_CSS_END__\s*\*\//.exec(html);
  if (cssMatch) {
    result.customCss = cssMatch[1].trim();
  }

  return result;
}

/**
 * Sincroniza un documento HTML5 editado (por Orión o por la persona usuaria)
 * de vuelta con el objeto `Project` del editor visual, conservando tanto los
 * cambios en escenas/entidades/scripts/assets como cualquier código HTML5 adicional.
 */
export function syncHtmlToProject(html: string, currentProject: Project): Project {
  const parsed = parseStandaloneGameHtml(html);
  const nextScenes = parsed.scenes && parsed.scenes.length > 0 ? parsed.scenes : currentProject.scenes;
  const nextActiveSceneId =
    parsed.initialSceneId && nextScenes.some((s) => s.id === parsed.initialSceneId)
      ? parsed.initialSceneId
      : nextScenes.some((s) => s.id === currentProject.activeSceneId)
        ? currentProject.activeSceneId
        : nextScenes[0]?.id ?? currentProject.activeSceneId;

  const cfg = parsed.config ?? {};
  const nextSettings = {
    ...currentProject.settings,
    ...(cfg.fpsCap === 30 || cfg.fpsCap === 60 || cfg.fpsCap === 120 ? { fpsCap: cfg.fpsCap } : {}),
    ...(typeof cfg.showHUD === "boolean" ? { showHUD: cfg.showHUD } : {}),
    ...(typeof cfg.showFPS === "boolean" ? { showFPS: cfg.showFPS } : {}),
    ...(typeof cfg.volume === "number" ? { volume: cfg.volume } : {}),
    ...(typeof cfg.muted === "boolean" ? { muted: cfg.muted } : {}),
    ...(typeof cfg.music === "boolean" ? { music: cfg.music } : {}),
    ...(cfg.musicUrl !== undefined ? { musicUrl: cfg.musicUrl } : {}),
    ...(typeof cfg.touchControls === "boolean" ? { touchControls: cfg.touchControls } : {}),
    ...(typeof cfg.autoPause === "boolean" ? { autoPause: cfg.autoPause } : {}),
    ...(typeof cfg.showHitboxes === "boolean" ? { showHitboxes: cfg.showHitboxes } : {}),
  };

  const prevRuntime = currentProject.customRuntime ?? {};
  const cleanedJs =
    parsed.customJs !== undefined
      ? parsed.customJs === DEFAULT_CUSTOM_RUNTIME_COMMENT.trim()
        ? ""
        : parsed.customJs
      : prevRuntime.jsCode;

  const updatedProject: Project = {
    ...currentProject,
    name: parsed.title || currentProject.name,
    scenes: nextScenes,
    activeSceneId: nextActiveSceneId,
    assets: parsed.assets ?? currentProject.assets,
    settings: nextSettings,
    customRuntime: {
      ...prevRuntime,
      jsCode: cleanedJs,
      cssCode: parsed.customCss !== undefined ? parsed.customCss : prevRuntime.cssCode,
      synthSounds: parsed.synthSounds ?? prevRuntime.synthSounds,
    },
  };

  // Si es un documento HTML5 de Asternal con payload estructurado, los cambios ya quedaron
  // sincronizados en scenes, assets, settings y customRuntime; solo usamos customHtmlOverride
  // si el documento carece de asternal-game-payload.
  const hasStructuredPayload = /<script\s+id=["']asternal-game-payload["']/i.test(html);
  if (!hasStructuredPayload && html.trim()) {
    updatedProject.customRuntime = {
      ...updatedProject.customRuntime,
      customHtmlOverride: html,
    };
  } else if (updatedProject.customRuntime) {
    updatedProject.customRuntime = {
      ...updatedProject.customRuntime,
      customHtmlOverride: null,
    };
  }

  return syncRuntimeAndTexturesToProject(updatedProject);
}

/**
 * Detecta las texturas SVG genéricas antiguas (128x128 con formas inventadas) que no
 * correspondían a los assets predeterminados reales del motor.
 */
export function isLegacyGeneratedPlaceholderSvg(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || typeof dataUrl !== "string") return false;
  if (!dataUrl.startsWith("data:image/svg+xml")) return false;
  try {
    const decoded = decodeURIComponent(dataUrl);
    return (
      decoded.includes('viewBox="0 0 128 128"') &&
      (decoded.includes('<circle cx="64" cy="64" r="46"') ||
        decoded.includes('<rect x="20" y="12" width="88" height="104" rx="10"') ||
        decoded.includes('<ellipse cx="48" cy="50" rx="9" ry="11"') ||
        decoded.includes('<polygon points="34,44 56,54 36,60"') ||
        decoded.includes('<rect x="12" y="12" width="104" height="104" rx="12"'))
    );
  } catch {
    return false;
  }
}

/**
 * Genera la textura editable exacta del asset predeterminado del motor (`drawEntity` + `drawChibiCharacter`)
 * con las mismas dimensiones y colores que se ven en el editor y en el runtime.
 */
export function entityToEditableSvgDataUrl(
  entity: Pick<Entity, "kind" | "color" | "w" | "h" | "texture"> & { facing?: 1 | -1 },
): string {
  if (entity.texture && entity.texture.trim() && !isLegacyGeneratedPlaceholderSvg(entity.texture)) {
    return entity.texture;
  }
  const defaultSizes: Record<Entity["kind"], { w: number; h: number; color: string }> = {
    player: { w: 40, h: 56, color: "#38bdf8" },
    platform: { w: 40, h: 40, color: "#1e3a8a" },
    enemy: { w: 40, h: 40, color: "#f43f5e" },
    coin: { w: 22, h: 22, color: "#fbbf24" },
    goal: { w: 36, h: 64, color: "#7dd3fc" },
    decor: { w: 64, h: 64, color: "#a78bfa" },
  };
  const preset = defaultSizes[entity.kind] ?? defaultSizes.platform;
  const w = Math.max(8, Math.round(entity.w || preset.w));
  const h = Math.max(8, Math.round(entity.h || preset.h));
  const color = (entity.color || preset.color).trim();
  const r2 = (n: number) => Math.round(n * 100) / 100;

  let inner = "";
  if (entity.kind === "coin") {
    const rad = r2(Math.min(w, h) / 2);
    inner = `<circle cx="${r2(w / 2)}" cy="${r2(h / 2)}" r="${rad}" fill="${color}"/>`;
  } else if (entity.kind === "goal") {
    const midX = r2(w / 2);
    inner =
      `<rect x="0" y="0" width="${w}" height="${h}" fill="rgba(125,211,252,0.3)"/>` +
      `<rect x="${r2(midX - 2)}" y="0" width="4" height="${h}" fill="${color}"/>` +
      `<polygon points="${r2(midX + 2)},4 ${r2(midX + 22)},12 ${r2(midX + 2)},20" fill="${color}"/>`;
  } else if (entity.kind === "player") {
    const r = r2(Math.min(w, h) * 0.32);
    const footH = r2(Math.max(4, h * 0.11));
    const bodyH = r2(h - footH * 0.6);
    const footW = r2(Math.max(6, w * 0.24));
    const leftFootX = r2(w * 0.18);
    const rightFootX = r2(w - w * 0.18 - footW);
    const footY = r2(h - footH);
    const shineX = r2(w * 0.14);
    const shineY = r2(bodyH * 0.08);
    const shineW = r2(w * 0.72);
    const shineH = r2(Math.max(3, bodyH * 0.14));
    const shineR = r2(r * 0.4);
    const dir = entity.facing === -1 ? -1 : 1;
    const shift = dir * w * 0.06;
    const eyeY = r2(bodyH * 0.42);
    const eyeSpacing = w * 0.2;
    const cx = w / 2 + shift;
    const eyeW = Math.max(3, w * 0.11);
    const eyeH = Math.max(4, bodyH * 0.16);
    const exL = r2(cx - eyeSpacing);
    const exR = r2(cx + eyeSpacing);
    const glintR = r2(Math.max(1, eyeW * 0.22));
    const glintY = r2(eyeY - eyeH * 0.2);
    const cheekY = r2(eyeY + eyeH * 0.55);
    const cheekRx = r2(eyeW * 0.55);
    const cheekRy = r2(eyeH * 0.25);

    inner =
      `<defs><linearGradient id="chibiBody" x1="0" y1="0" x2="0" y2="${bodyH}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="#7dd3fc"/>` +
      `<stop offset="55%" stop-color="${color}"/>` +
      `<stop offset="100%" stop-color="#0284c7"/>` +
      `</linearGradient></defs>` +
      `<rect x="${leftFootX}" y="${footY}" width="${footW}" height="${footH}" rx="2" fill="#0f172a"/>` +
      `<rect x="${rightFootX}" y="${footY}" width="${footW}" height="${footH}" rx="2" fill="#0f172a"/>` +
      `<rect x="0.75" y="0.75" width="${r2(w - 1.5)}" height="${r2(bodyH - 1.5)}" rx="${r}" fill="url(#chibiBody)" stroke="#0f172a" stroke-width="1.5"/>` +
      `<rect x="${shineX}" y="${shineY}" width="${shineW}" height="${shineH}" rx="${shineR}" fill="rgba(255,255,255,0.35)"/>` +
      `<ellipse cx="${exL}" cy="${eyeY}" rx="${r2(eyeW * 0.7)}" ry="${r2(eyeH * 0.65)}" fill="#f8fafc"/>` +
      `<ellipse cx="${r2(exL + dir * 0.8)}" cy="${r2(eyeY + 0.5)}" rx="${r2(eyeW * 0.45)}" ry="${r2(eyeH * 0.45)}" fill="#0f172a"/>` +
      `<circle cx="${r2(exL - 0.8)}" cy="${glintY}" r="${glintR}" fill="#ffffff"/>` +
      `<ellipse cx="${exR}" cy="${eyeY}" rx="${r2(eyeW * 0.7)}" ry="${r2(eyeH * 0.65)}" fill="#f8fafc"/>` +
      `<ellipse cx="${r2(exR + dir * 0.8)}" cy="${r2(eyeY + 0.5)}" rx="${r2(eyeW * 0.45)}" ry="${r2(eyeH * 0.45)}" fill="#0f172a"/>` +
      `<circle cx="${r2(exR - 0.8)}" cy="${glintY}" r="${glintR}" fill="#ffffff"/>` +
      `<ellipse cx="${r2(cx - eyeSpacing * 1.35)}" cy="${cheekY}" rx="${cheekRx}" ry="${cheekRy}" fill="rgba(244,114,182,0.55)"/>` +
      `<ellipse cx="${r2(cx + eyeSpacing * 1.35)}" cy="${cheekY}" rx="${cheekRx}" ry="${cheekRy}" fill="rgba(244,114,182,0.55)"/>`;
  } else {
    const rx = entity.kind === "platform" ? 4 : 6;
    inner = `<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${color}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Garantiza que todas las texturas (de entidades, animaciones, interfaz o fondo) y los sonidos
 * o ajustes registrados en el runtime estén sincronizados en las estructuras del editor normal
 * (`project.assets.sprites`, `project.customRuntime.synthSounds`, etc.) para que el usuario
 * pueda seguir editándolos sin perder nada, respetando siempre los assets predeterminados del motor.
 */
export function syncRuntimeAndTexturesToProject(
  project: Project,
  extraSprites?: Array<{ id?: string; name?: string; width?: number; height?: number; dataUrl?: string; texture?: string }>,
): Project {
  let scenesChanged = false;
  const cleanedScenes = (project.scenes ?? []).map((sc) => {
    let entChanged = false;
    const nextEntities = (sc.entities ?? []).map((ent) => {
      if (ent.texture && isLegacyGeneratedPlaceholderSvg(ent.texture)) {
        entChanged = true;
        return { ...ent, texture: null };
      }
      return ent;
    });
    const ensured = ensureSceneLayers(entChanged ? { ...sc, entities: nextEntities } : sc);
    if (ensured !== sc || entChanged) scenesChanged = true;
    return ensured;
  });

  const rawExistingSprites: SpriteAsset[] = project.assets?.sprites ?? [];
  let spritesCleaned = false;
  const existingSprites: SpriteAsset[] = [];
  const seenComposites = new Set<string>();
  for (const sp of rawExistingSprites) {
    const firstComp = sp.frames?.[0]?.composite;
    if (firstComp && isLegacyGeneratedPlaceholderSvg(firstComp)) {
      spritesCleaned = true;
      continue;
    }
    if (firstComp && seenComposites.has(firstComp)) {
      spritesCleaned = true;
      continue;
    }
    for (const fr of sp.frames ?? []) {
      if (fr?.composite) seenComposites.add(fr.composite);
    }
    existingSprites.push(sp);
  }

  const registerTexture = (dataUrl: string | null | undefined, name: string, w = 64, h = 64, customId?: string) => {
    const clean = typeof dataUrl === "string" ? dataUrl.trim() : "";
    if (!clean || isLegacyGeneratedPlaceholderSvg(clean) || seenComposites.has(clean)) return;
    seenComposites.add(clean);
    existingSprites.push({
      id: customId && customId.trim() ? customId.trim() : uid(),
      name: (name || "textura").slice(0, 24),
      width: Math.max(8, Math.round(w || 64)),
      height: Math.max(8, Math.round(h || 64)),
      fps: 8,
      loop: true,
      frames: [{ id: uid(), layers: [], composite: clean }],
    });
  };

  if (Array.isArray(extraSprites)) {
    for (const sp of extraSprites) {
      if (!sp || typeof sp !== "object") continue;
      const url = sp.dataUrl ?? sp.texture;
      registerTexture(url, sp.name || "textura", sp.width ?? 64, sp.height ?? 64, sp.id);
    }
  }

  for (const sc of cleanedScenes) {
    if (sc.bgImage) {
      registerTexture(sc.bgImage, `Fondo ${sc.name || "escena"}`, 256, 256);
    }
    for (const ent of sc.entities ?? []) {
      if (ent.texture) {
        registerTexture(ent.texture, ent.name || ent.kind, ent.w, ent.h);
      }
      if (Array.isArray(ent.animations)) {
        for (const clip of ent.animations) {
          const first = clip?.frames?.[0];
          if (first && !seenComposites.has(first)) {
            for (const f of clip.frames) {
              if (f) seenComposites.add(f);
            }
            existingSprites.push({
              id: clip.id || uid(),
              name: `${(ent.name || ent.kind).slice(0, 16)} ${clip.name || "anim"}`.slice(0, 24),
              width: Math.max(8, Math.round(ent.w || 64)),
              height: Math.max(8, Math.round(ent.h || 64)),
              fps: clip.fps || 8,
              loop: clip.loop !== false,
              frames: clip.frames.filter(Boolean).map((f) => ({ id: uid(), layers: [], composite: f })),
            });
          }
        }
      }
    }
    for (const u of sc.ui ?? []) {
      if (u.image) {
        registerTexture(u.image, u.name || u.kind, u.w, u.h);
      }
    }
  }

  // Extrae sonidos registrados con window.AsternalAudio.registerSound("nombre", { ... }) en customRuntime.jsCode
  const jsCode = project.customRuntime?.jsCode ?? "";
  const nextSynthSounds: Record<string, CustomSoundSynth> = {
    ...(project.customRuntime?.synthSounds ?? {}),
  };
  if (jsCode) {
    const soundRegex = /registerSound\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = soundRegex.exec(jsCode)) !== null) {
      const soundName = match[1]?.trim();
      const rawSpec = match[2];
      if (!soundName || nextSynthSounds[soundName]) continue;
      try {
        const parsedSpec = new Function(`return (${rawSpec});`)() as Partial<CustomSoundSynth>;
        if (parsedSpec && typeof parsedSpec === "object") {
          nextSynthSounds[soundName] = {
            name: soundName,
            wave: parsedSpec.wave ?? "sine",
            freq: typeof parsedSpec.freq === "number" ? parsedSpec.freq : 440,
            endFreq: typeof parsedSpec.endFreq === "number" ? parsedSpec.endFreq : parsedSpec.freq ?? 440,
            duration: typeof parsedSpec.duration === "number" ? parsedSpec.duration : 0.18,
            volume: typeof parsedSpec.volume === "number" ? parsedSpec.volume : 0.35,
          };
        }
      } catch {
        /* ignore dynamic expressions */
      }
    }

    const dataImgRegex = /["'](data:image\/(?:svg\+xml|png|jpeg|webp)[^"']+)["']/g;
    let imgMatch: RegExpExecArray | null;
    let runtimeTexIdx = 1;
    while ((imgMatch = dataImgRegex.exec(jsCode)) !== null) {
      const rawUrl = imgMatch[1]?.trim();
      if (rawUrl) {
        registerTexture(rawUrl, `Runtime #${runtimeTexIdx++}`, 64, 64);
      }
    }
  }

  const spritesChanged = spritesCleaned || existingSprites.length !== rawExistingSprites.length;
  const soundsChanged = Object.keys(nextSynthSounds).length !== Object.keys(project.customRuntime?.synthSounds ?? {}).length;

  if (!scenesChanged && !spritesChanged && !soundsChanged) return project;

  return {
    ...project,
    ...(scenesChanged ? { scenes: cleanedScenes } : {}),
    assets: {
      ...(project.assets ?? { sprites: [] }),
      sprites: existingSprites,
    },
    ...(project.customRuntime || soundsChanged
      ? {
          customRuntime: {
            ...(project.customRuntime ?? {}),
            synthSounds: nextSynthSounds,
          },
        }
      : {}),
  };
}

/**
 * Construye el documento HTML5 completo a partir de un `Project` completo.
 */
export function buildProjectGameHtml(project: Project, embedded = true): string {
  const scene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0];
  if (!scene) return "";
  return buildStandaloneGameHtml({
    scene,
    scenes: project.scenes,
    assets: project.assets,
    title: project.name || "Mi juego",
    fpsCap: project.settings.fpsCap,
    showHUD: project.settings.showHUD,
    showFPS: project.settings.showFPS ?? true,
    volume: project.settings.volume ?? 0.8,
    muted: project.settings.muted ?? false,
    music: project.settings.music ?? false,
    musicUrl: project.settings.musicUrl ?? null,
    touchControls: project.settings.touchControls ?? true,
    autoPause: project.settings.autoPause ?? true,
    showHitboxes: project.settings.showHitboxes ?? false,
    customRuntime: project.customRuntime,
    embedded,
  });
}

/**
 * Crea un archivo HTML5 en memoria (`Blob` de tipo `text/html`) y devuelve su URL
 * lista para cargarse en un `<iframe>` o pestaña independiente.
 */
export function createGameHtmlBlobUrl(options: Html5GameOptions & { rawHtmlOverride?: string | null }): {
  url: string;
  html: string;
  revoke: () => void;
} {
  const html = options.rawHtmlOverride?.trim()
    ? options.rawHtmlOverride
    : buildStandaloneGameHtml(options);
  if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    return {
      url,
      html,
      revoke: () => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      },
    };
  }
  return {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    html,
    revoke: () => {},
  };
}

/**
 * Descarga el proyecto como un archivo `.html` autónomo que se puede abrir y jugar
 * en cualquier navegador o dispositivo sin necesidad del editor.
 */
export function exportProjectHtml5(project: Project): void {
  const html = buildProjectGameHtml(project, false);
  if (!html) return;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(project.name || "asternal-game").replace(/\s+/g, "-").toLowerCase()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
