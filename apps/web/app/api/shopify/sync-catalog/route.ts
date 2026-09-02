import { requireDashboardUser } from "@/lib/auth/session";
import { syncShopifyCatalog } from "@/lib/shopify/syncCatalog";

export const maxDuration = 120;

export async function POST() {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  try {
    const result = await syncShopifyCatalog();
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog sync failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
