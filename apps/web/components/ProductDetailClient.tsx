"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { Countdown } from "@/components/WarRoomHeader";

const SHOPIFY_STORE_SLUG = "3efvmm-mp";

function shopifyAdminUrl(gid: string): string | null {
  const match = gid.match(/Product\/(\d+)/);
  if (!match) return null;
  return `https://admin.shopify.com/store/${SHOPIFY_STORE_SLUG}/products/${match[1]}`;
}

interface ProductImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  isSelected: boolean;
  position: number;
  source: string;
}

interface MarketAnalysis {
  competitorPrices?: number[];
  suggestedPrice?: number;
  marginPercent?: number;
  demandScore?: number;
  competitionLevel?: string;
  recommendation?: string;
  summary?: string;
  deal?: {
    maxBidLot?: number;
    maxBidUnit?: number;
    transportPerArticle?: number;
    unitLandedAtMaxBid?: number;
    unitLandedAtCurrentBid?: number | null;
    markupAtMaxBidPercent?: number;
    isViable?: boolean;
    skipReason?: string | null;
    articlesInWeek?: number;
    premiumRate?: number;
    weeklyTransport?: number;
  };
}

interface Product {
  id: string;
  status: string;
  sourceUrl: string;
  rawTitle: string | null;
  rawPrice: string | null;
  title: string | null;
  descriptionHtml: string | null;
  suggestedPrice: string | null;
  costPrice: string | null;
  tags: string[];
  marketAnalysis: MarketAnalysis | null;
  shopifyProductId: string | null;
  inventorySyncedAt?: string | null;
  errorMessage: string | null;
  images: ProductImage[];
  eventWeekKey: string | null;
  eventName: string | null;
  auctionEndsAt?: string | null;
  lotQuantity: number;
  bidStatus: string;
  maxBidLot: string | null;
  maxBidUnit: string | null;
  transportShare: string | null;
  dealMath: MarketAnalysis["deal"] | null;
}

type Tab = "edit" | "preview" | "market" | "images";

