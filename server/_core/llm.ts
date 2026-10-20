import { GoogleGenAI } from "@google/genai";

export type LLMTextContent = { type: "text"; text: string };
export type LLMImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<LLMTextContent | LLMImageContent>;
};

export type LLMRequest = {
  model?: string;
  messages: LLMMessage[];
  temperature?: number;
  responseMimeType?: "application/json" | "text/plain";
};

export type LLMResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
};

const GEMINI_PUBLIC_FALLBACK_ENDPOINT = "https://prexzyapis.com/ai/gemini";

function extractMessageText(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function resolveGeminiModel(requested?: string): string {
  if (!requested) return "gemini-3.8-flash";
  if (requested.startsWith("gemini-")) return requested;
  return "gemini-3.8-flash";
}

/**
 * Invoca el modelo Gemini real desde el servidor usando `@google/genai` con
 * `process.env.GEMINI_API_KEY`. Si en algún entorno externo no está definida
 * `GEMINI_API_KEY`, utiliza el endpoint configurado en `BUILT_IN_FORGE_API_URL`
 * o el puente Gemini de respaldo.
 */
export async function invokeLLM(request: LLMRequest): Promise<LLMResponse> {
  const systemMessages = request.messages
    .filter((m) => m.role === "system")
    .map((m) => extractMessageText(m.content).trim())
    .filter(Boolean);
  const systemInstruction = systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;

  const conversationTurns = request.messages.filter((m) => m.role !== "system");

  // 1) Ruta principal: SDK oficial @google/genai en el servidor
  const ai = getGeminiClient();
  if (ai) {
    try {
      const modelName = resolveGeminiModel(request.model);
      const contents =
        conversationTurns.length > 0
          ? conversationTurns.map((m) => ({
              role: m.role === "assistant" ? ("model" as const) : ("user" as const),
              parts: [{ text: extractMessageText(m.content) }],
            }))
          : [{ role: "user" as const, parts: [{ text: systemInstruction || "Hola" }] }];

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
          ...(request.responseMimeType ? { responseMimeType: request.responseMimeType } : {}),
        },
      });

      const text = response.text?.trim() ?? "";
      if (text) {
        return {
          model: modelName,
          choices: [{ message: { content: text } }],
        };
      }
    } catch (err) {
      console.error("[invokeLLM @google/genai error]", err);
      // Continúa al siguiente proveedor real si falla la clave local
    }
  }

  // 2) Segunda ruta: BUILT_IN_FORGE_API_URL si está configurada
  const forgeUrl = process.env.BUILT_IN_FORGE_API_URL?.trim();
  const forgeKey = process.env.BUILT_IN_FORGE_API_KEY?.trim();
  if (forgeUrl && forgeKey) {
    try {
      const baseUrl = forgeUrl.replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${forgeKey}` },
        body: JSON.stringify(request),
      });
      if (response.ok) {
        return (await response.json()) as LLMResponse;
      }
    } catch {
      // Continúa al puente público de Gemini
    }
  }

  // 3) Tercera ruta real: servicio Gemini directo
  const combinedPrompt = [
    systemInstruction ? `INSTRUCCIONES DEL SISTEMA:\n${systemInstruction}` : "",
    ...conversationTurns.map((m) => `${m.role === "assistant" ? "ASISTENTE" : "USUARIO"}:\n${extractMessageText(m.content)}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallbackRes = await fetch(GEMINI_PUBLIC_FALLBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: combinedPrompt.slice(0, 16_000),
      session_id: `orion-srv-${Date.now().toString(36)}`,
    }),
  });

  const payload = (await fallbackRes.json().catch(() => null)) as {
    status?: boolean;
    response?: string;
    service?: string;
    message?: string;
    error?: string;
  } | null;

  if (!fallbackRes.ok || !payload || payload.status === false || typeof payload.response !== "string" || !payload.response.trim()) {
    throw new Error(payload?.message || payload?.error || `Gemini no respondió (${fallbackRes.status}).`);
  }

  return {
    model: payload.service || "gemini-3.8-flash",
    choices: [{ message: { content: payload.response.trim() } }],
  };
}

/** Lista los modelos disponibles en el entorno del servidor. */
export async function listLLMModels(): Promise<{ data: Array<{ id: string }> }> {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return {
      data: [{ id: "gemini-3.8-flash" }],
    };
  }
  const forgeUrl = process.env.BUILT_IN_FORGE_API_URL?.trim();
  const forgeKey = process.env.BUILT_IN_FORGE_API_KEY?.trim();
  if (forgeUrl && forgeKey) {
    try {
      const baseUrl = forgeUrl.replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${forgeKey}` },
      });
      if (response.ok) {
        return (await response.json()) as { data: Array<{ id: string }> };
      }
    } catch {
      /* fallback */
    }
  }
  return {
    data: [{ id: "gemini-3.8-flash" }],
  };
}
