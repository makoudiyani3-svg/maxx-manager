import { prisma } from "@/lib/db";
import { isLowStock } from "@/lib/inventory/adjust";
import { requireDashboardUser } from "@/lib/auth/session";

export async function GET() {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const products = await prisma.product.findMany({
    where: {
      bidStatus: { notIn: ["lost", "skipped"] },
      status: { in: ["ready", "active", "publishing", "error"] },
    },
    select: {
      id: true,
      title: true,
      rawTitle: true,
      stockQty: true,
      lowStockThreshold: true,
      bidStatus: true,
      status: true,
      assignedTo: true,
      suggestedPrice: true,
      actualCostUnit: true,
      costPrice: true,
      shopifyAvailableQty: true,
    },
    orderBy: { stockQty: "asc" },
  });

  const lowStock = products.filter(isLowStock);
  const oversold = products.filter(
    (p) => p.shopifyAvailableQty != null && p.shopifyAvailableQty < 0
  );
  const unassigned = products.filter(
    (p) => !p.assignedTo && (p.status === "ready" || p.status === "active")
  );

  return Response.json({
    lowStockCount: lowStock.length,
    oversoldCount: oversold.length,
    unassignedCount: unassigned.length,
    lowStock,
    oversold,
    unassigned: unassigned.slice(0, 20),
  });
}
