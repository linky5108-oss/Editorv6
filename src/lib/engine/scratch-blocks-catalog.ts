import type { ScratchVariableDef } from "./core";
import type { Block, BlockKind, EventType } from "./scripts";

export type ScratchCategoryId =
  | "events"
  | "motion"
  | "looks"
  | "sound"
  | "control"
  | "sensing"
  | "operators"
  | "variables"
  | "myblocks";

export interface ScratchCategoryMeta {
  id: ScratchCategoryId;
  label: string;
  color: string;
  secondaryColor: string;
  tertiaryColor: string;
  description: string;
}

/**
 * Official Scratch 3.0 / scratch-blocks vertical palette colors
 * Reference: https://github.com/scratchfoundation/scratch-blocks/blob/develop/core/colours.js
 */
export const SCRATCH_CATEGORIES: ScratchCategoryMeta[] = [
  {
    id: "events",
    label: "Eventos",
    color: "#FFBF00",
    secondaryColor: "#E6AC00",
    tertiaryColor: "#CC9900",
    description: "Sombreros disparadores de scripts (al iniciar, al colisionar, al tocar...)",
  },
  {
    id: "motion",
    label: "Movimiento",
    color: "#4C97FF",
    secondaryColor: "#4280D7",
    tertiaryColor: "#3373CC",
    description: "Pasos, giros, dirección, deslizamiento, rebote en bordes y velocidad",
  },
  {
    id: "looks",
    label: "Apariencia",
    color: "#9966FF",
    secondaryColor: "#855CD6",
    tertiaryColor: "#774DCB",
    description: "Burbujas de diálogo, tamaño %, capas, color, opacidad y visibilidad",
  },
  {
    id: "sound",
    label: "Sonido",
    color: "#CF63CF",
    secondaryColor: "#C94FC9",
    tertiaryColor: "#BD42BD",
    description: "Efectos de sonido, música de biblioteca, sintetizador y vibración",
  },
  {
    id: "control",
    label: "Control",
    color: "#FFAB19",
    secondaryColor: "#EC9C13",
    tertiaryColor: "#CF8B17",
    description: "Esperas, bucles repetir, condicionales Si / Si-No, clones y escena",
  },
  {
    id: "sensing",
    label: "Sensores",
    color: "#5CB1D6",
    secondaryColor: "#47A8D1",
    tertiaryColor: "#2E8EB8",
    description: "Detección de contacto, bordes, teclas, distancia, cronómetro y propiedades",
  },
  {
    id: "operators",
    label: "Operadores",
    color: "#59C059",
    secondaryColor: "#46B946",
    tertiaryColor: "#389438",
    description: "Matemáticas (+, -, *, /, mod), azar, trigonometría y unión de textos",
  },
  {
    id: "variables",
    label: "Variables",
    color: "#FF8C1A",
    secondaryColor: "#FF8000",
    tertiaryColor: "#DB6E00",
    description: "Variables en pantalla (monitores Scratch), contadores, puntos y vidas",
  },
  {
    id: "myblocks",
    label: "Física y Motor",
    color: "#FF6680",
    secondaryColor: "#FF4D6A",
    tertiaryColor: "#FF3355",
    description: "Física 2D avanzada, impulsos, persecución, proyectiles y cámara",
  },
];

export const SCRATCH_CATEGORY_MAP: Record<ScratchCategoryId, ScratchCategoryMeta> =
  Object.fromEntries(SCRATCH_CATEGORIES.map((c) => [c.id, c])) as Record<
    ScratchCategoryId,
    ScratchCategoryMeta
  >;

export interface ScratchEventTemplate {
  event: EventType;
  label: string;
  scratchText: string;
  badge: string;
  uiOnly?: boolean;
  entityOnly?: boolean;
}

