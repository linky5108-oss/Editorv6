// El generador de scripts (y cualquier editor que lo use) habla con Gemini a
// través de la API pública de Prexzy, integrada por defecto: no hay clave, ni
// modelo que elegir, ni ajuste previo.
//
// Antes esto llamaba directamente a Google AI Studio (BYOK). Ya no: la petición
// sale del navegador a `https://prexzyapis.com/ai/gemini`, un servicio con CORS
// abierto (`access-control-allow-origin: *`), sin cabeceras de autenticación.
//
// Contrato verificado contra el servicio real:
//   POST /ai/gemini   { "prompt": "...", "session_id": "..." }
//   → 200 { status:true, response:"<texto>", service:"Google Gemini", session_id }
//   · El texto de la respuesta viene en `response`.
//   · `session_id` guarda el hilo: el servicio recuerda los turnos anteriores
//     de esa conversación, así que se reutiliza uno estable por script.
//   · También acepta GET con parámetros, pero el prompt viaja en la URL y el
//     servidor devuelve 414 a partir de ~8 KB: por eso aquí siempre se usa POST.

/** API pública integrada por defecto (Google Gemini, sin clave). */
export const GEMINI_API_ENDPOINT = "https://prexzyapis.com/ai/gemini";

/** Hilo por defecto cuando la edición no aporta uno propio. */
export const GEMINI_DEFAULT_SESSION = "asternal-script-ai";

/**
 * Tope del prompt enviado. La API acepta cuerpos grandes (probado con 20 000
 * caracteres), así que el límite es una salvaguarda para no arrastrar historiales
 * enormes: si la conversación crece, se descartan los turnos más antiguos.
 */
export const PROMPT_LIMIT = 16_000;

/** Espera máxima antes de dar la petición por perdida. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Un turno de la petición, tal como lo entregan los editores del motor. */
export interface GeminiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GeminiChatOptions {
  /** Instrucciones + conocimiento del motor, siempre al principio del prompt. */
  systemPrompt?: string;
  /** Hilo del servicio asociado a esta conversación (memoria del lado del servicio). */
  sessionId?: string;
  /** Permite cancelar la petición en curso. */
  signal?: AbortSignal;
}

export interface GeminiChatResult {
  text: string;
  model: string;
}

/**
 * Convierte el historial en un único prompt etiquetado.
 *
 * El prompt del sistema siempre se conserva; si la conversación no cabe en
 * `PROMPT_LIMIT`, se van quitando los turnos más antiguos (nunca el del
 * sistema ni la pregunta actual).
 */
export function buildChatPrompt(history: GeminiChatMessage[], systemPrompt?: string): string {
  const system = systemPrompt?.trim() ?? "";
  const turns = history
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = message.content?.trim();
      if (!text) return "";
      return `${message.role === "assistant" ? "ASISTENTE" : "USUARIO"}: ${text}`;
    })
    .filter(Boolean);

  let prompt = [system, ...turns].join("\n\n");
  let first = 0;
  while (prompt.length > PROMPT_LIMIT && first < turns.length - 1) {
    first += 1;
    prompt = [system, ...turns.slice(first)].join("\n\n");
  }
  return prompt;
}

function sessionFor(sessionId?: string): string {
  const clean = sessionId?.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) ?? "";
  return clean || GEMINI_DEFAULT_SESSION;
}

/**
 * Consulta a Gemini y devuelve su texto.
 *
 * Nunca deja pasar un error del servicio en crudo: se traduce a un mensaje
 * legible. Si la persona cancela la petición, se propaga el `AbortError`
 * original para que quien llama pueda distinguirlo de un fallo real.
 */
export async function geminiChat(
  history: GeminiChatMessage[],
  opts: GeminiChatOptions = {},
): Promise<GeminiChatResult> {
  const prompt = buildChatPrompt(history, opts.systemPrompt).trim();
  if (!prompt) throw new Error("Escribe una instrucción para la IA.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(GEMINI_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, session_id: sessionFor(opts.sessionId) }),
      signal: controller.signal,
    });
  } catch (error) {
    // Canceló la persona: se propaga tal cual (la interfaz lo trata como «detenido»).
    if (opts.signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("La IA tardó demasiado en responder. Inténtalo de nuevo.");
    throw new Error("No se pudo contactar con la IA. Revisa tu conexión.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  const payload = (await response.json().catch(() => null)) as {
    response?: unknown;
    service?: unknown;
    status?: unknown;
    message?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok || !payload || payload.status === false) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : `La IA no respondió (${response.status}).`;
    throw new Error(message);
  }

  const text = typeof payload.response === "string" ? payload.response.trim() : "";
  if (!text) throw new Error("La IA devolvió una respuesta vacía.");
  const model = typeof payload.service === "string" && payload.service.trim() ? payload.service.trim() : "Gemini";
  return { text, model };
}

