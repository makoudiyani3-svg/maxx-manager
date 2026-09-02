import { getShopifyClient } from "@/lib/shopify/client";
import { prisma } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory/adjust";

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
 * Pull recent Shopify orders and decrement local stock once per order line.
 * Single inventory pool — no location UI.
 */
export async function syncShopifyOrders(options?: {
  createdBy?: string;
  maxPages?: number;
}) {
  const client = getShopifyClient();
  let cursor: string | null = null;
  let pages = 0;
  const maxPages = options?.maxPages ?? 3;

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
        if (!shopifyProductId || !line.quantity) {
          skipped += 1;
          continue;
        }

        const alreadyLogged = await prisma.inventoryMovement.findFirst({
          where: {
            shopifyOrderId: order.id,
            reason: "sale",
            note: { contains: line.id },
            product: {
              OR: [
                { shopifyProductId },
                ...(variantId ? [{ shopifyVariantId: variantId }] : []),
              ],
            },
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
            note: `Shopify ${order.name} · ${line.id}`,
            createdBy: options?.createdBy ?? "shopify-sync",
            shopifyOrderId: order.id,
            syncShopify: false,
          });
          adjustedLines += 1;
        } catch (err) {
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
