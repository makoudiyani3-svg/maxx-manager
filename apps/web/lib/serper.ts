const SERPER_BASE = "https://google.serper.dev";

export interface SerperImageResult {
  title: string;
  imageUrl: string;
  link: string;
}

export interface SerperShoppingResult {
  title: string;
  price: number;
  source: string;
  link: string;
}

export async function searchImages(query: string, count = 10): Promise<SerperImageResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${SERPER_BASE}/images`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: count,
      gl: "ca",
      hl: "en",
      imgsz: "l",
    }),
  });

  if (!response.ok) {
    console.error("Serper images error:", await response.text());
    return [];
  }

  const data = (await response.json()) as {
    images?: Array<{ title?: string; imageUrl?: string; link?: string }>;
  };

  return (data.images ?? [])
    .filter((img) => img.imageUrl)
    .map((img) => ({
      title: img.title ?? "",
      imageUrl: img.imageUrl!,
      link: img.link ?? "",
    }));
}

export interface SerperLensResult {
  titles: string[];
  knowledgeGraphTitle: string | null;
  rawSnippet: string;
}

/** Google Lens reverse image search via Serper (3 credits/query). */
export async function lensSearch(imageUrl: string): Promise<SerperLensResult | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(`${SERPER_BASE}/lens`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: imageUrl,
        gl: "ca",
        hl: "en",
      }),
    });

    if (!response.ok) {
      console.error("Serper lens error:", await response.text());
      return null;
    }

    const data = (await response.json()) as {
      knowledgeGraph?: { title?: string; type?: string; description?: string };
      organic?: Array<{ title?: string; link?: string; source?: string }>;
      visualMatches?: Array<{ title?: string; source?: string; link?: string }>;
    };

    const titles: string[] = [];
    if (data.knowledgeGraph?.title) titles.push(data.knowledgeGraph.title);
    if (data.knowledgeGraph?.type) titles.push(data.knowledgeGraph.type);
    if (data.knowledgeGraph?.description) titles.push(data.knowledgeGraph.description);
    for (const item of data.organic ?? []) {
      if (item.title) titles.push(item.title);
      if (item.source) titles.push(item.source);
    }
    for (const item of data.visualMatches ?? []) {
      if (item.title) titles.push(item.title);
      if (item.source) titles.push(item.source);
    }

    return {
      titles,
      knowledgeGraphTitle: data.knowledgeGraph?.title ?? null,
      rawSnippet: titles.slice(0, 12).join(" | "),
    };
  } catch (err) {
    console.warn("Serper lens failed:", err);
    return null;
  }
}

export async function searchShopping(
  query: string,
  count = 10
): Promise<SerperShoppingResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${SERPER_BASE}/shopping`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: count,
      gl: "ca",
      hl: "fr",
      location: "Quebec, Canada",
    }),
  });

  if (!response.ok) {
    console.error("Serper shopping error:", await response.text());
    return [];
  }

  const data = (await response.json()) as {
    shopping?: Array<{
      title?: string;
      price?: number;
      source?: string;
      link?: string;
    }>;
  };

  return (data.shopping ?? [])
    .filter((item) => typeof item.price === "number")
    .map((item) => ({
      title: item.title ?? "",
      price: item.price!,
      source: item.source ?? "",
      link: item.link ?? "",
    }));
}
