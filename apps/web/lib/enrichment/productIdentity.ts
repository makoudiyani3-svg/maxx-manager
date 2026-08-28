import { chatCompletion } from "@/lib/openrouter";

export interface ParsedLotProduct {
  /** Quantity in the Maxx lot (1 if single item) */
  lotQuantity: number;
  /** Exact manufacturer product name — NEVER translated */
  manufacturerTitle: string;
  brand: string;
  model: string;
  manufacturerDomain: string | null;
  /** Color / finish / variant as sold on Maxx (e.g. walnut, black, white) */
  color: string | null;
  /** Extra variant attributes (size, material) */
  attributes: string[];
  /** Search queries for the SINGLE unit, exact product + color photos */
  searchQueries: string[];
  /** Cost of one unit if lot price was given */
  unitCost: number | null;
}

/** Heuristic: strip leading lot counts like "3 ASUS..." or "10x ECOVACS..." */
export function stripLotPrefix(title: string): { quantity: number; remainder: string } {
  const cleaned = title.trim();
  const match = cleaned.match(
    /^(\d+)\s*[x×]?\s+(?:pk|pack|pcs?|pieces?|units?|lots?)?\s*[-–—:]?\s*(.+)$/i
  );
  if (match) {
    const qty = parseInt(match[1], 10);
    if (qty > 1 && qty < 10000) {
      return { quantity: qty, remainder: match[2].trim() };
    }
  }
  return { quantity: 1, remainder: cleaned };
}

const COLOR_WORDS =
  /\b(black|white|walnut|oak|espresso|brown|grey|gray|beige|cream|ivory|natural|cherry|mahogany|navy|blue|red|green|silver|gold|bronze|charcoal|taupe|rustic|light\s*wood|dark\s*wood|blonde|ash|maple|pine|slate|cognac|caramel|marble|oak\s*finish|espresso\s*finish)\b/i;

function heuristicColor(title: string, description?: string | null): string | null {
  const hay = `${title} ${description ?? ""}`;
  const m = hay.match(COLOR_WORDS);
  return m ? m[1].toLowerCase() : null;
}

function heuristicParse(
  rawTitle: string,
  rawPrice?: number | null,
  rawDescription?: string | null
): ParsedLotProduct {
  const { quantity, remainder } = stripLotPrefix(rawTitle);
  const brand = remainder.split(/\s+/)[0] ?? "Unknown";
  const color = heuristicColor(remainder, rawDescription);
  const colorSuffix = color ? ` ${color}` : "";
  return {
    lotQuantity: quantity,
    manufacturerTitle: remainder,
    brand,
    model: remainder,
    manufacturerDomain: null,
    color,
    attributes: color ? [color] : [],
    searchQueries: [
      `"${remainder}"${colorSuffix} official product`,
      `"${remainder}"${colorSuffix} product photo`,
      `${remainder}${colorSuffix} manufacturer packshot`,
      `"${remainder}"${colorSuffix} white background`,
      `${brand} ${remainder}${colorSuffix} exact product`,
    ],
    unitCost:
      rawPrice && quantity > 0
        ? Math.round((rawPrice / quantity) * 100) / 100
        : rawPrice ?? null,
  };
}

/**
 * Parse a Maxx lot title into a single manufacturer product identity.
 * Title stays in manufacturer naming (no translation). Color/finish preserved for image match.
 */
export async function parseLotToProduct(input: {
  rawTitle: string;
  rawDescription?: string | null;
  rawPrice?: number | null;
}): Promise<ParsedLotProduct> {
  const fallback = heuristicParse(input.rawTitle, input.rawPrice, input.rawDescription);

  try {
    const content = await chatCompletion(
      "copywriting",
      [
        {
          role: "system",
          content: `You parse liquidation LOT titles into a SINGLE retail product identity for exact photo matching.

Rules:
- If the title is a lot (e.g. "4 WROUGHT STUDIO LIENA DINING TABLES"), extract the SINGLE unit product.
- manufacturerTitle = exact manufacturer product name in ORIGINAL language. DO NOT translate. No lot quantity.
- color = finish/color of the item AS SOLD on the listing if known (walnut, black, white oak…). null if unknown.
- attributes = other variant clues (size 47", 5-tier, folding…).
- searchQueries MUST include the exact product name AND color/finish when known, for Google Images of THAT exact SKU/variant. Never auctions, never maxx, never wrong colors.
- unitCost = lot price / lotQuantity when lotQuantity > 1.

Respond ONLY valid JSON:
{
  "lotQuantity": number,
  "manufacturerTitle": "exact manufacturer name, not translated",
  "brand": "brand",
  "model": "model/series",
  "manufacturerDomain": "wayfair.com or brand.com or null",
  "color": "walnut|black|null",
  "attributes": ["47 inch", "..."],
  "searchQueries": ["5-8 English Google Images queries for EXACT product+color photos"],
  "unitCost": number or null
}`,
        },
        {
          role: "user",
          content: JSON.stringify({
            lotTitle: input.rawTitle,
            description: (input.rawDescription ?? "").slice(0, 1200),
            lotPriceCad: input.rawPrice ?? null,
          }),
        },
      ],
      { json: true, temperature: 0.1 }
    );

    const parsed = JSON.parse(content) as Partial<ParsedLotProduct>;
    const lotQuantity =
      typeof parsed.lotQuantity === "number" && parsed.lotQuantity > 0
        ? parsed.lotQuantity
        : fallback.lotQuantity;

    const manufacturerTitle =
      (parsed.manufacturerTitle || fallback.manufacturerTitle).trim() ||
      fallback.manufacturerTitle;

    const color =
      (parsed.color && parsed.color !== "null" ? parsed.color : null) ||
      fallback.color;

    let unitCost = parsed.unitCost ?? null;
    if (
      (unitCost == null || unitCost <= 0) &&
      input.rawPrice &&
      lotQuantity > 0
    ) {
      unitCost = Math.round((input.rawPrice / lotQuantity) * 100) / 100;
    }

    const colorPart = color ? ` ${color}` : "";
    const defaultQueries = [
      `"${manufacturerTitle}"${colorPart} product photo`,
      `"${manufacturerTitle}"${colorPart} official`,
      `"${manufacturerTitle}"${colorPart} packshot`,
      `${parsed.brand || fallback.brand} ${parsed.model || ""}${colorPart} dining table product`.trim(),
      `"${manufacturerTitle}"${colorPart} white background`,
      color
        ? `"${manufacturerTitle}" ${color} finish`
        : `"${manufacturerTitle}" manufacturer image`,
    ];

    return {
      lotQuantity,
      manufacturerTitle,
      brand: parsed.brand || fallback.brand,
      model: parsed.model || manufacturerTitle,
      manufacturerDomain: parsed.manufacturerDomain || null,
      color,
      attributes: parsed.attributes?.length
        ? parsed.attributes
        : fallback.attributes,
      searchQueries:
        parsed.searchQueries?.length && parsed.searchQueries.length >= 3
          ? parsed.searchQueries
          : defaultQueries,
      unitCost,
    };
  } catch (err) {
    console.warn("parseLotToProduct fallback:", err);
    return fallback;
  }
}
