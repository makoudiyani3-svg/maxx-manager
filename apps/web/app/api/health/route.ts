import { isShopifyConfigured } from "@/lib/shopify/accessToken";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "maxx-manager",
    apiKeyConfigured: Boolean(process.env.MAXX_API_KEY),
    shopifyConfigured: isShopifyConfigured(),
    timestamp: new Date().toISOString(),
  });
}
