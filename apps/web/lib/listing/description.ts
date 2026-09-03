import { escapeHtml, sanitizeHtml } from "@/lib/html";

function asBulletList(bullets: unknown): string[] {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map((b) => (typeof b === "string" ? b.trim() : ""))
    .filter((b) => b.length > 0)
    .slice(0, 8);
}

/** Merge bullets into description HTML if not already present as a list. */
export function buildStorefrontDescriptionHtml(input: {
  descriptionHtml?: string | null;
  bulletPoints?: unknown;
  rawDescription?: string | null;
  title?: string | null;
  preWin?: boolean;
}): string {
  const bullets = asBulletList(input.bulletPoints);
  let html = (input.descriptionHtml ?? "").trim();

  if (!html && input.rawDescription) {
    html = `<p>${escapeHtml(input.rawDescription)}</p>`;
  }
  if (!html && input.title) {
    html = `<p>${escapeHtml(input.title)}</p>`;
  }

  const hasList = /<ul[\s>]/i.test(html);
  if (bullets.length > 0 && !hasList) {
    const list = `<ul>${bullets
      .map((b) => `<li>${escapeHtml(b)}</li>`)
      .join("")}</ul>`;
    html = html ? `${html}\n${list}` : list;
  }

  if (input.preWin) {
    const note =
      "<p><strong>Précommande sur demande</strong> — réservez dès maintenant. On n’achète le lot que s’il y a de l’intérêt ; sinon la commande est annulée et remboursée. Expédition après réception au entrepôt UNIT411.</p>";
    if (
      !html.toLowerCase().includes("sur demande") &&
      !html.toLowerCase().includes("précommande") &&
      !html.toLowerCase().includes("precommande")
    ) {
      html = `${html}\n${note}`;
    }
  }

  return sanitizeHtml(html.trim());
}

export function clampSeoTitle(title: string, max = 70): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function clampSeoDescription(desc: string, max = 155): string {
  const t = desc.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function inferVendor(product: {
  tags?: string[];
  title?: string | null;
  rawTitle?: string | null;
}): string {
  const brandTag = (product.tags ?? []).find((t) =>
    t.toLowerCase().startsWith("brand:")
  );
  if (brandTag) return brandTag.slice(6).trim() || "UNIT411";

  const title = product.title ?? product.rawTitle ?? "";
  const first = title.trim().split(/\s+/)[0];
  if (first && first.length > 1 && !/^\d+$/.test(first)) return first;
  return "UNIT411";
}

export function inferProductType(product: {
  tags?: string[];
  productType?: string | null;
}): string | undefined {
  if (product.productType?.trim()) return product.productType.trim();
  const typeTag = (product.tags ?? []).find((t) =>
    t.toLowerCase().startsWith("type:")
  );
  if (typeTag) return typeTag.slice(5).trim() || undefined;
  return undefined;
}

export function marketCompareAtPrice(marketAnalysis: unknown): number | null {
  if (!marketAnalysis || typeof marketAnalysis !== "object") return null;
  const prices = (marketAnalysis as { competitorPrices?: unknown })
    .competitorPrices;
  if (!Array.isArray(prices)) return null;
  const nums = prices
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  const median =
    nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  return Math.round(median * 100) / 100;
}
