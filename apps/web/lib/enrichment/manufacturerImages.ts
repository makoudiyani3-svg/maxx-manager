import { searchImages, type SerperImageResult } from "@/lib/serper";
import { validateImages, type ImageProbeResult } from "@/lib/enrichment/images";
import {
  parseLotToProduct,
  type ParsedLotProduct,
} from "@/lib/enrichment/productIdentity";

/** Minimum exact product photos required per product */
export const MIN_PRODUCT_IMAGES = 5;
const MAX_CANDIDATE_IMAGES = 16;

const BLOCKED_IMAGE_HOSTS = [
  "maxx.ca",
  "www.maxx.ca",
  "cdn.maxx.ca",
  "maxxliquidation",
  "pinterest.",
  "pinimg.com",
  "shutterstock",
  "gettyimages",
  "istockphoto",
  "dreamstime",
  "unsplash.com",
  "wallpaper",
];

/** Known brand → official product image domain */
const BRAND_OFFICIAL_DOMAINS: Record<string, string> = {
  ecoflow: "ecoflow.com",
  asus: "asus.com",
  samsung: "samsung.com",
  lg: "lg.com",
  dyson: "dyson.com",
  shark: "sharkclean.com",
  ninja: "ninjakitchen.com",
  kitchenaid: "kitchenaid.com",
  "wrought studio": "wayfair.com",
  wayfair: "wayfair.com",
};

export type ProductIdentity = ParsedLotProduct;

function isBlockedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_IMAGE_HOSTS.some(
      (blocked) => host === blocked || host.endsWith(`.${blocked}`)
    );
  } catch {
    return true;
  }
}

function scoreExactProductImage(
  url: string,
  link: string,
  identity: ParsedLotProduct,
  resultTitle = ""
): number {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const haystack = `${url} ${link} ${resultTitle}`.toLowerCase();
    let score = 0;
    const domain = identity.manufacturerDomain;

    if (
      domain &&
      (host === domain ||
        host.endsWith(`.${domain}`) ||
        host.includes(domain.replace(".com", "")))
    ) {
      score += 120;
    }

    const tokens = [
      identity.brand,
      ...identity.model.split(/[\s\-_/]+/),
      ...identity.manufacturerTitle.split(/[\s\-_/]+/),
    ]
      .map((t) => t.toLowerCase())
      .filter((t) => t.length > 2 && !/^\d+$/.test(t));

    let tokenHits = 0;
    for (const token of [...new Set(tokens)].slice(0, 10)) {
      if (haystack.includes(token)) tokenHits += 1;
    }
    score += tokenHits * 18;

    // Color / finish match is critical for furniture & variants
    if (identity.color) {
      const color = identity.color.toLowerCase();
      if (haystack.includes(color)) {
        score += 80;
      } else {
        // Wrong or missing color → strong penalty (prefer fewer correct photos)
        score -= 70;
      }
    }

    for (const attr of identity.attributes ?? []) {
      const a = attr.toLowerCase();
      if (a.length > 2 && haystack.includes(a)) score += 12;
    }

    if (
      host.includes("wayfair") ||
      host.includes("article") ||
      host.includes("westelm") ||
      host.includes("cb2") ||
      host.includes("ikea")
    ) {
      score += 40;
    }

    if (
      haystack.includes("lot-of") ||
      haystack.includes("auction") ||
      haystack.includes("liquidation") ||
      haystack.includes("pallet") ||
      haystack.includes("wholesale lot")
    ) {
      score -= 120;
    }
    if (host.includes("pinterest") || host.includes("blogspot")) score -= 50;

    return score;
  } catch {
    return 0;
  }
}

async function extractImagesFromManufacturerSite(
  domain: string,
  productName: string
): Promise<string[]> {
  const urls: string[] = [];
  const candidates = [
    `https://www.${domain}`,
    `https://${domain}`,
    `https://www.${domain}/search?q=${encodeURIComponent(productName)}`,
  ];

  for (const pageUrl of candidates.slice(0, 2)) {
    try {
      const fromPage = await scrapeProductPageGallery(pageUrl);
      urls.push(...fromPage);
    } catch {
      // ignore
    }
  }

  return [...new Set(urls)];
}

