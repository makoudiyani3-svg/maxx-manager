import { chatCompletion } from "@/lib/openrouter";
import { lensSearch } from "@/lib/serper";
import type { ParsedLotProduct } from "@/lib/enrichment/productIdentity";
import type { ImageProbeResult } from "@/lib/enrichment/images";
import { validateImages } from "@/lib/enrichment/images";
import { scrapeProductPageGallery } from "@/lib/enrichment/manufacturerImages";

export type ProductImageCandidate = ImageProbeResult & {
  source: "manufacturer" | "serper" | "lens";
};

type Candidate = ProductImageCandidate;

const UNRELATED_LENS_TERMS = [
  "landscape",
  "nature",
  "forest",
  "road",
  "highway",
  "scenic",
  "mountain",
  "beach",
  "sunset",
  "wallpaper",
  "stock photo",
  "abstract",
  "meme",
  "cartoon",
  "clipart",
  "power a new world",
  "banner",
  "hero image",
];

const BLOCKED_URL_HINTS = [
  "logo",
  "icon",
  "sprite",
  "banner",
  "placeholder",
  "avatar",
  "unsplash",
  "shutterstock",
  "gettyimages",
  "dreamstime",
  "wallpaper",
  "istockphoto",
];

function identityTokens(identity: ParsedLotProduct): string[] {
  return [
    identity.brand,
    ...identity.model.split(/[\s\-_/]+/),
    ...identity.manufacturerTitle.split(/[\s\-_/]+/),
  ]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

function isBlockedImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_URL_HINTS.some((h) => lower.includes(h));
}

/** Score Lens reverse-search titles against the exact product. */
export function scoreLensAgainstProduct(
  lens: { titles: string[]; knowledgeGraphTitle: string | null } | null,
  identity: ParsedLotProduct
): { score: number; decision: "keep" | "reject" | "unsure" } {
  if (!lens || lens.titles.length === 0) {
    return { score: 0, decision: "unsure" };
  }

  const haystack = lens.titles.join(" ").toLowerCase();
  const tokens = [...new Set(identityTokens(identity))];
  const brand = identity.brand.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (UNRELATED_LENS_TERMS.some((t) => haystack.includes(t))) {
    if (!(brand.length > 2 && haystack.includes(brand))) {
      return { score: -100, decision: "reject" };
    }
  }

  let hits = 0;
  for (const token of tokens.slice(0, 12)) {
    if (haystack.includes(token)) hits += 1;
  }

  const brandHit = brand.length > 2 && haystack.includes(brand);
  const modelTokens = identity.model
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .filter((t) => t.length > 2);
  const modelHit = modelTokens.some((t) =>
    haystack.includes(t.replace(/[^a-z0-9]/g, ""))
  );

  if (brandHit && (hits >= 2 || modelHit)) {
    return { score: 80 + hits * 5, decision: "keep" };
  }
  if (hits === 0 && !brandHit) {
    return { score: -50, decision: "reject" };
  }
  return { score: hits * 10, decision: "unsure" };
}

async function fetchOgImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MaxxManager/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const og =
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    return og?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Use a Maxx lot photo with Google Lens to find the real product page + image.
 * Does NOT publish the Maxx photo — only uses it as a visual probe.
 */
export async function findImagesFromMaxxReference(
  maxxImageUrls: string[],
  identity: ParsedLotProduct
): Promise<Candidate[]> {
  if (!process.env.SERPER_API_KEY || maxxImageUrls.length === 0) return [];

  const probeUrl = maxxImageUrls.find((u) => !isBlockedImageUrl(u));
  if (!probeUrl) return [];

  const apiKey = process.env.SERPER_API_KEY;
  const response = await fetch("https://google.serper.dev/lens", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ url: probeUrl, gl: "ca", hl: "en" }),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    organic?: Array<{ link?: string; title?: string }>;
    visualMatches?: Array<{ link?: string; title?: string }>;
  };

  const scored = scoreLensAgainstProduct(
    {
      titles: [
        ...(data.organic ?? []).flatMap((i) => [i.title ?? "", i.link ?? ""]),
        ...(data.visualMatches ?? []).flatMap((i) => [i.title ?? "", i.link ?? ""]),
      ],
      knowledgeGraphTitle: null,
    },
    identity
  );
  if (scored.decision === "reject") return [];

  const brand = identity.brand.toLowerCase();
  const pageUrls: string[] = [];

  for (const item of [...(data.organic ?? []), ...(data.visualMatches ?? [])]) {
    const link = item.link ?? "";
    const title = (item.title ?? "").toLowerCase();
    if (!link.startsWith("http")) continue;
    if (link.includes("maxx.ca") || link.includes("pinterest")) continue;
    const linkLower = link.toLowerCase();
    const matchesBrand =
      linkLower.includes(brand) ||
      title.includes(brand) ||
      identityTokens(identity).some(
        (t) => title.includes(t) || linkLower.includes(t)
      );
    if (matchesBrand) pageUrls.push(link);
  }

  const imageUrls: string[] = [];
  for (const page of [...new Set(pageUrls)].slice(0, 5)) {
    const gallery = await scrapeProductPageGallery(page);
    imageUrls.push(...gallery);
    if (gallery.length === 0) {
      const og = await fetchOgImage(page);
      if (og && !isBlockedImageUrl(og)) imageUrls.push(og);
    }
  }

  const probed = await validateImages([...new Set(imageUrls)].slice(0, 20));
  return probed.map((img) => ({ ...img, source: "lens" as const }));
}

