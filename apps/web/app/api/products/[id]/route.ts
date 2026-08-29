import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { computeDealMath } from "@/lib/enrichment/pricing";
import { setShopifyInventory } from "@/lib/shopify/setInventory";
import type { Prisma } from "@prisma/client";

const updateSchema = z.object({
  title: z.string().optional(),
  descriptionHtml: z.string().optional(),
  suggestedPrice: z.number().optional(),
  tags: z.array(z.string()).optional(),
  selectedImageIds: z.array(z.string().uuid()).optional(),
  bidStatus: z
    .enum(["watching", "capped", "published", "won", "lost", "skipped"])
    .optional(),
  syncInventory: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    if (data.selectedImageIds) {
      await prisma.productImage.updateMany({
        where: { productId: id },
        data: { isSelected: false },
      });
      await prisma.productImage.updateMany({
        where: { id: { in: data.selectedImageIds }, productId: id },
        data: { isSelected: true },
      });
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    let dealUpdate: Prisma.ProductUpdateInput = {};

    if (data.suggestedPrice !== undefined) {
      const articlesInWeek = existing.eventWeekKey
        ? await prisma.product.count({
            where: {
              eventWeekKey: existing.eventWeekKey,
              bidStatus: { notIn: ["lost", "skipped"] },
            },
          })
        : 1;

      const siblings = existing.eventWeekKey
        ? await prisma.product.findMany({
            where: {
              eventWeekKey: existing.eventWeekKey,
              bidStatus: { notIn: ["lost", "skipped"] },
            },
            select: { lotQuantity: true },
          })
        : [];
      const unitArticles = Math.max(
        1,
        siblings.reduce((s, p) => s + Math.max(1, p.lotQuantity || 1), 0) ||
          articlesInWeek
      );

      const deal = computeDealMath({
        sellPrice: data.suggestedPrice,
        lotQuantity: existing.lotQuantity || 1,
        articlesInWeek: unitArticles,
        currentBidLot: existing.rawPrice ? Number(existing.rawPrice) : null,
      });

      dealUpdate = {
        maxBidLot: deal.maxBidLot,
        maxBidUnit: deal.maxBidUnit,
        transportShare: deal.transportPerArticle,
        costPrice: deal.unitLandedAtMaxBid,
        dealMath: deal as unknown as Prisma.InputJsonValue,
        ...(data.bidStatus
          ? {}
          : { bidStatus: deal.isViable ? "capped" : "skipped" }),
      };
    }

    let product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.descriptionHtml !== undefined && {
          descriptionHtml: data.descriptionHtml,
        }),
        ...(data.suggestedPrice !== undefined && {
          suggestedPrice: data.suggestedPrice,
        }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.bidStatus !== undefined && { bidStatus: data.bidStatus }),
        ...dealUpdate,
      },
      include: { images: { orderBy: { position: "asc" } } },
    });

    const shouldSyncInventory =
      Boolean(product.shopifyProductId) &&
      (data.bidStatus === "won" || data.syncInventory === true);

    let inventorySync: {
      ok: boolean;
      quantity?: number;
      error?: string;
    } | null = null;

    if (shouldSyncInventory) {
      try {
        const sync = await setShopifyInventory(product);
        product = await prisma.product.update({
          where: { id },
          data: {
            shopifyVariantId: sync.variantId,
            shopifyInventoryItemId: sync.inventoryItemId,
            inventorySyncedAt: new Date(),
          },
          include: { images: { orderBy: { position: "asc" } } },
        });
        inventorySync = { ok: true, quantity: sync.quantity };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Inventory sync failed:", message);
        inventorySync = { ok: false, error: message };
      }
    }

    return Response.json({ ...product, inventorySync });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid payload", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Product update failed:", error);
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: { orderBy: { position: "asc" } } },
  });

  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  return Response.json(product);
}
