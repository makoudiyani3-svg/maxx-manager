"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Countdown } from "@/components/WarRoomHeader";

export interface RowProduct {
  id: string;
  status: string;
  bidStatus: string;
  sourceUrl: string;
  shopifyProductId: string | null;
  inventorySyncedAt: string | Date | null;
  auctionEndsAt: string | Date | null;
  lotQuantity: number;
}

const SHOPIFY_STORE_SLUG = "3efvmm-mp";

function shopifyAdminUrl(gid: string): string | null {
  const match = gid.match(/Product\/(\d+)/);
  if (!match) return null;
  return `https://admin.shopify.com/store/${SHOPIFY_STORE_SLUG}/products/${match[1]}`;
}

export function ProductRowActions({
  product,
  selected,
  onToggleSelect,
  selectable,
}: {
  product: RowProduct;
  selected?: boolean;
  onToggleSelect?: () => void;
  selectable?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setMsg(null);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Échec");
    if (data.inventorySync && !data.inventorySync.ok) {
      setMsg(`Stock: ${data.inventorySync.error}`);
    } else if (data.inventorySync?.ok) {
      setMsg(`Stock OK ×${data.inventorySync.quantity}`);
    }
    startTransition(() => router.refresh());
    return data;
  }

  async function setBid(status: string) {
    setBusy(status);
    try {
      await patch({ bidStatus: status });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    try {
      const res = await fetch(`/api/publish/${product.id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Publish failed");
      setMsg("Publié");
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur publish");
    } finally {
      setBusy(null);
    }
  }

  async function syncStock() {
    setBusy("stock");
    try {
      await patch({ syncInventory: true, bidStatus: "won" });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur stock");
    } finally {
      setBusy(null);
    }
  }

  const adminUrl = product.shopifyProductId
    ? shopifyAdminUrl(product.shopifyProductId)
    : null;
  const needsStock =
    product.bidStatus === "won" &&
    Boolean(product.shopifyProductId) &&
    !product.inventorySyncedAt;
  const canPublish =
    product.status === "ready" &&
    !product.shopifyProductId &&
    product.bidStatus !== "skipped" &&
    product.bidStatus !== "lost";

  const disabled = Boolean(busy) || pending;

  return (
    <div
      className="flex flex-col items-end gap-2"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {product.auctionEndsAt && (
        <Countdown endsAt={product.auctionEndsAt} className="text-xs" />
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {selectable && (
          <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[0.65rem] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={onToggleSelect}
              className="accent-[var(--accent)]"
            />
            Bulk
          </label>
        )}

        <a
          href={product.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[0.65rem] text-[var(--info)] hover:border-[var(--border-strong)]"
        >
          Maxx
        </a>
        {adminUrl && (
          <a
            href={adminUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[0.65rem] text-[var(--success)] hover:border-[var(--border-strong)]"
          >
            Shopify
          </a>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-1">
        {(["won", "lost", "skipped"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => void setBid(s)}
            className={`rounded-md px-2 py-1 text-[0.65rem] font-semibold capitalize transition ${
              product.bidStatus === s
                ? s === "won"
                  ? "bg-[var(--success)] text-[#0a0c0b]"
                  : s === "lost"
                    ? "bg-[var(--danger)] text-white"
                    : "bg-[var(--text-faint)] text-[#0a0c0b]"
                : "border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {busy === s ? "…" : s}
          </button>
        ))}
        {canPublish && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void publish()}
            className="rounded-md bg-[var(--accent)] px-2 py-1 text-[0.65rem] font-bold text-[#0a0c0b]"
          >
            {busy === "publish" ? "…" : "Publier"}
          </button>
        )}
        {needsStock && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void syncStock()}
            className="rounded-md bg-[var(--warning)] px-2 py-1 text-[0.65rem] font-bold text-[#0a0c0b]"
          >
            {busy === "stock" ? "…" : "Activer stock"}
          </button>
        )}
      </div>

      {msg && (
        <p className="max-w-[12rem] text-right text-[0.6rem] text-[var(--text-faint)]">
          {msg}
        </p>
      )}
    </div>
  );
}
