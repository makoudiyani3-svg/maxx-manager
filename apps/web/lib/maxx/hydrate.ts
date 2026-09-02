import { assertSafeExternalUrl } from "@/lib/urlSafety";
import { normalizeImageUrl } from "@/lib/enrichment/images";
import { parseMaxxEventFromUrl } from "@/lib/enrichment/pricing";

export type MaxxHydrateResult = {
  sourceUrl: string;
  title: string;
  price?: number;
  description?: string;
  images: string[];
  eventId?: string | null;
  eventName?: string | null;
  eventWeekKey?: string | null;
  auctionEndsAt?: string | null;
  sourceId?: string | null;
  lotQuantity: number;
};

function isMaxxHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "maxx.ca" || host.endsWith(".maxx.ca");
}

function extractLotQuantity(title: string): number {
  const m = title.match(/^\s*(\d+)\s*[-x×]/i);
  if (m) return parseInt(m[1], 10);
  const m2 = title.match(/\b(\d+)\s*(?:pcs?|units?|pi[eè]ces?)\b/i);
  if (m2) return parseInt(m2[1], 10);
  return 1;
}

function parsePrice(text: string): number | undefined {
  const match = text.replace(/,/g, ".").match(/[\d]+(?:\.\d{2})?/);
  return match ? parseFloat(match[0]) : undefined;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort server-side hydrate of a Maxx lot page (dashboard URL capture). */
export async function hydrateMaxxLotPage(
  rawUrl: string
): Promise<MaxxHydrateResult> {
  const url = assertSafeExternalUrl(rawUrl);
  if (!isMaxxHost(url.hostname)) {
    throw new Error("Seuls les liens maxx.ca sont acceptés");
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Maxx HTTP ${res.status}`);
  }

  const html = await res.text();
  const parsedEvent = parseMaxxEventFromUrl(url.toString());

  const ogTitle =
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1];
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];

  const title = stripTags(
    ogTitle || h1 || titleTag || `Lot Maxx ${parsedEvent.sourceLotId ?? ""}`
  )
    .replace(/\s*\|\s*Maxx.*/i, "")
    .trim();

  const ogDesc =
    html.match(
      /property=["']og:description["'][^>]*content=["']([^"']+)["']/i
    )?.[1] ||
    html.match(
      /content=["']([^"']+)["'][^>]*property=["']og:description["']/i
    )?.[1] ||
    html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];

  const metaPrice =
    html.match(
      /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i
    )?.[1] ||
    html.match(
      /(?:current\s*bid|enchère|prix)[^$]{0,40}\$?\s*([\d]+(?:[.,]\d{2})?)/i
    )?.[1];
  const price = metaPrice ? parsePrice(metaPrice) : undefined;

  const imageSet = new Set<string>();
  const ogImages = [
    ...html.matchAll(
      /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi
    ),
    ...html.matchAll(
      /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/gi
    ),
  ];
  for (const m of ogImages) {
    if (m[1]) imageSet.add(normalizeImageUrl(m[1]));
  }

  const imgTags = html.matchAll(
    /<img[^>]+(?:src|data-src|data-zoom|data-original)=["']([^"']+)["'][^>]*>/gi
  );
  for (const m of imgTags) {
    const candidate = normalizeImageUrl(m[1] ?? "");
    if (
      candidate &&
      (candidate.includes("maxx") ||
        /\.(jpe?g|png|webp)(\?|$)/i.test(candidate))
    ) {
      imageSet.add(candidate);
    }
  }

  // Event id from links in HTML
  let eventId = parsedEvent.eventId;
  let eventName: string | null = null;
  const eventLink = html.match(
    /href=["']([^"']*\/Event\/(?:Details|Index)\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i
  );
  if (eventLink?.[2]) {
    eventId = eventLink[2];
    const name = stripTags(eventLink[3] ?? "");
    if (name && name.length < 120) eventName = name;
  }

  const eventWeekKey = eventId
    ? `maxx-event-${eventId}`
    : parsedEvent.eventWeekKey;

  let auctionEndsAt: string | null = null;
  const endMatch = html.match(
    /(?:ends?|ferme|clôture|closes?)[^0-9]{0,40}(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );
  if (endMatch?.[1]) {
    const d = new Date(endMatch[1]);
    if (!Number.isNaN(d.getTime())) auctionEndsAt = d.toISOString();
  }

  return {
    sourceUrl: url.toString().split("?")[0]!,
    title: title || `Lot Maxx ${parsedEvent.sourceLotId ?? "nouveau"}`,
    price,
    description: ogDesc ? stripTags(ogDesc) : undefined,
    images: [...imageSet].filter(Boolean).slice(0, 12),
    eventId,
    eventName,
    eventWeekKey,
    auctionEndsAt,
    sourceId: parsedEvent.sourceLotId,
    lotQuantity: extractLotQuantity(title),
  };
}
