import { useEffect, useRef, useState } from "react";
import type { CustomRuntimeConfig, Entity, Project, RuntimeInput, RuntimeState, Scene, UIElement } from "@/lib/engine/core";
import { stepScene, newRuntimeState, resolveUIRect, sortedForRender, isOnHiddenLayer, layerOpacityFor, intersects } from "@/lib/engine/core";
import { getRenderableImage } from "@/lib/engine/images";
import { currentFrameRenderable } from "@/lib/engine/animations";
import { drawChibiCharacter } from "@/lib/engine/character";
import { createScriptRunner, compileScriptToHtml5Js, type RuntimeHooks, type UIScriptPhase } from "@/lib/engine/scripts";
import { startMusic, stopMusic, setVolume, setMuted } from "@/lib/engine/sfx";
import { createGameHtmlBlobUrl } from "@/lib/engine/html5-game";
import { sanitizeOrUpgradeHtml5ScriptJs } from "@/lib/ai/custom-language";

function drawUIElement(
  ctx: CanvasRenderingContext2D,
  el: UIElement,
  W: number,
  H: number,
  _tick: number,
  state: { score: number; lives: number; time: number; timeLimit?: number; startLives?: number },
) {
  const r = resolveUIRect(el, W, H);
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  const radius = Math.max(0, Math.min(r.w / 2, r.h / 2, el.radius ?? 8));

  if (el.bg) {
    ctx.fillStyle = el.bg;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.fill();
  }
  if (el.border) {
    ctx.strokeStyle = el.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.stroke();
  }

  if (el.image) {
    const img = getRenderableImage(el.image);
    if (img) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }
  }

  let displayText = el.text ?? "";
  if (el.bind === "score") displayText = `${el.text ? el.text + " " : ""}${state.score}`;
  else if (el.bind === "lives") displayText = `${el.text ? el.text + " " : ""}${state.lives}`;
  else if (el.bind === "time") {
    const left = state.timeLimit && state.timeLimit > 0
      ? Math.max(0, Math.ceil(state.timeLimit - state.time))
      : Math.floor(state.time);
    displayText = `${el.text ? el.text + " " : ""}${left}`;
  }

  if (displayText) {
    const fontSize = el.fontSize ?? 14;
    ctx.font = `600 ${fontSize}px Rajdhani, sans-serif`;
    ctx.fillStyle = el.color ?? "#f8fafc";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(displayText, r.x + r.w / 2, r.y + r.h / 2);
  }
  ctx.restore();
}

interface Props {
  scene: Scene;
  scenes?: Scene[];
  assets?: Project["assets"];
  customRuntime?: CustomRuntimeConfig;
  rawHtmlOverride?: string | null;
  title?: string;
  fpsCap: 30 | 60 | 120;
  showHUD: boolean;
  showFPS?: boolean;
  volume?: number;
  muted?: boolean;
  music?: boolean;
  musicUrl?: string | null;
  touchControls?: boolean;
  autoPause?: boolean;
  showHitboxes?: boolean;
  cameraOrientation?: "horizontal" | "vertical";
  embedded?: boolean;
  onExit: () => void;
}

/**
 * Ejecuta el juego compilándolo en un archivo HTML5 autónomo (`Blob` `text/html`)
 * dentro de un contexto aislado (`<iframe>`). Así el rendimiento de la vista previa
 * y del runtime depende exclusivamente de la potencia real del dispositivo y su
 * `requestAnimationFrame` nativo, sin interferencia del árbol React ni del editor.
 */
export function GameRuntime(props: Props) {
  const effectiveRawOverride =
    props.rawHtmlOverride ?? props.customRuntime?.customHtmlOverride ?? null;
  if (effectiveRawOverride && effectiveRawOverride.trim()) {
    return <IframeHtmlGameRuntime {...props} rawHtmlOverride={effectiveRawOverride} />;
  }
  return <LegacyCanvasGameRuntime {...props} />;
}

