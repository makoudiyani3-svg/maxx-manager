/** Soft minimum — keep source images even if smaller */
const MIN_IMAGE_WIDTH = 400;
const PREFERRED_IMAGE_WIDTH = 1200;

export function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const resizeParams = ["w", "width", "h", "height", "size", "resize", "fit"];
    resizeParams.forEach((param) => parsed.searchParams.delete(param));
    let pathname = parsed.pathname;
    pathname = pathname
      .replace(/\/(small|medium|thumb|thumbnail|_small|_medium)\//gi, "/")
      .replace(/_(small|medium|thumb|thumbnail)\./gi, ".");
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = normalizeImageUrl(url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export interface ImageProbeResult {
  url: string;
  width: number;
  height: number;
  valid: boolean;
}

export async function probeImage(url: string): Promise<ImageProbeResult | null> {
  try {
    const { assertSafeExternalUrl } = await import("@/lib/urlSafety");
    assertSafeExternalUrl(url);
    const probe = (await import("probe-image-size")).default;
    const result = await probe(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MaxxManager/1.0; +https://localhost)",
        Accept: "image/*,*/*",
      },
    });
    const width = result.width ?? 0;
    const height = result.height ?? 0;
    return {
      url,
      width,
      height,
      valid: width >= MIN_IMAGE_WIDTH || (width === 0 && height === 0),
    };
  } catch {
    // Keep URL even if probe fails (hotlink/CDN blocks HEAD) — unless SSRF
    try {
      const { assertSafeExternalUrl } = await import("@/lib/urlSafety");
      assertSafeExternalUrl(url);
      return { url, width: 0, height: 0, valid: true };
    } catch {
      return null;
    }
  }
}

export async function validateImages(urls: string[]): Promise<ImageProbeResult[]> {
  const normalized = dedupeUrls(urls);
  const results = await Promise.all(normalized.map(probeImage));
  return results
    .filter((r): r is ImageProbeResult => r !== null && r.valid)
    .sort((a, b) => {
      const scoreA = a.width * a.height || (a.width >= PREFERRED_IMAGE_WIDTH ? 1 : 0);
      const scoreB = b.width * b.height || (b.width >= PREFERRED_IMAGE_WIDTH ? 1 : 0);
      return scoreB - scoreA;
    });
}

export function extractLargestFromSrcset(srcset: string): string | null {
  const parts = srcset.split(",").map((p) => p.trim());
  let bestUrl = "";
  let bestWidth = 0;
  for (const part of parts) {
    const [url, descriptor] = part.split(/\s+/);
    const width = parseInt(descriptor?.replace("w", "") ?? "0", 10);
    if (width > bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }
  return bestUrl || null;
}
