function queryFirst(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function extractText(selectors) {
  const el = queryFirst(selectors);
  return el?.textContent?.trim() ?? "";
}

function parsePrice(text) {
  const match = text.replace(/,/g, ".").match(/[\d]+(?:\.\d{2})?/);
  return match ? parseFloat(match[0]) : undefined;
}

function extractLargestFromSrcset(srcset) {
  if (!srcset) return null;
  const parts = srcset.split(",").map((p) => p.trim());
  let bestUrl = "";
  let bestWidth = 0;
  for (const part of parts) {
    const segments = part.split(/\s+/);
    const url = segments[0];
    const width = parseInt(segments[1]?.replace("w", "") ?? "0", 10);
    if (width >= bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }
  return bestUrl || null;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  let cleaned = url.trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) return null;
  if (cleaned.startsWith("//")) cleaned = `https:${cleaned}`;
  if (cleaned.startsWith("/")) cleaned = `${window.location.origin}${cleaned}`;
  try {
    const parsed = new URL(cleaned);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelyProductImage(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("placeholder") || lower.includes("icon") || lower.includes("logo")) {
    return false;
  }
  if (lower.includes("avatar") || lower.includes("sprite") || lower.includes("favicon")) {
    return false;
  }
  return (
    /\.(jpe?g|png|webp|gif)(\?|$)/i.test(lower) ||
    lower.includes("image") ||
    lower.includes("photo") ||
    lower.includes("cdn") ||
    lower.includes("media") ||
    lower.includes("blob.core") ||
    lower.includes("cloudinary") ||
    lower.includes("imgix")
  );
}

function addImage(urls, candidate) {
  const url = normalizeUrl(candidate);
  if (url && isLikelyProductImage(url)) {
    urls.add(url);
  }
}

function extractImages() {
  const urls = new Set();

  // Open Graph / Twitter cards — often the best product photo
  document
    .querySelectorAll(
      'meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], link[rel="image_src"]'
    )
    .forEach((el) => {
      addImage(urls, el.getAttribute("content") || el.getAttribute("href"));
    });

  // Targeted gallery selectors
  document.querySelectorAll(MAXX_SELECTORS.images.join(", ")).forEach((img) => {
    addImage(urls, extractLargestFromSrcset(img.getAttribute("srcset")));
    addImage(urls, img.getAttribute("src"));
    addImage(urls, img.getAttribute("data-src"));
    addImage(urls, img.getAttribute("data-lazy"));
    addImage(urls, img.getAttribute("data-original"));
    addImage(urls, img.getAttribute("data-zoom-image"));
  });

  // All images on page as fallback
  if (urls.size < 2) {
    document.querySelectorAll("img").forEach((img) => {
      const w = img.naturalWidth || parseInt(img.getAttribute("width") || "0", 10);
      const h = img.naturalHeight || parseInt(img.getAttribute("height") || "0", 10);
      if (w > 0 && w < 80) return;
      if (h > 0 && h < 80) return;

      addImage(urls, extractLargestFromSrcset(img.getAttribute("srcset")));
      addImage(urls, img.getAttribute("src"));
      addImage(urls, img.getAttribute("data-src"));
      addImage(urls, img.getAttribute("data-lazy"));
      addImage(urls, img.getAttribute("data-original"));
    });
  }

  // Background-image URLs in style attributes
  if (urls.size < 2) {
    document.querySelectorAll("[style*='background']").forEach((el) => {
      const style = el.getAttribute("style") || "";
      const match = style.match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) addImage(urls, match[2]);
    });
  }

  // Raw URLs embedded in page HTML (common on auction platforms)
  if (urls.size < 2) {
    const html = document.documentElement.innerHTML;
    const matches = html.match(
      /https?:\/\/[^"'>\s]+\.(?:jpe?g|png|webp)(?:\?[^"'>\s]*)?/gi
    );
    (matches || []).slice(0, 30).forEach((url) => addImage(urls, url));
  }

  return Array.from(urls).slice(0, 12);
}

function extractVariants() {
  const variants = [];
  document.querySelectorAll(MAXX_SELECTORS.variants.join(", ")).forEach((select) => {
    const options = Array.from(select.options).map((opt) => ({
      name: select.name || select.id,
      value: opt.value,
      label: opt.textContent?.trim(),
    }));
    if (options.length > 0) {
      variants.push({ select: select.name || select.id, options });
    }
  });
  return variants;
}

function extractSourceId() {
  const match =
    window.location.pathname.match(/\/(?:LotDetails|Details|Listing\/Details|products?)\/(\d+)/i) ||
    window.location.pathname.match(/\/(\d{6,})\//);
  return match?.[1] ?? undefined;
}

function extractLotQuantity(title) {
  const m = (title || "").match(/^\s*(\d+)\s*[-x×]/i);
  if (m) return parseInt(m[1], 10);
  const m2 = (title || "").match(/\b(\d+)\s*(?:pcs?|units?|pi[eè]ces?)\b/i);
  if (m2) return parseInt(m2[1], 10);
  return 1;
}

function extractEventMeta() {
  const path = window.location.pathname;
  let eventId = null;
  let eventName = null;

  const details = path.match(/\/Event\/(?:Details|Index)\/(\d+)/i);
  if (details) eventId = details[1];

  const eventLink = document.querySelector(
    'a[href*="/Event/Details/"], a[href*="/Event/Index/"], a[href*="/Event/"]'
  );
  if (eventLink) {
    const href = eventLink.getAttribute("href") || "";
    const idMatch = href.match(/\/Event\/(?:Details|Index)\/(\d+)/i);
    if (idMatch) eventId = idMatch[1];
    const name = eventLink.textContent?.trim();
    if (name && name.length < 120) eventName = name;
  }

  const breadcrumb = document.querySelector(
    ".breadcrumb, .breadcrumbs, nav[aria-label='breadcrumb']"
  );
  if (!eventName && breadcrumb) {
    const t = breadcrumb.textContent?.replace(/\s+/g, " ").trim();
    if (t && t.length < 160) eventName = t;
  }

  const lotMatch = path.match(/\/Event\/LotDetails\/(\d+)/i);
  const eventWeekKey = eventId
    ? `maxx-event-${eventId}`
    : lotMatch
      ? `maxx-lotweek-${lotMatch[1].slice(0, 5)}`
      : undefined;

  // Try auction end from page text
  let auctionEndsAt = undefined;
  const endEl = queryFirst(
    MAXX_SELECTORS.auctionEnd || [
      "[class*='end']",
      "[class*='closes']",
      "[data-end]",
      ".auction-end",
      ".lot-ends",
    ]
  );
  const endText = endEl?.textContent || "";
  const dateGuess = endText.match(
    /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/
  );
  if (dateGuess) {
    const d = new Date(dateGuess[0]);
    if (!Number.isNaN(d.getTime())) auctionEndsAt = d.toISOString();
  }

  return { eventId, eventName, eventWeekKey, auctionEndsAt };
}

function extractProductData() {
  const title = extractText(MAXX_SELECTORS.title);
  const priceText = extractText(MAXX_SELECTORS.price);
  let description = extractText(MAXX_SELECTORS.description);

  const extras = [];
  document
    .querySelectorAll(
      [
        ...(MAXX_SELECTORS.condition || []),
        ".notes",
        "[class*='color']",
        "[class*='finish']",
        ".specifications",
        ".details",
      ].join(", ")
    )
    .forEach((el) => {
      const t = el.textContent?.trim();
      if (t && t.length > 3 && t.length < 500) extras.push(t);
    });
  if (extras.length) {
    description = [description, ...extras].filter(Boolean).join("\n");
  }

  const images = extractImages();
  const variants = extractVariants();
  const resolvedTitle =
    title || document.title.replace(/\s*\|\s*Maxx.*/i, "").trim();
  const event = extractEventMeta();

  return {
    sourceUrl: window.location.href.split("?")[0],
    sourceSite: "maxx.ca",
    sourceId: extractSourceId(),
    title: resolvedTitle,
    price: parsePrice(priceText),
    description,
    images,
    variants,
    lotQuantity: extractLotQuantity(resolvedTitle),
    eventId: event.eventId || undefined,
    eventName: event.eventName || undefined,
    eventWeekKey: event.eventWeekKey || undefined,
    auctionEndsAt: event.auctionEndsAt || undefined,
  };
}

function showToast(message, type = "success") {
  const existing = document.getElementById("maxx-sniper-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "maxx-sniper-toast";
  toast.className = `maxx-sniper-toast maxx-sniper-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

function createSniperButton() {
  if (document.getElementById("maxx-sniper-btn")) return;

  const btn = document.createElement("button");
  btn.id = "maxx-sniper-btn";
  btn.className = "maxx-sniper-btn";
  btn.innerHTML = "Sniper";
  btn.title = "Envoyer ce produit à Maxx Manager";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Envoi...";

    const data = extractProductData();

    if (!data.title) {
      showToast("Impossible d'extraire le titre du produit", "error");
      btn.disabled = false;
      btn.innerHTML = "Sniper";
      return;
    }

    if (!data.images.length) {
      showToast("Aucune image trouvée — envoi quand même...", "warning");
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_PRODUCT",
        payload: data,
      });

      if (response.success) {
        const imgNote = data.images.length
          ? ` (${data.images.length} images)`
          : " (sans image)";
        showToast(`Produit envoyé!${imgNote}`, "success");
      } else if (response.duplicate) {
        showToast("Produit déjà capturé", "warning");
      } else {
        showToast(response.error || "Erreur d'envoi", "error");
      }
    } catch (err) {
      showToast("Erreur: configurez l'extension dans le popup", "error");
      console.error(err);
    }

    btn.disabled = false;
    btn.innerHTML = "Sniper";
  });

  document.body.appendChild(btn);
}

function isProductPage() {
  const path = window.location.pathname.toLowerCase();
  return (
    path.includes("/lotdetails") ||
    path.includes("/listing/details") ||
    path.includes("/details/") ||
    path.includes("/product") ||
    document.querySelector("h1") !== null
  );
}

if (isProductPage()) {
  createSniperButton();
}

const observer = new MutationObserver(() => {
  if (isProductPage()) createSniperButton();
});
observer.observe(document.body, { childList: true, subtree: true });