export function buildGeminiScriptPrompt(args: {
  userRequest: string;
  engineKnowledge: string;
  targetEntityKind?: string;
  projectSummary?: string;
}): string {
  const { userRequest, engineKnowledge, targetEntityKind, projectSummary } = args;
  return [
    "Eres un programador del motor de Asternal. Solo puedes usar los tipos y bloques reales del motor listados abajo. No inventes APIs.",
    targetEntityKind ? `Entidad objetivo: ${targetEntityKind}.` : "",
    projectSummary ? `Resumen del proyecto:\n${projectSummary}` : "",
    "Conocimiento del motor:",
    engineKnowledge,
    "Petición del usuario:",
    userRequest,
    "Devuelve SOLO un JSON válido con un array de Script[] (tipo Script del conocimiento). Sin markdown, sin explicación y sin escapar las comillas.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Prompt para **seguir editando un script ya existente** con instrucciones
 * nuevas.
 *
 * A diferencia de `buildGeminiScriptPrompt` (que crea scripts desde cero), aquí
 * el script actual viaja completo en el prompt: la IA parte de él y aplica solo
 * el cambio pedido, así se conservan el contexto y los cambios anteriores
 * —también los hechos a mano— en lugar de reescribirlo todo. El editor usa
 * además un `sessionId` por script, de modo que el servicio recuerda la
 * conversación de ese script entre ediciones.
 */
export function buildGeminiScriptEditPrompt(args: {
  instruction: string;
  engineKnowledge: string;
  currentScript: unknown;
  targetEntityKind?: string;
  projectSummary?: string;
}): string {
  const { instruction, engineKnowledge, currentScript, targetEntityKind, projectSummary } = args;
  return [
    "Eres un programador del motor de Asternal. Solo puedes usar los tipos y bloques reales del motor listados abajo. No inventes APIs.",
    "Estás EDITANDO un script que ya existe: devuelve ese mismo script con sus bloques cambiados, no uno nuevo.",
    targetEntityKind ? `Entidad objetivo: ${targetEntityKind}.` : "",
    projectSummary ? `Resumen del proyecto:\n${projectSummary}` : "",
    "Conocimiento del motor:",
    engineKnowledge,
    "Script actual (estado exacto que debes conservar):",
    JSON.stringify(currentScript, null, 2),
    "Nueva instrucción de edición:",
    instruction,
    "Reglas obligatorias de la edición:",
    "- Conserva `id` y `event` exactamente como están: el evento lo controla el usuario desde el editor.",
    "- Conserva los bloques que ya existen, con sus ids y sus valores ajustados, salvo que la instrucción pida cambiarlos o quitarlos.",
    "- Añade, modifica o quita únicamente los bloques necesarios para cumplir la instrucción.",
    "Devuelve SOLO un JSON válido con el objeto Script actualizado (uno solo, no un array). Sin markdown, sin explicación y sin escapar las comillas.",
  ].filter(Boolean).join("\n\n");
}

function stripFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json|js|javascript)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Deshace la capa de escape adicional que añade el servicio de IA cuando
 * devuelve un JSON serializado como texto (`\"` en las comillas del JSON,
 * `\\\"` en las comillas internas y `\` seguido de salto de línea real en `\n`).
 */
function unescapeExtra(value: string): string {
  return value
    .replace(/\\\r?\n/g, "\\n")
    .replace(/\\(["\\/])/g, "$1");
}

function repairJsonSyntax(
  input: string,
  fixInnerQuotes = false,
  closeTruncated = false,
): string {
  let out = "";
  let i = 0;
  const n = input.length;
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let stringRole: "key" | "value" | "arrayItem" = "value";
  let expectingKey = false;

  while (i < n) {
    const ch = input[i];
    if (!inString) {
      if (ch === "/" && input[i + 1] === "/") {
        i += 2;
        while (i < n && input[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && input[i + 1] === "*") {
        i += 2;
        while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
        if (i < n) i += 2;
        continue;
      }
      if (ch === "{") {
        stack.push("{");
        expectingKey = true;
        out += ch;
        i++;
        continue;
      }
      if (ch === "[") {
        stack.push("[");
        expectingKey = false;
        out += ch;
        i++;
        continue;
      }
      if (ch === "}" || ch === "]") {
        stack.pop();
        expectingKey = false;
        out += ch;
        i++;
        continue;
      }
      if (ch === ":") {
        expectingKey = false;
        out += ch;
        i++;
        continue;
      }
      if (ch === ",") {
        const rest = input
          .slice(i + 1)
          .replace(/^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/, "");
        if (rest.startsWith("}") || rest.startsWith("]")) {
          i++;
          continue;
        }
        if (stack[stack.length - 1] === "{") expectingKey = true;
        out += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        const top = stack[stack.length - 1];
        stringRole = top === "{" ? (expectingKey ? "key" : "value") : "arrayItem";
        out += ch;
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === "\\") {
      const next = input[i + 1];
      if (next === undefined) {
        out += "\\\\";
        i++;
        continue;
      }
      if (next === "\n") {
        out += "\\n";
        i += 2;
        continue;
      }
      if (next === "\r") {
        out += "\\n";
        i += input[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (next === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (
        next === '"' ||
        next === "\\" ||
        next === "/" ||
        next === "b" ||
        next === "f" ||
        next === "n" ||
        next === "r" ||
        next === "t"
      ) {
        out += "\\" + next;
        i += 2;
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 2, i + 6))) {
        out += "\\u" + input.slice(i + 2, i + 6);
        i += 6;
        continue;
      }
      out += "\\\\" + next;
      i += 2;
      continue;
    }

    if (ch === "\n") {
      out += "\\n";
      i++;
      continue;
    }
    if (ch === "\r") {
      if (input[i + 1] !== "\n") out += "\\r";
      i++;
      continue;
      }
    if (ch === "\t") {
      out += "\\t";
      i++;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
      i++;
      continue;
    }

    if (ch === '"') {
      if (!fixInnerQuotes) {
        inString = false;
        out += '"';
        i++;
        continue;
      }
      const rest = input.slice(i + 1);
      let isClosing = false;
      if (stringRole === "key") {
        isClosing = /^\s*:/.test(rest);
      } else if (stringRole === "value") {
        isClosing =
          /^\s*\}/.test(rest) ||
          /^\s*,\s*\}/.test(rest) ||
          /^\s*,\s*"[a-zA-Z0-9_$-]+"\s*:/.test(rest);
      } else {
        isClosing =
          /^\s*\]/.test(rest) ||
          /^\s*,\s*\]/.test(rest) ||
          /^\s*,\s*(?:["{\[\d-]|true\b|false\b|null\b)/.test(rest);
      }
      if (isClosing) {
        inString = false;
        out += '"';
      } else {
        out += '\\"';
      }
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  if (closeTruncated && stack.length > 0 && /^[\s]*[{[]/.test(out)) {
    if (inString) {
      out += '"';
      if (stringRole === "key") out += ": null";
    }
    out = out.replace(/,\s*$/, "");
    if (/:\s*$/.test(out)) out += "null";
    while (stack.length > 0) {
      const open = stack.pop();
      out += open === "{" ? "}" : "]";
    }
  }

  return out;
}

function collectDelimitedSlices(source: string): string[] {
  const slices: Array<{ start: number; text: string }> = [];
  const lastBrace = source.lastIndexOf("}");
  const lastBracket = source.lastIndexOf("]");

  if (lastBrace > 0) {
    let pos = source.indexOf("{");
    let count = 0;
    while (pos !== -1 && pos < lastBrace && count < 4) {
      slices.push({ start: pos, text: source.slice(pos, lastBrace + 1) });
      pos = source.indexOf("{", pos + 1);
      count++;
    }
  }

  if (lastBracket > 0) {
    let pos = source.indexOf("[");
    let count = 0;
    while (pos !== -1 && pos < lastBracket && count < 4) {
      slices.push({ start: pos, text: source.slice(pos, lastBracket + 1) });
      pos = source.indexOf("[", pos + 1);
      count++;
    }
  }

  slices.sort((a, b) => a.start - b.start);
  return slices.map((s) => s.text);
}

/**
 * Parseo del JSON que devuelve la IA.
 *
 * El servicio entrega a veces el JSON escapado de más, como si fuera el
 * contenido de una cadena: `\"id\"` en lugar de `"id"` y, a veces, `\` seguido
 * de salto real o `\n` dentro de cadenas multilínea. Aquí se prueba el texto
 * tal cual, luego deshaciendo los escapes sobrantes y reparando saltos/comillas
 * internas. Si ninguna forma da un JSON válido, lanza un error legible.
 */
export function parseAiJson<T = unknown>(value: string): T {
  const raw = stripFence(value ?? "");
  if (!raw) throw new Error("La IA no devolvió nada.");

  const baseCandidates: string[] = [];
  const pushUnique = (candidate: string) => {
    const clean = stripFence(candidate);
    if (clean && !baseCandidates.includes(clean)) {
      baseCandidates.push(clean);
    }
  };

  pushUnique(raw);
  pushUnique(unescapeExtra(raw));

  try {
    const decoded = JSON.parse(`"${raw}"`);
    if (typeof decoded === "string" && decoded !== raw) {
      pushUnique(decoded);
      pushUnique(unescapeExtra(decoded));
    }
  } catch {
    // No era una cadena escapada simple.
  }

  // Bloques ```json ... ``` aunque haya texto conversacional antes o después
  const fenceRegex = /```(?:json|js|javascript)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(value ?? "")) !== null) {
    if (match[1]?.trim()) {
      const body = match[1].trim();
      pushUnique(body);
      pushUnique(unescapeExtra(body));
    }
  }

  // Recortes delimitados {...} y [...] tanto sobre el texto crudo como sin escapes extra
  for (const slice of collectDelimitedSlices(raw)) {
    pushUnique(slice);
    pushUnique(unescapeExtra(slice));
  }
  for (const slice of collectDelimitedSlices(unescapeExtra(raw))) {
    pushUnique(slice);
  }

  const expandedAttempts: string[] = [];
  const addAttempt = (attempt: string) => {
    const trimmed = attempt.trim();
    if (trimmed && !expandedAttempts.includes(trimmed)) {
      expandedAttempts.push(trimmed);
    }
  };

  for (const candidate of baseCandidates) {
    addAttempt(candidate);
    addAttempt(unescapeExtra(candidate));
    addAttempt(repairJsonSyntax(candidate, false, false));
    addAttempt(repairJsonSyntax(unescapeExtra(candidate), false, false));
    addAttempt(repairJsonSyntax(candidate, true, false));
    addAttempt(repairJsonSyntax(unescapeExtra(candidate), true, false));
  }

  for (const candidate of baseCandidates) {
    addAttempt(repairJsonSyntax(candidate, false, true));
    addAttempt(repairJsonSyntax(unescapeExtra(candidate), false, true));
    addAttempt(repairJsonSyntax(candidate, true, true));
    addAttempt(repairJsonSyntax(unescapeExtra(candidate), true, true));
  }

  for (const attempt of expandedAttempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (typeof parsed === "string") {
        const inner = parsed.trim();
        if ((inner.startsWith("{") || inner.startsWith("[")) && inner !== attempt) {
          return parseAiJson<T>(inner);
        }
      }
      if (parsed !== null && parsed !== undefined) {
        return parsed as T;
      }
    } catch {
      // Se prueba el siguiente intento.
    }
  }
  throw new Error("La IA no devolvió un JSON válido.");
}

/**
 * Solicita generación o edición de scripts manuales con IA:
 * intenta primero la ruta de servidor `/api/orion/script-ai` (Gemini oficial)
 * y recurre automáticamente a `geminiChat` (Prexzy) si la ruta local no responde.
 */
export async function requestScriptAi(
  prompt: string,
  opts: GeminiChatOptions = {},
): Promise<GeminiChatResult> {
  try {
    const res = await fetch("/api/orion/script-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        sessionId: sessionFor(opts.sessionId),
      }),
      signal: opts.signal,
    });
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        text?: unknown;
        response?: unknown;
        scripts?: unknown;
        script?: unknown;
        model?: unknown;
      } | null;
      if (payload) {
        const text =
          typeof payload.text === "string" && payload.text.trim()
            ? payload.text.trim()
            : typeof payload.response === "string" && payload.response.trim()
              ? payload.response.trim()
              : payload.scripts || payload.script
                ? JSON.stringify(payload.scripts ?? payload.script)
                : "";
        if (text) {
          return {
            text,
            model: typeof payload.model === "string" ? payload.model : "Gemini",
          };
        }
      }
    }
  } catch (err) {
    if (opts.signal?.aborted) throw err;
  }
  return geminiChat([{ role: "user", content: prompt }], opts);
}

/**
 * Respaldo determinista que construye un `Script[]` válido a partir de una petición
 * en lenguaje natural si el proveedor de IA falla o devuelve una lista vacía.
 */
export function synthesizeScriptsFromRequest(
  requestText: string,
  allowedEvents?: string[],
): Array<{
  id: string;
  event: string;
  withKind?: string;
  key?: "left" | "right" | "jump";
  threshold?: number;
  interval?: number;
  message?: string;
  blocks: Array<Record<string, unknown>>;
}> {
  const lower = (requestText ?? "").toLowerCase();
  const makeId = () => Math.random().toString(36).slice(2, 10);
  const canUse = (ev: string) => !allowedEvents?.length || allowedEvents.includes(ev);

  let event = "onCollide";
  let withKind: string | undefined = "player";
  let interval: number | undefined;
  let key: "left" | "right" | "jump" | undefined;

  if (canUse("onTap") && !canUse("onCollide")) {
    event = /manten|hold/i.test(lower) && canUse("onHold") ? "onHold" : "onTap";
    withKind = undefined;
  } else if (/cada\s+(\d+)\s*s|temporizador|timer|intervalo/i.test(lower) && canUse("onTimer")) {
    event = "onTimer";
    withKind = undefined;
    const m = lower.match(/(\d+(?:\.\d+)?)\s*s/);
    interval = m ? Math.max(100, Math.round(Number(m[1]) * 1000)) : 2000;
  } else if (/fotograma|siempre|update|continuamente|persig/i.test(lower) && canUse("onUpdate")) {
    event = "onUpdate";
    withKind = undefined;
  } else if (/tecla|presionar|pulsar.*salto/i.test(lower) && canUse("onKeyDown")) {
    event = "onKeyDown";
    withKind = undefined;
    key = /izquierda|left/.test(lower) ? "left" : /derecha|right/.test(lower) ? "right" : "jump";
  } else if (/iniciar|empezar|comenzar|start/i.test(lower) && canUse("onStart")) {
    event = "onStart";
    withKind = undefined;
  } else if (!canUse("onCollide")) {
    event = allowedEvents?.[0] || "onStart";
    withKind = undefined;
  }

  const blocks: Array<Record<string, unknown>> = [];

  if (/persig|chase|seguir/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "chase", text: "player", value: 110 });
  }
  if (/salt|impuls.*arriba|rebot/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "jump", value: 480 });
  }
  if (/empuj|knockback|retroce/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "knockback", x: 240, y: -300 });
  }
  if (/punto|score|premio|moneda/i.test(lower)) {
    const m = lower.match(/(\d+)\s*punto/);
    blocks.push({ id: makeId(), kind: "addScore", value: m ? Number(m[1]) : 25 });
  }
  if (/rest.*vida|quit.*vida|dañ|hurt/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "addLives", value: -1 });
  } else if (/vida|coraz/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "addLives", value: 1 });
  }
  if (/sacud|shake|tembl/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "shake", value: 8 });
  }
  if (/sonido|suene|audio|efect/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "playSound", text: "coin" });
  }
  if (/destru|desaparec|elimin/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "destroySelf" });
  }
  if (/ganar|victoria|meta/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "win" });
  }
  if (/perder|game over|morir/i.test(lower)) {
    blocks.push({ id: makeId(), kind: "lose" });
  }

  if (blocks.length === 0) {
    blocks.push({ id: makeId(), kind: "jump", value: 420 });
  }

  return [
    {
      id: makeId(),
      event,
      ...(withKind ? { withKind } : {}),
      ...(interval ? { interval } : {}),
      ...(key ? { key } : {}),
      blocks,
    },
  ];
}



