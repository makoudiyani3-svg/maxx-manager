import { chatCompletion } from "@/lib/openrouter";
import type { ParsedLotProduct } from "@/lib/enrichment/productIdentity";

export interface CopywritingResult {
  title: string;
  descriptionHtml: string;
  bulletPoints: string[];
  seoTitle: string;
  seoDescription: string;
  tags: string[];
}

export async function generateCopywriting(input: {
  /** Exact manufacturer title — do not translate */
  manufacturerTitle: string;
  rawDescription?: string;
  unitCost?: number;
  lotQuantity?: number;
  identity?: ParsedLotProduct;
}): Promise<CopywritingResult> {
  const content = await chatCompletion(
    "copywriting",
    [
      {
        role: "system",
        content: `Tu es copywriter e-commerce senior pour UNIT411 (revente Canada / Québec).

RÈGLES STRICTES:
- "title" = le nom EXACT du fabricant fourni (manufacturerTitle). NE PAS traduire, NE PAS inventer, NE PAS préfixer avec une quantité de lot.
- descriptionHtml: HTML riche (2–4 <p>, éventuellement <ul>), FR-CA, vendeur, factuel. Mentionne état usagé/testé SEULEMENT si implicite dans la source. Pas de jargon Maxx/enchères.
- bulletPoints: 4–6 bullets concrets (specs, usage, inclus).
- seoTitle: nom fabricant + complément FR ≤70 car.
- seoDescription: ≤155 car, accroche + bénéfice.
- tags: 5–12 tags Shopify (marque, catégorie, attributs).
Réponds UNIQUEMENT en JSON: title, descriptionHtml, bulletPoints (array), seoTitle, seoDescription, tags (array).`,
      },
      {
        role: "user",
        content: JSON.stringify({
          manufacturerTitle: input.manufacturerTitle,
          brand: input.identity?.brand,
          model: input.identity?.model,
          color: input.identity?.color,
          attributes: input.identity?.attributes,
          description_source: input.rawDescription ?? "",
          unitCostCad: input.unitCost,
          note:
            input.lotQuantity && input.lotQuantity > 1
              ? `Source était un lot de ${input.lotQuantity}; fiche = 1 unité`
              : "Produit unitaire",
        }),
      },
    ],
    { json: true, temperature: 0.45, maxTokens: 8192 }
  );

  const parsed = JSON.parse(content) as CopywritingResult;

  // Force manufacturer title — never trust AI translation for the title field
  return {
    title: input.manufacturerTitle,
    descriptionHtml: parsed.descriptionHtml ?? "",
    bulletPoints: parsed.bulletPoints ?? [],
    seoTitle: parsed.seoTitle?.includes(input.manufacturerTitle)
      ? parsed.seoTitle
      : input.manufacturerTitle.slice(0, 70),
    seoDescription: parsed.seoDescription ?? "",
    tags: parsed.tags ?? [],
  };
}
