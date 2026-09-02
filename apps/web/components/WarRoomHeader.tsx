"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Terminé";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}j ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function Countdown({
  endsAt,
  className = "",
}: {
  endsAt: string | Date | null | undefined;
  className?: string;
}) {
  const target = endsAt ? new Date(endsAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target || Number.isNaN(target)) return null;

  const remaining = target - now;
  const urgent = remaining > 0 && remaining < 60 * 60 * 1000;

  return (
    <span
      className={`font-mono tabular-nums ${
        remaining <= 0
          ? "text-[var(--text-faint)]"
          : urgent
            ? "text-[var(--danger)]"
            : "text-[var(--warning)]"
      } ${className}`}
    >
      {formatCountdown(remaining)}
    </span>
  );
}

function SyncOrdersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/shopify/sync-orders", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setMsg(`Ventes sync: ${data.adjustedLines} lignes`);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur sync");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void sync()}
        disabled={busy}
        className="btn btn-secondary text-xs"
      >
        {busy ? "Sync…" : "Sync ventes Shopify"}
      </button>
      {msg && <p className="text-[0.65rem] text-[var(--text-faint)]">{msg}</p>}
    </div>
  );
}

export function WarRoomHeader({
  eventKey,
  eventName,
  nearestEndsAt,
  kpis,
}: {
  eventKey: string | null;
  eventName: string | null;
  nearestEndsAt: string | null;
  kpis: {
    total: number;
    ready: number;
    published: number;
    won: number;
    lost: number;
    capitalExposed: number;
    transportPerArticle: number | null;
    unitsInStock: number;
    lowStock: number;
    unassigned: number;
  };
}) {
  const label = eventName ?? (eventKey ? eventKey.replace(/^maxx-/, "") : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-faint)]">
            Gestion inventaire
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            War Room
          </h1>
          {label ? (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Event <span className="text-[var(--warning)]">{label}</span>
              {nearestEndsAt && (
                <>
                  {" "}
                  · prochain lot{" "}
                  <Countdown endsAt={nearestEndsAt} className="font-semibold" />
                </>
              )}
            </p>
          ) : (
            <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
              Sourcer → enrichir → publier → stock → ventes. Pool inventaire unique.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-end">
          <SyncOrdersButton />
          {nearestEndsAt && (
            <div className="panel panel-glow px-5 py-3 text-right">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                Prochaine fin
              </p>
              <Countdown endsAt={nearestEndsAt} className="text-2xl font-bold" />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
        {[
          { label: "Lots", value: String(kpis.total), hint: "snipés" },
          {
            label: "Prêts",
            value: String(kpis.ready),
            hint: "à publier",
            accent: true,
          },
          { label: "Publiés", value: String(kpis.published), hint: "live" },
          { label: "Won", value: String(kpis.won), hint: "gagnés", success: true },
          { label: "Lost", value: String(kpis.lost), hint: "passés" },
          {
            label: "Stock",
            value: String(kpis.unitsInStock),
            hint: "unités",
            success: true,
          },
          {
            label: "Bas",
            value: String(kpis.lowStock),
            hint: "alertes",
            danger: kpis.lowStock > 0,
          },
          {
            label: "À assigner",
            value: String(kpis.unassigned),
            hint: "ready/active",
          },
          {
            label: "Capital",
            value: `${kpis.capitalExposed.toFixed(0)} $`,
            hint: "max bids",
            warning: true,
          },
        ].map((stat) => (
          <div key={stat.label} className="panel panel-glow p-3 sm:p-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              {stat.label}
            </p>
            <p
              className={`stat-value mt-1 text-xl sm:text-2xl ${
                stat.accent
                  ? "text-[var(--accent)]"
                  : stat.success
                    ? "text-[var(--success)]"
                    : stat.warning
                      ? "text-[var(--warning)]"
                      : stat.danger
                        ? "text-[var(--danger)]"
                        : ""
              }`}
            >
              {stat.value}
            </p>
            <p className="mt-0.5 text-[0.65rem] text-[var(--text-faint)]">{stat.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
