import { Prisma } from "@prisma/client";

/** Buyer premium / fees on winning bid */
export const AUCTION_PREMIUM_RATE = 0.3;

/** Fixed weekly transport for a Maxx event week ($) */
export const WEEKLY_TRANSPORT_CAD = 400;

/**
 * Min markup on landed unit cost = 100%
 * → sell price must be ≥ 2 × unit landed cost
 */
export const MIN_MARKUP_RATE = 1.0; // 100%

export type BidStatus =
  | "watching"
  | "capped"
  | "published"
  | "won"
  | "lost"
  | "skipped";

export interface DealMathInput {
  /** Competitive / chosen sell price for ONE unit */
  sellPrice: number;
  /** Units in the Maxx lot (1 for unique piece) */
  lotQuantity: number;
  /** Articles sharing the $400 truck that event week */
  articlesInWeek: number;
  /** Optional: current bid / asking on Maxx (lot) */
  currentBidLot?: number | null;
  premiumRate?: number;
  weeklyTransport?: number;
  minMarkupRate?: number;
}

export interface DealMathResult {
  premiumRate: number;
  weeklyTransport: number;
  articlesInWeek: number;
  transportPerArticle: number;
  lotQuantity: number;
  sellPrice: number;
  minUnitLandedCost: number;
  /** Max lot bid so that after ×1.30 + transport, sell ≥ 2× landed */
  maxBidLot: number;
  maxBidUnit: number;
  /** Landed unit cost if you win at maxBidLot */
  unitLandedAtMaxBid: number;
  /** Landed unit cost if you win at currentBidLot */
  unitLandedAtCurrentBid: number | null;
  /** Markup % on cost at max bid vs sell */
  markupAtMaxBidPercent: number;
  /** True if market sell price can clear 100% markup */
  isViable: boolean;
  skipReason: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeDealMath(input: DealMathInput): DealMathResult {
  const premiumRate = input.premiumRate ?? AUCTION_PREMIUM_RATE;
  const weeklyTransport = input.weeklyTransport ?? WEEKLY_TRANSPORT_CAD;
  const minMarkup = input.minMarkupRate ?? MIN_MARKUP_RATE;
  const qty = Math.max(1, Math.floor(input.lotQuantity) || 1);
  const articles = Math.max(1, Math.floor(input.articlesInWeek) || 1);
  const sellPrice = Math.max(0, input.sellPrice);

  const transportPerArticle = weeklyTransport / articles;
  // sell ≥ cost × (1 + markup) ⇒ max unit landed = sell / (1 + markup)
  const minUnitLandedCost = sellPrice / (1 + minMarkup);

  // unitLanded = (bidLot × (1+premium) / qty) + transport
  // bidLot = (minUnitLandedCost - transport) × qty / (1+premium)
  const bidBudgetUnit = minUnitLandedCost - transportPerArticle;
  let maxBidLot = (bidBudgetUnit * qty) / (1 + premiumRate);
  if (!Number.isFinite(maxBidLot) || maxBidLot < 0) maxBidLot = 0;

  maxBidLot = round2(maxBidLot);
  const maxBidUnit = round2(maxBidLot / qty);

  const unitLandedAtMaxBid = round2(
    (maxBidLot * (1 + premiumRate)) / qty + transportPerArticle
  );

  let unitLandedAtCurrentBid: number | null = null;
  if (input.currentBidLot != null && input.currentBidLot > 0) {
    unitLandedAtCurrentBid = round2(
      (input.currentBidLot * (1 + premiumRate)) / qty + transportPerArticle
    );
  }

  const markupAtMaxBidPercent =
    unitLandedAtMaxBid > 0
      ? round2(((sellPrice - unitLandedAtMaxBid) / unitLandedAtMaxBid) * 100)
      : 0;

  let isViable = maxBidLot > 0 && sellPrice > 0;
  let skipReason: string | null = null;

  if (sellPrice <= 0) {
    isViable = false;
    skipReason = "Prix de vente manquant";
  } else if (maxBidLot <= 0) {
    isViable = false;
    skipReason = `Transport (${round2(transportPerArticle)} $/article) trop élevé vs prix vente pour marge 100%`;
  } else if (
    unitLandedAtCurrentBid != null &&
    unitLandedAtCurrentBid * (1 + minMarkup) > sellPrice * 1.02
  ) {
    // Current bid already above what 100% markup allows
    isViable = false;
    skipReason = "Enchère actuelle trop haute pour marge 100%";
  }

  return {
    premiumRate,
    weeklyTransport,
    articlesInWeek: articles,
    transportPerArticle: round2(transportPerArticle),
    lotQuantity: qty,
    sellPrice: round2(sellPrice),
    minUnitLandedCost: round2(minUnitLandedCost),
    maxBidLot,
    maxBidUnit,
    unitLandedAtMaxBid,
    unitLandedAtCurrentBid,
    markupAtMaxBidPercent,
    isViable,
    skipReason,
  };
}

/** Extract Maxx event week key from a lot/event URL */
export function parseMaxxEventFromUrl(sourceUrl: string): {
  eventId: string | null;
  eventWeekKey: string;
  sourceLotId: string | null;
} {
  try {
    const u = new URL(sourceUrl);
    const path = u.pathname;

    const lotMatch = path.match(
      /\/Event\/LotDetails\/(\d+)/i
    );
    const eventDetails = path.match(/\/Event\/(?:Details|Index)\/(\d+)/i);
    const eventAny = path.match(/\/Event\/([^/]+)/i);

    const sourceLotId = lotMatch?.[1] ?? null;
    let eventId = eventDetails?.[1] ?? null;

    // Some Maxx URLs only have LotDetails — use lot id bucket as week proxy
    if (!eventId && eventAny?.[1] && !/^LotDetails$/i.test(eventAny[1])) {
      eventId = eventAny[1];
    }

    const eventWeekKey = eventId
      ? `maxx-event-${eventId}`
      : sourceLotId
        ? `maxx-lotweek-${sourceLotId.slice(0, 5)}`
        : `maxx-url-${sourceUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-16)}`;

    return { eventId, eventWeekKey, sourceLotId };
  } catch {
    return {
      eventId: null,
      eventWeekKey: "maxx-unknown",
      sourceLotId: null,
    };
  }
}

export function dealMathToJson(deal: DealMathResult): Prisma.InputJsonValue {
  return deal as unknown as Prisma.InputJsonValue;
}
