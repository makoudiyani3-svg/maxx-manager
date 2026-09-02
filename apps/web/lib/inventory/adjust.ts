import { prisma } from "@/lib/db";
import { setShopifyInventory } from "@/lib/shopify/setInventory";
import type { Product } from "@prisma/client";

export type InventoryReason =
  | "receive"
  | "adjust"
  | "sale"
  | "win"
  | "publish"
  | "return"
  | "damage"
  | "other";

export type AdjustInventoryInput = {
  productId: string;
  /** Absolute target quantity (preferred) OR use delta */
  quantity?: number;
  delta?: number;
  reason: InventoryReason;
  note?: string;
  createdBy?: string | null;
  shopifyOrderId?: string | null;
  shopifyLineItemId?: string | null;
  /** Push new qty to Shopify when product is published */
  syncShopify?: boolean;
};

export async function adjustInventory(input: AdjustInventoryInput) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
  });
  if (!product) throw new Error("Product not found");

  let nextQty: number;
  if (input.quantity !== undefined) {
    nextQty = Math.max(0, Math.floor(input.quantity));
  } else if (input.delta !== undefined) {
    nextQty = Math.max(0, product.stockQty + Math.floor(input.delta));
  } else {
    throw new Error("quantity or delta required");
  }

  const delta = nextQty - product.stockQty;

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.product.update({
      where: { id: product.id },
      data: {
        stockQty: nextQty,
        ...(delta !== 0 || input.reason === "win"
          ? { inventorySyncedAt: null }
          : {}),
      },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        productId: product.id,
        delta,
        quantityAfter: nextQty,
        reason: input.reason,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
        shopifyOrderId: input.shopifyOrderId ?? null,
        shopifyLineItemId: input.shopifyLineItemId ?? null,
      },
    });

    return { product: p, movement };
  });

  let shopifySync: { ok: boolean; error?: string } | null = null;
  const shouldSync =
    input.syncShopify !== false &&
    Boolean(updated.product.shopifyProductId) &&
    Boolean(updated.product.shopifyInventoryItemId || updated.product.shopifyProductId);

  if (shouldSync) {
    try {
      const sync = await setShopifyInventory(updated.product, nextQty);
      await prisma.product.update({
        where: { id: product.id },
        data: {
          shopifyVariantId: sync.variantId,
          shopifyInventoryItemId: sync.inventoryItemId,
          inventorySyncedAt: new Date(),
        },
      });
      shopifySync = { ok: true };
    } catch (err) {
      shopifySync = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    stockQty: nextQty,
    delta,
    movement: updated.movement,
    shopifySync,
  };
}

export function isLowStock(product: Pick<Product, "stockQty" | "lowStockThreshold" | "bidStatus" | "status">) {
  if (product.bidStatus === "lost" || product.bidStatus === "skipped") return false;
  if (product.status === "captured" || product.status === "enriching") return false;
  // Pre-win published lots intentionally at 0 — not a low-stock alert
  if (product.bidStatus === "published" && product.stockQty === 0) return false;
  return product.stockQty <= product.lowStockThreshold;
}

export function computeRealMargin(params: {
  suggestedPrice: number | null;
  actualCostUnit: number | null;
  costPrice: number | null;
}) {
  const sell = params.suggestedPrice;
  const cost = params.actualCostUnit ?? params.costPrice;
  if (sell == null || cost == null || sell <= 0) return null;
  return Math.round(((sell - cost) / sell) * 100);
}