export function IframeHtmlGameRuntime({
  scene,
  scenes,
  assets,
  customRuntime,
  rawHtmlOverride,
  title,
  fpsCap,
  showHUD,
  showFPS = true,
  volume = 0.8,
  muted = false,
  music = false,
  musicUrl = null,
  touchControls = true,
  autoPause = true,
  showHitboxes = false,
  cameraOrientation = "horizontal",
  embedded = true,
  onExit,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");

  useEffect(() => {
    const bundle = createGameHtmlBlobUrl({
      scene,
      scenes,
      assets,
      customRuntime,
      rawHtmlOverride: rawHtmlOverride ?? customRuntime?.customHtmlOverride ?? null,
      title: title || scene.name || "Asternal HTML5 Game",
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
      cameraOrientation,
      embedded,
    });
    setBlobUrl(bundle.url);
    setHtmlContent(bundle.html);
    return () => {
      setTimeout(() => bundle.revoke(), 2000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, scenes, assets, customRuntime, rawHtmlOverride, title, fpsCap, embedded]);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "asternal:runtime-config",
        volume,
        muted,
        music,
        musicUrl,
        showHUD,
        showFPS,
        showHitboxes,
        touchControls,
        autoPause,
        cameraOrientation,
        fpsCap,
      },
      "*",
    );
  }, [volume, muted, music, musicUrl, showHUD, showFPS, showHitboxes, touchControls, autoPause, cameraOrientation, fpsCap]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== "object" || data.type !== "asternal:runtime") return;
      if (data.action === "exit") {
        onExitRef.current();
      } else if (data.action === "goal") {
        window.dispatchEvent(
          new CustomEvent("asternal:goal", {
            detail: {
              nextSceneId: data.nextSceneId ?? null,
              endsGame: Boolean(data.endsGame),
            },
          }),
        );
      }
    };

    const onRestart = () => {
      iframeRef.current?.contentWindow?.postMessage({ type: "asternal:runtime-restart" }, "*");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "asternal:key", kind: "keydown", code: e.code, key: e.key },
        "*",
      );
    };

    const onKeyUp = (e: KeyboardEvent) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "asternal:key", kind: "keyup", code: e.code, key: e.key },
        "*",
      );
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("asternal:restart", onRestart);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("asternal:restart", onRestart);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div data-no-drawably className="relative h-full w-full bg-[#0b1e3f] overflow-hidden">
      {blobUrl && (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          srcDoc={htmlContent || undefined}
          title={title || scene.name || "HTML5 Game Runtime"}
          className="h-full w-full border-0 block"
          allow="autoplay; fullscreen; gamepad"
          onLoad={() => {
            try {
              iframeRef.current?.contentWindow?.focus();
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
  );
}

const SYNTH_PRESETS: Record<string, { wave: OscillatorType; freq: number; endFreq: number; duration: number; volume: number }> = {
  jump: { wave: "sine", freq: 240, endFreq: 560, duration: 0.16, volume: 0.35 },
  coin: { wave: "sine", freq: 587.33, endFreq: 1174.66, duration: 0.18, volume: 0.35 },
  laser: { wave: "sawtooth", freq: 780, endFreq: 160, duration: 0.18, volume: 0.3 },
  dash: { wave: "triangle", freq: 180, endFreq: 680, duration: 0.14, volume: 0.4 },
  explosion: { wave: "sawtooth", freq: 140, endFreq: 32, duration: 0.38, volume: 0.45 },
  powerup: { wave: "triangle", freq: 330, endFreq: 880, duration: 0.28, volume: 0.35 },
  hit: { wave: "square", freq: 160, endFreq: 65, duration: 0.15, volume: 0.35 },
  victory: { wave: "triangle", freq: 440, endFreq: 880, duration: 0.42, volume: 0.4 },
  bounce: { wave: "sine", freq: 190, endFreq: 480, duration: 0.22, volume: 0.38 },
  portal: { wave: "sine", freq: 320, endFreq: 960, duration: 0.32, volume: 0.35 },
};

export function LegacyCanvasGameRuntime({
  scene,
  scenes,
  customRuntime,
  fpsCap,
  showHUD,
  showFPS = true,
  volume = 0.8,
  muted = false,
  music = false,
  musicUrl = null,
  touchControls = true,
  autoPause = true,
  showHitboxes = false,
  cameraOrientation = "horizontal",
  embedded = true,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<RuntimeInput>({ left: false, right: false, jump: false });
  const btnSrc = useRef({ left: false, right: false, jump: false });
  const joySrc = useRef({ left: false, right: false, jump: false });
  const keySrc = useRef({ left: false, right: false, jump: false });
  const stateRef = useRef<RuntimeState | null>(null);
  const uiScriptsRef = useRef<((el: UIElement, phase: UIScriptPhase) => void) | null>(null);
  const workRef = useRef<Scene | null>(null);
  const [hud, setHud] = useState({ score: 0, fps: 60, win: false, dead: false });
  const [dialog, setDialog] = useState<RuntimeState["dialog"]>(null);

  const recomputeInput = () => {
    inputRef.current.left = btnSrc.current.left || joySrc.current.left || keySrc.current.left;
    inputRef.current.right = btnSrc.current.right || joySrc.current.right || keySrc.current.right;
    inputRef.current.jump = btnSrc.current.jump || joySrc.current.jump || keySrc.current.jump;
  };

  const press = (k: keyof RuntimeInput, v: boolean) => {
    btnSrc.current[k] = v;
    recomputeInput();
  };

  useEffect(() => { setVolume(volume); }, [volume]);
  useEffect(() => { setMuted(muted); }, [muted]);
  useEffect(() => {
    if (music && !muted && musicUrl) startMusic(musicUrl);
    else stopMusic();
    return () => stopMusic();
  }, [music, muted, musicUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const allScenes = scenes && scenes.length > 0 ? scenes : [scene];
    let initial: Scene = JSON.parse(JSON.stringify(scene));
    let work: Scene = JSON.parse(JSON.stringify(initial));
    workRef.current = work;
    let drawList = sortedForRender(work).filter(e => !isOnHiddenLayer(work, e));
    const state: RuntimeState = newRuntimeState(initial);
    stateRef.current = state;
    let scripts = createScriptRunner();
    uiScriptsRef.current = (el, phase) => scripts.runUI(el, phase);
    const shake = { intensity: 0, time: 0 };

    type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; gravity: number };
    const particles: Part[] = [];

    // Custom Runtime & WebAudio bridge on window for customRuntime.jsCode & custom-language
    let audioCtx: AudioContext | null = null;
    const getAudioCtx = (): AudioContext | null => {
      if (typeof window === "undefined") return null;
      if (!audioCtx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          try { audioCtx = new Ctx(); } catch { audioCtx = null; }
        }
      }
      if (audioCtx && audioCtx.state === "suspended") {
        try { void audioCtx.resume(); } catch { /* ignore */ }
      }
      return audioCtx;
    };

    const registeredSounds: Record<string, Record<string, unknown>> = {
      ...SYNTH_PRESETS,
      ...(customRuntime?.synthSounds as Record<string, Record<string, unknown>> | undefined ?? {}),
    };

    const playSynthSpec = (spec: Record<string, unknown> | undefined): boolean => {
      if (muted || !spec) return false;
      const actx = getAudioCtx();
      if (!actx) return false;
      try {
        const now = actx.currentTime;
        const dur = Math.max(0.03, Math.min(3, Number(spec.duration) || 0.18));
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = (spec.wave as OscillatorType) || "sine";
        const startF = Math.max(20, Number(spec.freq) || 440);
        const endF = Math.max(20, Number(spec.endFreq !== undefined ? spec.endFreq : startF));
        osc.frequency.setValueAtTime(startF, now);
        if (endF !== startF) {
          osc.frequency.exponentialRampToValueAtTime(endF, now + dur);
        }
        const peak = Math.max(0.01, Math.min(1, (typeof spec.volume === "number" ? spec.volume : 0.35) * volume));
        gain.gain.setValueAtTime(peak, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.01);
        return true;
      } catch {
        return false;
      }
    };

    const playRuntimeSound = (nameOrSpec: unknown): boolean => {
      if (muted || !nameOrSpec) return false;
      if (typeof nameOrSpec === "object") {
        return playSynthSpec(nameOrSpec as Record<string, unknown>);
      }
      const key = String(nameOrSpec).trim().replace(/^synth:/, "");
      if (registeredSounds[key]) return playSynthSpec(registeredSounds[key]);
      return playSynthSpec(SYNTH_PRESETS.coin);
    };

    type RuntimeHookEntry = {
      id?: string;
      onInit?: (api: unknown) => void;
      onTick?: (api: unknown, dt: number) => void;
      onCollide?: (a: Entity, b: Entity, api: unknown) => void;
      onKeyDown?: (code: string, key: string, api: unknown) => void;
      onKeyUp?: (code: string, key: string, api: unknown) => void;
      onRenderBackground?: (ctx: CanvasRenderingContext2D, api: unknown, W: number, H: number) => void;
      onRender?: (ctx: CanvasRenderingContext2D, api: unknown) => void;
      onRenderOverlay?: (ctx: CanvasRenderingContext2D, api: unknown, W: number, H: number) => void;
      customBlocks?: Record<string, unknown>;
    };
    const runtimeHooksList: RuntimeHookEntry[] = [];
    const runtimePhysics = {
      baseSpeed: 220,
      jumpForce: 520,
      terminalVelocity: 1200,
      coyoteTime: 0.1,
      jumpBuffer: 0.12,
      jumpCut: 0.45,
    };

    const hooks: RuntimeHooks = {
      shake: (intensity: number, duration: number) => {
        shake.intensity = Math.max(shake.intensity, intensity);
        shake.time = Math.max(shake.time, duration);
      },
      restart: () => {
        work = JSON.parse(JSON.stringify(initial));
        workRef.current = work;
        drawList = sortedForRender(work).filter(e => !isOnHiddenLayer(work, e));
        Object.assign(state, newRuntimeState(initial));
        scripts = createScriptRunner();
        particles.length = 0;
        for (const h of runtimeHooksList) {
          if (typeof h.onInit === "function") {
            try { h.onInit(runtimeApi); } catch { /* ignore */ }
          }
        }
        setHud({ score: state.score, fps: fpsCap, win: false, dead: false });
      },
    };

    const pressedKeys: Record<string, boolean> = {};
    const runtimeApi = {
      canvas,
      ctx,
      keys: pressedKeys,
      get scene() { return work; },
      get state() { return state; },
      get input() { return Object.assign(inputRef.current, { keys: pressedKeys }); },
      camera: { x: 0, y: 0, scale: 1 },
      getScene: () => work,
      getState: () => state,
      getInput: () => Object.assign(inputRef.current, { keys: pressedKeys }),
      getPlayer: () => work.entities.find(e => (e.controllable || e.kind === "player") && e.x > -9000) ?? null,
      getScore: () => state.score,
      getLives: () => state.lives,
      getEntities: (kind?: string) =>
        kind
          ? work.entities.filter(e => e.kind === kind && e.x > -9000)
          : work.entities.filter(e => e.x > -9000),
      spawnEntity: (
        kindOrPreset: string | Partial<Entity>,
        xOrOverrides?: number | Partial<Entity>,
        yOpt?: number,
        overridesOpt?: Partial<Entity>,
      ) => {
        const extraOverrides: Partial<Entity> & Record<string, unknown> =
          typeof xOrOverrides === "number"
            ? {
                ...(overridesOpt ?? {}),
                x: xOrOverrides,
                ...(typeof yOpt === "number" ? { y: yOpt } : {}),
              }
            : { ...(xOrOverrides ?? {}) };

        if (
          typeof kindOrPreset === "string" &&
          (kindOrPreset === "particle" || kindOrPreset === "spark" || kindOrPreset === "fire" || kindOrPreset === "smoke")
        ) {
          const px = typeof extraOverrides.x === "number" && Number.isFinite(extraOverrides.x) ? extraOverrides.x : 100;
          const py = typeof extraOverrides.y === "number" && Number.isFinite(extraOverrides.y) ? extraOverrides.y : 100;
          const pvx = typeof extraOverrides.vx === "number" && Number.isFinite(extraOverrides.vx) ? extraOverrides.vx : (Math.random() - 0.5) * 120;
          const pvy = typeof extraOverrides.vy === "number" && Number.isFinite(extraOverrides.vy) ? extraOverrides.vy : -40 - Math.random() * 80;
          const plife = typeof extraOverrides.life === "number" && extraOverrides.life > 0 ? extraOverrides.life : 0.45;
          const psize = typeof extraOverrides.size === "number" && extraOverrides.size > 0 ? extraOverrides.size : (typeof extraOverrides.w === "number" ? extraOverrides.w : 4);
          const pcolor = typeof extraOverrides.color === "string" ? extraOverrides.color : "#38bdf8";
          particles.push({
            x: px,
            y: py,
            vx: pvx,
            vy: pvy,
            life: plife,
            max: plife,
            color: pcolor,
            size: psize,
            gravity: extraOverrides.gravity === false ? 0 : 300,
          });
          return null;
        }

        const base: Partial<Entity> =
          typeof kindOrPreset === "string"
            ? {
                kind: (kindOrPreset as Entity["kind"]) || "coin",
                w: 32,
                h: 32,
                vx: 0,
                vy: 0,
                color: kindOrPreset === "enemy" ? "#ef4444" : kindOrPreset === "platform" ? "#3b82f6" : "#fbbf24",
                solid: kindOrPreset === "platform",
                gravity: kindOrPreset === "enemy" || kindOrPreset === "player",
                controllable: false,
                collectible: kindOrPreset === "coin",
                hazard: kindOrPreset === "enemy",
                goal: kindOrPreset === "goal",
                visible: true,
                opacity: 1,
                texture: null,
              }
            : kindOrPreset;
        const resolvedW = typeof extraOverrides.w === "number" ? extraOverrides.w : typeof extraOverrides.width === "number" ? Number(extraOverrides.width) : (base.w ?? 32);
        const resolvedH = typeof extraOverrides.h === "number" ? extraOverrides.h : typeof extraOverrides.height === "number" ? Number(extraOverrides.height) : (base.h ?? 32);
        const ent: Entity & Record<string, unknown> = {
          id: Math.random().toString(36).slice(2, 10),
          kind: "coin",
          x: 100,
          y: 100,
          w: resolvedW,
          h: resolvedH,
          width: resolvedW,
          height: resolvedH,
          vx: 0,
          vy: 0,
          color: "#fbbf24",
          solid: false,
          gravity: false,
          controllable: false,
          collectible: false,
          hazard: false,
          goal: false,
          visible: true,
          opacity: 1,
          texture: null,
          grounded: false,
          onGround: false,
          ...base,
          ...extraOverrides,
        };
        ent.width = ent.w;
        ent.height = ent.h;
        work.entities.push(ent);
        drawList = sortedForRender(work).filter(e => !isOnHiddenLayer(work, e));
        return ent;
      },
      removeEntity: (entityOrId: string | Entity) => {
        const targetId = typeof entityOrId === "string" ? entityOrId : entityOrId?.id;
        if (!targetId) return false;
        const found = work.entities.find(e => e.id === targetId);
        if (found) {
          found.x = -99999;
          return true;
        }
        return false;
      },
      destroyEntity: (entityOrId: string | Entity) => runtimeApi.removeEntity(entityOrId),
      addScore: (delta: number) => { state.score += Number(delta) || 0; return state.score; },
      setScore: (val: number) => { state.score = Number(val) || 0; return state.score; },
      addLives: (delta: number) => {
        state.lives = Math.max(0, state.lives + (Number(delta) || 0));
        if (state.lives <= 0) state.dead = true;
        return state.lives;
      },
      setLives: (val: number) => {
        state.lives = Math.max(0, Number(val) || 0);
        if (state.lives <= 0) state.dead = true;
        return state.lives;
      },
      win: () => { state.win = true; },
      lose: () => { state.dead = true; },
      setGravity: (g: number) => { if (typeof g === "number") work.gravity = g; },
      setBg: (color: string) => { if (typeof color === "string") work.bg = color; },
      emitBurst: (x: number, y: number, color?: string, count?: number) => {
        if (!state.particles) state.particles = [];
        state.particles.push({ x, y, color: color || "#38bdf8", count: count || 10 });
      },
      playSound: (nameOrUrl: unknown) => playRuntimeSound(nameOrUrl),
      synthSound: (spec: Record<string, unknown>) => playSynthSpec(spec),
      shake: (intensity?: number, duration?: number) => hooks.shake(intensity || 8, duration || 0.25),
      restart: () => hooks.restart(),
      switchScene: (sceneId: string) => {
        const nextScene = allScenes.find(s => s.id === sceneId);
        if (!nextScene) return false;
        initial = JSON.parse(JSON.stringify(nextScene));
        hooks.restart();
        return true;
      },
      physics: runtimePhysics,
    };

    const winAny = window as unknown as Record<string, unknown>;
    winAny.AsternalAudio = {
      play: (nameOrUrl: unknown) => playRuntimeSound(nameOrUrl),
      playMusic: (url: string) => { startMusic(url); return true; },
      stopMusic: () => stopMusic(),
      synth: (spec: Record<string, unknown>) => playSynthSpec(spec),
      registerSound: (name: string, spec: Record<string, unknown>) => {
        if (name && spec) registeredSounds[name] = spec;
      },
      getRegisteredSounds: () => registeredSounds,
    };

    winAny.AsternalRuntime = {
      canvas,
      ctx,
      get scene() { return work; },
      get state() { return state; },
      get input() { return inputRef.current; },
      physics: runtimePhysics,
      hooks: runtimeHooksList,
      api: runtimeApi,
      registerHook: (hook: RuntimeHookEntry | ((api: unknown, dt: number) => void)) => {
        if (typeof hook === "function") {
          runtimeHooksList.push({ onTick: hook });
          return;
        }
        if (!hook || typeof hook !== "object") return;
        const normalized: RuntimeHookEntry = { ...hook };
        const raw = hook as Record<string, unknown>;
        if (!normalized.onTick && typeof raw.onUpdate === "function") {
          normalized.onTick = raw.onUpdate as RuntimeHookEntry["onTick"];
        }
        if (!normalized.onRender && typeof raw.onDraw === "function") {
          normalized.onRender = raw.onDraw as RuntimeHookEntry["onRender"];
        }
        if (!normalized.onKeyDown && typeof raw.onKey === "function") {
          normalized.onKeyDown = raw.onKey as RuntimeHookEntry["onKeyDown"];
        }
        if (!normalized.onInit && typeof raw.onStart === "function") {
          normalized.onInit = raw.onStart as RuntimeHookEntry["onInit"];
        }
        if (normalized.id) {
          const existingIdx = runtimeHooksList.findIndex(h => h.id === normalized.id);
          if (existingIdx >= 0) {
            runtimeHooksList[existingIdx] = normalized;
            return;
          }
        }
        runtimeHooksList.push(normalized);
      },
      registerBlock: () => {},
    };

    const html5Snippets: Array<{ id: string; code: string }> = [];
    const seenSnippets = new Set<string>();
    const addHtml5Snippet = (
      rawJs?: string | null,
      fallbackSource?: string | null,
      entityId?: string | null,
      entityKind?: Entity["kind"],
      scriptId?: string,
    ) => {
      const clean = sanitizeOrUpgradeHtml5ScriptJs(
        rawJs,
        fallbackSource,
        entityId,
        entityKind,
      ).trim();
      if (!clean || seenSnippets.has(clean)) return;
      seenSnippets.add(clean);
      html5Snippets.push({
        id: scriptId || `html5-script-${html5Snippets.length + 1}`,
        code: clean,
      });
    };

    const baseJsCode = (customRuntime?.jsCode || "")
      .replace(/\/\/ \[BEGIN_USER_LANG_PROGRAM:[^\]]+\][\s\S]*?\/\/ \[END_USER_LANG_PROGRAM:[^\]]+\]\n?/g, "")
      .trim();
    if (baseJsCode) {
      addHtml5Snippet(baseJsCode, null, null, undefined, "scene-runtime");
    }
    for (const ent of initial.entities ?? []) {
      for (const sc of ent.scripts ?? []) {
        if (sc.compiledJs && sc.compiledJs.trim()) {
          addHtml5Snippet(sc.compiledJs, sc.customLanguageCode, ent.id, ent.kind, sc.id);
        } else if (sc.customLanguageCode && sc.customLanguageCode.trim()) {
          addHtml5Snippet(
            compileScriptToHtml5Js(sc, ent.id, ent.kind),
            sc.customLanguageCode,
            ent.id,
            ent.kind,
            sc.id,
          );
        }
      }
    }
    for (const uel of initial.ui ?? []) {
      for (const sc of uel.scripts ?? []) {
        if (sc.compiledJs && sc.compiledJs.trim()) {
          addHtml5Snippet(sc.compiledJs, sc.customLanguageCode, uel.id, undefined, sc.id);
        }
      }
    }
    if (html5Snippets.length === 0 && customRuntime?.jsCode?.trim()) {
      addHtml5Snippet(customRuntime.jsCode, null, null, undefined, "scene-runtime");
    }

    const mountedScriptElements: HTMLScriptElement[] = [];
    for (const snippet of html5Snippets) {
      try {
        if (typeof document !== "undefined" && document.body) {
          const scriptEl = document.createElement("script");
          scriptEl.type = "text/javascript";
          scriptEl.setAttribute("data-asternal-script-id", snippet.id);
          scriptEl.text = `try {\n${snippet.code}\n} catch (err) { console.warn("[Asternal HTML5 Script]", err); }`;
          document.body.appendChild(scriptEl);
          mountedScriptElements.push(scriptEl);
        } else {
          const fn = new Function(snippet.code);
          fn();
        }
      } catch (err) {
        console.warn("[Asternal HTML5 Script]", err);
      }
    }

    for (const h of runtimeHooksList) {
      if (typeof h.onInit === "function") {
        try { h.onInit(runtimeApi); } catch { /* ignore */ }
      }
    }

    let paused = false;
    const onVis = () => { if (autoPause) paused = document.hidden; };
    document.addEventListener("visibilitychange", onVis);
    const onRestart = () => hooks.restart();
    window.addEventListener("asternal:restart", onRestart);

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code || e.key;
      const key = e.key;
      if (code) pressedKeys[code] = true;
      if (key) pressedKeys[key] = true;
      if (code === "ArrowLeft" || code === "KeyA" || key === "a" || key === "A") {
        keySrc.current.left = true;
        recomputeInput();
      } else if (code === "ArrowRight" || code === "KeyD" || key === "d" || key === "D") {
        keySrc.current.right = true;
        recomputeInput();
      } else if (code === "ArrowUp" || code === "KeyW" || code === "Space" || key === " ") {
        if (state.dialog) state.dialogAdvance = true;
        keySrc.current.jump = true;
        recomputeInput();
      } else if (code === "Enter" && state.dialog) {
        state.dialogAdvance = true;
      } else if (code === "KeyR") {
        hooks.restart();
      } else if (code === "Escape" && embedded) {
        onExit();
      }
      for (const h of runtimeHooksList) {
        if (typeof h.onKeyDown === "function") {
          try { h.onKeyDown(code, key, runtimeApi); } catch { /* ignore */ }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code || e.key;
      const key = e.key;
      if (code) pressedKeys[code] = false;
      if (key) pressedKeys[key] = false;
      if (code === "ArrowLeft" || code === "KeyA" || key === "a" || key === "A") {
        keySrc.current.left = false;
        recomputeInput();
      } else if (code === "ArrowRight" || code === "KeyD" || key === "d" || key === "D") {
        keySrc.current.right = false;
        recomputeInput();
      } else if (code === "ArrowUp" || code === "KeyW" || code === "Space" || key === " ") {
        keySrc.current.jump = false;
        recomputeInput();
      }
      for (const h of runtimeHooksList) {
        if (typeof h.onKeyUp === "function") {
          try { h.onKeyUp(code, key, runtimeApi); } catch { /* ignore */ }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const targetDt = 1 / fpsCap;
    let frames = 0;
    let fpsT = last;

    let cssW = 0;
    let cssH = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width) || canvas.clientWidth || window.innerWidth || 800);
      cssH = Math.max(1, Math.round(rect.height) || canvas.clientHeight || window.innerHeight || 600);
      const nextW = Math.round(cssW * dpr);
      const nextH = Math.round(cssH * dpr);
      if (canvas.width !== nextW) canvas.width = nextW;
      if (canvas.height !== nextH) canvas.height = nextH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    };
    resize();
    window.addEventListener("resize", resize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const flushParticles = () => {
      const list = state.particles ?? [];
      for (const p of list) {
        const n = p.count ?? 8;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 60 + Math.random() * 140;
          particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.6, max: 0.6, color: p.color, size: 3, gravity: 400 });
        }
      }
      if (list.length) state.particles = [];
    };

    const tickEmitters = (dt: number) => {
      for (const e of work.entities) {
        const em = e.emitter;
        if (!em || !em.enabled) continue;
        em._acc = (em._acc ?? 0) + (em.rate || 0) * dt;
        while ((em._acc ?? 0) >= 1) {
          em._acc = (em._acc ?? 0) - 1;
          const dir = ((em.direction || 0) + (Math.random() - 0.5) * (em.spread || 0)) * Math.PI / 180;
          const sp = em.speed || 80;
          particles.push({
            x: e.x + e.w / 2,
            y: e.y + e.h / 2,
            vx: Math.cos(dir) * sp,
            vy: Math.sin(dir) * sp,
            life: em.lifetime || 1,
            max: em.lifetime || 1,
            color: em.color || "#7dd3fc",
            size: em.size || 3,
            gravity: em.gravity ?? 0,
          });
        }
      }
    };

    const draw = () => {
      if (!cssW || !cssH) resize();
      const W = cssW || canvas.clientWidth || window.innerWidth || 800;
      const H = cssH || canvas.clientHeight || window.innerHeight || 600;
      ctx.fillStyle = work.bg || "#0b1e3f";
      ctx.fillRect(0, 0, W, H);

      // Background image
      if (work.bgImage) {
        const img = getRenderableImage(work.bgImage);
        if (img && img.width) {
          const mode = work.bgImageMode || "cover";
          if (mode === "stretch") {
            ctx.drawImage(img, 0, 0, W, H);
          } else if (mode === "tile") {
            for (let x = 0; x < W; x += img.width) for (let y = 0; y < H; y += img.height) ctx.drawImage(img, x, y);
          } else {
            const sa = img.width / img.height;
            const da = W / H;
            const fit = mode === "cover" ? sa > da : sa < da;
            const dw = fit ? H * sa : W;
            const dh = fit ? H : W / sa;
            ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
          }
        }
      }

      for (const h of runtimeHooksList) {
        if (typeof h.onRenderBackground === "function") {
          try { h.onRenderBackground(ctx, runtimeApi, W, H); } catch { /* ignore */ }
        }
      }

      ctx.strokeStyle = "rgba(56,189,248,0.10)";
      ctx.lineWidth = 1;
      let off = (-state.cameraX * 0.4) % 40;
      if (off < 0) off += 40;
      ctx.beginPath();
      for (let x = off; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      // Fixed-size camera: adjusts framing based on cameraOrientation ("horizontal" vs "vertical").
      const isVerticalCam = cameraOrientation === "vertical";
      const VIEW_W = 540;
      const VIEW_H = 700;
      const scale = isVerticalCam ? W / VIEW_W : H / VIEW_H;
      const viewW = isVerticalCam ? VIEW_W : W / scale;
      const viewH = isVerticalCam ? H / scale : VIEW_H;
      const player = work.entities.find((e) => e.controllable && e.x > -9000);
      let camX = state.cameraX;
      let camY = 0;
      if (player) {
        camX = player.x + player.w / 2 - viewW / 2;
        camY = player.y + player.h / 2 - viewH / 2;
        if (work.width > viewW) camX = Math.max(0, Math.min(work.width - viewW, camX));
        else camX = (work.width - viewW) / 2;
        if (work.height > viewH) camY = Math.max(0, Math.min(work.height - viewH, camY));
        else camY = (work.height - viewH) / 2;
        state.cameraX = camX;
      } else {
        if (work.width <= viewW) camX = (work.width - viewW) / 2;
        if (work.height > viewH) camY = Math.max(0, Math.min(work.height - viewH, (work.height - viewH) / 2));
        else camY = (work.height - viewH) / 2;
      }
      runtimeApi.camera.x = camX;
      runtimeApi.camera.y = camY;
      runtimeApi.camera.scale = scale;

      const sx = shake.time > 0 ? (Math.random() - 0.5) * shake.intensity : 0;
      const sy = shake.time > 0 ? (Math.random() - 0.5) * shake.intensity : 0;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(scale, scale);
      ctx.translate(-camX, -camY);

      const cullMinX = camX - 96;
      const cullMaxX = camX + viewW + 96;
      const cullMinY = camY - 96;
      const cullMaxY = camY + viewH + 96;

      const tSec = performance.now() / 1000;
      const visualEffects = W >= 700;
      for (const e of drawList) {
        if (e.visible === false || e.x < -9000) continue;
        if (e.x + e.w < cullMinX || e.x > cullMaxX || e.y + e.h < cullMinY || e.y > cullMaxY) continue;
        const la = layerOpacityFor(work, e);
        const a = (e.opacity ?? 1) * la;
        if (e.controllable && state.invulnT > 0 && Math.floor(state.invulnT * 16) % 2 === 0) {
          ctx.globalAlpha = 0.4 * la;
        } else if (a !== 1) ctx.globalAlpha = a;
        drawEntity(ctx, e, tSec, visualEffects);
        if (ctx.globalAlpha !== 1) ctx.globalAlpha = 1;

        // Speech / thought bubble
        const bubbleEnt = e as Entity & { _bubbleText?: string | null; _bubbleKind?: string; _bubbleUntil?: number };
        if (bubbleEnt._bubbleText) {
          if (bubbleEnt._bubbleUntil && bubbleEnt._bubbleUntil > 0 && state.time >= bubbleEnt._bubbleUntil) {
            bubbleEnt._bubbleText = null;
            bubbleEnt._bubbleUntil = 0;
          } else {
            ctx.save();
            ctx.font = "700 13px Inter, system-ui, sans-serif";
            const bTxt = String(bubbleEnt._bubbleText);
            const tw = Math.min(220, Math.max(48, ctx.measureText(bTxt).width + 20));
            const bh = 30;
            const bx = e.x + e.w / 2 - tw / 2;
            const by = e.y - bh - 12;
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = bubbleEnt._bubbleKind === "think" ? "#9966FF" : "#4C97FF";
            ctx.lineWidth = 2;
            roundRect(ctx, bx, by, tw, bh, 10);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#0f172a";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(bTxt, bx + tw / 2, by + bh / 2, tw - 14);
            ctx.restore();
          }
        }
      }

      // particles
      flushParticles();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.x < cullMinX || p.x > cullMaxX || p.y < cullMinY || p.y > cullMaxY) continue;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (showHitboxes) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#f43f5e";
        ctx.setLineDash([4, 3]);
        for (const e of work.entities) {
          if (e.x < -9000) continue;
          if (e.x + e.w < cullMinX || e.x > cullMaxX || e.y + e.h < cullMinY || e.y > cullMaxY) continue;
          const hb = e.hitbox;
          if (hb) ctx.strokeRect(e.x + hb.x, e.y + hb.y, hb.w, hb.h);
          else ctx.strokeRect(e.x, e.y, e.w, e.h);
        }
        ctx.setLineDash([]);
      }

      for (const h of runtimeHooksList) {
        if (typeof h.onRender === "function") {
          try { h.onRender(ctx, runtimeApi); } catch { /* ignore */ }
        }
      }
      ctx.restore();

      if (showHUD) {
        ctx.fillStyle = "rgba(2,6,23,0.6)";
        ctx.fillRect(12, 12, 260, 36);
        ctx.strokeStyle = "rgba(125,211,252,0.5)";
        ctx.strokeRect(12, 12, 260, 36);
        ctx.fillStyle = "#7dd3fc";
        ctx.font = "600 14px Rajdhani, sans-serif";
        ctx.fillText(`SCORE ${state.score}`, 22, 35);
        ctx.fillText(`♥ ${state.lives}`, 130, 35);
        if (work.timeLimit && work.timeLimit > 0) {
          const left = Math.max(0, Math.ceil(work.timeLimit - state.time));
          ctx.fillStyle = left < 10 ? "#f43f5e" : "#7dd3fc";
          ctx.fillText(`⏱ ${left}`, 190, 35);
        }
      }

      // Variable monitors on stage
      const varDefs = Array.isArray(work.variableDefinitions) ? work.variableDefinitions : [];
      let wy = showHUD ? 56 : 14;
      for (const vDef of varDefs) {
        if (!vDef || !vDef.name || vDef.visibleOnStage === false) continue;
        let vVal: string | number | boolean = vDef.initialValue ?? 0;
        if (vDef.scope === "entity" && vDef.entityId) {
          const vEnt = work.entities.find(e => e.id === vDef.entityId);
          if (vEnt?.variables && vEnt.variables[vDef.name] !== undefined) {
            vVal = vEnt.variables[vDef.name];
          }
        } else if (work.variables && work.variables[vDef.name] !== undefined) {
          vVal = work.variables[vDef.name];
        }
        ctx.save();
        ctx.font = "700 12px Inter, system-ui, sans-serif";
        const lblStr = String(vDef.name);
        const valStr = String(vVal);
        const lblW = Math.max(40, ctx.measureText(lblStr).width + 16);
        const valW = Math.max(34, ctx.measureText(valStr).width + 16);
        const boxW = lblW + valW + 8;
        const boxH = 26;
        ctx.fillStyle = "rgba(15,23,42,0.88)";
        ctx.strokeStyle = "rgba(255,140,26,0.75)";
        ctx.lineWidth = 1.5;
        roundRect(ctx, 12, wy, boxW, boxH, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e2e8f0";
        ctx.textBaseline = "middle";
        ctx.fillText(lblStr, 20, wy + boxH / 2);
        ctx.fillStyle = "#FF8C1A";
        roundRect(ctx, 12 + lblW + 2, wy + 3, valW, boxH - 6, 5);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(valStr, 12 + lblW + 2 + valW / 2, wy + boxH / 2);
        ctx.restore();
        wy += boxH + 6;
      }

      // UI overlay (screen-space)
      const W2 = W, H2 = H;
      const tick = performance.now() / 16;
      const uiState = { score: state.score, lives: state.lives, time: state.time, timeLimit: work.timeLimit, startLives: work.startLives };
      for (const el of (work.ui ?? [])) {
        if (el.visible === false) continue;
        if (el.kind === "joystick") {
          const r = resolveUIRect(el, W2, H2);
          const rad = Math.min(r.w, r.h) / 2;
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          ctx.globalAlpha = el.opacity ?? 1;
          ctx.fillStyle = el.bg ?? "rgba(2,6,23,0.4)";
          ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
          const k = joyKnobs.current.get(el.id);
          const kx = cx + (k?.dx ?? 0);
          const ky = cy + (k?.dy ?? 0);
          ctx.fillStyle = el.color ?? "#7dd3fc";
          ctx.beginPath(); ctx.arc(kx, ky, rad / 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        drawUIElement(ctx, el, W2, H2, tick, uiState);
      }

      for (const h of runtimeHooksList) {
        if (typeof h.onRenderOverlay === "function") {
          try { h.onRenderOverlay(ctx, runtimeApi, W, H); } catch { /* ignore */ }
        }
      }
    };

    // Draw initial frame immediately
    draw();

    const targetIntervalMs = 1000 / Math.max(1, fpsCap);
    let lastTickMs = last;
    let prevEndWin = false;
    let prevEndDead = false;

    const tickFrame = (now: number, fromTimer: boolean) => {
      const deltaMs = now - lastTickMs;
      if (fromTimer) {
        if (deltaMs < targetIntervalMs - 1.2) return;
      } else if (fpsCap <= 30 && deltaMs < targetIntervalMs - 2.5) {
        return;
      }
      lastTickMs = now;
      const elapsed = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!paused) {
        acc += elapsed;
        let steps = 0;
        while (acc + 0.0015 >= targetDt && steps < 5) {
          if (!state.win && !state.dead) {
            stepScene(work, inputRef.current, state, targetDt);
          }
          scripts.step(work, state, inputRef.current, hooks, targetDt);
          const collideHooks = runtimeHooksList.filter(h => typeof h.onCollide === "function");
          if (collideHooks.length > 0) {
            const liveEnts = work.entities;
            for (let ia = 0; ia < liveEnts.length; ia++) {
              const a = liveEnts[ia];
              if (a.x < -9000) continue;
              for (let ib = ia + 1; ib < liveEnts.length; ib++) {
                const b = liveEnts[ib];
                if (b.x < -9000) continue;
                if (intersects(a, b)) {
                  for (const ch of collideHooks) {
                    try { ch.onCollide!(a, b, runtimeApi); } catch { /* ignore */ }
                  }
                }
              }
            }
          }
          for (const h of runtimeHooksList) {
            if (typeof h.onTick === "function") {
              try { h.onTick(runtimeApi, targetDt); } catch { /* ignore */ }
            }
          }
          if (drawList.length !== work.entities.length) {
            drawList = sortedForRender(work).filter(e => !isOnHiddenLayer(work, e));
          }
          if (shake.time > 0) shake.time = Math.max(0, shake.time - targetDt);
          tickEmitters(targetDt);
          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx * targetDt;
            p.y += p.vy * targetDt;
            p.vy += p.gravity * targetDt;
            p.life -= targetDt;
            if (p.life <= 0) {
              particles[i] = particles[particles.length - 1];
              particles.pop();
            }
          }
          acc = Math.max(0, acc - targetDt);
          steps++;
        }
        for (const d of activePointers.current.values()) {
          if (d.kind === "btn") uiScriptsRef.current?.(d.el, "hold");
        }
      }
      draw();
      frames++;
      setDialog(prev => {
        const d = state.dialog ?? null;
        if (!prev && !d) return prev;
        if (prev && d && prev.entityId === d.entityId && prev.lineIndex === d.lineIndex) return prev;
        return d;
      });
      if (state.win !== prevEndWin || state.dead !== prevEndDead) {
        prevEndWin = state.win;
        prevEndDead = state.dead;
        setHud(h => ({ ...h, score: state.score, win: state.win, dead: state.dead }));
      }
      if (now - fpsT > 500) {
        const fps = Math.min(fpsCap, Math.round((frames * 1000) / (now - fpsT)));
        setHud({ score: state.score, fps, win: state.win, dead: state.dead });
        frames = 0; fpsT = now;
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      tickFrame(now, false);
    };
    raf = requestAnimationFrame(loop);
    const timer = window.setInterval(() => {
      if (!paused) tickFrame(performance.now(), true);
    }, 4);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      ro?.disconnect();
      for (const el of mountedScriptElements) {
        try { el.remove(); } catch { /* ignore */ }
      }
      uiScriptsRef.current = null;
      workRef.current = null;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("asternal:restart", onRestart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, scenes, customRuntime, fpsCap, showHUD, autoPause, showHitboxes, cameraOrientation]);

  // UI element hit handling (buttons + joysticks)
  const uiButtons = (scene.ui ?? []).filter(e => e.kind === "button" && (e.visible ?? true));
  const uiJoysticks = (scene.ui ?? []).filter(e => e.kind === "joystick" && (e.visible ?? true));
  const liveUI = (): UIElement[] => workRef.current?.ui ?? scene.ui ?? [];
  const hasCustomInput = (act: "left" | "right" | "jump") =>
    uiButtons.some(b => b.action === act) || (act !== "jump" && uiJoysticks.length > 0);
  const hasAnyCustomInput = uiButtons.some(b => ["left","right","jump"].includes(b.action ?? "")) || uiJoysticks.length > 0;
  const showDefaultTouch = touchControls && !hasAnyCustomInput;

  type JoyDrag = { kind: "btn"; el: UIElement } | { kind: "joy"; el: UIElement; cx: number; cy: number; r: number };
  const activePointers = useRef<Map<number, JoyDrag>>(new Map());
  const joyKnobs = useRef<Map<string, { dx: number; dy: number }>>(new Map());

  const hitUIButton = (sx: number, sy: number): UIElement | null => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const tappable = liveUI().filter(e =>
      (e.visible ?? true) && e.kind !== "joystick" && (e.kind === "button" || (e.scripts?.length ?? 0) > 0));
    for (let i = tappable.length - 1; i >= 0; i--) {
      const b = tappable[i];
      const r = resolveUIRect(b, W, H);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return b;
    }
    return null;
  };
  const hitJoystick = (sx: number, sy: number): { el: UIElement; cx: number; cy: number; r: number } | null => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const joysticks = liveUI().filter(e => e.kind === "joystick" && (e.visible ?? true));
    for (let i = joysticks.length - 1; i >= 0; i--) {
      const j = joysticks[i];
      const r = resolveUIRect(j, W, H);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) / 2;
      const dx = sx - cx, dy = sy - cy;
      const grab = rad * 1.3;
      if (dx * dx + dy * dy <= grab * grab) return { el: j, cx, cy, r: rad };
    }
    return null;
  };

  const applyJoystick = (id: string, dx: number, dy: number, r: number) => {
    const len = Math.hypot(dx, dy);
    const max = r;
    const nx = len > max ? (dx / len) * max : dx;
    const ny = len > max ? (dy / len) * max : dy;
    joyKnobs.current.set(id, { dx: nx, dy: ny });
    const ax = nx / max;
    void ny;
    joySrc.current.left = ax < -0.25;
    joySrc.current.right = ax > 0.25;
    recomputeInput();
  };
  const releaseJoystick = (id: string) => {
    joyKnobs.current.delete(id);
    joySrc.current.left = false;
    joySrc.current.right = false;
    joySrc.current.jump = false;
    recomputeInput();
  };

  const handleButton = (b: UIElement, down: boolean) => {
    const act = b.kind === "button" ? b.action ?? "none" : "none";
    if (act === "left" || act === "right" || act === "jump") press(act, down);
    else if (down && act === "restart") window.dispatchEvent(new CustomEvent("asternal:restart"));
    else if (down && act === "exit") onExit();
    else if (down && act === "event" && b.eventName) window.dispatchEvent(new CustomEvent("asternal:ui-event", { detail: b.eventName }));
    if (b.scripts?.length) uiScriptsRef.current?.(b, down ? "tap" : "release");
  };

  const onCanvasDown = (ev: React.PointerEvent) => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const b = hitUIButton(sx, sy);
    if (b) {
      try { (ev.target as Element).setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      activePointers.current.set(ev.pointerId, { kind: "btn", el: b });
      handleButton(b, true);
      ev.preventDefault();
      return;
    }
    const j = hitJoystick(sx, sy);
    if (j) {
      try { (ev.target as Element).setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      activePointers.current.set(ev.pointerId, { kind: "joy", el: j.el, cx: j.cx, cy: j.cy, r: j.r });
      applyJoystick(j.el.id, sx - j.cx, sy - j.cy, j.r);
      ev.preventDefault();
    }
  };
  const onCanvasMove = (ev: React.PointerEvent) => {
    const d = activePointers.current.get(ev.pointerId);
    if (!d || d.kind !== "joy") return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    applyJoystick(d.el.id, sx - d.cx, sy - d.cy, d.r);
  };
  const onCanvasUp = (ev: React.PointerEvent) => {
    const d = activePointers.current.get(ev.pointerId);
    if (!d) return;
    if (d.kind === "btn") handleButton(d.el, false);
    else releaseJoystick(d.el.id);
    activePointers.current.delete(ev.pointerId);
  };

  return (
    <div data-no-drawably className="relative h-full w-full bg-[#0b1e3f] overflow-hidden select-none">
      <canvas
        id="game-canvas"
        ref={canvasRef}
        className="h-full w-full block touch-none"
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
      />

      <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
        {showFPS && (
          <div className="rounded-md bg-[#020617]/80 border border-sky-400/40 px-2.5 py-1 text-[10px] font-mono font-semibold text-sky-300">
            {hud.fps} FPS
          </div>
        )}
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto rounded-md bg-[#020617]/85 border border-sky-400/60 px-3 py-1 text-xs font-display font-bold tracking-wider text-white shadow-md active:scale-95 transition"
        >STOP</button>
      </div>

      {showDefaultTouch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-15 p-4 flex items-end justify-between select-none">
          <div className="flex gap-3">
            {!hasCustomInput("left") && <TouchBtn label="◀" onDown={() => press("left", true)} onUp={() => press("left", false)} />}
            {!hasCustomInput("right") && <TouchBtn label="▶" onDown={() => press("right", true)} onUp={() => press("right", false)} />}
          </div>
          {!hasCustomInput("jump") && <TouchBtn label="JUMP" big onDown={() => press("jump", true)} onUp={() => press("jump", false)} />}
        </div>
      )}

      {(hud.win || hud.dead) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#020617]/75 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#090e1c]/95 border border-sky-400/50 px-8 py-6 text-center shadow-2xl min-w-[260px]">
            <div className="font-display text-2xl font-extrabold tracking-wider text-sky-300 mb-2">
              {hud.win ? "LEVEL CLEAR" : "GAME OVER"}
            </div>
            <div className="text-sm text-slate-400 mb-5">Score: {hud.score}</div>
            <div className="flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("asternal:restart"))}
                className="font-display text-xs font-bold tracking-wider px-4 py-2.5 rounded-lg bg-slate-800 text-slate-100 border border-slate-600 active:scale-95 transition"
              >REINTENTAR</button>
              <button
                type="button"
                onClick={onExit}
                className="font-display text-xs font-bold tracking-wider px-4 py-2.5 rounded-lg bg-sky-500 text-slate-950 border border-sky-300 active:scale-95 transition"
              >BACK TO EDITOR</button>
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <div
          className="absolute inset-x-0 bottom-0 z-25 p-3 sm:p-5 pointer-events-auto"
          onPointerDown={(e) => {
            e.stopPropagation();
            const s = stateRef.current;
            if (s) s.dialogAdvance = true;
          }}
        >
          <div className="mx-auto max-w-[720px] rounded-2xl border border-sky-400/40 bg-[#020617]/95 shadow-2xl overflow-hidden">
            {dialog.speaker && (
              <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                {dialog.portrait && (
                  <img src={dialog.portrait} alt="" className="w-9 h-9 rounded-full object-cover border border-sky-400/40" />
                )}
                <div className="text-[11px] font-display font-bold tracking-widest text-sky-400 uppercase">{dialog.speaker}</div>
              </div>
            )}
            <div className="px-4 pb-3 pt-1 text-[15px] leading-snug text-white">
              {dialog.text}
            </div>
            <div className="px-4 pb-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>{dialog.lineIndex + 1} / {dialog.totalLines}</span>
              <span className="animate-pulse">▶ tap to continue</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TouchBtn({ label, onDown, onUp, big }: { label: string; onDown: () => void; onUp: () => void; big?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
        onDown();
      }}
      onPointerUp={(e) => {
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        onUp();
      }}
      onPointerCancel={() => onUp()}
      onPointerLeave={(e) => { if (e.buttons) onUp(); }}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto touch-none select-none ${big ? "h-20 w-20 text-sm tracking-wider" : "h-16 w-16 text-2xl"} rounded-full bg-[#020617]/75 border-2 border-sky-400/60 font-display font-bold text-sky-300 shadow-lg grid place-items-center active:scale-95 active:bg-sky-400/30 transition-transform`}
    >
      {label}
    </button>
  );
}

export function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, time: number, visualEffects = true) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const rot = ((e.rotation ?? 0) * Math.PI) / 180;
  if (rot) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
  }
  const flip = (e.facing === -1) !== !!e.flipX;
  if (flip) {
    ctx.translate(e.x + e.w, e.y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(e.x, e.y);
  }
  const animImg = currentFrameRenderable(e, time);
  const drawFit = (img: HTMLImageElement | ImageBitmap) => {
    const fit = e.textureFit ?? "stretch";
    if (fit === "stretch") { ctx.drawImage(img, 0, 0, e.w, e.h); return; }
    const sa = img.width / img.height;
    const da = e.w / e.h;
    const cover = fit === "cover" ? sa > da : sa < da;
    const dw = cover ? e.h * sa : e.w;
    const dh = cover ? e.h : e.w / sa;
    ctx.drawImage(img, (e.w - dw) / 2, (e.h - dh) / 2, dw, dh);
  };
  if (animImg) { drawFit(animImg); ctx.restore(); return; }
  if (e.texture) {
    const img = getRenderableImage(e.texture);
    if (img) { drawFit(img); ctx.restore(); return; }
  }
  // fallback shape — reset flip/translate but keep rotation, so redraw at absolute coords
  ctx.restore();
  ctx.save();
  if (rot) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
  }
  if (visualEffects) {
    ctx.shadowColor = e.color;
    ctx.shadowBlur = e.kind === "coin" ? 10 : (e.kind === "goal" && e.goal) ? 12 : 4;
  }
  ctx.fillStyle = e.color;
  if (e.kind === "coin") {
    ctx.beginPath();
    ctx.arc(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === "goal" && e.goal) {
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
    roundRect(ctx, e.x, e.y, e.w, e.h, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    const effFacing = ((e.facing === -1) !== !!e.flipX) ? -1 : 1;
    drawChibiCharacter(ctx, e.x, e.y, e.w, e.h, e.color, effFacing);
  } else {
    const r = e.kind === "platform" ? 4 : 6;
    roundRect(ctx, e.x, e.y, e.w, e.h, r);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
