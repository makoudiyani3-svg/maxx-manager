"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AlertProduct = {
  id: string;
  title: string | null;
  rawTitle: string | null;
  stockQty: number;
  lowStockThreshold: number;
  assignedTo: string | null;
  shopifyAvailableQty: number | null;
};

type AlertsPayload = {
  lowStockCount: number;
  oversoldCount: number;
  unassignedCount: number;
  lowStock: AlertProduct[];
  oversold: AlertProduct[];
  unassigned: AlertProduct[];
};

export function InventoryAlertsPanel({
  focus,
}: {
  focus?: "low" | "unassigned" | "oversold" | null;
}) {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory/alerts")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Échec alertes");
        return json as AlertsPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-[rgba(255,107,107,0.3)] px-4 py-3 text-sm text-[var(--danger)]">
        Alertes: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs text-[var(--text-faint)]">Chargement alertes inventaire…</div>
    );
  }

  const total =
    data.lowStockCount + data.oversoldCount + data.unassignedCount;
  if (total === 0 && !focus) return null;

  const sections = (
    [
      {
        key: "oversold" as const,
        title: "Survente Shopify",
        count: data.oversoldCount,
        items: data.oversold,
        danger: true,
      },
      {
        key: "low" as const,
        title: "Stock bas",
        count: data.lowStockCount,
        items: data.lowStock.slice(0, 12),
        danger: true,
      },
      {
        key: "unassigned" as const,
        title: "À assigner",
        count: data.unassignedCount,
        items: data.unassigned,
        danger: false,
      },
    ] as const
  ).filter((s) => (focus ? s.key === focus : s.count > 0));

  return (
    <section className="bento flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            File d&apos;alertes
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            {data.oversoldCount} survente · {data.lowStockCount} bas ·{" "}
            {data.unassignedCount} non assignés
          </p>
        </div>
        {focus && (
          <Link href="/" className="text-xs text-[var(--info)] hover:underline">
            Voir tout
          </Link>
        )}
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-[var(--success)]">Aucune alerte sur ce filtre.</p>
      ) : (
        sections.map((section) => (
          <div key={section.key}>
            <p
              className={`mb-2 text-xs font-semibold uppercase tracking-wider ${
                section.danger ? "text-[var(--danger)]" : "text-[var(--text-faint)]"
              }`}
            >
              {section.title} ({section.count})
            </p>
            <ul className="space-y-1">
              {section.items.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                  >
                    <span className="min-w-0 truncate">
                      {p.title ?? p.rawTitle ?? "Sans titre"}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-[var(--text-faint)]">
                      stock {p.stockQty}
                      {p.shopifyAvailableQty != null
                        ? ` · shopify ${p.shopifyAvailableQty}`
                        : ""}
                      {p.assignedTo ? ` · ${p.assignedTo.split("@")[0]}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