export const SCRATCH_EVENT_TEMPLATES: ScratchEventTemplate[] = [
  {
    event: "onStart",
    label: "Al presionar bandera verde",
    scratchText: "al presionar ⚑ (Iniciar escena)",
    badge: "⚑",
  },
  {
    event: "onUpdate",
    label: "Por siempre (cada frame)",
    scratchText: "por siempre en cada frame (60 FPS)",
    badge: "↻",
    entityOnly: true,
  },
  {
    event: "onKeyDown",
    label: "Al presionar tecla",
    scratchText: "al presionar tecla de movimiento/salto",
    badge: "⌨",
    entityOnly: true,
  },
  {
    event: "onCollide",
    label: "Al tocar otro objeto",
    scratchText: "al colisionar con otro objeto",
    badge: "💥",
    entityOnly: true,
  },
  {
    event: "onMessage",
    label: "Al recibir mensaje",
    scratchText: "al recibir un mensaje broadcast",
    badge: "📨",
  },
  {
    event: "onTimer",
    label: "Por temporizador",
    scratchText: "cada intervalo del cronómetro",
    badge: "⏱",
    entityOnly: true,
  },
  {
    event: "onLand",
    label: "Al tocar el suelo",
    scratchText: "al aterrizar sobre una plataforma",
    badge: "⬇",
    entityOnly: true,
  },
  {
    event: "onScoreReach",
    label: "Al alcanzar puntos",
    scratchText: "cuando los puntos superan el umbral",
    badge: "★",
    entityOnly: true,
  },
  {
    event: "onLeaveScreen",
    label: "Al salir de la pantalla",
    scratchText: "cuando sale de los bordes de la escena",
    badge: "🚪",
    entityOnly: true,
  },
  {
    event: "onCreate",
    label: "Al comenzar como clon",
    scratchText: "al crearse o spawnear en la escena",
    badge: "✦",
    entityOnly: true,
  },
  {
    event: "onDestroyed",
    label: "Al destruirse",
    scratchText: "justo antes de ser eliminado",
    badge: "✖",
    entityOnly: true,
  },
  {
    event: "onWin",
    label: "Al ganar la partida",
    scratchText: "cuando se activa Victoria",
    badge: "🏆",
    entityOnly: true,
  },
  {
    event: "onLose",
    label: "Al perder la partida",
    scratchText: "cuando se activa Game Over",
    badge: "💀",
    entityOnly: true,
  },
  {
    event: "onTap",
    label: "Al hacer clic en este botón UI",
    scratchText: "al tocar este elemento UI",
    badge: "👆",
    uiOnly: true,
  },
  {
    event: "onHold",
    label: "Mientras se mantiene presionado",
    scratchText: "mientras se presiona este botón UI",
    badge: "✊",
    uiOnly: true,
  },
  {
    event: "onRelease",
    label: "Al soltar botón UI",
    scratchText: "al soltar este elemento UI",
    badge: "🖐",
    uiOnly: true,
  },
];

export interface ScratchBlockSpec {
  kind: BlockKind;
  category: ScratchCategoryId;
  shape: "stack" | "c-block" | "c-if-else" | "cap";
  title: string;
  subtitle?: string;
  createDefault: () => Omit<Block, "id">;
}

