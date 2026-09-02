const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type AiTask = "copywriting" | "market" | "imageRanking" | "identity";

/** @deprecated use AiTask */
export type OpenRouterTask = AiTask;

const OPENROUTER_MODEL_BY_TASK: Record<AiTask, string> = {
  copywriting: process.env.OPENROUTER_MODEL_COPY ?? "google/gemini-2.5-flash",
  market: process.env.OPENROUTER_MODEL_MARKET ?? "deepseek/deepseek-chat-v3-0324",
  imageRanking: process.env.OPENROUTER_MODEL_VISION ?? "google/gemini-2.5-flash",
  identity: process.env.OPENROUTER_MODEL_COPY ?? "google/gemini-2.5-flash",
};

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Claude Sonnet — primary when ANTHROPIC_API_KEY is set */
const ANTHROPIC_MODEL_DEFAULT =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const ANTHROPIC_MODEL_BY_TASK: Record<AiTask, string> = {
  copywriting:
    process.env.ANTHROPIC_MODEL_COPY ?? ANTHROPIC_MODEL_DEFAULT,
  market: process.env.ANTHROPIC_MODEL_MARKET ?? ANTHROPIC_MODEL_DEFAULT,
  imageRanking:
    process.env.ANTHROPIC_MODEL_VISION ?? ANTHROPIC_MODEL_DEFAULT,
  identity:
    process.env.ANTHROPIC_MODEL_IDENTITY ?? ANTHROPIC_MODEL_DEFAULT,
};

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      return `[image: ${part.image_url.url}]`;
    })
    .join("\n");
}

function messagesHaveImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === "image_url")
  );
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isAnyAiConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY
  );
}

async function fetchImageBase64(
  url: string
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const { assertSafeExternalUrl } = await import("@/lib/urlSafety");
    assertSafeExternalUrl(url);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/*,*/*" },
    });
    if (!response.ok) return null;
    const mime =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 4_500_000) return null;
    return { mimeType: mime, data: buffer.toString("base64") };
  } catch {
    return null;
  }
}

async function fetchImageInlinePart(
  url: string
): Promise<GeminiPart | { text: string }> {
  const img = await fetchImageBase64(url);
  if (!img) return { text: `[image unreachable: ${url}]` };
  return {
    inlineData: { mimeType: img.mimeType, data: img.data },
  };
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

async function contentToAnthropicBlocks(
  content: MessageContent
): Promise<AnthropicContentBlock[]> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    const img = await fetchImageBase64(part.image_url.url);
    if (img) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType,
          data: img.data,
        },
      });
    } else {
      blocks.push({ type: "text", text: `[image unreachable: ${part.image_url.url}]` });
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
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
    throw new Error(
      `OpenRouter error (${response.status}): ${await response.text()}`
    );
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
    systemParts.push(
      "Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour."
    );
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
  task: AiTask,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content));

  if (options?.json) {
    systemParts.push(
      "Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour."
    );
  }

  const conversation: Array<{
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }> = [];

  for (const m of messages.filter((msg) => msg.role !== "system")) {
    const role = m.role as "user" | "assistant";
    if (Array.isArray(m.content) && messagesHaveImages([m])) {
      conversation.push({
        role,
        content: await contentToAnthropicBlocks(m.content),
      });
    } else {
      conversation.push({
        role,
        content: contentToText(m.content),
      });
    }
  }

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

  const maxTokens =
    options?.maxTokens ??
    (task === "copywriting" ? 8192 : task === "imageRanking" ? 2048 : 4096);

  const response = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: ANTHROPIC_MODEL_BY_TASK[task],
      max_tokens: maxTokens,
      temperature: options?.temperature ?? 0.7,
      system: systemParts.join("\n\n") || undefined,
      messages: conversation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("anthropic-workspace-id")) {
      throw new Error(
        "Clé Anthropic multi-workspace: créez une clé scoped à 1 workspace (Console Anthropic)."
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
 * Maximize quality when Claude is configured:
 * - Text (copy / market / identity): Anthropic → OpenRouter → Gemini
 * - Vision (imageRanking): Anthropic (vision) → Gemini → OpenRouter
 */
export async function chatCompletion(
  task: AiTask,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number; maxTokens?: number }
): Promise<string> {
  const errors: string[] = [];
  const needsVision = task === "imageRanking" && messagesHaveImages(messages);
  const preferAnthropic =
    process.env.AI_PRIMARY !== "openrouter" &&
    process.env.AI_PRIMARY !== "gemini" &&
    Boolean(process.env.ANTHROPIC_API_KEY);

  const tryAnthropic = async () => {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    try {
      return await chatViaAnthropic(task, messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Anthropic failed:", msg);
      errors.push(`Anthropic: ${msg}`);
      return null;
    }
  };

  const tryOpenRouter = async () => {
    if (!process.env.OPENROUTER_API_KEY) return null;
    try {
      return await chatViaOpenRouter(task, messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("OpenRouter failed:", msg);
      errors.push(`OpenRouter: ${msg}`);
      return null;
    }
  };

  const tryGemini = async () => {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
      return await chatViaGemini(messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Gemini failed:", msg);
      errors.push(`Gemini: ${msg}`);
      return null;
    }
  };

  if (preferAnthropic) {
    const first = await tryAnthropic();
    if (first) return first;
  }

  // Vision: Gemini is a strong cheap backup after Claude
  if (needsVision && process.env.GEMINI_API_KEY) {
    const gem = await tryGemini();
    if (gem) return gem;
  }

  if (!preferAnthropic) {
    const claude = await tryAnthropic();
    if (claude) return claude;
  }

  const or = await tryOpenRouter();
  if (or) return or;

  if (!needsVision) {
    const gem = await tryGemini();
    if (gem) return gem;
  }

  if (errors.length > 0) {
    throw new Error(`All AI providers failed. ${errors.join(" | ")}`);
  }

  throw new Error(
    "Aucun fournisseur IA configuré. Ajoutez ANTHROPIC_API_KEY (recommandé), GEMINI_API_KEY ou OPENROUTER_API_KEY."
  );
}
