import { escapeHtml } from "@/lib/html";
import { isAnyAiConfigured } from "@/lib/openrouter";
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
import { buildStorefrontDescriptionHtml } from "@/lib/listing/description";
import { normalizeImageUrl } from "@/lib/enrichment/images";
import { hydrateMaxxLotPage } from "@/lib/maxx/hydrate";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

const MAX_STOREFRONT_IMAGES = 10;
const MAX_MAXX_TAIL_IMAGES = 4;

function fallbackCopy(manufacturerTitle: string, rawDescription?: string | null): CopywritingResult {
  const safeTitle = escapeHtml(manufacturerTitle);
  const safeDesc = rawDescription ? escapeHtml(rawDescription) : null;
  return {
    title: manufacturerTitle,
    descriptionHtml: buildStorefrontDescriptionHtml({
      descriptionHtml: safeDesc ? `<p>${safeDesc}</p>` : `<p>${safeTitle}</p>`,
      bulletPoints: [],
      title: manufacturerTitle,
    }),
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
    const warnings: string[] = [];
    let rawTitle = product.rawTitle ?? "Product";
    let rawDescription = product.rawDescription;
    let lotPrice = product.rawPrice ? Number(product.rawPrice) : undefined;

    const parsedEvent = parseMaxxEventFromUrl(product.sourceUrl);
    let eventWeekKey = product.eventWeekKey ?? parsedEvent.eventWeekKey;
    let eventId = product.eventId ?? parsedEvent.eventId;
    let eventName = product.eventName;
    let maxxRefs = (
      (product.rawVariants as { maxxImageRefs?: string[] } | null)
        ?.maxxImageRefs ?? []
    ).map(normalizeImageUrl);

    // Weak event / thin capture → re-fetch Maxx page for event + images + title
    if (
      isWeakEventWeekKey(eventWeekKey) ||
      maxxRefs.length === 0 ||
      !product.rawTitle ||
      product.rawTitle.startsWith("Lot Maxx")
    ) {
      try {
        const hydrated = await hydrateMaxxLotPage(product.sourceUrl);
        if (hydrated.eventId) {
          eventId = hydrated.eventId;
          eventWeekKey =
            hydrated.eventWeekKey ?? `maxx-event-${hydrated.eventId}`;
        } else if (
          hydrated.eventWeekKey &&
          !isWeakEventWeekKey(hydrated.eventWeekKey)
        ) {
          eventWeekKey = hydrated.eventWeekKey;
        }
        if (hydrated.eventName) eventName = hydrated.eventName;
        if (hydrated.images.length > 0) {
          maxxRefs = [
            ...new Set([
              ...maxxRefs,
              ...hydrated.images.map(normalizeImageUrl),
            ]),
          ].filter(Boolean);
        }
        if (
          (!product.rawTitle || product.rawTitle.startsWith("Lot Maxx")) &&
          hydrated.title
        ) {
          rawTitle = hydrated.title;
        }
        if (!rawDescription && hydrated.description) {
          rawDescription = hydrated.description;
        }
        if (lotPrice == null && hydrated.price != null) {
          lotPrice = hydrated.price;
        }
        warnings.push("Event/images Maxx re-hydratés depuis la page lot");
      } catch (err) {
        console.warn("Enrich Maxx hydrate failed:", err);
      }
    }

    // 1) Parse lot → single manufacturer product (name not translated)
    const identity = await parseLotToProduct({
      rawTitle,
      rawDescription,
      rawPrice: lotPrice,
    });

    const unitCost = identity.unitCost ?? lotPrice ?? undefined;
    const lotQuantity = Math.max(1, identity.lotQuantity || 1);

    // Persist lot qty + event early so week counts include this product
    await prisma.product.update({
      where: { id: productId },
      data: {
        rawTitle,
        ...(rawDescription != null ? { rawDescription } : {}),
        ...(lotPrice != null ? { rawPrice: lotPrice } : {}),
        lotQuantity,
        eventWeekKey,
        eventId,
        ...(eventName ? { eventName } : {}),
        ...(maxxRefs.length > 0
          ? {
              rawVariants: {
                ...((product.rawVariants as object) ?? {}),
                maxxImageRefs: maxxRefs.slice(0, 12),
              } as Prisma.InputJsonValue,
            }
          : {}),
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

    // 2) Exact manufacturer photos (+ Maxx lot photos appended later)
    let rankedImages: ProductImageCandidate[] = [];

    // Lens on Maxx lot photo → official product pages (Maxx URLs published only as tail)
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
        rawTitle,
        rawDescription,
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
          rawDescription,
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

    const manufacturerSelected = Math.min(
      6,
      Math.max(rankedImages.length, 0)
    );
    const manufacturerRows = rankedImages.map((img, index) => ({
      productId,
      url: img.url,
      width: img.width || null,
      height: img.height || null,
      source: img.source,
      isSelected: index < manufacturerSelected,
      position: index,
      score: 1 - index * 0.1,
    }));

    // Maxx lot photos last (real condition) — selected after manufacturer heroes
    const maxxTail = [...new Set(maxxRefs.map(normalizeImageUrl))]
      .filter(Boolean)
      .slice(0, MAX_MAXX_TAIL_IMAGES)
      .map((url, i) => ({
        productId,
        url,
        width: null as number | null,
        height: null as number | null,
        source: "maxx",
        isSelected: true,
        position: manufacturerRows.length + i,
        score: 0.2 - i * 0.02,
      }));

    // Cap total selected storefront images
    const allRows = [...manufacturerRows, ...maxxTail];
    let selectedSoFar = 0;
    const cappedRows = allRows.map((row) => {
      if (!row.isSelected) return row;
      selectedSoFar += 1;
      if (selectedSoFar > MAX_STOREFRONT_IMAGES) {
        return { ...row, isSelected: false };
      }
      return row;
    });

    if (cappedRows.length > 0) {
      await prisma.productImage.createMany({ data: cappedRows });
    }

    if (rankedImages.length >= MIN_PRODUCT_IMAGES) {
      // ok
    } else if (rankedImages.length > 0) {
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

    if (maxxTail.length > 0) {
      warnings.push(
        `${maxxTail.length} photo(s) Maxx ajoutée(s) en fin de galerie`
      );
    }

    // 3) Copy — title locked to manufacturer name
    let copy: CopywritingResult;
    try {
      if (!isAnyAiConfigured()) {
        throw new Error("No AI provider configured");
      }
      copy = await generateCopywriting({
        manufacturerTitle: identity.manufacturerTitle,
        rawDescription: rawDescription ?? undefined,
        unitCost,
        lotQuantity: identity.lotQuantity,
        identity,
      });
    } catch (err) {
      console.warn("Copywriting fallback:", err);
      warnings.push("Description IA indisponible");
      copy = fallbackCopy(identity.manufacturerTitle, rawDescription);
    }

    // Always force manufacturer title + merge bullets into HTML
    copy.title = identity.manufacturerTitle;
    copy.descriptionHtml = buildStorefrontDescriptionHtml({
      descriptionHtml: copy.descriptionHtml,
      bulletPoints: copy.bulletPoints,
      title: identity.manufacturerTitle,
    });
    if (copy.productType && !copy.tags.some((t) => t.toLowerCase().startsWith("type:"))) {
      copy.tags = [`type:${copy.productType}`, ...copy.tags];
    }
    if (identity.brand && !copy.tags.some((t) => t.toLowerCase().startsWith("brand:"))) {
      copy.tags = [`brand:${identity.brand}`, ...copy.tags];
    }

    // 4) Market — per unit
    let market: MarketAnalysis;
    try {
      if (!isAnyAiConfigured()) {
        throw new Error("No AI provider configured");
      }
      market = await runMarketAnalysis({
        title: identity.manufacturerTitle,
        unitCost,
        lotQuantity,
        lotPrice,
        articlesInWeek,
        brand: identity.brand,
        model: identity.model,
        color: identity.color ?? undefined,
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
        ...(eventName ? { eventName } : {}),
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