/** Scrape a product detail page gallery (og:image + product images). */
export async function scrapeProductPageGallery(pageUrl: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MaxxManager/1.0; +https://localhost)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const ogMatches = [
      ...html.matchAll(
        /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi
      ),
      ...html.matchAll(
        /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/gi
      ),
    ];
    for (const m of ogMatches) {
      if (m[1]) urls.push(m[1]);
    }

    // JSON-LD Product images
    const ldBlocks = html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    for (const block of ldBlocks ?? []) {
      try {
        const jsonText = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
        const data = JSON.parse(jsonText) as
          | { image?: string | string[]; "@type"?: string }
          | Array<{ image?: string | string[]; "@type"?: string }>;
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const imgs = node.image;
          if (typeof imgs === "string") urls.push(imgs);
          else if (Array.isArray(imgs)) {
            for (const i of imgs) if (typeof i === "string") urls.push(i);
          }
        }
      } catch {
        // ignore bad JSON-LD
      }
    }

    const imgMatches = html.match(
      /https?:\/\/[^"'>\s]+\.(?:jpe?g|png|webp)(?:\?[^"'>\s]*)?/gi
    );
    for (const match of (imgMatches ?? []).slice(0, 40)) {
      if (!isBlockedHost(match)) urls.push(match);
    }
  } catch {
    return [];
  }

  return [...new Set(urls.filter((u) => !isBlockedHost(u)))].slice(0, 24);
}

function resolveOfficialDomain(identity: ParsedLotProduct): string | null {
  if (identity.manufacturerDomain) {
    return identity.manufacturerDomain.replace(/^www\./, "");
  }
  const brandKey = identity.brand.toLowerCase();
  if (BRAND_OFFICIAL_DOMAINS[brandKey]) {
    return BRAND_OFFICIAL_DOMAINS[brandKey];
  }
  for (const [key, domain] of Object.entries(BRAND_OFFICIAL_DOMAINS)) {
    if (brandKey.includes(key) || identity.manufacturerTitle.toLowerCase().includes(key)) {
      return domain;
    }
  }
  return null;
}

function buildSearchRounds(identity: ParsedLotProduct): string[][] {
  const title = identity.manufacturerTitle;
  const color = identity.color;
  const colorQ = color ? ` ${color}` : "";
  const attrs = (identity.attributes ?? []).slice(0, 2).join(" ");
  const officialDomain = resolveOfficialDomain(identity);

  const exact = [
    ...identity.searchQueries,
    `"${title}"${colorQ} product photo`,
    `"${title}"${colorQ} packshot`,
    color ? `"${title}" ${color} finish` : `"${title}" official product`,
    `${identity.brand} ${identity.model}${colorQ} ${attrs}`.trim(),
    officialDomain
      ? `site:${officialDomain} "${title}"`
      : `"${title}"${colorQ} manufacturer`,
    officialDomain
      ? `site:${officialDomain} ${identity.model}`
      : `"${title}"${colorQ} -lot -auction -maxx -pallet`,
    `"${identity.brand}" "${identity.model}"${colorQ} -lot -collage`,
  ];

  const unique = [...new Set(exact.filter(Boolean))];
  return [
    unique.slice(0, 5),
    unique.slice(5, 10),
    [
      color
        ? `"${title}" ${color} dining`
        : `"${title}" front view`,
      `"${title}"${colorQ} side angle`,
      `"${identity.brand} ${title}"${colorQ} studio`,
      color
        ? `${identity.brand} ${identity.model} ${color} exact`
        : `"${title}" retail product`,
      `"${title}"${colorQ} white background`,
    ],
  ];
}

