import { requireDashboardUser } from "@/lib/auth/session";
import { syncShopifyOrders } from "@/lib/shopify/syncOrders";

export const maxDuration = 60;

export async function POST() {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  try {
    const result = await syncShopifyOrders({
      createdBy: auth.user.email ?? "dashboard",
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
