import { NextRequest } from "next/server";
import { enrichProduct } from "@/lib/enrichment";
import { validateApiKey } from "@/lib/auth";
import { requireDashboardUser } from "@/lib/auth/session";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = validateApiKey(request);
  if (!apiKey.ok) {
    const session = await requireDashboardUser();
    if (!session.ok) {
      return session.response;
    }
  }

  const { id } = await params;

  try {
    await enrichProduct(id);
    return Response.json({ success: true, productId: id, status: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed";
    console.error(`Enrichment error for ${id}:`, error);
    return Response.json({ error: message, productId: id }, { status: 500 });
  }
}
