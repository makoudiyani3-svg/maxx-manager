import Link from "next/link";
import { prisma } from "@/lib/db";
import { StatusBadge, STATUS_FILTERS } from "@/components/StatusBadge";
import type { ProductStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function formatPrice(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return `${n.toFixed(2)} $`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; event?: string }>;
}) {
  const { status, event } = await searchParams;
  const filterStatus = status as ProductStatus | undefined;

  const where = {
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(event ? { eventWeekKey: event } : {}),
  };

  const [products, counts, total, eventGroups] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        images: {
          where: { isSelected: true },
          orderBy: { position: "asc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.groupBy({ by: ["status"], _count: true }),
    prisma.product.count(),
    prisma.product.groupBy({
      by: ["eventWeekKey"],
      _count: true,
      where: { eventWeekKey: { not: null } },
      orderBy: { _count: { eventWeekKey: "desc" } },
      take: 12,
    }),
  ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const readyCount = countMap.ready ?? 0;
  const activeCount = countMap.active ?? 0;
  const errorCount = countMap.error ?? 0;
  const enrichingCount = countMap.enriching ?? 0;

  return (
    <div className="fade-in space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-faint)]">
            Pipeline produits
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Catalogue Maxx
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
            Sniper Maxx → enrichissement → prix vente concurrentiel → plafond enchère
            (×1.30 + transport 400$/sem) → publish Shopify avant win (stock 0).
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
          <span className="h-2 w-2 rounded-full bg-[var(--success)] shadow-[0_0_8px_var(--success)]" />
          Système en ligne
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total", value: total, hint: "produits sourcés" },
          { label: "Prêts", value: readyCount, hint: "à publier", accent: true },
          { label: "Actifs", value: activeCount, hint: "sur Shopify" },
          {
            label: enrichingCount > 0 ? "En cours" : "Erreurs",
            value: enrichingCount > 0 ? enrichingCount : errorCount,
            hint: enrichingCount > 0 ? "enrichissement" : "à corriger",
            danger: enrichingCount === 0 && errorCount > 0,
          },
        ].map((stat) => (
          <div key={stat.label} className="panel panel-glow p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              {stat.label}
            </p>
            <p
              className={`stat-value mt-2 ${
                stat.accent
                  ? "text-[var(--accent)]"
                  : stat.danger
                    ? "text-[var(--danger)]"
                    : ""
              }`}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const count =
            filter.value === ""
              ? total
              : (countMap[filter.value as ProductStatus] ?? 0);
          const isActive = (filterStatus ?? "") === filter.value && !event;
          return (
            <Link
              key={filter.key}
              href={filter.value ? `/?status=${filter.value}` : "/"}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-[var(--accent)] text-[#0a0c0b]"
                  : "border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              }`}
            >
              {filter.label}
              <span className={`ml-1.5 ${isActive ? "opacity-70" : "opacity-50"}`}>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {eventGroups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Events
          </span>
          {eventGroups.map((g) => {
            const key = g.eventWeekKey!;
            const isActive = event === key;
            return (
              <Link
                key={key}
                href={`/?event=${encodeURIComponent(key)}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-[var(--warning)] text-[#0a0c0b]"
                    : "border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {key.replace(/^maxx-/, "")}
                <span className="ml-1 opacity-60">{g._count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {products.length === 0 ? (
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
      ) : (
        <div className="grid gap-3">
          {products.map((product, index) => {
            const sell = formatPrice(product.suggestedPrice);
            const cost = formatPrice(product.costPrice);
            const margin =
              product.suggestedPrice && product.costPrice
                ? Math.round(
                    ((Number(product.suggestedPrice) - Number(product.costPrice)) /
                      Number(product.suggestedPrice)) *
                      100
                  )
                : null;

            return (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className="panel panel-glow group flex gap-4 p-3 transition hover:border-[var(--border-strong)] sm:p-4"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-elevated)] sm:h-28 sm:w-28">
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0].url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[var(--text-faint)]">
                      Aucune image
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display line-clamp-2 text-base font-semibold tracking-tight sm:text-lg">
                      {product.title ?? product.rawTitle ?? "Sans titre"}
                    </h2>
                    <StatusBadge status={product.status} />
                  </div>

                  <p className="mt-1 truncate text-xs text-[var(--text-faint)]">
                    {product.sourceSite} · {formatDate(product.createdAt)}
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
                    {product.bidStatus && (
                      <span className="capitalize text-[var(--text-faint)]">
                        {product.bidStatus}
                      </span>
                    )}
                    {product.eventWeekKey && (
                      <span className="hidden text-[var(--text-faint)] md:inline">
                        {product.eventWeekKey.replace(/^maxx-/, "")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="hidden items-center self-center pr-2 text-[var(--text-faint)] transition group-hover:text-[var(--accent)] sm:flex">
                  →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
