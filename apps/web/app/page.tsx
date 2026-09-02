import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_FILTERS } from "@/components/StatusBadge";
import { WarRoomHeader } from "@/components/WarRoomHeader";
import { ProductPipelineList } from "@/components/ProductPipelineList";
import type { ProductStatus } from "@prisma/client";
import { WEEKLY_TRANSPORT_CAD } from "@/lib/enrichment/pricing";

export const dynamic = "force-dynamic";

const BID_FILTERS = [
  { value: "", label: "Toutes enchères", key: "bid-all" },
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
  searchParams: Promise<{ status?: string; event?: string; bid?: string }>;
}) {
  const { status, event, bid } = await searchParams;
  const filterStatus = status as ProductStatus | undefined;

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
      // Global inventory KPIs (includes Shopify imports with no Maxx event)
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
          maxBidLot: true,
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
        maxBidLot: p.maxBidLot,
        lotQuantity: p.lotQuantity,
        auctionEndsAt: p.auctionEndsAt,
        eventName: p.eventName,
        status: p.status,
        shopifyProductId: p.shopifyProductId,
        stockQty: p.stockQty,
        lowStockThreshold: p.lowStockThreshold,
        assignedTo: p.assignedTo,
      }));

  const exposedStatuses = new Set(["watching", "capped", "published", "won"]);
  const capitalExposed = weekProducts
    .filter((p) => exposedStatuses.has(p.bidStatus) && p.maxBidLot != null)
    .reduce((sum, p) => sum + Number(p.maxBidLot), 0);

  const activeArticles = weekProducts
    .filter((p) => !["lost", "skipped"].includes(p.bidStatus))
    .reduce((sum, p) => sum + Math.max(1, p.lotQuantity || 1), 0);

  const nearestEndsAt =
    weekProducts
      .map((p) => p.auctionEndsAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const eventName =
    weekProducts.find((p) => p.eventName)?.eventName ?? activeEventKey;

  const listProducts = products.map((p) => ({
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
    maxBidLot: p.maxBidLot != null ? Number(p.maxBidLot) : null,
    eventWeekKey: p.eventWeekKey,
    sourceSite: p.sourceSite,
    createdAt: p.createdAt.toISOString(),
    imageUrl: p.images[0]?.url ?? null,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
    assignedTo: p.assignedTo,
  }));

  function hrefWith(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const merged = {
      status: filterStatus,
      event,
      bid,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) sp.set(k, v);
    }
    const q = sp.toString();
    return q ? `/?${q}` : "/";
  }

  return (
    <div className="fade-in space-y-8">
      <WarRoomHeader
        eventKey={activeEventKey}
        eventName={eventName}
        nearestEndsAt={nearestEndsAt?.toISOString() ?? null}
        kpis={{
          total: weekProducts.length || total,
          ready: weekProducts.filter((p) => p.status === "ready").length,
          published: weekProducts.filter(
            (p) => p.bidStatus === "published" || Boolean(p.shopifyProductId)
          ).length,
          won: weekProducts.filter((p) => p.bidStatus === "won").length,
          lost: weekProducts.filter((p) => p.bidStatus === "lost").length,
          capitalExposed,
          transportPerArticle:
            activeArticles > 0 ? WEEKLY_TRANSPORT_CAD / activeArticles : null,
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

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const count =
            filter.value === ""
              ? total
              : (countMap[filter.value as ProductStatus] ?? 0);
          const isActive = (filterStatus ?? "") === filter.value;
          return (
            <Link
              key={filter.key}
              href={hrefWith({ status: filter.value || undefined })}
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

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-bold uppercase tracking-wider text-[var(--text-faint)]">
          Enchères
        </span>
        {BID_FILTERS.map((filter) => {
          const count =
            filter.value === ""
              ? total
              : (bidCountMap[filter.value] ?? 0);
          const isActive = (bid ?? "") === filter.value;
          return (
            <Link
              key={filter.key}
              href={hrefWith({ bid: filter.value || undefined })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                isActive
                  ? "bg-[var(--warning)] text-[#0a0c0b]"
                  : "border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {filter.label}
              <span className="ml-1 opacity-60">{count}</span>
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
            const isActive = event === key || (!event && key === activeEventKey);
            return (
              <Link
                key={key}
                href={hrefWith({ event: key })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-[var(--info)] text-[#0a0c0b]"
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

      <ProductPipelineList products={listProducts} />
    </div>
  );
}
