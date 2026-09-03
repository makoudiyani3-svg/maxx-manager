import Link from "next/link";
import { prisma } from "@/lib/db";
import { WarRoomHeader } from "@/components/WarRoomHeader";
import { ProductPipelineList } from "@/components/ProductPipelineList";
import type { ProductStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    event?: string;
    bid?: string;
    alert?: string;
    store?: string;
  }>;
}) {
  const { status, event, bid, alert, store } = await searchParams;
  const filterStatus = status as ProductStatus | undefined;
  const alertFocus =
    alert === "low" || alert === "unassigned" || alert === "oversold"
      ? alert
      : null;
  const storeFilter =
    store === "published" || store === "unpublished" ? store : null;

  const where = {
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(event ? { eventWeekKey: event } : {}),
    ...(bid ? { bidStatus: bid } : {}),
  };

  const [products, total, eventGroups, inventoryAgg] = await Promise.all([
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
    prisma.product.count(),
    prisma.product.groupBy({
      by: ["eventWeekKey"],
      _count: true,
      where: { eventWeekKey: { not: null } },
      orderBy: { _count: { eventWeekKey: "desc" } },
      take: 20,
    }),
    prisma.product.findMany({
      select: {
        stockQty: true,
        lowStockThreshold: true,
        assignedTo: true,
        status: true,
        bidStatus: true,
        shopifyProductId: true,
      },
    }),
  ]);

  const eventNames = await prisma.product.findMany({
    where: { eventWeekKey: { not: null }, eventName: { not: null } },
    select: { eventWeekKey: true, eventName: true },
    distinct: ["eventWeekKey"],
  });
  const eventNameByKey = Object.fromEntries(
    eventNames
      .filter((e) => e.eventWeekKey && e.eventName)
      .map((e) => [e.eventWeekKey!, e.eventName!])
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
    eventName: p.eventName,
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

  if (storeFilter === "published") {
    listProducts = listProducts.filter(
      (p) => Boolean(p.shopifyProductId) || p.bidStatus === "published"
    );
  } else if (storeFilter === "unpublished") {
    listProducts = listProducts.filter(
      (p) => !p.shopifyProductId && p.bidStatus !== "published"
    );
  }

  const publishedCount = inventoryAgg.filter(
    (p) => Boolean(p.shopifyProductId) || p.bidStatus === "published"
  ).length;
  const unpublishedCount = inventoryAgg.length - publishedCount;

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
      store: storeFilter ?? undefined,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) sp.set(k, v);
    }
    const q = sp.toString();
    return q ? `/?${q}` : "/";
  }

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

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="bento flex flex-col gap-2 p-3">
          <p className="px-3 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Semaines
          </p>
          <Link
            href={hrefWith({ event: undefined })}
            className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition ${
              !event
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
            }`}
          >
            <span>Toutes</span>
            <span className={!event ? "opacity-70" : "opacity-50"}>{total}</span>
          </Link>
          {eventGroups.map((g) => {
            const key = g.eventWeekKey!;
            const isActive = event === key;
            const label =
              eventNameByKey[key]?.trim() || key.replace(/^maxx-/, "");
            return (
              <Link
                key={key}
                href={hrefWith({ event: key })}
                className={`flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                }`}
              >
                <span className="truncate">{label}</span>
                <span className={isActive ? "opacity-70" : "opacity-50"}>
                  {g._count}
                </span>
              </Link>
            );
          })}

          <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Boutique
          </p>
          {(
            [
              { value: undefined, label: "Tous", count: total },
              {
                value: "published" as const,
                label: "Publiés",
                count: publishedCount,
              },
              {
                value: "unpublished" as const,
                label: "Non publiés",
                count: unpublishedCount,
              },
            ] as const
          ).map((item) => {
            const isActive = (storeFilter ?? undefined) === item.value;
            return (
              <Link
                key={item.label}
                href={hrefWith({ store: item.value })}
                className={`flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                }`}
              >
                <span>{item.label}</span>
                <span className={isActive ? "opacity-70" : "opacity-50"}>
                  {item.count}
                </span>
              </Link>
            );
          })}

          <Link href="/?store=unpublished" className="btn btn-primary mt-3 w-full">
            Voir non publiés
          </Link>
        </aside>

        <div className="min-w-0">
          <ProductPipelineList products={listProducts} />
        </div>
      </div>
    </div>
  );
}
