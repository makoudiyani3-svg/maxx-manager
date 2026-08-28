import { NextRequest } from "next/server";
import { enrichProduct } from "@/lib/enrichment";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
