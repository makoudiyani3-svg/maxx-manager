import { chatCompletion } from "@/lib/openrouter";
import { searchShopping } from "@/lib/serper";
import {
  computeDealMath,
  type DealMathResult,
} from "@/lib/enrichment/pricing";

export interface MarketAnalysis {
  competitorPrices: number[];
  suggestedPrice: number;
  marginPercent: number;
  demandScore: number;
  competitionLevel: "low" | "medium" | "high";
  recommendation: "publish" | "review" | "skip";
  summary: string;
  unitCost?: number;
  lotQuantity?: number;
  deal?: DealMathResult;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export async function runMarketAnalysis(input: {
  title: string;
  unitCost?: number;
  lotQuantity?: number;
  lotPrice?: number;
  articlesInWeek?: number;
}): Promise<MarketAnalysis> {
  const shoppingResults = await searchShopping(input.title, 10);
  const competitorPrices = shoppingResults
    .map((r) => r.price)
    .filter((p) => p > 0);

  const content = await chatCompletion(
    "market",
    [
      {
        role: "system",
        content: `Tu es analyste e-commerce Québec/Canada pour un revendeur liquidation.
Analyse UN SEUL article (pas le lot).
suggestedPrice = prix de vente Shopify concurrentiel pour 1 unité (ancré sur le marché, souvent un peu sous la médiane).
Marge cible du business: 100% sur le coût landed (vente ≥ 2× coût) — tu proposes le prix marché; le système calcule le plafond d'enchère à part.
Réponds UNIQUEMENT en JSON: competitorPrices (number[]), suggestedPrice (number), marginPercent (number), demandScore (1-10), competitionLevel ("low"|"medium"|"high"), recommendation ("publish"|"review"|"skip"), summary (français court).`,
      },
      {
        role: "user",
        content: JSON.stringify({
          produit_unitaire: input.title,
          cout_unitaire_estime_avant_transport: input.unitCost,
          quantite_lot_source: input.lotQuantity ?? 1,
          prix_lot_source: input.lotPrice,
          prix_concurrents_trouves: competitorPrices,
          mediane_marche: median(competitorPrices),
          resultats_shopping: shoppingResults.slice(0, 5),
        }),
      },
    ],
    { json: true, temperature: 0.3 }
  );

  const parsed = JSON.parse(content) as MarketAnalysis;

  if (
    competitorPrices.length > 0 &&
    (!parsed.competitorPrices || parsed.competitorPrices.length === 0)
  ) {
    parsed.competitorPrices = competitorPrices;
  }

  const marketMedian = median(competitorPrices);
  if (!parsed.suggestedPrice || parsed.suggestedPrice <= 0) {
    if (marketMedian) {
      // Slightly under median for competitiveness
      parsed.suggestedPrice = Math.round(marketMedian * 0.92 * 100) / 100;
    } else if (input.unitCost) {
      parsed.suggestedPrice = Math.round(input.unitCost * 2.2 * 100) / 100;
    } else {
      parsed.suggestedPrice = 0;
    }
  }

  const lotQuantity = input.lotQuantity ?? 1;
  const articlesInWeek = Math.max(1, input.articlesInWeek ?? 1);

  const deal = computeDealMath({
    sellPrice: parsed.suggestedPrice,
    lotQuantity,
    articlesInWeek,
    currentBidLot: input.lotPrice,
  });

  parsed.deal = deal;
  parsed.unitCost = deal.unitLandedAtMaxBid;
  parsed.lotQuantity = lotQuantity;

  // Margin vs landed-at-max-bid (target ~100%+)
  parsed.marginPercent = deal.markupAtMaxBidPercent;

  if (!deal.isViable) {
    parsed.recommendation = "skip";
    parsed.summary = [
      parsed.summary,
      deal.skipReason,
      `Plafond enchère lot: ${deal.maxBidLot.toFixed(2)} $`,
    ]
      .filter(Boolean)
      .join(" — ");
  } else if (parsed.recommendation === "skip") {
    // keep AI skip
  } else {
    parsed.recommendation = "publish";
    parsed.summary = [
      parsed.summary,
      `Max enchère lot ${deal.maxBidLot.toFixed(2)} $ (unité ${deal.maxBidUnit.toFixed(2)} $)`,
      `Transport ${deal.transportPerArticle.toFixed(2)} $/article (${deal.articlesInWeek} art. × event)`,
      `Premium enchère +${Math.round(deal.premiumRate * 100)}%`,
    ].join(" · ");
  }

  return parsed;
}
