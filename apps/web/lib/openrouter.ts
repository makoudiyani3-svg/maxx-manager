const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type AiTask = "copywriting" | "market" | "imageRanking";

/** @deprecated use AiTask */
export type OpenRouterTask = AiTask;

const OPENROUTER_MODEL_BY_TASK: Record<AiTask, string> = {
  copywriting: process.env.OPENROUTER_MODEL_COPY ?? "google/gemini-2.5-flash",
  market: process.env.OPENROUTER_MODEL_MARKET ?? "deepseek/deepseek-chat-v3-0324",
  imageRanking: process.env.OPENROUTER_MODEL_VISION ?? "google/gemini-2.5-flash",
};

/** Gemini Flash — backup simple et peu cher */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/** Claude Haiku — optionnel si clé scoped à un workspace */
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";

type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      return `[image: ${part.image_url.url}]`;
    })
    .join("\n");
}

async function fetchImageInlinePart(
  url: string
): Promise<GeminiPart | { text: string }> {
  try {
    const { assertSafeExternalUrl } = await import("@/lib/urlSafety");
    assertSafeExternalUrl(url);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/*,*/*" },
    });
    if (!response.ok) {
      return { text: `[image fetch failed: ${url}]` };
    }
    const mime =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    if (!mime.startsWith("image/")) {
      return { text: `[not an image: ${url}]` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 4_500_000) {
      return { text: `[image too large: ${url}]` };
    }
    return {
      inlineData: {
        mimeType: mime,
        data: buffer.toString("base64"),
      },
    };
  } catch {
    return { text: `[image unreachable: ${url}]` };
  }
}

async function contentToGeminiParts(
  content: MessageContent
): Promise<GeminiPart[]> {
  if (typeof content === "string") return [{ text: content }];
  const parts: GeminiPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ text: part.text });
    } else {
      parts.push(await fetchImageInlinePart(part.image_url.url));
    }
  }
  return parts;
}

async function chatViaOpenRouter(
  task: AiTask,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number }
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const response = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Maxx Manager",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_BY_TASK[task],
      messages,
      temperature: options?.temperature ?? 0.7,
      ...(options?.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned empty content");
  return content;
}

async function chatViaGemini(
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content));

  if (options?.json) {
    systemParts.push("Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.");
  }

  const contents = [];
  for (const m of messages.filter((msg) => msg.role !== "system")) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: await contentToGeminiParts(m.content),
    });
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Continue." }] });
  }

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: systemParts.length
        ? { parts: [{ text: systemParts.join("\n\n") }] }
        : undefined,
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        ...(options?.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

async function chatViaAnthropic(
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content));

  if (options?.json) {
    systemParts.push("Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.");
  }

  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: contentToText(m.content),
    }));

  if (conversation.length === 0) {
    throw new Error("No messages to send to Anthropic");
  }
  if (conversation[0].role !== "user") {
    conversation.unshift({ role: "user", content: "Continue." });
  }

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  if (workspaceId) {
    headers["anthropic-workspace-id"] = workspaceId;
  }

  const response = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemParts.join("\n\n") || undefined,
      messages: conversation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("anthropic-workspace-id")) {
      throw new Error(
        "Clé Anthropic multi-workspace: créez une clé scoped à 1 workspace, ou utilisez GEMINI_API_KEY à la place."
      );
    }
    throw new Error(`Anthropic error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned empty content");
  return text;
}

/**
 * Ordre: pour vision (imageRanking + pixels) → Gemini d'abord.
 * Sinon: OpenRouter → Gemini → Anthropic.
 */
function messagesHaveImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === "image_url")
  );
}

export async function chatCompletion(
  task: AiTask,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number }
): Promise<string> {
  const errors: string[] = [];
  const needsVision = task === "imageRanking" && messagesHaveImages(messages);

  if (needsVision && process.env.GEMINI_API_KEY) {
    try {
      return await chatViaGemini(messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Gemini vision failed:", msg);
      errors.push(`Gemini: ${msg}`);
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      return await chatViaOpenRouter(task, messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("OpenRouter failed:", msg);
      errors.push(`OpenRouter: ${msg}`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      return await chatViaGemini(messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Gemini failed:", msg);
      errors.push(`Gemini: ${msg}`);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await chatViaAnthropic(messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Anthropic failed:", msg);
      errors.push(`Anthropic: ${msg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`All AI providers failed. ${errors.join(" | ")}`);
  }

  throw new Error(
    "Aucun fournisseur IA configuré. Ajoutez GEMINI_API_KEY (recommandé) ou OPENROUTER_API_KEY."
  );
}
