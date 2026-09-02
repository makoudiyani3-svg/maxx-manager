import { requireDashboardUser } from "@/lib/auth/session";
import { testShopifyConnection } from "@/lib/shopify/testConnection";

export async function GET() {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const shopify = await testShopifyConnection();
  return Response.json(shopify, {
    status: shopify.connected ? 200 : shopify.configured ? 503 : 200,
  });
}
