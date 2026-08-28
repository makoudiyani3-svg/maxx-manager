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
        content: `Tu es copywriter e-commerce.
RÈGLES STRICTES:
- "title" = le nom EXACT du fabricant fourni (manufacturerTitle). NE PAS traduire, NE PAS inventer, NE PAS préfixer avec une quantité de lot.
- descriptionHtml, seoDescription, bulletPoints: français canadien OK.
- seoTitle peut garder le nom fabricant + un complément FR court.
- Ne parle PAS du lot Maxx / enchères / liquidation dans le titre.
Réponds UNIQUEMENT en JSON: title, descriptionHtml, bulletPoints (array), seoTitle, seoDescription, tags (array).`,
      },
      {
        role: "user",
        content: JSON.stringify({
          manufacturerTitle: input.manufacturerTitle,
          brand: input.identity?.brand,
          model: input.identity?.model,
          description_source: input.rawDescription ?? "",
          unitCostCad: input.unitCost,
          note:
            input.lotQuantity && input.lotQuantity > 1
              ? `Source était un lot de ${input.lotQuantity}; fiche = 1 unité`
              : "Produit unitaire",
        }),
      },
    ],
    { json: true, temperature: 0.4 }
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
