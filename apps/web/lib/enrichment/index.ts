import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { escapeHtml } from "@/lib/html";
import { generateCopywriting } from "@/lib/enrichment/copywriting";
import { runMarketAnalysis } from "@/lib/enrichment/market";
import {
  findManufacturerImages,
  MIN_PRODUCT_IMAGES,
} from "@/lib/enrichment/manufacturerImages";
import {
  verifyProductImages,
  findImagesFromMaxxReference,
  type ProductImageCandidate,
} from "@/lib/enrichment/imageVerify";
import { parseLotToProduct } from "@/lib/enrichment/productIdentity";
import {
  computeDealMath,
  parseMaxxEventFromUrl,
  isWeakEventWeekKey,
  WEEKLY_TRANSPORT_CAD,
  AUCTION_PREMIUM_RATE,
} from "@/lib/enrichment/pricing";
import type { CopywritingResult } from "@/lib/enrichment/copywriting";
import type { MarketAnalysis } from "@/lib/enrichment/market";

function fallbackCopy(manufacturerTitle: string, rawDescription?: string | null): CopywritingResult {
  const safeTitle = escapeHtml(manufacturerTitle);
  const safeDesc = rawDescription ? escapeHtml(rawDescription) : null;
  return {
    title: manufacturerTitle,
    descriptionHtml: safeDesc
      ? `<p>${safeDesc}</p>`
      : `<p>${safeTitle}</p>`,
    bulletPoints: [],
    seoTitle: manufacturerTitle.slice(0, 70),
    seoDescription: (rawDescription ?? manufacturerTitle).slice(0, 160),
    tags: ["maxx", "import"],
  };
}

function fallbackMarket(
  unitCost: number | null | undefined,
  lotQuantity: number,
  articlesInWeek: number,
  lotPrice?: number
): MarketAnalysis {
  const cost = unitCost ?? 0;
  const suggestedPrice = cost
    ? Math.round(cost * 2.2 * 100) / 100
    : 0;
  const deal = computeDealMath({
    sellPrice: suggestedPrice,
    lotQuantity,
    articlesInWeek,
    currentBidLot: lotPrice,
  });

  return {
    competitorPrices: [],
    suggestedPrice,
    marginPercent: deal.markupAtMaxBidPercent,
    demandScore: 5,
    competitionLevel: "medium",
    recommendation: deal.isViable ? "review" : "skip",
    summary:
      "Analyse IA non disponible. Prix ≈ 2.2× coût estimé; plafond enchère calculé (premium 30% + transport 400$/sem).",
    unitCost: deal.unitLandedAtMaxBid,
    lotQuantity,
    deal,
  };
}

async function countArticlesInEventWeek(
  eventWeekKey: string,
  selfLotQuantity: number
): Promise<number> {
  const siblings = await prisma.product.findMany({
    where: {
      eventWeekKey,
      bidStatus: { notIn: ["lost", "skipped"] },
    },
    select: { id: true, lotQuantity: true },
  });

  if (siblings.length === 0) {
    return Math.max(1, selfLotQuantity);
  }

  const totalUnits = siblings.reduce(
    (sum, p) => sum + Math.max(1, p.lotQuantity || 1),
    0
  );
  return Math.max(1, totalUnits);
}