export function ProductDetailClient({ product }: { product: Product }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("edit");
  const [title, setTitle] = useState(product.title ?? product.rawTitle ?? "");
  const [description, setDescription] = useState(product.descriptionHtml ?? "");
  const [price, setPrice] = useState(
    product.suggestedPrice ? Number(product.suggestedPrice).toFixed(2) : ""
  );
  const [selectedImages, setSelectedImages] = useState<Set<string>>(
    new Set(product.images.filter((i) => i.isSelected).map((i) => i.id))
  );
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const market = product.marketAnalysis;
  const deal = market?.deal ?? product.dealMath;
  const heroImage = useMemo(() => {
    const selected = product.images.find((i) => selectedImages.has(i.id));
    return selected ?? product.images[0];
  }, [product.images, selectedImages]);

  const isErrorMsg = Boolean(
    message && (message.includes("Erreur") || message.includes("Échec"))
  );

  function toggleImage(id: string) {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveProduct() {
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        descriptionHtml: description,
        suggestedPrice: parseFloat(price),
        selectedImageIds: Array.from(selectedImages),
      }),
    });
    if (!res.ok) throw new Error("Échec de la sauvegarde");
    router.refresh();
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await saveProduct();
      setMessage("Modifications sauvegardées");
    } catch {
      setMessage("Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function handleReenrich() {
    setEnriching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/enrich/${product.id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec de l'enrichissement");
      setMessage("Enrichissement terminé");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur d'enrichissement");
    } finally {
      setEnriching(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    try {
      await saveProduct();
      const res = await fetch(`/api/publish/${product.id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec de la publication");
      setMessage(`Publié sur Shopify — ${data.shopifyProductId}`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur de publication");
    } finally {
      setPublishing(false);
    }
  }

  async function setBidStatus(status: string) {
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidStatus: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec");
      if (data.inventorySync?.ok) {
        setMessage(`Won — stock Shopify ×${data.inventorySync.quantity}`);
      } else if (data.inventorySync && !data.inventorySync.ok) {
        setMessage(`Won — stock sync échoué: ${data.inventorySync.error}`);
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur enchère");
    }
  }

  async function syncInventory() {
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncInventory: true, bidStatus: "won" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec");
      if (data.inventorySync?.ok) {
        setMessage(`Stock activé ×${data.inventorySync.quantity}`);
      } else if (data.inventorySync && !data.inventorySync.ok) {
        setMessage(`Stock: ${data.inventorySync.error}`);
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur stock");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "edit", label: "Édition" },
    { id: "preview", label: "Aperçu" },
    { id: "market", label: "Marché" },
    { id: "images", label: `Images (${selectedImages.size})` },
  ];

  const adminUrl = product.shopifyProductId
    ? shopifyAdminUrl(product.shopifyProductId)
    : null;
  const needsStock =
    product.bidStatus === "won" &&
    Boolean(product.shopifyProductId) &&
    !product.inventorySyncedAt;

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-faint)] transition hover:text-[var(--accent)]"
          >
            ← War Room
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {title || "Sans titre"}
            </h1>
            <StatusBadge status={product.status} />
          </div>
          <a
            href={product.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block max-w-full truncate text-sm text-[var(--info)] hover:underline"
          >
            {product.sourceUrl}
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          {(product.status === "error" ||
            product.status === "captured" ||
            product.status === "ready") && (
            <button
              onClick={handleReenrich}
              disabled={enriching}
              className="btn btn-ghost"
            >
              {enriching ? "Enrichissement…" : "Relancer IA"}
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className="btn btn-secondary">
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
          {product.status === "ready" && !product.shopifyProductId && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="btn btn-primary"
            >
              {publishing ? "Publication…" : "Publier sur Shopify"}
            </button>
          )}
        </div>
      </div>

      {(message || product.errorMessage || product.shopifyProductId) && (
        <div className="space-y-2">
          {message && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                isErrorMsg
                  ? "border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.1)] text-[var(--danger)]"
                  : "border-[rgba(94,224,154,0.3)] bg-[rgba(94,224,154,0.1)] text-[var(--success)]"
              }`}
            >
              {message}
            </div>
          )}
          {product.errorMessage && (
            <div className="rounded-xl border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.1)] px-4 py-3 text-sm text-[var(--danger)]">
              {product.errorMessage}
            </div>
          )}
          {product.shopifyProductId && (
            <div className="rounded-xl border border-[rgba(94,224,154,0.3)] bg-[rgba(94,224,154,0.1)] px-4 py-3 text-sm text-[var(--success)]">
              Live sur Shopify
              {adminUrl ? (
                <>
                  {" — "}
                  <a
                    href={adminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:no-underline"
                  >
                    Ouvrir dans Admin
                  </a>
                </>
              ) : (
                <> — {product.shopifyProductId}</>
              )}
              {product.inventorySyncedAt && (
                <span className="ml-2 text-[var(--text-faint)]">
                  · stock sync OK
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="panel panel-glow sticky top-16 z-10 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between lg:top-4">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Décision enchère
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="font-display text-2xl font-bold text-[var(--warning)]">
              {product.maxBidLot != null
                ? `${Number(product.maxBidLot).toFixed(2)} $`
                : "—"}
              <span className="ml-2 text-xs font-medium text-[var(--text-faint)]">
                max bid lot
              </span>
            </p>
            {product.auctionEndsAt && (
              <p className="text-sm">
                Fin <Countdown endsAt={product.auctionEndsAt} className="font-semibold" />
              </p>
            )}
            {deal?.isViable === false && (
              <p className="text-sm text-[var(--danger)]">
                {deal.skipReason ?? "Non viable"}
              </p>
            )}
            {deal?.isViable === true && (
              <p className="text-sm text-[var(--success)]">Deal viable</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["won", "lost", "skipped"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void setBidStatus(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
                product.bidStatus === s
                  ? s === "won"
                    ? "bg-[var(--success)] text-[#0a0c0b]"
                    : s === "lost"
                      ? "bg-[var(--danger)] text-white"
                      : "bg-[var(--text-faint)] text-[#0a0c0b]"
                  : "border border-[var(--border)] text-[var(--text-muted)]"
              }`}
            >
              {s}
            </button>
          ))}
          {product.status === "ready" && !product.shopifyProductId && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="btn btn-primary text-xs"
            >
              {publishing ? "…" : "Publier"}
            </button>
          )}
          {needsStock && (
            <button
              type="button"
              onClick={() => void syncInventory()}
              className="rounded-full bg-[var(--warning)] px-3 py-1.5 text-xs font-bold text-[#0a0c0b]"
            >
              Activer stock
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="panel panel-glow overflow-hidden">
          <div className="aspect-square bg-[var(--bg-elevated)]">
            {heroImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroImage.url}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
                Pas d&apos;image
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div>
              <p className="field-label">Prix de vente</p>
              <p className="stat-value text-[var(--accent)]">
                {price ? `${Number(price).toFixed(2)} $` : "—"}
              </p>
            </div>
            {product.costPrice && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-faint)]">Coût landed*</span>
                <span>{Number(product.costPrice).toFixed(2)} $</span>
              </div>
            )}
            {product.maxBidLot != null && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-faint)]">Max enchère lot</span>
                <span className="font-semibold text-[var(--warning)]">
                  {Number(product.maxBidLot).toFixed(2)} $
                </span>
              </div>
            )}
            {product.transportShare != null && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-faint)]">Transport / art.</span>
                <span>{Number(product.transportShare).toFixed(2)} $</span>
              </div>
            )}
            {market?.marginPercent != null && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-faint)]">Markup vs coût</span>
                <span className="text-[var(--success)]">{market.marginPercent}%</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-faint)]">Enchère</span>
              <span className="capitalize">{product.bidStatus}</span>
            </div>
            {product.eventWeekKey && (
              <div className="pt-1 text-[0.65rem] text-[var(--text-faint)]">
                {product.eventName ?? product.eventWeekKey}
                {product.lotQuantity > 1 ? ` · lot ×${product.lotQuantity}` : ""}
              </div>
            )}
            <p className="text-[0.6rem] leading-relaxed text-[var(--text-faint)]">
              *Coût = enchère×1.30 ÷ qty + transport (400$/sem ÷ articles event)
            </p>
            {product.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {product.tags.slice(0, 6).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[0.65rem] text-[var(--text-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  tab === t.id
                    ? "bg-[var(--bg-hover)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "edit" && (
            <section className="panel panel-glow space-y-4 p-5">
              <div>
                <label className="field-label">Titre</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label">Prix suggéré ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="field max-w-xs"
                />
              </div>
              <div>
                <label className="field-label">Description HTML</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={12}
                  className="field font-mono text-[0.8rem] leading-relaxed"
                />
              </div>
            </section>
          )}

          {tab === "preview" && (
            <section className="panel panel-glow p-5">
              <h2 className="font-display text-xl font-semibold">{title}</h2>
              {price && (
                <p className="mt-2 text-2xl font-bold text-[var(--accent)]">
                  {Number(price).toFixed(2)} $
                </p>
              )}
              <div
                className="prose-preview mt-5 border-t border-[var(--border)] pt-5 text-sm"
                dangerouslySetInnerHTML={{ __html: description || "<p>Aucune description</p>" }}
              />
            </section>
          )}

          {tab === "market" && (
            <section className="panel panel-glow p-5">
              {deal && (
                <div className="mb-5 rounded-xl border border-[rgba(245,197,66,0.35)] bg-[rgba(245,197,66,0.08)] p-4">
                  <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--warning)]">
                    Plafond d&apos;enchère (event Maxx)
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      {
                        label: "Max bid lot",
                        value: `${Number(deal.maxBidLot ?? product.maxBidLot ?? 0).toFixed(2)} $`,
                      },
                      {
                        label: "Max bid / u",
                        value: `${Number(deal.maxBidUnit ?? product.maxBidUnit ?? 0).toFixed(2)} $`,
                      },
                      {
                        label: "Transport / art.",
                        value: `${Number(deal.transportPerArticle ?? product.transportShare ?? 0).toFixed(2)} $`,
                      },
                      {
                        label: "Landed @ max",
                        value: `${Number(deal.unitLandedAtMaxBid ?? product.costPrice ?? 0).toFixed(2)} $`,
                      },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-[0.65rem] text-[var(--text-faint)]">{item.label}</p>
                        <p className="font-display text-lg font-semibold">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    Premium +{Math.round((deal.premiumRate ?? 0.3) * 100)}% · Transport{" "}
                    {deal.weeklyTransport ?? 400}$ ÷ {deal.articlesInWeek ?? "?"} articles · Marge
                    mini 100% (vente ≥ 2× coût)
                  </p>
                  {deal.skipReason && (
                    <p className="mt-2 text-sm text-[var(--danger)]">{deal.skipReason}</p>
                  )}
                  {product.rawPrice != null && (
                    <p className="mt-2 text-xs text-[var(--text-faint)]">
                      Enchère / prix Maxx actuel (lot): {Number(product.rawPrice).toFixed(2)} $
                      {deal.unitLandedAtCurrentBid != null
                        ? ` → landed unitaire ${deal.unitLandedAtCurrentBid.toFixed(2)} $`
                        : ""}
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4 flex flex-wrap gap-2">
                {(["watching", "capped", "published", "won", "lost", "skipped"] as const).map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void setBidStatus(s)}
                      className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                        product.bidStatus === s
                          ? "bg-[var(--accent)] text-[#0a0c0b]"
                          : "border border-[var(--border)] text-[var(--text-muted)]"
                      }`}
                    >
                      {s}
                    </button>
                  )
                )}
              </div>

              {market ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      {
                        label: "Prix suggéré",
                        value: market.suggestedPrice
                          ? `${market.suggestedPrice.toFixed(2)} $`
                          : "—",
                      },
                      {
                        label: "Markup",
                        value:
                          market.marginPercent != null
                            ? `${market.marginPercent}%`
                            : "—",
                      },
                      {
                        label: "Demande",
                        value:
                          market.demandScore != null
                            ? `${market.demandScore}/10`
                            : "—",
                      },
                      {
                        label: "Concurrence",
                        value: market.competitionLevel ?? "—",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
                      >
                        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                          {item.label}
                        </p>
                        <p className="font-display mt-1 text-lg font-semibold capitalize">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {market.competitorPrices && market.competitorPrices.length > 0 && (
                    <div className="mt-5">
                      <p className="field-label">Prix concurrents</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {market.competitorPrices
                          .map((p) => `${p.toFixed(2)} $`)
                          .join("  ·  ")}
                      </p>
                    </div>
                  )}

                  <p className="mt-5 text-sm leading-relaxed text-[var(--text-muted)]">
                    {market.summary}
                  </p>

                  <div className="mt-4">
                    <span
                      className={`badge ${
                        market.recommendation === "publish"
                          ? "border border-[rgba(94,224,154,0.3)] bg-[rgba(94,224,154,0.12)] text-[var(--success)]"
                          : market.recommendation === "skip"
                            ? "border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.12)] text-[var(--danger)]"
                            : "border border-[rgba(245,197,66,0.3)] bg-[rgba(245,197,66,0.12)] text-[var(--warning)]"
                      }`}
                    >
                      Reco: {market.recommendation}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  Aucune analyse de marché. Relancez l&apos;enrichissement IA.
                </p>
              )}
            </section>
          )}

          {tab === "images" && (
            <section className="panel panel-glow p-5">
              <p className="mb-4 text-sm text-[var(--text-muted)]">
                Cliquez pour sélectionner les images fabricant envoyées à Shopify.
                Les photos maxx.ca ne sont jamais utilisées.
              </p>
              {product.images.length === 0 ? (
                <p className="text-sm text-[var(--text-faint)]">Aucune image disponible.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {product.images.map((img) => {
                    const selected = selectedImages.has(img.id);
                    return (
                      <button
                        key={img.id}
                        onClick={() => toggleImage(img.id)}
                        className={`relative overflow-hidden rounded-xl border-2 transition ${
                          selected
                            ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-glow)]"
                            : "border-transparent opacity-55 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="aspect-square w-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2 text-left text-[0.65rem] text-white">
                          {img.width && img.height
                            ? `${img.width}×${img.height}`
                            : img.source}
                        </div>
                        {selected && (
                          <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[#0a0c0b]">
                            ✓
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
