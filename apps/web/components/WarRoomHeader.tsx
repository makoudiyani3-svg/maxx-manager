"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CaptureMaxxForm } from "@/components/CaptureMaxxForm";

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
            : "text-[var(--text)]"
      } ${className}`}
    >
      {formatCountdown(remaining)}
    </span>
  );
}

function ShopifySyncButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<"catalog" | "orders" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(
    kind: "catalog" | "orders",
    path: string,
    format: (data: Record<string, unknown>) => string
  ) {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setMsg(format(data));
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur sync");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void run("catalog", "/api/shopify/sync-catalog", (d) =>
              `Catalogue: +${d.created ?? 0} · maj ${d.updated ?? 0}`
            )
          }
          disabled={busy !== null}
          className="btn btn-secondary text-xs"
        >
          {busy === "catalog" ? "Import…" : "Importer catalogue"}
        </button>
        <button
          type="button"
          onClick={() =>
            void run("orders", "/api/shopify/sync-orders", (d) =>
              `Ventes: ${d.adjustedLines ?? 0} lignes`
            )
          }
          disabled={busy !== null}
          className="btn btn-secondary text-xs"
        >
          {busy === "orders" ? "Sync…" : "Sync ventes"}
        </button>
      </div>
      {msg && <p className="text-[0.65rem] text-[var(--text-faint)]">{msg}</p>}
    </div>
  );
}

export function WarRoomHeader({
  eventKey,
  eventName,
  nearestEndsAt,
  kpis,
  activeAlert,
  featured,
}: {
  eventKey: string | null;
  eventName: string | null;
  nearestEndsAt: string | null;
  activeAlert?: string | null;
  featured?: {
    id: string;
    title: string;
    imageUrl: string | null;
    price: string | null;
    status: string;
  } | null;
  kpis: {
    total: number;
    ready: number;
    published: number;
    won: number;
    lost: number;
    unitsInStock: number;
    lowStock: number;
    unassigned: number;
  };
}) {
  const label = eventName ?? (eventKey ? eventKey.replace(/^maxx-/, "") : null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
      {/* Hero featured */}
      <div className="bento relative min-h-[280px] overflow-hidden">
        {featured?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={featured.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover grayscale-[30%]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] via-[#2c2c2c] to-[#111]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />
        <div className="relative flex h-full min-h-[280px] flex-col justify-between p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="rounded-full bg-white/15 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-white backdrop-blur">
              {featured ? featured.status : "War Room"}
            </span>
            <ShopifySyncButtons />
          </div>
          <div className="max-w-xl text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
              {label ? `Event · ${label}` : "UNIT411 · Maxx → Shopify"}
            </p>
            <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {featured?.title ?? "War Room"}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
              {featured?.price && (
                <span className="font-semibold text-white">{featured.price}</span>
              )}
              {nearestEndsAt && (
                <span>
                  Prochaine fin{" "}
                  <Countdown endsAt={nearestEndsAt} className="font-semibold text-white" />
                </span>
              )}
              {!featured && (
                <span>Sourcer · enrichir · publier · stock</span>
              )}
            </div>
            {featured && (
              <Link
                href={`/products/${featured.id}`}
                className="mt-5 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Ouvrir la fiche
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Side rail: capture + KPI stack */}
      <div className="flex flex-col gap-4">
        <div className="bento flex flex-1 flex-col gap-4 p-5">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
              Pipeline
            </p>
            <h2 className="font-display mt-1 text-xl font-bold">Capture Maxx</h2>
          </div>
          <CaptureMaxxForm compact />
          <div className="mt-auto grid grid-cols-2 gap-2">
            {[
              {
                label: "Prêts",
                value: kpis.ready,
                href: "/?status=ready",
                active: false,
              },
              {
                label: "Stock",
                value: kpis.unitsInStock,
              },
              {
                label: "Bas",
                value: kpis.lowStock,
                href: "/?alert=low",
                danger: kpis.lowStock > 0,
                active: activeAlert === "low",
              },
              {
                label: "Assigner",
                value: kpis.unassigned,
                href: "/?alert=unassigned",
                active: activeAlert === "unassigned",
              },
            ].map((s) => {
              const body = (
                <>
                  <p className="text-[0.65rem] uppercase tracking-wider text-[var(--text-faint)]">
                    {s.label}
                  </p>
                  <p
                    className={`font-display mt-1 text-2xl font-bold ${
                      s.danger ? "text-[var(--danger)]" : ""
                    }`}
                  >
                    {s.value}
                  </p>
                </>
              );
              const cls = `rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-3 transition ${
                s.active ? "ring-2 ring-[var(--accent)]" : ""
              } ${s.href ? "hover:border-[var(--border-strong)]" : ""}`;
              return s.href ? (
                <Link key={s.label} href={s.href} className={cls}>
                  {body}
                </Link>
              ) : (
                <div key={s.label} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