export async function enrichProduct(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: true },
  });

  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  await prisma.product.update({
    where: { id: productId },
    data: { status: "enriching", errorMessage: null },
  });

  try {
    const lotPrice = product.rawPrice ? Number(product.rawPrice) : undefined;
    const warnings: string[] = [];

    // 1) Parse lot → single manufacturer product (name not translated)
    const identity = await parseLotToProduct({
      rawTitle: product.rawTitle ?? "Product",
      rawDescription: product.rawDescription,
      rawPrice: lotPrice,
    });

    const unitCost = identity.unitCost ?? lotPrice ?? undefined;
    const lotQuantity = Math.max(1, identity.lotQuantity || 1);

    const parsedEvent = parseMaxxEventFromUrl(product.sourceUrl);
    const eventWeekKey = product.eventWeekKey ?? parsedEvent.eventWeekKey;
    const eventId = product.eventId ?? parsedEvent.eventId;

    // Persist lot qty + event early so week counts include this product
    await prisma.product.update({
      where: { id: productId },
      data: {
        lotQuantity,
        eventWeekKey,
        eventId,
      },
    });

    const articlesInWeek = await countArticlesInEventWeek(
      eventWeekKey,
      lotQuantity
    );

    if (lotQuantity > 1) {
      warnings.push(
        `Lot ×${lotQuantity} → fiche unitaire « ${identity.manufacturerTitle} »`
      );
    }
    if (identity.color) {
      warnings.push(`Couleur/finition ciblée: ${identity.color}`);
    }
    warnings.push(
      `Event ${eventWeekKey} · transport ${WEEKLY_TRANSPORT_CAD}$ ÷ ${articlesInWeek} art. · premium enchère +${Math.round(AUCTION_PREMIUM_RATE * 100)}% · marge mini 100%`
    );

    // 2) Exact product photos (not lot photos, not maxx)
    let rankedImages: ProductImageCandidate[] = [];

    const rawVariants = product.rawVariants as {
      maxxImageRefs?: string[];
    } | null;
    const maxxRefs = rawVariants?.maxxImageRefs ?? [];

    // Lens on Maxx lot photo → official product pages (never publish Maxx URLs)
    if (maxxRefs.length > 0 && process.env.SERPER_API_KEY) {
      try {
        const fromLotLens = await findImagesFromMaxxReference(maxxRefs, identity);
        if (fromLotLens.length > 0) {
          rankedImages.push(...fromLotLens);
          warnings.push(
            `Lens sur photo Maxx → ${fromLotLens.length} image(s) fabricant trouvée(s)`
          );
        }
      } catch (err) {
        console.warn("Maxx reference lens failed:", err);
      }
    }

    try {
      const found = await findManufacturerImages({
        rawTitle: product.rawTitle ?? "Product",
        rawDescription: product.rawDescription,
        rawPrice: lotPrice,
        minCount: MIN_PRODUCT_IMAGES,
        identity,
      });
      const existing = new Set(rankedImages.map((i) => i.url));
      for (const img of found.images) {
        if (!existing.has(img.url)) {
          rankedImages.push(img);
          existing.add(img.url);
        }
      }
    } catch (err) {
      console.warn("Manufacturer image search failed:", err);
      warnings.push("Recherche d'images fabricant échouée");
    }

    // Prefer exact color/model matches — Google Lens + vision QA (not URL text)
    async function filterExactProductImages(
      candidates: typeof rankedImages
    ): Promise<typeof rankedImages> {
      if (candidates.length === 0) return [];
      try {
        const verified = await verifyProductImages(candidates, identity);
        if (verified.lensRejected > 0) {
          warnings.push(
            `Google Lens a rejeté ${verified.lensRejected} image(s) hors-produit`
          );
        }
        if (verified.visionUsed) {
          warnings.push(
            `Vérification visuelle IA: ${verified.images.length}/${candidates.length} photos validées`
          );
        }
        return verified.images.slice(0, 8);
      } catch (err) {
        console.warn("Image verify failed:", err);
        warnings.push("Vérification visuelle des images échouée");
        return [];
      }
    }

    rankedImages = await filterExactProductImages(rankedImages);

    // Extra search + verify if still short
    if (
      rankedImages.length < MIN_PRODUCT_IMAGES &&
      process.env.SERPER_API_KEY
    ) {
      try {
        const domain = identity.manufacturerDomain?.replace(/^www\./, "");
        const extraQueries = [
          `"${identity.manufacturerTitle}" product photo -lot -auction`,
          `${identity.brand} ${identity.model} official packshot`,
          identity.color
            ? `"${identity.manufacturerTitle}" ${identity.color} product`
            : `"${identity.brand}" "${identity.model}" white background`,
          domain
            ? `site:${domain} ${identity.model} product`
            : `${identity.brand} ${identity.model} product image`,
        ];
        const extraPass = await findManufacturerImages({
          rawTitle: identity.manufacturerTitle,
          rawDescription: product.rawDescription,
          rawPrice: lotPrice,
          minCount: MIN_PRODUCT_IMAGES,
          identity: {
            ...identity,
            searchQueries: extraQueries,
          },
        });
        const existing = new Set(rankedImages.map((i) => i.url));
        const merged = [...rankedImages];
        for (const img of extraPass.images) {
          if (!existing.has(img.url)) {
            merged.push(img);
            existing.add(img.url);
          }
        }
        rankedImages = await filterExactProductImages(merged);
      } catch (err) {
        console.warn("Extra image search failed:", err);
      }
    }

    await prisma.productImage.deleteMany({ where: { productId } });

    if (rankedImages.length >= MIN_PRODUCT_IMAGES) {
      const selectedCount = Math.min(6, rankedImages.length);
      await prisma.productImage.createMany({
        data: rankedImages.map((img, index) => ({
          productId,
          url: img.url,
          width: img.width || null,
          height: img.height || null,
          source: img.source,
          isSelected: index < selectedCount,
          position: index,
          score: 1 - index * 0.1,
        })),
      });
    } else if (rankedImages.length > 0) {
      await prisma.productImage.createMany({
        data: rankedImages.map((img, index) => ({
          productId,
          url: img.url,
          width: img.width || null,
          height: img.height || null,
          source: img.source,
          isSelected: true,
          position: index,
          score: 1 - index * 0.1,
        })),
      });
      warnings.push(
        `Seulement ${rankedImages.length}/${MIN_PRODUCT_IMAGES} images exactes trouvées`
      );
    } else if (!process.env.SERPER_API_KEY) {
      warnings.push("SERPER_API_KEY requis pour les images fabricant");
    } else {
      warnings.push(
        `Aucune image exacte pour « ${identity.manufacturerTitle} » (min ${MIN_PRODUCT_IMAGES})`
      );
    }

    // 3) Copy — title locked to manufacturer name
    let copy: CopywritingResult;
    try {
      if (
        !process.env.OPENROUTER_API_KEY &&
        !process.env.GEMINI_API_KEY &&
        !process.env.ANTHROPIC_API_KEY
      ) {
        throw new Error("No AI provider configured");
      }
      copy = await generateCopywriting({
        manufacturerTitle: identity.manufacturerTitle,
        rawDescription: product.rawDescription ?? undefined,
        unitCost,
        lotQuantity: identity.lotQuantity,
        identity,
      });
    } catch (err) {
      console.warn("Copywriting fallback:", err);
      warnings.push("Description IA indisponible");
      copy = fallbackCopy(identity.manufacturerTitle, product.rawDescription);
    }

    // Always force manufacturer title
    copy.title = identity.manufacturerTitle;

    // 4) Market — per unit
    let market: MarketAnalysis;
    try {
      if (
        !process.env.OPENROUTER_API_KEY &&
        !process.env.GEMINI_API_KEY &&
        !process.env.ANTHROPIC_API_KEY
      ) {
        throw new Error("No AI provider configured");
      }
      market = await runMarketAnalysis({
        title: identity.manufacturerTitle,
        unitCost,
        lotQuantity,
        lotPrice,
        articlesInWeek,
      });
    } catch (err) {
      console.warn("Market analysis fallback:", err);
      warnings.push("Étude de marché IA indisponible");
      market = fallbackMarket(unitCost, lotQuantity, articlesInWeek, lotPrice);
    }

    market.lotQuantity = lotQuantity;
    const deal =
      market.deal ??
      computeDealMath({
        sellPrice: market.suggestedPrice,
        lotQuantity,
        articlesInWeek,
        currentBidLot: lotPrice,
      });
    market.deal = deal;
    market.unitCost = deal.unitLandedAtMaxBid;

    if (isWeakEventWeekKey(eventWeekKey)) {
      deal.isViable = false;
      deal.skipReason =
        "Event Maxx manquant — transport 400$/sem non partagé correctement. Relance avec URL event.";
      warnings.push(deal.skipReason);
    } else if (!deal.isViable) {
      warnings.push(deal.skipReason ?? "Deal non viable (marge 100%)");
    }

    await prisma.product.update({
      where: { id: productId },
      data: {
        status: "ready",
        title: identity.manufacturerTitle,
        descriptionHtml: copy.descriptionHtml,
        bulletPoints: copy.bulletPoints as Prisma.InputJsonValue,
        seoTitle: copy.seoTitle,
        seoDescription: copy.seoDescription,
        tags: copy.tags,
        suggestedPrice: market.suggestedPrice || null,
        costPrice: deal.unitLandedAtMaxBid || unitCost || null,
        marketAnalysis: market as unknown as Prisma.InputJsonValue,
        lotQuantity,
        eventWeekKey,
        eventId,
        maxBidLot: deal.maxBidLot,
        maxBidUnit: deal.maxBidUnit,
        transportShare: deal.transportPerArticle,
        dealMath: deal as unknown as Prisma.InputJsonValue,
        bidStatus: deal.isViable ? "capped" : "skipped",
        errorMessage: warnings.length > 0 ? warnings.join(" · ") : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown enrichment error";
    await prisma.product.update({
      where: { id: productId },
      data: { status: "error", errorMessage: message },
    });
    throw error;
  }
}
