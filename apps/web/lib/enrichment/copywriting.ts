import { chatCompletion } from "@/lib/openrouter";
import type { ParsedLotProduct } from "@/lib/enrichment/productIdentity";
import {
  buildStorefrontDescriptionHtml,
  clampSeoDescription,
  clampSeoTitle,
} from "@/lib/listing/description";

export interface CopywritingResult {
  title: string;
  descriptionHtml: string;
  bulletPoints: string[];
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  productType?: string;
}

export async function generateCopywriting(input: {
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
- descriptionHtml: HTML riche FR-CA (2–4 <p>), vendeur, factuel. Structure:
  1) accroche bénéfice
  2) specs / usage
  3) si la source implique un lot liquidation: mention discrète "article d'occasion / testé selon disponibilité" — sinon neuf/retail tone
- bulletPoints: 4–6 bullets concrets (specs, usage, inclus, dimensions si connues).
- seoTitle: nom fabricant + complément FR ≤70 car.
- seoDescription: ≤155 car, accroche + bénéfice, sans jargon enchère.
- productType: catégorie Shopify courte EN ou FR (ex. "Furniture", "Electronics").
- tags: 5–12 tags (marque, catégorie, attributs). Inclus "brand:Marque" et "type:Catégorie".
- INTERDIT: Maxx, enchère, lot, pallet, liquidation comme argument de vente.

Réponds UNIQUEMENT en JSON: title, descriptionHtml, bulletPoints (array), seoTitle, seoDescription, tags (array), productType (string).`,
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
  const bullets = Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [];

  const brand = input.identity?.brand?.trim();
  const productType =
    typeof parsed.productType === "string" ? parsed.productType.trim() : "";

  let tags = Array.isArray(parsed.tags) ? parsed.tags.map(String) : [];
  if (brand && !tags.some((t) => t.toLowerCase().startsWith("brand:"))) {
    tags = [`brand:${brand}`, ...tags];
  }
  if (productType && !tags.some((t) => t.toLowerCase().startsWith("type:"))) {
    tags = [`type:${productType}`, ...tags];
  }

  const descriptionHtml = buildStorefrontDescriptionHtml({
    descriptionHtml: parsed.descriptionHtml ?? "",
    bulletPoints: bullets,
    title: input.manufacturerTitle,
    preWin: false,
  });

  return {
    title: input.manufacturerTitle,
    descriptionHtml,
    bulletPoints: bullets,
    seoTitle: clampSeoTitle(
      parsed.seoTitle?.includes(input.manufacturerTitle)
        ? parsed.seoTitle
        : input.manufacturerTitle
    ),
    seoDescription: clampSeoDescription(
      parsed.seoDescription ?? input.rawDescription ?? input.manufacturerTitle
    ),
    tags,
    productType: productType || undefined,
  };
}