export const SCRATCH_BLOCK_SPECS: ScratchBlockSpec[] = [
  // ================= MOTION (#4C97FF) =================
  {
    kind: "moveSteps",
    category: "motion",
    shape: "stack",
    title: "mover (10) pasos",
    subtitle: "Avanza en la dirección actual del objeto",
    createDefault: () => ({ kind: "moveSteps", value: 10 }),
  },
  {
    kind: "turnRight",
    category: "motion",
    shape: "stack",
    title: "girar ↻ (15) grados",
    subtitle: "Rota el objeto en sentido horario",
    createDefault: () => ({ kind: "turnRight", value: 15 }),
  },
  {
    kind: "turnLeft",
    category: "motion",
    shape: "stack",
    title: "girar ↺ (15) grados",
    subtitle: "Rota el objeto en sentido antihorario",
    createDefault: () => ({ kind: "turnLeft", value: 15 }),
  },
  {
    kind: "pointInDirection",
    category: "motion",
    shape: "stack",
    title: "apuntar en dirección (90)",
    subtitle: "90=derecha, -90=izquierda, 0=arriba, 180=abajo",
    createDefault: () => ({ kind: "pointInDirection", value: 90 }),
  },
  {
    kind: "faceTarget",
    category: "motion",
    shape: "stack",
    title: "apuntar hacia [objetivo]",
    subtitle: "Mira hacia el jugador o tipo de objeto",
    createDefault: () => ({ kind: "faceTarget", text: "player" }),
  },
  {
    kind: "gotoTarget",
    category: "motion",
    shape: "stack",
    title: "ir a [posición aleatoria / objeto]",
    subtitle: "Salta a una posición al azar o hacia otro objeto",
    createDefault: () => ({ kind: "gotoTarget", text: "random" }),
  },
  {
    kind: "teleport",
    category: "motion",
    shape: "stack",
    title: "ir a x: (100) y: (100)",
    subtitle: "Posiciona el objeto en coordenadas exactas",
    createDefault: () => ({ kind: "teleport", x: 100, y: 100 }),
  },
  {
    kind: "glideTo",
    category: "motion",
    shape: "stack",
    title: "deslizar en (500) ms a x: (180) y: (300)",
    subtitle: "Interpola suavemente hacia el destino",
    createDefault: () => ({ kind: "glideTo", value: 500, x: 180, y: 300 }),
  },
  {
    kind: "moveX",
    category: "motion",
    shape: "stack",
    title: "sumar a x (10)",
    subtitle: "Desplaza horizontalmente en píxeles",
    createDefault: () => ({ kind: "moveX", value: 10 }),
  },
  {
    kind: "setX",
    category: "motion",
    shape: "stack",
    title: "fijar x a (180)",
    subtitle: "Establece la coordenada X",
    createDefault: () => ({ kind: "setX", value: 180 }),
  },
  {
    kind: "moveY",
    category: "motion",
    shape: "stack",
    title: "sumar a y (-10)",
    subtitle: "Desplaza verticalmente en píxeles",
    createDefault: () => ({ kind: "moveY", value: -10 }),
  },
  {
    kind: "setY",
    category: "motion",
    shape: "stack",
    title: "fijar y a (300)",
    subtitle: "Establece la coordenada Y",
    createDefault: () => ({ kind: "setY", value: 300 }),
  },
  {
    kind: "ifOnEdgeBounce",
    category: "motion",
    shape: "stack",
    title: "si toca un borde, rebotar",
    subtitle: "Invierte su dirección si choca con los límites de la pantalla",
    createDefault: () => ({ kind: "ifOnEdgeBounce" }),
  },
  {
    kind: "wrapScreen",
    category: "motion",
    shape: "stack",
    title: "envolver bordes de pantalla (Pac-Man)",
    subtitle: "Si sale por un lado entra por el opuesto",
    createDefault: () => ({ kind: "wrapScreen" }),
  },
  {
    kind: "setFacing",
    category: "motion",
    shape: "stack",
    title: "fijar estilo de orientación [derecha / izquierda]",
    subtitle: "Cambia hacia dónde mira el sprite",
    createDefault: () => ({ kind: "setFacing", value: 1 }),
  },

  // ================= LOOKS (#9966FF) =================
  {
    kind: "sayForSecs",
    category: "looks",
    shape: "stack",
    title: "decir [¡Hola!] durante (2000) ms",
    subtitle: "Muestra un bocadillo de diálogo sobre el objeto",
    createDefault: () => ({ kind: "sayForSecs", text: "¡Hola!", value: 2000 }),
  },
  {
    kind: "say",
    category: "looks",
    shape: "stack",
    title: "decir [¡Hola!]",
    subtitle: "Muestra un bocadillo de diálogo permanente",
    createDefault: () => ({ kind: "say", text: "¡Hola!" }),
  },
  {
    kind: "thinkForSecs",
    category: "looks",
    shape: "stack",
    title: "pensar [Hmm...] durante (2000) ms",
    subtitle: "Muestra una nube de pensamiento sobre el objeto",
    createDefault: () => ({ kind: "thinkForSecs", text: "Hmm...", value: 2000 }),
  },
  {
    kind: "clearBubble",
    category: "looks",
    shape: "stack",
    title: "quitar burbuja de diálogo",
    subtitle: "Oculta cualquier texto o pensamiento activo",
    createDefault: () => ({ kind: "clearBubble" }),
  },
  {
    kind: "changeSizeBy",
    category: "looks",
    shape: "stack",
    title: "cambiar tamaño por (10) %",
    subtitle: "Aumenta o reduce la escala relativa del objeto",
    createDefault: () => ({ kind: "changeSizeBy", value: 10 }),
  },
  {
    kind: "setSizePercent",
    category: "looks",
    shape: "stack",
    title: "fijar tamaño al (100) %",
    subtitle: "Restaura o ajusta el porcentaje de escala respecto al original",
    createDefault: () => ({ kind: "setSizePercent", value: 100 }),
  },
  {
    kind: "setObjectSize",
    category: "looks",
    shape: "stack",
    title: "fijar dimensiones ancho: (48) alto: (48)",
    subtitle: "Define el tamaño exacto en píxeles",
    createDefault: () => ({ kind: "setObjectSize", w: 48, h: 48 }),
  },
  {
    kind: "setColor",
    category: "looks",
    shape: "stack",
    title: "fijar efecto color a [#38bdf8]",
    subtitle: "Cambia el color principal del objeto",
    createDefault: () => ({ kind: "setColor", color: "#38bdf8" }),
  },
  {
    kind: "setOpacity",
    category: "looks",
    shape: "stack",
    title: "fijar opacidad al (80) %",
    subtitle: "Controla la transparencia (100 = opaco, 0 = invisible)",
    createDefault: () => ({ kind: "setOpacity", value: 80 }),
  },
  {
    kind: "clearGraphicEffects",
    category: "looks",
    shape: "stack",
    title: "quitar efectos gráficos",
    subtitle: "Restaura opacidad 100%, rotación 0 y limpia burbuja",
    createDefault: () => ({ kind: "clearGraphicEffects" }),
  },
  {
    kind: "setVisible",
    category: "looks",
    shape: "stack",
    title: "mostrar / esconder objeto",
    subtitle: "Alterna si el sprite es visible en el escenario",
    createDefault: () => ({ kind: "setVisible", bool: true }),
  },
  {
    kind: "setBg",
    category: "looks",
    shape: "stack",
    title: "cambiar fondo de escena a [#0f172a]",
    subtitle: "Cambia el color del cielo/escenario",
    createDefault: () => ({ kind: "setBg", color: "#0f172a" }),
  },
  {
    kind: "goToFrontBack",
    category: "looks",
    shape: "stack",
    title: "ir a la capa [delantera / trasera]",
    subtitle: "Cambia el orden de dibujo Z-index",
    createDefault: () => ({ kind: "goToFrontBack", text: "front" }),
  },
  {
    kind: "goForwardBackwardLayers",
    category: "looks",
    shape: "stack",
    title: "ir (1) capas hacia [adelante / atrás]",
    subtitle: "Sube o baja niveles de profundidad",
    createDefault: () => ({ kind: "goForwardBackwardLayers", value: 1 }),
  },

  // ================= SOUND (#CF63CF) =================
  {
    kind: "playSound",
    category: "sound",
    shape: "stack",
    title: "iniciar sonido [audio de biblioteca]",
    subtitle: "Reproduce un efecto de sonido de tu Biblioteca de Ajustes",
    createDefault: () => ({ kind: "playSound", soundName: "Sonido" }),
  },
  {
    kind: "playMusic",
    category: "sound",
    shape: "stack",
    title: "tocar música en bucle [pista]",
    subtitle: "Reproduce música de tu Biblioteca de Ajustes",
    createDefault: () => ({ kind: "playMusic", soundName: "Música" }),
  },
  {
    kind: "stopMusic",
    category: "sound",
    shape: "stack",
    title: "detener todos los sonidos",
    subtitle: "Silencia la música de fondo activa",
    createDefault: () => ({ kind: "stopMusic" }),
  },
  {
    kind: "playRandomSound",
    category: "sound",
    shape: "stack",
    title: "tocar sonido aleatorio",
    subtitle: "Elige un efecto de sonido al azar",
    createDefault: () => ({ kind: "playRandomSound" }),
  },
  {
    kind: "vibrate",
    category: "sound",
    shape: "stack",
    title: "vibrar dispositivo (80) ms",
    subtitle: "Respuesta háptica en móviles compatibles",
    createDefault: () => ({ kind: "vibrate", value: 80 }),
  },

  // ================= EVENTS (Broadcast inside stacks) =================
  {
    kind: "broadcast",
    category: "events",
    shape: "stack",
    title: "enviar mensaje [evento_1]",
    subtitle: "Dispara todos los bloques 'Al recibir mensaje' de la escena",
    createDefault: () => ({ kind: "broadcast", text: "evento_1" }),
  },

  // ================= CONTROL (#FFAB19) =================
  {
    kind: "wait",
    category: "control",
    shape: "stack",
    title: "esperar (500) ms",
    subtitle: "Pausa la ejecución de este hilo de bloques",
    createDefault: () => ({ kind: "wait", value: 500 }),
  },
  {
    kind: "repeat",
    category: "control",
    shape: "c-block",
    title: "repetir (5) veces",
    subtitle: "Bucle Scratch C-Block: ejecuta los bloques internos N veces",
    createDefault: () => ({ kind: "repeat", repeat: 5, thenBlocks: [] }),
  },
  {
    kind: "ifSensing",
    category: "control",
    shape: "c-if-else",
    title: "si <sensor se cumple> entonces / si no",
    subtitle: "Evalúa si toca un objeto, borde, tecla o distancia",
    createDefault: () => ({
      kind: "ifSensing",
      sensingCond: "touchingKind",
      text: "enemy",
      value: 120,
      thenBlocks: [],
      elseBlocks: [],
    }),
  },
  {
    kind: "ifVariable",
    category: "control",
    shape: "c-if-else",
    title: "si <(variable) cumple operador (valor)> entonces / si no",
    subtitle: "Compara cualquier variable de Scratch o del juego",
    createDefault: () => ({
      kind: "ifVariable",
      scope: "scene",
      text: "puntos",
      operator: "gte",
      value: 10,
      thenBlocks: [],
      elseBlocks: [],
    }),
  },
  {
    kind: "repeatUntilVariable",
    category: "control",
    shape: "c-block",
    title: "repetir hasta que <(variable) cumpla condición>",
    subtitle: "Repite los bloques internos hasta alcanzar la meta",
    createDefault: () => ({
      kind: "repeatUntilVariable",
      scope: "scene",
      text: "energia",
      operator: "lte",
      value: 0,
      thenBlocks: [],
    }),
  },
  {
    kind: "if",
    category: "control",
    shape: "c-if-else",
    title: "si <puntos cumplen condición> entonces / si no",
    subtitle: "Condicional de puntuación rápida",
    createDefault: () => ({
      kind: "if",
      cond: "scoreGte",
      value: 50,
      thenBlocks: [],
      elseBlocks: [],
    }),
  },
  {
    kind: "cloneSelf",
    category: "control",
    shape: "stack",
    title: "crear clon de mí mismo en Δx:(24) Δy:(0)",
    subtitle: "Duplica este objeto en la escena",
    createDefault: () => ({ kind: "cloneSelf", x: 24, y: 0 }),
  },
  {
    kind: "spawnEntity",
    category: "control",
    shape: "stack",
    title: "generar clon de [tipo] en x:(100) y:(100)",
    subtitle: "Spawnea otro objeto en la escena",
    createDefault: () => ({ kind: "spawnEntity", text: "coin", x: 100, y: 100 }),
  },
  {
    kind: "destroySelf",
    category: "control",
    shape: "cap",
    title: "eliminar este clon / objeto",
    subtitle: "Destruye la entidad actual",
    createDefault: () => ({ kind: "destroySelf" }),
  },
  {
    kind: "destroyOther",
    category: "control",
    shape: "stack",
    title: "eliminar el otro objeto colisionado",
    subtitle: "Destruye el objeto con el que chocó",
    createDefault: () => ({ kind: "destroyOther" }),
  },
  {
    kind: "removeAllOf",
    category: "control",
    shape: "stack",
    title: "eliminar todos los objetos de tipo [enemy]",
    subtitle: "Limpia todos los enemigos, monedas o proyectiles",
    createDefault: () => ({ kind: "removeAllOf", text: "enemy" }),
  },
  {
    kind: "restartScene",
    category: "control",
    shape: "cap",
    title: "reiniciar escena actual",
    subtitle: "Resetea posiciones, vidas y variables",
    createDefault: () => ({ kind: "restartScene" }),
  },
  {
    kind: "win",
    category: "control",
    shape: "cap",
    title: "detener todo y declarar ¡Victoria!",
    subtitle: "Termina la partida ganando",
    createDefault: () => ({ kind: "win" }),
  },
  {
    kind: "lose",
    category: "control",
    shape: "cap",
    title: "detener todo y declarar Game Over",
    subtitle: "Termina la partida perdiendo",
    createDefault: () => ({ kind: "lose" }),
  },

  // ================= SENSING (#5CB1D6) =================
  {
    kind: "senseDistanceToVariable",
    category: "sensing",
    shape: "stack",
    title: "guardar distancia a [player] en variable [distancia]",
    subtitle: "Mide los píxeles hasta el objetivo y lo guarda en una variable",
    createDefault: () => ({
      kind: "senseDistanceToVariable",
      varA: "player",
      scope: "scene",
      text: "distancia",
    }),
  },
  {
    kind: "sensePropertyToVariable",
    category: "sensing",
    shape: "stack",
    title: "leer propiedad [x / y / puntos / tiempo] en variable",
    subtitle: "Captura coordenadas, velocidad, vidas o tiempo en tu variable",
    createDefault: () => ({
      kind: "sensePropertyToVariable",
      varA: "self",
      varB: "x",
      scope: "scene",
      text: "mi_x",
    }),
  },
  {
    kind: "resetTimer",
    category: "sensing",
    shape: "stack",
    title: "reiniciar cronómetro",
    subtitle: "Pone el temporizador de la escena de vuelta en 0",
    createDefault: () => ({ kind: "resetTimer" }),
  },
  {
    kind: "setHitbox",
    category: "sensing",
    shape: "stack",
    title: "ajustar sensor de colisión (Hitbox) W:(32) H:(32)",
    subtitle: "Personaliza la caja física de contacto",
    createDefault: () => ({ kind: "setHitbox", x: 0, y: 0, w: 32, h: 32 }),
  },
  {
    kind: "clearHitbox",
    category: "sensing",
    shape: "stack",
    title: "restaurar sensor de colisión original",
    subtitle: "Usa el tamaño visual del sprite como hitbox",
    createDefault: () => ({ kind: "clearHitbox" }),
  },

  // ================= OPERATORS (#59C059) =================
  {
    kind: "mathOperation",
    category: "operators",
    shape: "stack",
    title: "fijar [variable] = (A) [+ / - / * / ÷ / mod] (B)",
    subtitle: "Operación matemática entre números o variables de Scratch",
    createDefault: () => ({
      kind: "mathOperation",
      scope: "scene",
      text: "resultado",
      varA: "10",
      mathOp: "add",
      varB: "5",
    }),
  },
  {
    kind: "setRandomVariable",
    category: "operators",
    shape: "stack",
    title: "fijar [variable] a número aleatorio entre (1) y (10)",
    subtitle: "Elige un entero al azar dentro del rango [mín, máx]",
    createDefault: () => ({
      kind: "setRandomVariable",
      scope: "scene",
      text: "azar",
      x: 1,
      y: 10,
    }),
  },
  {
    kind: "mathFunctionVariable",
    category: "operators",
    shape: "stack",
    title: "fijar [variable] a [abs / sqrt / sin / cos / round] de (X)",
    subtitle: "Aplica una función matemática avanzada",
    createDefault: () => ({
      kind: "mathFunctionVariable",
      scope: "scene",
      text: "calculo",
      mathFn: "round",
      varA: "10",
    }),
  },
  {
    kind: "joinTextVariable",
    category: "operators",
    shape: "stack",
    title: "fijar [variable] a unir [texto A] con [texto B]",
    subtitle: "Concatena cadenas o valores de variables ($nombre)",
    createDefault: () => ({
      kind: "joinTextVariable",
      scope: "scene",
      text: "mensaje",
      varA: "Puntos: ",
      varB: "$puntos",
    }),
  },

  // ================= VARIABLES (#FF8C1A) =================
  {
    kind: "setVariable",
    category: "variables",
    shape: "stack",
    title: "dar a [mi variable] el valor (0)",
    subtitle: "Asigna un valor numérico a una variable global o local",
    createDefault: () => ({
      kind: "setVariable",
      scope: "scene",
      text: "puntos",
      value: 0,
    }),
  },
  {
    kind: "changeVariable",
    category: "variables",
    shape: "stack",
    title: "sumar a [mi variable] (1)",
    subtitle: "Incrementa o resta el valor de una variable",
    createDefault: () => ({
      kind: "changeVariable",
      scope: "scene",
      text: "puntos",
      value: 1,
    }),
  },
  {
    kind: "showVariable",
    category: "variables",
    shape: "stack",
    title: "mostrar variable [mi variable] en pantalla",
    subtitle: "Activa el monitor naranja de Scratch en el juego",
    createDefault: () => ({
      kind: "showVariable",
      scope: "scene",
      text: "puntos",
    }),
  },
  {
    kind: "hideVariable",
    category: "variables",
    shape: "stack",
    title: "esconder variable [mi variable] de la pantalla",
    subtitle: "Oculta el monitor de la variable en el HUD del juego",
    createDefault: () => ({
      kind: "hideVariable",
      scope: "scene",
      text: "puntos",
    }),
  },
  {
    kind: "addScore",
    category: "variables",
    shape: "stack",
    title: "sumar al marcador SCORE (10)",
    subtitle: "Modifica el marcador principal del HUD",
    createDefault: () => ({ kind: "addScore", value: 10 }),
  },
  {
    kind: "setScore",
    category: "variables",
    shape: "stack",
    title: "fijar marcador SCORE a (0)",
    subtitle: "Define el marcador de puntos",
    createDefault: () => ({ kind: "setScore", value: 0 }),
  },
  {
    kind: "addLives",
    category: "variables",
    shape: "stack",
    title: "sumar o restar vidas ♥ (1)",
    subtitle: "Modifica los corazones del jugador",
    createDefault: () => ({ kind: "addLives", value: 1 }),
  },
  {
    kind: "setLives",
    category: "variables",
    shape: "stack",
    title: "fijar vidas ♥ a (3)",
    subtitle: "Establece el total de vidas",
    createDefault: () => ({ kind: "setLives", value: 3 }),
  },

  // ================= MY BLOCKS / PHYSICS (#FF6680) =================
  {
    kind: "jump",
    category: "myblocks",
    shape: "stack",
    title: "saltar con fuerza (420)",
    subtitle: "Impulso vertical hacia arriba",
    createDefault: () => ({ kind: "jump", value: 420 }),
  },
  {
    kind: "impulse",
    category: "myblocks",
    shape: "stack",
    title: "aplicar impulso físico vx:(200) vy:(-300)",
    subtitle: "Suma velocidad instantánea en ambos ejes",
    createDefault: () => ({ kind: "impulse", x: 200, y: -300 }),
  },
  {
    kind: "setVx",
    category: "myblocks",
    shape: "stack",
    title: "fijar velocidad horizontal Vx a (160)",
    subtitle: "Define la velocidad en el eje X",
    createDefault: () => ({ kind: "setVx", value: 160 }),
  },
  {
    kind: "setVy",
    category: "myblocks",
    shape: "stack",
    title: "fijar velocidad vertical Vy a (-260)",
    subtitle: "Define la velocidad en el eje Y",
    createDefault: () => ({ kind: "setVy", value: -260 }),
  },
  {
    kind: "flipVx",
    category: "myblocks",
    shape: "stack",
    title: "invertir velocidad horizontal (rebote X)",
    subtitle: "Ideal para patrullas al chocar con paredes",
    createDefault: () => ({ kind: "flipVx" }),
  },
  {
    kind: "bounceY",
    category: "myblocks",
    shape: "stack",
    title: "rebotar verticalmente (80) %",
    subtitle: "Rebote elástico vertical",
    createDefault: () => ({ kind: "bounceY", value: 80 }),
  },
  {
    kind: "chase",
    category: "myblocks",
    shape: "stack",
    title: "perseguir a [player] a velocidad (110)",
    subtitle: "IA de seguimiento continuo hacia el objetivo",
    createDefault: () => ({ kind: "chase", text: "player", value: 110 }),
  },
  {
    kind: "knockback",
    category: "myblocks",
    shape: "stack",
    title: "empujar atrás (knockback) X:(240) Y:(-300)",
    subtitle: "Retroceso de impacto al recibir golpe",
    createDefault: () => ({ kind: "knockback", x: 240, y: -300 }),
  },
  {
    kind: "hurtPlayer",
    category: "myblocks",
    shape: "stack",
    title: "dañar al jugador",
    subtitle: "Aplica daño al jugador",
    createDefault: () => ({ kind: "hurtPlayer" }),
  },
  {
    kind: "shake",
    category: "myblocks",
    shape: "stack",
    title: "sacudir cámara intensidad (8)",
    subtitle: "Efecto de terremoto / impacto en pantalla",
    createDefault: () => ({ kind: "shake", value: 8 }),
  },
  {
    kind: "stop",
    category: "myblocks",
    shape: "stack",
    title: "frenar velocidades a cero",
    subtitle: "Detiene Vx y Vy inmediatamente",
    createDefault: () => ({ kind: "stop" }),
  },
];

