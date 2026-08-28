import { chatCompletion } from "@/lib/openrouter";
import { lensSearch } from "@/lib/serper";
import type { ParsedLotProduct } from "@/lib/enrichment/productIdentity";
import type { ImageProbeResult } from "@/lib/enrichment/images";

type Candidate = ImageProbeResult & { source: "manufacturer" | "serper" };

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
    const hasBrand =
      brand.length > 2 && haystack.includes(brand);
    if (!hasBrand) {
      return { score: -100, decision: "reject" };
    }
  }

  let hits = 0;
  for (const token of tokens.slice(0, 12)) {
    if (haystack.includes(token)) hits += 1;
  }

  const brandHit = brand.length > 2 && haystack.includes(brand);
  if (brandHit && hits >= 2) {
    return { score: 80 + hits * 5, decision: "keep" };
  }
  if (brandHit && hits >= 1) {
    return { score: 40, decision: "unsure" };
  }
  if (hits === 0 && !brandHit) {
    return { score: -50, decision: "reject" };
  }
  return { score: hits * 10, decision: "unsure" };
}

async function filterWithLens(
  candidates: Candidate[],
  identity: ParsedLotProduct
): Promise<{ kept: Candidate[]; rejected: number }> {
  if (!process.env.SERPER_API_KEY || candidates.length === 0) {
    return { kept: candidates, rejected: 0 };
  }

  // Cap Lens calls (3 credits each) — verify the strongest candidates first
  const toCheck = candidates.slice(0, 10);
  const unchecked = candidates.slice(10);

  const results = await Promise.all(
    toCheck.map(async (img) => {
      const lens = await lensSearch(img.url);
      const scored = scoreLensAgainstProduct(lens, identity);
      return { img, scored };
    })
  );

  const kept: Candidate[] = [];
  let rejected = 0;
  for (const row of results) {
    if (row.scored.decision === "reject") {
      rejected += 1;
      continue;
    }
    kept.push(row.img);
  }

  // Unchecked leftovers still go to vision
  kept.push(...unchecked);

  if (kept.length === 0 && candidates.length > 0) {
    return { kept: candidates, rejected: 0 };
  }

  return { kept, rejected };
}

/**
 * True visual check: the model receives the actual image pixels (not just URLs).
 */
async function filterWithVision(
  candidates: Candidate[],
  identity: ParsedLotProduct
): Promise<Candidate[]> {
  if (candidates.length === 0) return [];
  if (
    !process.env.OPENROUTER_API_KEY &&
    !process.env.GEMINI_API_KEY
  ) {
    return candidates;
  }

  const batch = candidates.slice(0, 10);
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: `Verify each product photo for Shopify listing.

REQUIRED PRODUCT (exact):
- title: ${identity.manufacturerTitle}
- brand: ${identity.brand}
- model: ${identity.model}
- color/finish: ${identity.color ?? "unknown"}

For EACH image below (1..${batch.length}), decide if it is a usable packshot/lifestyle of THIS exact product.

KEEP only if the photo clearly shows this product (same brand/model). Color must match when specified.
REJECT: scenery/nature/roads, unrelated objects, wrong model, wrong color, auction lots, pallets, heavy collages/ads with many unrelated SKUs, logos-only, text posters without the unit.

Return JSON only:
{ "results": [ { "index": 1, "match": "exact"|"reject", "reason": "short" } ] }`,
    },
  ];

  for (let i = 0; i < batch.length; i++) {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({
      type: "image_url",
      image_url: { url: batch[i].url },
    });
  }

  try {
    const raw = await chatCompletion(
      "imageRanking",
      [
        {
          role: "system",
          content:
            "You are a strict visual QA for e-commerce product photos. You LOOK at each image. Prefer rejecting doubtful photos. JSON only.",
        },
        { role: "user", content },
      ],
      { json: true, temperature: 0 }
    );

    const parsed = JSON.parse(raw) as {
      results?: Array<{ index?: number; match?: string }>;
      keepIndices?: number[];
    };

    if (Array.isArray(parsed.keepIndices)) {
      return parsed.keepIndices
        .map((idx) => batch[idx - 1])
        .filter(Boolean);
    }

    const results = parsed.results ?? [];
    const kept = results
      .filter((r) => String(r.match).toLowerCase() === "exact")
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((r) => batch[(r.index ?? 0) - 1])
      .filter(Boolean);

    return kept;
  } catch (err) {
    console.warn("Vision image verify failed:", err);
    // Do not ship unverified photos when vision QA fails
    return [];
  }
}

/**
 * Pipeline: Google Lens reverse-search → multimodal vision QA.
 * Better few correct photos than many wrong ones.
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
    new Map(candidates.map((c) => [c.url, c])).values()
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
      process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY
    ),
  };
}
