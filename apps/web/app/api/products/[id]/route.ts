import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { computeDealMath } from "@/lib/enrichment/pricing";
import { adjustInventory } from "@/lib/inventory/adjust";
import {
  updateShopifyProductContent,
  updateShopifyVariantPrice,
} from "@/lib/shopify/updateProduct";
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
  assignedTo: z.string().email().nullable().optional(),
  internalNotes: z.string().max(5000).nullable().optional(),
  actualCostLot: z.number().min(0).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  syncShopifyContent: z.boolean().optional(),
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

    let actualCostUnit: number | null | undefined;
    if (data.actualCostLot !== undefined) {
      if (data.actualCostLot == null) {
        actualCostUnit = null;
      } else {
        const qty = Math.max(1, existing.lotQuantity || 1);
        const premium = data.actualCostLot * 1.3;
        const transport = existing.transportShare
          ? Number(existing.transportShare)
          : 0;
        actualCostUnit = premium / qty + transport;
      }
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
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
        ...(data.internalNotes !== undefined && {
          internalNotes: data.internalNotes,
        }),
        ...(data.actualCostLot !== undefined && {
          actualCostLot: data.actualCostLot,
          actualCostUnit:
            actualCostUnit === undefined ? undefined : actualCostUnit,
        }),
        ...(data.lowStockThreshold !== undefined && {
          lowStockThreshold: data.lowStockThreshold,
        }),
        ...dealUpdate,
      },
      include: {
        images: { orderBy: { position: "asc" } },
        movements: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    let inventorySync: {
      ok: boolean;
      quantity?: number;
      error?: string;
    } | null = null;

    // Won → receive stock = lotQuantity (single pool, no location UI)
    if (data.bidStatus === "won" && existing.bidStatus !== "won") {
      try {
        const qty = Math.max(1, product.lotQuantity || 1);
        const adj = await adjustInventory({
          productId: id,
          quantity: Math.max(product.stockQty, qty),
          reason: "win",
          note: "Auction won",
          syncShopify: Boolean(product.shopifyProductId),
        });
        inventorySync = {
          ok: adj.shopifySync?.ok !== false,
          quantity: adj.stockQty,
          error: adj.shopifySync?.error,
        };
        product = await prisma.product.findUniqueOrThrow({
          where: { id },
          include: {
            images: { orderBy: { position: "asc" } },
            movements: { orderBy: { createdAt: "desc" }, take: 20 },
          },
        });
      } catch (err) {
        inventorySync = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else if (
      data.syncInventory === true &&
      Boolean(product.shopifyProductId)
    ) {
      try {
        const adj = await adjustInventory({
          productId: id,
          quantity: product.stockQty,
          reason: "adjust",
          note: "Manual Shopify sync",
          syncShopify: true,
        });
        inventorySync = {
          ok: adj.shopifySync?.ok !== false,
          quantity: adj.stockQty,
          error: adj.shopifySync?.error,
        };
      } catch (err) {
        inventorySync = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    let shopifyContentSync: { ok: boolean; error?: string } | null = null;
    if (data.syncShopifyContent && product.shopifyProductId) {
      try {
        await updateShopifyProductContent(product, {
          title: product.title ?? undefined,
          descriptionHtml: product.descriptionHtml ?? undefined,
        });
        if (product.suggestedPrice != null) {
          await updateShopifyVariantPrice(
            product,
            Number(product.suggestedPrice)
          );
        }
        shopifyContentSync = { ok: true };
      } catch (err) {
        shopifyContentSync = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return Response.json({ ...product, inventorySync, shopifyContentSync });
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
    include: {
      images: { orderBy: { position: "asc" } },
      movements: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });

  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  return Response.json(product);
}