export async function identifyProduct(
  rawTitle: string,
  rawDescription?: string | null,
  rawPrice?: number | null
): Promise<ParsedLotProduct> {
  return parseLotToProduct({ rawTitle, rawDescription, rawPrice });
}

export async function findManufacturerImages(input: {
  rawTitle: string;
  rawDescription?: string | null;
  rawPrice?: number | null;
  minCount?: number;
  /** Pre-parsed identity — avoids calling AI twice */
  identity?: ParsedLotProduct;
}): Promise<{
  images: Array<ImageProbeResult & { source: "manufacturer" | "serper" }>;
  identity: ParsedLotProduct;
}> {
  const minCount = input.minCount ?? MIN_PRODUCT_IMAGES;
  const identity =
    input.identity ??
    (await parseLotToProduct({
      rawTitle: input.rawTitle,
      rawDescription: input.rawDescription,
      rawPrice: input.rawPrice,
    }));

  const collected = new Map<
    string,
    { url: string; source: "manufacturer" | "serper"; boost: number }
  >();

  const addUrl = (
    url: string,
    source: "manufacturer" | "serper",
    boost: number,
    link = "",
    resultTitle = ""
  ) => {
    if (!url || isBlockedHost(url)) return;
    const scored =
      boost + scoreExactProductImage(url, link, identity, resultTitle);
    // Stricter: require stronger match when color is known
    const minScore = identity.color ? 55 : 35;
    if (scored < minScore) return;
    const existing = collected.get(url);
    if (!existing || scored > existing.boost) {
      collected.set(url, { url, source, boost: scored });
    }
  };

  if (identity.manufacturerDomain) {
    const fromSite = await extractImagesFromManufacturerSite(
      identity.manufacturerDomain.replace(/^www\./, ""),
      identity.manufacturerTitle
    );
    for (const url of fromSite) {
      addUrl(
        url,
        "manufacturer",
        scoreExactProductImage(url, "", identity) + 40
      );
    }
  }

  const officialDomain = resolveOfficialDomain(identity);
  if (officialDomain && officialDomain !== identity.manufacturerDomain?.replace(/^www\./, "")) {
    const fromOfficial = await extractImagesFromManufacturerSite(
      officialDomain,
      identity.manufacturerTitle
    );
    for (const url of fromOfficial) {
      addUrl(
        url,
        "manufacturer",
        scoreExactProductImage(url, "", identity) + 60
      );
    }
  }

  if (process.env.SERPER_API_KEY) {
    for (const queries of buildSearchRounds(identity)) {
      if (collected.size >= minCount * 4) break;

      const batches = await Promise.all(queries.map((q) => searchImages(q, 12)));
      const flat: SerperImageResult[] = batches.flat();

      for (const img of flat) {
        if (!img.imageUrl || isBlockedHost(img.imageUrl)) continue;
        let titleBoost = 0;
        const t = (img.title || "").toLowerCase();
        if (identity.brand && t.includes(identity.brand.toLowerCase())) {
          titleBoost += 25;
        }
        if (identity.color && t.includes(identity.color.toLowerCase())) {
          titleBoost += 40;
        } else if (identity.color && t.length > 0) {
          titleBoost -= 15;
        }
        addUrl(img.imageUrl, "serper", titleBoost, img.link, img.title);
      }
    }
  }

  const sortedUrls = Array.from(collected.values())
    .sort((a, b) => b.boost - a.boost)
    .slice(0, 40);

  const probed = await validateImages(sortedUrls.map((s) => s.url));
  const metaByUrl = new Map(sortedUrls.map((s) => [s.url, s]));

  const images = probed
    .filter((img) => !isBlockedHost(img.url))
    .map((img) => ({
      ...img,
      source: metaByUrl.get(img.url)?.source ?? ("serper" as const),
      _boost: metaByUrl.get(img.url)?.boost ?? 0,
    }))
    .sort((a, b) => b._boost - a._boost)
    .slice(0, MAX_CANDIDATE_IMAGES)
    .map(({ _boost, ...rest }) => rest);

  return { images, identity };
}
