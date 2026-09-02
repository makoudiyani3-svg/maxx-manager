import { NextRequest } from "next/server";
import { syncShopifyOrders } from "@/lib/shopify/syncOrders";

export const maxDuration = 120;

/** Vercel Cron / manual: Authorization: Bearer $CRON_SECRET */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncShopifyOrders({
      createdBy: "cron",
      maxPages: 5,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
