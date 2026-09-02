"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ProductRowActions, type RowProduct } from "@/components/ProductRowActions";

interface ListProduct extends RowProduct {
  title: string | null;
  rawTitle: string | null;
  suggestedPrice: string | number | null;
  costPrice: string | number | null;
  maxBidLot: string | number | null;
  eventWeekKey: string | null;
  sourceSite: string;
  createdAt: string;
  imageUrl: string | null;
  stockQty?: number;
  lowStockThreshold?: number;
  assignedTo?: string | null;
}

function formatPrice(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return `${n.toFixed(2)} $`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function ProductPipelineList({ products }: { products: ListProduct[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const publishableIds = useMemo(
    () =>
      products
        .filter(
          (p) =>
            (p.status === "ready" || p.status === "error") && !p.shopifyProductId
        )
        .map((p) => p.id),
    [products]
  );

  const selectedPublishable = publishableIds.filter((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllReady() {
    setSelected(new Set(publishableIds));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkPublish() {
    if (selectedPublishable.length === 0) return;
    setPublishing(true);
    setBulkMsg(null);
    let ok = 0;
    let fail = 0;
    for (const id of selectedPublishable) {
      try {
        const res = await fetch(`/api/publish/${id}`, { method: "POST" });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkMsg(`Publié ${ok}${fail ? ` · échecs ${fail}` : ""}`);
    setSelected(new Set());
    setPublishing(false);
    startTransition(() => router.refresh());
  }

  if (products.length === 0) {
    return (
      <div className="panel panel-glow flex flex-col items-center px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] text-2xl text-[var(--accent)]">
          ◈
        </div>
        <h2 className="font-display mt-5 text-xl font-semibold">Pipeline vide</h2>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)]">
          Ouvrez l&apos;extension Chrome sur une fiche maxx.ca et cliquez{" "}
          <span className="text-[var(--accent)]">Sniper</span> pour démarrer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(publishableIds.length > 0 || selected.size > 0) && (
        <div className="panel flex flex-wrap items-center gap-3 p-3">
          <span className="text-xs text-[var(--text-muted)]">
            {publishableIds.length} prêt(s) à publier
          </span>
          <button
            type="button"
            onClick={selectAllReady}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Tout sélectionner
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
            >
              Effacer
            </button>
          )}
          <button
            type="button"
            disabled={publishing || selectedPublishable.length === 0}
            onClick={() => void bulkPublish()}
            className="btn btn-primary ml-auto text-xs disabled:opacity-40"
          >
            {publishing
              ? "Publication…"
              : `Publier ${selectedPublishable.length || ""}`.trim()}
          </button>
          {bulkMsg && (
            <span className="w-full text-xs text-[var(--success)] sm:w-auto">
              {bulkMsg}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {products.map((product, index) => {
          const sell = formatPrice(product.suggestedPrice);
          const cost = formatPrice(product.costPrice);
          const margin =
            product.suggestedPrice != null && product.costPrice != null
              ? Math.round(
                  ((Number(product.suggestedPrice) - Number(product.costPrice)) /
                    Number(product.suggestedPrice)) *
                    100
                )
              : null;
          const selectable =
            (product.status === "ready" || product.status === "error") &&
            !product.shopifyProductId;

          return (
            <div
              key={product.id}
              className="panel panel-glow group flex gap-3 p-3 transition hover:border-[var(--border-strong)] sm:gap-4 sm:p-4"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Link
                href={`/products/${product.id}`}
                className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-elevated)] sm:h-28 sm:w-28"
              >
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--text-faint)]">
                    Aucune image
                  </div>
                )}
              </Link>

              <div className="min-w-0 flex-1 py-0.5">
                <Link href={`/products/${product.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display line-clamp-2 text-base font-semibold tracking-tight sm:text-lg">
                      {product.title ?? product.rawTitle ?? "Sans titre"}
                    </h2>
                    <StatusBadge status={product.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--text-faint)]">
                    {product.sourceSite} · {formatDate(product.createdAt)}
                    {product.lotQuantity > 1 ? ` · ×${product.lotQuantity}` : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {sell && (
                      <span className="font-semibold text-[var(--accent)]">{sell}</span>
                    )}
                    {product.maxBidLot != null && (
                      <span className="text-[var(--warning)]">
                        Max bid {formatPrice(product.maxBidLot)}
                      </span>
                    )}
                    {cost && (
                      <span className="text-[var(--text-muted)]">Landed {cost}</span>
                    )}
                    {margin != null && (
                      <span className="text-[var(--text-faint)]">Markup {margin}%</span>
                    )}
                    <span className="capitalize text-[var(--text-faint)]">
                      {product.bidStatus}
                    </span>
                    <span
                      className={
                        (product.stockQty ?? 0) <= (product.lowStockThreshold ?? 1)
                          ? "text-[var(--danger)]"
                          : "text-[var(--success)]"
                      }
                    >
                      Stock {product.stockQty ?? 0}
                    </span>
                    {product.assignedTo && (
                      <span className="truncate text-[var(--text-faint)]">
                        @{product.assignedTo.split("@")[0]}
                      </span>
                    )}
                    {product.eventWeekKey && (
                      <span className="hidden text-[var(--text-faint)] md:inline">
                        {product.eventWeekKey.replace(/^maxx-/, "")}
                      </span>
                    )}
                  </div>
                </Link>
              </div>

              <ProductRowActions
                product={product}
                selectable={selectable}
                selected={selected.has(product.id)}
                onToggleSelect={() => toggle(product.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
