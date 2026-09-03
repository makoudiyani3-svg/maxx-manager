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
      <div className="bento flex flex-col items-center px-6 py-20 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-white">
          M
        </div>
        <h2 className="font-display mt-5 text-xl font-semibold">Pipeline vide</h2>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)]">
          Collez une URL Maxx dans Capture, ou utilisez l&apos;extension Chrome.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(publishableIds.length > 0 || selected.size > 0) && (
        <div className="bento flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <span className="text-xs text-[var(--text-muted)]">
            {publishableIds.length} prêt(s) à publier
          </span>
          <button
            type="button"
            onClick={selectAllReady}
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Tout sélectionner
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs text-[var(--text-muted)]"
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((product, index) => {
          const sell = formatPrice(product.suggestedPrice);
          const selectable =
            (product.status === "ready" || product.status === "error") &&
            !product.shopifyProductId;

          return (
            <article
              key={product.id}
              className="bento group flex flex-col overflow-hidden transition hover:-translate-y-0.5"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Link
                href={`/products/${product.id}`}
                className="relative aspect-square overflow-hidden bg-[var(--bg)]"
              >
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
                    Pas d&apos;image
                  </div>
                )}
                <div className="absolute left-3 top-3">
                  <StatusBadge status={product.status} />
                </div>
              </Link>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <Link href={`/products/${product.id}`} className="min-w-0">
                  <h2 className="font-display line-clamp-2 text-base font-semibold tracking-tight">
                    {product.title ?? product.rawTitle ?? "Sans titre"}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {sell && (
                      <span className="font-semibold">{sell}</span>
                    )}
                    <span className="capitalize text-[var(--text-faint)]">
                      {product.bidStatus}
                    </span>
                    <span
                      className={
                        (product.stockQty ?? 0) <= (product.lowStockThreshold ?? 1)
                          ? "text-[var(--danger)]"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      Stock {product.stockQty ?? 0}
                    </span>
                  </div>
                </Link>

                <div className="mt-auto border-t border-[var(--border)] pt-3">
                  <ProductRowActions
                    product={product}
                    selectable={selectable}
                    selected={selected.has(product.id)}
                    onToggleSelect={() => toggle(product.id)}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
