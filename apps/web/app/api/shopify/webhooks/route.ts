import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { applyShopifyOrderSale } from "@/lib/shopify/syncOrders";

export const maxDuration = 60;

function getWebhookSecret(): string | null {
  return (
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    process.env.SHOPIFY_CLIENT_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    null
  );
}

function verifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = getWebhookSecret();
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(hmacHeader);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type ShopifyWebhookOrder = {
  admin_graphql_api_id?: string;
  id?: number;
  name?: string;
  cancelled_at?: string | null;
  financial_status?: string | null;
  line_items?: Array<{
    admin_graphql_api_id?: string;
    id?: number;
    quantity?: number;
    sku?: string | null;
    variant_id?: number | null;
    product_id?: number | null;
  }>;
};

function toGid(type: string, id: number | string | undefined | null): string | null {
  if (id == null) return null;
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${type}/${s}`;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic") ?? "";

  if (!verifyHmac(rawBody, hmac)) {
    return Response.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  // Acknowledge immediately for topics we ignore
  if (
    !topic.includes("orders/") &&
    topic !== "ORDERS_CREATE" &&
    topic !== "ORDERS_PAID" &&
    topic !== "orders/create" &&
    topic !== "orders/paid" &&
    topic !== "orders/updated"
  ) {
    return Response.json({ ok: true, ignored: topic });
  }

  let payload: ShopifyWebhookOrder;
  try {
    payload = JSON.parse(rawBody) as ShopifyWebhookOrder;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId =
    payload.admin_graphql_api_id ?? toGid("Order", payload.id);
  if (!orderId) {
    return Response.json({ error: "Missing order id" }, { status: 400 });
  }

  const result = await applyShopifyOrderSale({
    id: orderId,
    name: payload.name ?? orderId,
    cancelledAt: payload.cancelled_at ?? null,
    displayFinancialStatus: payload.financial_status ?? null,
    lineItems: (payload.line_items ?? []).map((li) => ({
      id:
        li.admin_graphql_api_id ??
        toGid("LineItem", li.id) ??
        `legacy-${payload.id}-${li.id}`,
      quantity: li.quantity ?? 0,
      sku: li.sku ?? null,
      variantId: toGid("ProductVariant", li.variant_id),
      productId: toGid("Product", li.product_id),
    })),
    createdBy: `webhook:${topic}`,
  });

  return Response.json({ ok: true, topic, ...result });
}
