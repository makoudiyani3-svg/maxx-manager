import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_FILTERS } from "@/components/StatusBadge";
import { WarRoomHeader } from "@/components/WarRoomHeader";
import { ProductPipelineList } from "@/components/ProductPipelineList";
import { InventoryAlertsPanel } from "@/components/InventoryAlertsPanel";
import type { ProductStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const BID_FILTERS = [
  { value: "", label: "Toutes", key: "bid-all" },
  { value: "watching", label: "Watching", key: "watching" },
  { value: "capped", label: "Capped", key: "capped" },
  { value: "published", label: "Publiés", key: "published" },
  { value: "won", label: "Won", key: "won" },
  { value: "lost", label: "Lost", key: "lost" },
  { value: "skipped", label: "Skipped", key: "skipped" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    event?: string;
    bid?: string;
    alert?: string;
  }>;
}) {
  const { status, event, bid, alert } = await searchParams;
  const filterStatus = status as ProductStatus | undefined;
  const alertFocus =
    alert === "low" || alert === "unassigned" || alert === "oversold"
      ? alert
      : null;

  const where = {
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(event ? { eventWeekKey: event } : {}),
    ...(bid ? { bidStatus: bid } : {}),
  };

  const [products, counts, total, eventGroups, bidCounts, inventoryAgg] =
    await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          images: {
            where: { isSelected: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
        orderBy: [{ auctionEndsAt: "asc" }, { createdAt: "desc" }],
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
      prisma.product.groupBy({ by: ["bidStatus"], _count: true }),
      prisma.product.findMany({
        select: {
          stockQty: true,
          lowStockThreshold: true,
          assignedTo: true,
          status: true,
          bidStatus: true,
        },
      }),
    ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const bidCountMap = Object.fromEntries(
    bidCounts.map((c) => [c.bidStatus, c._count])
  );

  const activeEventKey =
    event ??
    eventGroups[0]?.eventWeekKey ??
    products.find((p) => p.eventWeekKey)?.eventWeekKey ??
    null;

  const weekProducts = activeEventKey
    ? await prisma.product.findMany({
        where: { eventWeekKey: activeEventKey },
        select: {
          bidStatus: true,
          lotQuantity: true,
          auctionEndsAt: true,
          eventName: true,
          status: true,
          shopifyProductId: true,
          stockQty: true,
          lowStockThreshold: true,
          assignedTo: true,
        },
      })
    : products.map((p) => ({
        bidStatus: p.bidStatus,
        lotQuantity: p.lotQuantity,
        auctionEndsAt: p.auctionEndsAt,
        eventName: p.eventName,
        status: p.status,
        shopifyProductId: p.shopifyProductId,
        stockQty: p.stockQty,
        lowStockThreshold: p.lowStockThreshold,
        assignedTo: p.assignedTo,
      }));

  const nearestEndsAt =
    weekProducts
      .map((p) => p.auctionEndsAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const eventName =
    weekProducts.find((p) => p.eventName)?.eventName ?? activeEventKey;

  let listProducts = products.map((p) => ({
    id: p.id,
    status: p.status,
    bidStatus: p.bidStatus,
    sourceUrl: p.sourceUrl,
    shopifyProductId: p.shopifyProductId,
    inventorySyncedAt: p.inventorySyncedAt,
    auctionEndsAt: p.auctionEndsAt,
    lotQuantity: p.lotQuantity,
    title: p.title,
    rawTitle: p.rawTitle,
    suggestedPrice: p.suggestedPrice != null ? Number(p.suggestedPrice) : null,
    costPrice: p.costPrice != null ? Number(p.costPrice) : null,
    eventWeekKey: p.eventWeekKey,
    sourceSite: p.sourceSite,
    createdAt: p.createdAt.toISOString(),
    imageUrl: p.images[0]?.url ?? null,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
    assignedTo: p.assignedTo,
  }));

  if (alertFocus === "low") {
    listProducts = listProducts.filter(
      (p) =>
        !["lost", "skipped"].includes(p.bidStatus) &&
        (p.stockQty ?? 0) <= (p.lowStockThreshold ?? 1) &&
        ["ready", "active", "publishing", "error"].includes(p.status)
    );
  } else if (alertFocus === "unassigned") {
    listProducts = listProducts.filter(
      (p) => !p.assignedTo && (p.status === "ready" || p.status === "active")
    );
  }

  const featuredSource =
    listProducts.find((p) => p.status === "ready" && p.imageUrl) ??
    listProducts.find((p) => p.imageUrl) ??
    listProducts[0] ??
    null;

  const featured = featuredSource
    ? {
        id: featuredSource.id,
        title:
          featuredSource.title ?? featuredSource.rawTitle ?? "Produit Maxx",
        imageUrl: featuredSource.imageUrl,
        price:
          featuredSource.suggestedPrice != null
            ? `${Number(featuredSource.suggestedPrice).toFixed(2)} $`
            : null,
        status: featuredSource.status,
      }
    : null;

  function hrefWith(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const merged = {
      status: filterStatus,
      event,
      bid,
      alert: alertFocus ?? undefined,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) sp.set(k, v);
    }
    const q = sp.toString();
    return q ? `/?${q}` : "/";
  }

  const pipelineItems = [
    {
      label: "Tous",
      href: hrefWith({ status: undefined, bid: undefined, alert: undefined }),
      count: total,
      active: !filterStatus && !bid && !alertFocus,
    },
    ...STATUS_FILTERS.filter((f) => f.value).map((filter) => ({
      label: filter.label,
      href: hrefWith({
        status: filter.value || undefined,
        bid: undefined,
        alert: undefined,
      }),
      count: countMap[filter.value as ProductStatus] ?? 0,
      active: (filterStatus ?? "") === filter.value,
    })),
  ];

  return (
    <div className="fade-in flex flex-col gap-6">
      <WarRoomHeader
        eventKey={activeEventKey}
        eventName={eventName}
        nearestEndsAt={nearestEndsAt?.toISOString() ?? null}
        activeAlert={alertFocus}
        featured={featured}
        kpis={{
          total: weekProducts.length || total,
          ready: weekProducts.filter((p) => p.status === "ready").length,
          published: weekProducts.filter(
            (p) => p.bidStatus === "published" || Boolean(p.shopifyProductId)
          ).length,
          won: weekProducts.filter((p) => p.bidStatus === "won").length,
          lost: weekProducts.filter((p) => p.bidStatus === "lost").length,
          unitsInStock: inventoryAgg.reduce((s, p) => s + (p.stockQty ?? 0), 0),
          lowStock: inventoryAgg.filter(
            (p) =>
              !["lost", "skipped"].includes(p.bidStatus) &&
              (p.stockQty ?? 0) <= (p.lowStockThreshold ?? 1) &&
              ["ready", "active", "error"].includes(p.status)
          ).length,
          unassigned: inventoryAgg.filter(
            (p) =>
              !p.assignedTo &&
              (p.status === "ready" || p.status === "active")
          ).length,
        }}
      />

      <InventoryAlertsPanel focus={alertFocus} />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Pipeline rail — Maisone "Rooms" style */}
        <aside className="bento flex flex-col gap-2 p-3">
          <p className="px-3 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Statuts
          </p>
          {pipelineItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition ${
                item.active
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
              }`}
            >
              <span>{item.label}</span>
              <span className={item.active ? "opacity-70" : "opacity-50"}>
                {item.count}
              </span>
            </Link>
          ))}

          <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Enchères
          </p>
          {BID_FILTERS.map((filter) => {
            const count =
              filter.value === "" ? total : (bidCountMap[filter.value] ?? 0);
            const isActive = (bid ?? "") === filter.value;
            return (
              <Link
                key={filter.key}
                href={hrefWith({
                  bid: filter.value || undefined,
                  alert: undefined,
                })}
                className={`flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                }`}
              >
                <span>{filter.label}</span>
                <span className={isActive ? "opacity-70" : "opacity-50"}>
                  {count}
                </span>
              </Link>
            );
          })}

          {eventGroups.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                Events
              </p>
              {eventGroups.map((g) => {
                const key = g.eventWeekKey!;
                const isActive =
                  event === key || (!event && key === activeEventKey);
                return (
                  <Link
                    key={key}
                    href={hrefWith({ event: key })}
                    className={`flex items-center justify-between rounded-2xl px-4 py-2.5 text-xs font-medium transition ${
                      isActive
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg)]"
                    }`}
                  >
                    <span className="truncate">{key.replace(/^maxx-/, "")}</span>
                    <span className="opacity-60">{g._count}</span>
                  </Link>
                );
              })}
            </>
          )}

          <Link
            href="/?status=ready"
            className="btn btn-primary mt-3 w-full"
          >
            Publier les prêts
          </Link>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                Collection
              </p>
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {listProducts.length} produit{listProducts.length === 1 ? "" : "s"}
              </h2>
            </div>
          </div>
          <ProductPipelineList products={listProducts} />
        </div>
      </div>
    </div>
  );
}