export function getScratchCategoryForBlock(kind: BlockKind): ScratchCategoryMeta {
  const spec = SCRATCH_BLOCK_SPECS.find((s) => s.kind === kind);
  if (spec) return SCRATCH_CATEGORY_MAP[spec.category];
  if (
    [
      "moveX",
      "moveY",
      "setX",
      "setY",
      "teleport",
      "setSpeed",
      "flipVy",
      "pushAway",
    ].includes(kind)
  ) {
    return SCRATCH_CATEGORY_MAP.motion;
  }
  if (["setSize", "setColor", "setOpacity", "setVisible", "setBg"].includes(kind)) {
    return SCRATCH_CATEGORY_MAP.looks;
  }
  if (["playSound", "playMusic", "stopMusic", "playRandomSound", "vibrate"].includes(kind)) {
    return SCRATCH_CATEGORY_MAP.sound;
  }
  if (["setVariable", "changeVariable", "addScore", "setScore", "resetScore", "addLives", "setLives"].includes(kind)) {
    return SCRATCH_CATEGORY_MAP.variables;
  }
  if (["wait", "repeat", "if", "ifVariable", "ifSensing", "repeatUntilVariable"].includes(kind)) {
    return SCRATCH_CATEGORY_MAP.control;
  }
  return SCRATCH_CATEGORY_MAP.myblocks;
}