async function verifySingleImageWithVision(
  img: Candidate,
  identity: ParsedLotProduct
): Promise<"exact" | "close" | "reject"> {
  try {
    const raw = await chatCompletion(
      "imageRanking",
      [
        {
          role: "system",
          content:
            "Strict e-commerce photo QA. You SEE the image pixels. JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Classify this image for the product listing.

Product: ${identity.manufacturerTitle}
Brand: ${identity.brand}
Model: ${identity.model}
Color/finish: ${identity.color ?? "unknown"}

exact = main subject is this exact SKU/model (and color if known).
close = same model/brand but color/angle uncertain OR minor packaging differences — only if model clearly matches.
reject = wrong product, scenery, collage, logo-only, lot/pallet.

Reply JSON: {"match":"exact"|"close"|"reject","reason":"short"}`,
            },
            { type: "image_url", image_url: { url: img.url } },
          ],
        },
      ],
      { json: true, temperature: 0 }
    );

    const parsed = JSON.parse(raw) as { match?: string };
    const match = String(parsed.match).toLowerCase();
    if (match === "exact") return "exact";
    if (match === "close") return "close";
    return "reject";
  } catch {
    return "reject";
  }
}

async function filterWithLens(
  candidates: Candidate[],
  identity: ParsedLotProduct
): Promise<{ kept: Candidate[]; rejected: number }> {
  if (!process.env.SERPER_API_KEY || candidates.length === 0) {
    return { kept: candidates, rejected: 0 };
  }

  const results = await Promise.all(
    candidates.slice(0, 12).map(async (img) => {
      if (isBlockedImageUrl(img.url)) {
        return { img, reject: true };
      }
      const lens = await lensSearch(img.url);
      const scored = scoreLensAgainstProduct(lens, identity);
      return { img, reject: scored.decision === "reject" };
    })
  );

  const kept: Candidate[] = [];
  let rejected = 0;
  for (const row of results) {
    if (row.reject) rejected += 1;
    else kept.push(row.img);
  }

  return { kept, rejected };
}

async function filterWithVision(
  candidates: Candidate[],
  identity: ParsedLotProduct
): Promise<Candidate[]> {
  if (candidates.length === 0) return [];

  const hasVision =
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY);
  if (!hasVision) {
    return [];
  }

  const exact: Candidate[] = [];
  const close: Candidate[] = [];
  const batch = candidates.slice(0, 10);

  // Parallel batches of 3 for speed
  for (let i = 0; i < batch.length; i += 3) {
    const chunk = batch.slice(i, i + 3);
    const verdicts = await Promise.all(
      chunk.map((img) => verifySingleImageWithVision(img, identity))
    );
    chunk.forEach((img, idx) => {
      const v = verdicts[idx];
      if (v === "exact") exact.push(img);
      else if (v === "close") close.push(img);
    });
  }

  // Prefer exact; allow close only to fill gallery / when color unknown
  if (exact.length >= 3) return exact;
  if (identity.color) {
    // Color known: only exact unless we have almost none
    return exact.length > 0 ? exact : close.slice(0, 3);
  }
  return [...exact, ...close];
}

/**
 * Pipeline: Lens pre-filter → per-image Gemini vision QA.
 * Never falls back to unverified images.
 */
export async function verifyProductImages(
  candidates: Candidate[],
  identity: ParsedLotProduct
): Promise<{
  images: Candidate[];
  lensRejected: number;
  visionUsed: boolean;
}> {
  const unique = Array.from(
    new Map(
      candidates
        .filter((c) => !isBlockedImageUrl(c.url))
        .map((c) => [c.url, c])
    ).values()
  );

  const { kept: afterLens, rejected: lensRejected } = await filterWithLens(
    unique,
    identity
  );

  const afterVision = await filterWithVision(afterLens, identity);

  return {
    images: afterVision,
    lensRejected,
    visionUsed: Boolean(
      process.env.ANTHROPIC_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.OPENROUTER_API_KEY
    ),
  };
}
