import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_PRESETS, entityKindLabel, isMainGoalEntity, newScene, uid } from "./core";
import { t, setLang } from "../i18n";
import {
  buildProjectGameHtml,
  buildStandaloneGameHtml,
  createGameHtmlBlobUrl,
  entityToEditableSvgDataUrl,
  isLegacyGeneratedPlaceholderSvg,
  parseStandaloneGameHtml,
  serializeForHtmlScript,
  syncHtmlToProject,
  syncRuntimeAndTexturesToProject,
} from "./html5-game";
import {
  applyOrionPatchToProject,
  buildOrionIntelligentPatch,
} from "../ai/orion-game-architect";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("motor y vista previa HTML5 autónomos (independientes del editor)", () => {
  it("compila la escena y el proyecto en un documento HTML5 completo y autónomo", () => {
    const scene = newScene("Level 1");
    const html = buildStandaloneGameHtml({
      scene,
      scenes: [scene],
      title: "Prueba HTML5 Nativa",
      fpsCap: 120,
      showHUD: true,
      showFPS: true,
    });

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Prueba HTML5 Nativa</title>");
    expect(html).toContain('<canvas id="game-canvas"></canvas>');
    // El bucle corre directamente con requestAnimationFrame del dispositivo y subpasos físicos
    expect(html).toContain("var MAX_SUBSTEP = 1 / 120;");
    expect(html).toContain("requestAnimationFrame(loop);");
    // Incluye motor físico, scripts y audio WebAudio sin depender de React
    expect(html).toContain("function stepScene(");
    expect(html).toContain("function createScriptRunner(");
    expect(html).toContain("initialSceneId");
  });

  it("escapa secuencias peligrosas al incrustar datos en el script HTML5", () => {
    const raw = { text: "</script><script>alert(1)</script>" };
    const serialized = serializeForHtmlScript(raw);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
  });

  it("genera una URL para cargar el archivo HTML5 en un iframe aislado y permite revocarla", () => {
    const scene = newScene("Level 1");
    const bundle = createGameHtmlBlobUrl({
      scene,
      scenes: [scene],
      title: "Mi juego",
    });
    expect(bundle.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(bundle.url.startsWith("blob:") || bundle.url.startsWith("data:text/html")).toBe(true);
    expect(() => bundle.revoke()).not.toThrow();
  });

  it("GameRuntime ejecuta el archivo HTML5 en un iframe aislado para que el rendimiento dependa del dispositivo", () => {
    const runtimeSource = read("src/components/engine/GameRuntime.tsx");
    expect(runtimeSource).toContain("createGameHtmlBlobUrl");
    expect(runtimeSource).toContain("<iframe");
    expect(runtimeSource).toContain("src={blobUrl}");
  });

  it("permite editar cualquier lógica, sonido, física y distribución de assets desde el archivo HTML5 y sincronizarlo con el proyecto", () => {
    const scene = newScene("Nivel Editable");
    const initialProject = {
      name: "Juego Original",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: { sprites: [] },
      settings: {
        fpsCap: 60 as const,
        showHUD: true,
        showFPS: true,
        volume: 0.8,
        muted: false,
        music: false,
        touchControls: true,
        autoPause: true,
        showHitboxes: false,
      },
      customRuntime: {
        jsCode: "window.AsternalRuntime.physics.baseSpeed = 310;",
        synthSounds: {
          laser: { name: "laser", wave: "sawtooth" as const, freq: 800, endFreq: 160, duration: 0.18, volume: 0.35 },
        },
      },
    };

    const html = buildStandaloneGameHtml({
      scene,
      scenes: initialProject.scenes,
      assets: initialProject.assets,
      title: initialProject.name,
      customRuntime: initialProject.customRuntime,
    });

    expect(html).toContain("window.AsternalRuntime");
    expect(html).toContain("window.AsternalAudio");
    expect(html).toContain("__ASTERNAL_CUSTOM_RUNTIME_START__");
    expect(html).toContain("window.AsternalRuntime.physics.baseSpeed = 310;");

    // Editamos el título y el código del runtime directamente sobre el documento HTML5
    const editedHtml = html
      .replace("<title>Juego Original</title>", "<title>Juego Editado con Orión</title>")
      .replace(
        "window.AsternalRuntime.physics.baseSpeed = 310;",
        "window.AsternalRuntime.physics.baseSpeed = 420;\nwindow.AsternalRuntime.registerHook({ onTick: function(api) {} });",
      );

    const parsed = parseStandaloneGameHtml(editedHtml);
    expect(parsed.title).toBe("Juego Editado con Orión");
    expect(parsed.customJs).toContain("window.AsternalRuntime.physics.baseSpeed = 420;");
    expect(parsed.synthSounds?.laser?.freq).toBe(800);

    const synced = syncHtmlToProject(editedHtml, initialProject);
    expect(synced.name).toBe("Juego Editado con Orión");
    expect(synced.customRuntime?.jsCode).toContain("window.AsternalRuntime.physics.baseSpeed = 420;");
    expect(synced.customRuntime?.synthSounds?.laser?.wave).toBe("sawtooth");
  });

  it("Orión (con tilde) conoce todas las lógicas del motor e implementa nuevas lógicas, sonidos y distribución en el archivo HTML5", () => {
    const scene = newScene("Nivel Orión");
    const project = {
      name: "Aventura Asternal",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: { sprites: [] },
      settings: {
        fpsCap: 60 as const,
        showHUD: true,
        showFPS: true,
      },
    };

    const patch = buildOrionIntelligentPatch(
      "Orión, añade dash con estela, disparo láser, sonidos WebAudio y redistribuye las monedas en espiral",
      project,
    );

    expect(patch.reply).toContain("Orión");
    expect(patch.redistributeLayout).toBe("spiral");
    expect(patch.customRuntimeJs).toContain("window.AsternalRuntime.registerHook");
    expect(patch.synthSounds?.dash).toBeDefined();
    expect(patch.synthSounds?.laser).toBeDefined();

    const updated = applyOrionPatchToProject(project, patch);
    const compiledHtml = buildProjectGameHtml(updated);
    expect(compiledHtml).toContain("window.AsternalRuntime.registerHook");
    expect(compiledHtml).toContain('"dash"');
    expect(compiledHtml).toContain('"laser"');

    // Verificar que se eliminó el botón flotante de Orión y que su sistema de IA se reutiliza para crear Script manual sin bloques ni código a mano
    const editorSource = read("src/components/engine/AsternalEditor.tsx");
    expect(editorSource).not.toContain("orion-top-left-trigger");
    expect(editorSource).toContain("OrionAiModeScreen");
    expect(editorSource).toContain("SCRIPT MANUAL");
    expect(editorSource).toContain("open-entity-script-manual-btn");

    const orionScreenSource = read("src/components/engine/OrionAiModeScreen.tsx");
    expect(orionScreenSource).toContain("Script manual · Inteligencia Artificial");
    expect(orionScreenSource).toContain("orion-ai-mode-fullscreen");

    const scriptEditorSource = read("src/components/engine/ScriptEditor.tsx");
    expect(scriptEditorSource).toContain("SCRIPT MANUAL");
    expect(scriptEditorSource).not.toContain("+ NEW SCRIPT");
    expect(scriptEditorSource).not.toContain("+ ADD BLOCK");
  });

  it("conecta las texturas, entidades y sonidos creados por Orión o en el runtime con el editor normal para que se puedan seguir editando", () => {
    const scene = newScene("Nivel Conectado");
    const project = {
      name: "Juego Editable",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: { sprites: [] },
      settings: {
        fpsCap: 60 as const,
        showHUD: true,
        showFPS: true,
      },
    };

    const svgTex = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22128%22%20height%3D%22128%22%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2264%22%20r%3D%2250%22%20fill%3D%22%2338bdf8%22%2F%3E%3C%2Fsvg%3E";
    const inlineRuntimeTex = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%23f43f5e%22%2F%3E%3C%2Fsvg%3E";

    const updated = applyOrionPatchToProject(project, {
      entitiesToAdd: [
        {
          kind: "enemy",
          name: "Guardián",
          x: 340,
          y: 420,
          w: 48,
          h: 48,
          texture: svgTex,
        },
      ],
      spritesToAdd: [
        {
          name: "Moneda Especial",
          width: 128,
          height: 128,
          dataUrl: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22128%22%20height%3D%22128%22%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2264%22%20r%3D%2240%22%20fill%3D%22%23facc15%22%2F%3E%3C%2Fsvg%3E",
        },
      ],
      customRuntimeJs: `
        window.AsternalAudio.registerSound("turbo", { wave: "square", freq: 300, endFreq: 900, duration: 0.2, volume: 0.4 });
        var runtimeSprite = "${inlineRuntimeTex}";
      `,
    });

    // Las 3 texturas (de la entidad, de spritesToAdd y la incrustada en el runtime JS) quedan registradas en project.assets.sprites del editor normal
    expect(updated.assets?.sprites.length).toBe(3);
    expect(updated.assets?.sprites.map((s) => s.frames[0]?.composite)).toContain(svgTex);
    expect(updated.assets?.sprites.map((s) => s.frames[0]?.composite)).toContain(inlineRuntimeTex);
    // El sonido registrado desde customRuntimeJs también queda conectado en synthSounds
    expect(updated.customRuntime?.synthSounds?.turbo?.wave).toBe("square");
  });

  it("evita claves duplicadas en scene.ui (como ui_btn_left, ui_btn_right, ui_btn_jump, ui_btn_restart) cuando Orión añade elementos con el mismo id", () => {
    const scene = newScene("Nivel UI");
    const project = {
      name: "Juego UI",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: { sprites: [] },
      settings: { fpsCap: 60 as const, showHUD: true, showFPS: true },
    };

    const first = applyOrionPatchToProject(project, {
      uiToAdd: [
        { id: "ui_btn_left", kind: "button", name: "Izquierda", action: "left" },
        { id: "ui_btn_right", kind: "button", name: "Derecha", action: "right" },
        { id: "ui_btn_jump", kind: "button", name: "Saltar", action: "jump" },
        { id: "ui_btn_restart", kind: "button", name: "Reiniciar", action: "restart" },
      ],
    });

    const second = applyOrionPatchToProject(first, {
      uiToAdd: [
        { id: "ui_btn_left", kind: "button", name: "Izquierda 2", action: "left" },
        { id: "ui_btn_right", kind: "button", name: "Derecha 2", action: "right" },
        { id: "ui_btn_jump", kind: "button", name: "Saltar 2", action: "jump" },
        { id: "ui_btn_restart", kind: "button", name: "Reiniciar 2", action: "restart" },
      ],
    });

    const uiIds = (second.scenes[0].ui ?? []).map((u) => u.id);
    expect(uiIds).toEqual(["ui_btn_left", "ui_btn_right", "ui_btn_jump", "ui_btn_restart"]);
    expect(new Set(uiIds).size).toBe(uiIds.length);
  });

  it("usa exactamente los mismos assets predeterminados del motor en el runtime y el editor sin sobreescribir las entidades con SVGs inventados", () => {
    const scene = newScene("Nivel Predeterminado");
    const player = scene.entities.find((e) => e.kind === "player")!;
    const coin = scene.entities.find((e) => e.kind === "coin")!;
    const goal = scene.entities.find((e) => e.kind === "goal")!;

    // Los assets SVG generados bajo demanda para el menú y el editor de dibujo usan las dimensiones reales y el diseño exacto de character.ts
    const playerSvg = decodeURIComponent(entityToEditableSvgDataUrl(player));
    expect(playerSvg).toContain(`width="${player.w}" height="${player.h}"`);
    expect(playerSvg).toContain("rgba(244,114,182,0.3)"); // rubor chibi predeterminado del motor (character.ts)
    expect(playerSvg).toContain("chibiGloss"); // brillo diagonal idéntico a character.ts

    const coinSvg = decodeURIComponent(entityToEditableSvgDataUrl(coin));
    expect(coinSvg).toContain(`width="${coin.w}" height="${coin.h}"`);
    expect(coinSvg).toContain("#fbbf24"); // círculo de moneda predeterminado del motor

    const goalSvg = decodeURIComponent(entityToEditableSvgDataUrl(goal));
    expect(goalSvg).toContain(`width="${goal.w}" height="${goal.h}"`);
    expect(goalSvg).toContain("rgba(125,211,252,0.3)"); // bandera predeterminada del motor

    // Si una entidad tenía un SVG genérico antiguo de 128x128, syncRuntimeAndTexturesToProject lo limpia a null para restaurar el asset predeterminado del motor
    const legacyPlayerSvg =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="20" y="12" width="88" height="104" rx="28" fill="#38bdf8"/><ellipse cx="48" cy="50" rx="9" ry="11" fill="#ffffff"/></svg>`
      );
    expect(isLegacyGeneratedPlaceholderSvg(legacyPlayerSvg)).toBe(true);

    player.texture = legacyPlayerSvg;
    const cleaned = syncRuntimeAndTexturesToProject({
      name: "Juego Limpio",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: {
        sprites: [
          {
            id: "legacy_spr",
            name: "Player (Runtime)",
            width: 128,
            height: 128,
            fps: 8,
            loop: true,
            frames: [{ id: "f1", layers: [], composite: legacyPlayerSvg }],
          },
        ],
      },
      settings: { fpsCap: 60 as const, showHUD: true, showFPS: true },
    });

    const cleanedPlayer = cleaned.scenes[0].entities.find((e) => e.kind === "player")!;
    expect(cleanedPlayer.texture ?? null).toBeNull();
    expect(cleaned.assets?.sprites.length).toBe(0);
  });

  it("la banderita de meta principal ya viene puesta en la escena y la herramienta Objeto coloca un objeto placeholder como los demás assets predeterminados", () => {
    setLang("es");
    expect(t("tool.goal")).toBe("Objeto");

    const scene = newScene("Nivel con Meta Principal");
    const mainGoal = scene.entities.find((e) => isMainGoalEntity(e));
    expect(mainGoal).toBeDefined();
    expect(mainGoal?.goal).toBe(true);
    expect(mainGoal?.w).toBe(36);
    expect(mainGoal?.h).toBe(64);
    expect(entityKindLabel(mainGoal!)).toBe("META");

    // La banderita de meta principal conserva su diseño de bandera
    const mainGoalSvg = decodeURIComponent(entityToEditableSvgDataUrl(mainGoal!));
    expect(mainGoalSvg).toContain("rgba(125,211,252,0.3)");
    expect(mainGoalSvg).toContain("<polygon");

    // Al colocar con la herramienta "Objeto" (KIND_PRESETS.goal), crea un Objeto placeholder (sin bandera)
    const placedObject = {
      ...KIND_PRESETS.goal,
      id: uid(),
      x: 300,
      y: 400,
    };
    expect(placedObject.name).toBe("Objeto");
    expect(placedObject.goal).toBe(false);
    expect(placedObject.w).toBe(40);
    expect(placedObject.h).toBe(40);
    expect(isMainGoalEntity(placedObject)).toBe(false);
    expect(entityKindLabel(placedObject)).toBe("OBJETO");

    // Su representación predeterminada es un rectángulo redondeado placeholder (rx="6") como los demás assets predeterminados del motor
    const placedObjectSvg = decodeURIComponent(entityToEditableSvgDataUrl(placedObject));
    expect(placedObjectSvg).toContain('<rect x="0" y="0" width="40" height="40" rx="6" fill="#7dd3fc"/>');
    expect(placedObjectSvg).not.toContain("<polygon");
  });

  it("gestiona la biblioteca de sonidos y música en Ajustes y detecta/pregunta qué pista usar cuando se pide música en Scripts Manuales", async () => {
    const {
      buildAudioSelectionQuestion,
      detectAudioRequestAndCandidates,
      getProjectAudioLibrary,
      injectAudioAssetIntoScripts,
      saveAudioLibraryToProject,
    } = await import("./audio-library");

    const scene = newScene("Nivel Musical");
    const baseProject = {
      name: "Juego Musical",
      scenes: [scene],
      activeSceneId: scene.id,
      assets: { sprites: [] },
      settings: { fpsCap: 60 as const, showHUD: true, showFPS: true },
    };

    const updatedProject = saveAudioLibraryToProject(baseProject, [
      { id: "m1", name: "Tema Batalla", url: "data:audio/mp3;base64,AAA", category: "music" },
      { id: "m2", name: "Bosque Mágico", url: "data:audio/mp3;base64,BBB", category: "music" },
      { id: "s1", name: "Explosión Retro", url: "data:audio/wav;base64,CCC", category: "sfx" },
    ]);

    const lib = getProjectAudioLibrary(updatedProject);
    expect(lib.length).toBe(3);

    // Si el usuario pide poner música en algún lado sin especificar cuál y tiene 2 pistas de música, lo detecta y pregunta cuál de los dos quiere
    const detection = detectAudioRequestAndCandidates(
      "Pon música cuando el jugador toque la moneda",
      lib,
    );
    expect(detection.isAudioRequest).toBe(true);
    expect(detection.intentKind).toBe("music");
    expect(detection.needsDisambiguation).toBe(true);
    expect(detection.candidates.map((c) => c.name)).toEqual(["Tema Batalla", "Bosque Mágico"]);

    const question = buildAudioSelectionQuestion(detection.candidates, detection.intentKind);
    expect(question).toContain("Tema Batalla");
    expect(question).toContain("Bosque Mágico");
    expect(question).toContain("¿Cuál de los dos quieres");

    // Cuando el usuario elige uno de los dos (ej. "Bosque Mágico"), se inyecta en el script manual con el evento detectado
    const scripts = injectAudioAssetIntoScripts(
      [],
      detection.candidates[1],
      "Pon música cuando el jugador toque la moneda",
    );
    expect(scripts.length).toBe(1);
    expect(scripts[0].event).toBe("onCollide");
    expect(scripts[0].withKind).toBe("coin");
    expect(scripts[0].blocks[0].kind).toBe("playMusic");
    expect(scripts[0].blocks[0].soundName).toBe("Bosque Mágico");
    expect(scripts[0].blocks[0].soundUrl).toBe("data:audio/mp3;base64,BBB");

    // El HTML5 autónomo incluye los assets de audio y el bloque playMusic en el runtime
    const html = buildProjectGameHtml(updatedProject);
    expect(html).toContain("Bosque Mágico");
    expect(html).toContain('case "playMusic":');
    expect(html).toContain("playMusic: function(nameOrUrl)");

    // Verificar que la biblioteca se gestiona en el apartado de Ajustes de AsternalEditor
    const editorSource = read("src/components/engine/AsternalEditor.tsx");
    expect(editorSource).toContain("settings-audio-library");
    expect(editorSource).toContain("BIBLIOTECA DE SONIDOS Y MÚSICA (ASSETS)");
  });

  it("integra Scripts Humanos (hechos a mano con bloques de Scratch, variables en pantalla, operadores, sensores y apariencia) junto a Scripts Manuales", async () => {
    const { createScriptRunner } = await import("./scripts");
    const {
      SCRATCH_CATEGORIES,
      SCRATCH_BLOCK_SPECS,
      SCRATCH_EVENT_TEMPLATES,
      collectAllVariableNames,
    } = await import("./scratch-blocks-catalog");

    // 1. Verifica catálogo oficial de categorías Scratch (scratchfoundation/scratch-blocks)
    expect(SCRATCH_CATEGORIES.map((c) => c.id)).toEqual([
      "events",
      "motion",
      "looks",
      "sound",
      "control",
      "sensing",
      "operators",
      "variables",
      "myblocks",
    ]);
    expect(SCRATCH_BLOCK_SPECS.length).toBeGreaterThanOrEqual(45);
    expect(SCRATCH_EVENT_TEMPLATES.length).toBeGreaterThanOrEqual(12);

    // 2. Configura una escena con variables de Scratch visibles en el escenario (monitores) y scripts hechos a mano
    const scene = newScene("Nivel Scratch Humano");
    scene.variableDefinitions = [
      {
        id: "v_puntos",
        name: "puntos_scratch",
        scope: "scene",
        initialValue: 10,
        visibleOnStage: true,
      },
      {
        id: "v_energia",
        name: "energia",
        scope: "entity",
        initialValue: 50,
        visibleOnStage: true,
      },
    ];
    scene.variables = { puntos_scratch: 10 };

    const player = scene.entities.find((e) => e.kind === "player")!;
    player.variables = { energia: 50 };
    player.scripts = [
      {
        id: "s_scratch_1",
        event: "onStart",
        blocks: [
          { id: "b1", kind: "pointInDirection", value: 90 },
          { id: "b2", kind: "moveSteps", value: 25 },
          { id: "b3", kind: "turnRight", value: 15 },
          { id: "b4", kind: "sayForSecs", text: "¡Hola Scratch!", value: 2000 },
          { id: "b5", kind: "changeSizeBy", value: 20 },
          {
            id: "b6",
            kind: "mathOperation",
            scope: "scene",
            text: "puntos_scratch",
            varA: "$puntos_scratch",
            mathOp: "mul",
            varB: "3",
          },
          {
            id: "b7",
            kind: "joinTextVariable",
            scope: "scene",
            text: "saludo",
            varA: "Total: ",
            varB: "$puntos_scratch",
          },
          {
            id: "b8",
            kind: "sensePropertyToVariable",
            varA: "self",
            varB: "x",
            scope: "scene",
            text: "pos_x",
          },
          {
            id: "b9",
            kind: "ifVariable",
            scope: "scene",
            text: "puntos_scratch",
            operator: "gte",
            value: 30,
            thenBlocks: [
              {
                id: "b9_then",
                kind: "changeVariable",
                scope: "scene",
                text: "puntos_scratch",
                value: 5,
              },
              {
                id: "b9_show",
                kind: "showVariable",
                scope: "scene",
                text: "puntos_scratch",
              },
            ],
            elseBlocks: [],
          },
        ],
      },
    ];

    const { newRuntimeState } = await import("./core");
    const startX = player.x;
    const baseW = player.w;
    const runner = createScriptRunner();
    const state = {
      ...newRuntimeState(scene),
      time: 1.5,
    };
    const input = { left: false, right: false, jump: false };
    const hooks = {
      shake: () => {},
      restart: () => {},
    };

    runner.step(scene, state, input, hooks, 1 / 60);

    // Verifica que moveSteps desplazó en X (+25), turnRight rotó (+15), sayForSecs activó burbuja, changeSizeBy escaló 120%
    expect(player.x).toBeCloseTo(startX + 25, 1);
    expect(player.rotation).toBe(15);
    expect(player._bubbleText).toBe("¡Hola Scratch!");
    expect(player.w).toBe(Math.round(baseW * 1.2));

    // Verifica operadores matemáticos, unión de textos, sensor de propiedad y condicional ifVariable de Scratch
    expect(scene.variables?.puntos_scratch).toBe(35); // (10 * 3) + 5
    expect(scene.variables?.saludo).toBe("Total: 30");
    expect(scene.variables?.pos_x).toBe(Math.round(startX + 25));

    const varNames = collectAllVariableNames(
      scene.variableDefinitions,
      player.variables,
      scene.variables,
      player.scripts
    );
    expect(varNames).toContain("puntos_scratch");
    expect(varNames).toContain("energia");
    expect(varNames).toContain("saludo");

    // 3. Verifica que el HTML5 autónomo incluye monitores de variables en pantalla, burbujas Scratch y todos los bloques
    const html = buildStandaloneGameHtml({
      scene,
      scenes: [scene],
      title: "Prueba Scratch HTML5",
    });
    expect(html).toContain("puntos_scratch");
    expect(html).toContain('case "moveSteps":');
    expect(html).toContain('case "sayForSecs":');
    expect(html).toContain('block.kind === "ifSensing"');
    expect(html).toContain('case "mathOperation":');
    expect(html).toContain('case "showVariable":');
    expect(html).toContain("e._bubbleText");
    expect(html).toContain("scene.variableDefinitions");

    // 4. Verifica que la interfaz ofrece tanto Scripts Manuales (IA) como Scripts Humanos (Scratch)
    const editorSource = read("src/components/engine/AsternalEditor.tsx");
    expect(editorSource).toContain("HumanScratchScreen");
    expect(editorSource).toContain("SCRIPTS HUMANOS");
    expect(editorSource).toContain("open-entity-human-scratch-btn");

    const humanScreenSource = read("src/components/engine/HumanScratchScreen.tsx");
    expect(humanScreenSource).toContain("SCRIPTS HUMANOS");
    expect(humanScreenSource).toContain("SCRATCH BLOCKS · SIN IA");
    expect(humanScreenSource).toContain("CREAR VARIABLE DE SCRATCH");
  });

  it("mantiene únicamente el recuadro limpio del nivel en SceneEditor sin barras ni funciones extra", () => {
    const sceneEditorSource = read("src/components/engine/SceneEditor.tsx");
    expect(sceneEditorSource).not.toContain("BUILDA SCENE");
    expect(sceneEditorSource).not.toContain("+ ESCENA INDEPENDIENTE");
    expect(sceneEditorSource).not.toContain("RADAR DE ESCENA");
    expect(sceneEditorSource).not.toContain("CÁMARA INICIAL");
    expect(sceneEditorSource).toContain("ctx.strokeRect(0, 0, scene.width, scene.height);");
  });
});