export function getBlockShape(kind: BlockKind): "stack" | "c-block" | "c-if-else" | "cap" {
  const spec = SCRATCH_BLOCK_SPECS.find((s) => s.kind === kind);
  if (spec) return spec.shape;
  if (kind === "repeat" || kind === "repeatUntilVariable") return "c-block";
  if (kind === "if" || kind === "ifVariable" || kind === "ifSensing") return "c-if-else";
  if (kind === "destroySelf" || kind === "restartScene" || kind === "win" || kind === "lose") return "cap";
  return "stack";
}

const VARIABLE_BLOCK_KINDS = new Set<BlockKind>([
  "setVariable",
  "changeVariable",
  "showVariable",
  "hideVariable",
  "ifVariable",
  "repeatUntilVariable",
  "mathOperation",
  "setRandomVariable",
  "mathFunctionVariable",
  "joinTextVariable",
  "senseDistanceToVariable",
  "sensePropertyToVariable",
]);

export function collectAllVariableNames(
  sceneVariables: ScratchVariableDef[] | undefined,
  entityVariables?: Record<string, string | number | boolean>,
  sceneRuntimeVars?: Record<string, string | number | boolean>,
  scripts?: { blocks: Block[] }[]
): string[] {
  const names = new Set<string>(["puntos", "vidas", "velocidad_extra"]);
  for (const def of sceneVariables ?? []) {
    if (def.name.trim()) names.add(def.name.trim());
  }
  for (const k of Object.keys(entityVariables ?? {})) {
    if (k.trim()) names.add(k.trim());
  }
  for (const k of Object.keys(sceneRuntimeVars ?? {})) {
    if (k.trim()) names.add(k.trim());
  }
  const visitBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      if (VARIABLE_BLOCK_KINDS.has(b.kind) && b.text?.trim()) {
        names.add(b.text.trim());
      }
      if (b.thenBlocks?.length) visitBlocks(b.thenBlocks);
      if (b.elseBlocks?.length) visitBlocks(b.elseBlocks);
    }
  };
  for (const s of scripts ?? []) {
    visitBlocks(s.blocks);
  }
  return Array.from(names);
}
