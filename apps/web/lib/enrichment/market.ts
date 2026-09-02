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

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s\-]/gi, " ")
    .split(/[\s\-_\/]+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

function titleOverlapScore(resultTitle: string, required: string[]): number {
  const hay = tokenize(resultTitle);
  if (hay.length === 0 || required.length === 0) return 0;
  let hits = 0;
  for (const token of required) {
    if (hay.some((h) => h.includes(token) || token.includes(h))) hits += 1;
  }
  return hits / required.length;
}

function dropOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const med = median(sorted)!;
  const filtered = sorted.filter((p) => p >= med * 0.6 && p <= med * 1.4);
  return filtered.length >= 3 ? filtered : sorted;
}

export async function runMarketAnalysis(input: {
  title: string;
  unitCost?: number;
  lotQuantity?: number;
  lotPrice?: number;
  articlesInWeek?: number;
  brand?: string;
  model?: string;
  color?: string;
}): Promise<MarketAnalysis> {
  const queryParts = [
    input.brand,
    input.model,
    input.color,
    !input.brand && !input.model ? input.title : null,
  ].filter(Boolean);
  const shoppingQuery =
    queryParts.length > 0 ? queryParts.join(" ") : input.title;

  const shoppingResults = await searchShopping(shoppingQuery, 14);

  const requiredTokens = [
    ...tokenize(input.brand ?? ""),
    ...tokenize(input.model ?? ""),
    ...tokenize(input.color ?? ""),
  ];
  const titleTokens =
    requiredTokens.length > 0 ? requiredTokens : tokenize(input.title).slice(0, 6);

  const filteredResults = shoppingResults.filter((r) => {
    if (!r.price || r.price <= 0) return false;
    const score = titleOverlapScore(r.title || "", titleTokens);
    // Require decent overlap when we know brand/model
    if (input.brand || input.model) return score >= 0.35;
    return score >= 0.2;
  });

  const competitorPrices = dropOutliers(
    filteredResults.map((r) => r.price).filter((p) => p > 0)
  );

  const thinComps = competitorPrices.length < 3;

  const content = await chatCompletion(
    "market",
    [
      {
        role: "system",
        content: `Tu es analyste pricing senior Québec/Canada pour UNIT411 (liquidation → Shopify).

Analyse UN SEUL article (pas le lot).
suggestedPrice = prix Shopify concurrentiel pour 1 unité, ancré sur le marché (souvent ~5–12% sous la médiane si concurrence haute).
Marge business cible: vente ≥ 2× coût landed — tu proposes le prix marché; le plafond enchère est calculé ailleurs.
Si moins de 3 prix concurrents fiables: recommendation="review" et sois conservateur.
Ne invente PAS de prix concurrents absents des données.
summary: 1–2 phrases FR-CA actionnables.

Réponds UNIQUEMENT en JSON: competitorPrices (number[]), suggestedPrice (number), marginPercent (number), demandScore (1-10), competitionLevel ("low"|"medium"|"high"), recommendation ("publish"|"review"|"skip"), summary (string).`,
      },
      {
        role: "user",
        content: JSON.stringify({
          produit_unitaire: input.title,
          brand: input.brand,
          model: input.model,
          color: input.color,
          cout_unitaire_estime_avant_transport: input.unitCost,
          quantite_lot_source: input.lotQuantity ?? 1,
          prix_lot_source: input.lotPrice,
          prix_concurrents_filtres: competitorPrices,
          mediane_marche: median(competitorPrices),
          comps_insuffisants: thinComps,
          resultats_shopping: filteredResults.slice(0, 8),
        }),
      },
    ],
    { json: true, temperature: 0.25, maxTokens: 4096 }
  );

  const parsed = JSON.parse(content) as MarketAnalysis;
  parsed.competitorPrices = competitorPrices;

  const marketMedian = median(competitorPrices);
  if (!parsed.suggestedPrice || parsed.suggestedPrice <= 0) {
    if (marketMedian) {
      parsed.suggestedPrice = Math.round(marketMedian * 0.92 * 100) / 100;
    } else if (input.unitCost) {
      parsed.suggestedPrice = Math.round(input.unitCost * 2.2 * 100) / 100;
    } else {
      parsed.suggestedPrice = 0;
    }
  }

  if (thinComps) {
    parsed.recommendation = "review";
    if (marketMedian) {
      // More conservative when comps are thin
      parsed.suggestedPrice = Math.round(marketMedian * 0.88 * 100) / 100;
    }
    parsed.summary = [
      parsed.summary,
      `Comps filtrés insuffisants (${competitorPrices.length}) — revue manuelle.`,
    ]
      .filter(Boolean)
      .join(" — ");
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
  } else if (parsed.recommendation === "skip" || parsed.recommendation === "review") {
    // keep AI / thin-comps decision
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
