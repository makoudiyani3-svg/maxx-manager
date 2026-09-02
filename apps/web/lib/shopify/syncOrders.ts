import { getShopifyClient } from "@/lib/shopify/client";
import { prisma } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory/adjust";
import { Prisma } from "@prisma/client";

const ORDERS_QUERY = `
  query recentOrders($cursor: String) {
    orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        lineItems(first: 50) {
          nodes {
            id
            quantity
            sku
            variant {
              id
              product {
                id
              }
            }
          }
        }
      }
    }
  }
`;

type OrdersPage = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      name: string;
      cancelledAt: string | null;
      displayFinancialStatus: string | null;
      lineItems: {
        nodes: Array<{
          id: string;
          quantity: number;
          sku: string | null;
          variant: {
            id: string;
            product: { id: string } | null;
          } | null;
        }>;
      };
    }>;
  };
};

/**
 * Pull recent Shopify orders and decrement local stock once per line item.
 * Single inventory pool — no location UI. Does not push qty back to Shopify.
 */
export async function syncShopifyOrders(options?: {
  createdBy?: string;
  maxPages?: number;
}) {
  const client = getShopifyClient();
  let cursor: string | null = null;
  let pages = 0;
  const maxPages = options?.maxPages ?? 5;

  let processedOrders = 0;
  let adjustedLines = 0;
  let skipped = 0;
  const errors: string[] = [];

  while (pages < maxPages) {
    pages += 1;
    const page: OrdersPage = await client.query(ORDERS_QUERY, { cursor });

    for (const order of page.orders.nodes) {
      processedOrders += 1;

      if (order.cancelledAt) {
        skipped += 1;
        continue;
      }
      const financial = (order.displayFinancialStatus ?? "").toUpperCase();
      if (financial === "REFUNDED" || financial === "VOIDED") {
        skipped += 1;
        continue;
      }

      for (const line of order.lineItems.nodes) {
        const shopifyProductId = line.variant?.product?.id;
        const variantId = line.variant?.id;
        if (!shopifyProductId || !line.quantity || !line.id) {
          skipped += 1;
          continue;
        }

        const alreadyLogged = await prisma.inventoryMovement.findFirst({
          where: {
            shopifyOrderId: order.id,
            shopifyLineItemId: line.id,
            reason: "sale",
          },
          select: { id: true },
        });
        if (alreadyLogged) {
          skipped += 1;
          continue;
        }

        const product = await prisma.product.findFirst({
          where: {
            OR: [
              { shopifyProductId },
              ...(variantId ? [{ shopifyVariantId: variantId }] : []),
              ...(line.sku ? [{ sku: line.sku }] : []),
            ],
          },
          select: { id: true },
        });

        if (!product) {
          skipped += 1;
          continue;
        }

        try {
          await adjustInventory({
            productId: product.id,
            delta: -Math.abs(line.quantity),
            reason: "sale",
            note: `Shopify ${order.name}`,
            createdBy: options?.createdBy ?? "shopify-sync",
            shopifyOrderId: order.id,
            shopifyLineItemId: line.id,
            syncShopify: false,
          });
          adjustedLines += 1;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            skipped += 1;
            continue;
          }
          errors.push(
            `${order.name}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    if (!page.orders.pageInfo.hasNextPage) break;
    cursor = page.orders.pageInfo.endCursor;
  }

  return { processedOrders, adjustedLines, skipped, errors };
}

/** Apply a single paid order payload (webhook) — same idempotent line logic. */
export async function applyShopifyOrderSale(order: {
  id: string;
  name: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  lineItems: Array<{
    id: string;
    quantity: number;
    sku?: string | null;
    variantId?: string | null;
    productId?: string | null;
  }>;
  createdBy?: string;
}) {
  if (order.cancelledAt) {
    return { adjustedLines: 0, skipped: 1, errors: [] as string[] };
  }
  const financial = (order.displayFinancialStatus ?? "").toUpperCase();
  if (financial === "REFUNDED" || financial === "VOIDED") {
    return { adjustedLines: 0, skipped: 1, errors: [] as string[] };
  }

  let adjustedLines = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const line of order.lineItems) {
    if (!line.quantity || !line.id) {
      skipped += 1;
      continue;
    }

    const already = await prisma.inventoryMovement.findFirst({
      where: {
        shopifyOrderId: order.id,
        shopifyLineItemId: line.id,
        reason: "sale",
      },
      select: { id: true },
    });
    if (already) {
      skipped += 1;
      continue;
    }

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          ...(line.productId ? [{ shopifyProductId: line.productId }] : []),
          ...(line.variantId ? [{ shopifyVariantId: line.variantId }] : []),
          ...(line.sku ? [{ sku: line.sku }] : []),
        ],
      },
      select: { id: true },
    });
    if (!product) {
      skipped += 1;
      continue;
    }

    try {
      await adjustInventory({
        productId: product.id,
        delta: -Math.abs(line.quantity),
        reason: "sale",
        note: `Shopify ${order.name}`,
        createdBy: order.createdBy ?? "shopify-webhook",
        shopifyOrderId: order.id,
        shopifyLineItemId: line.id,
        syncShopify: false,
      });
      adjustedLines += 1;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        skipped += 1;
        continue;
      }
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { adjustedLines, skipped, errors };
}
