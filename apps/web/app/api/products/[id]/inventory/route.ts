import { NextRequest } from "next/server";
import { z } from "zod";
import { requireDashboardUser } from "@/lib/auth/session";
import { adjustInventory } from "@/lib/inventory/adjust";
import { prisma } from "@/lib/db";

const bodySchema = z.object({
  quantity: z.number().int().min(0).optional(),
  delta: z.number().int().optional(),
  reason: z
    .enum([
      "receive",
      "adjust",
      "sale",
      "win",
      "publish",
      "return",
      "damage",
      "other",
    ])
    .default("adjust"),
  note: z.string().max(500).optional(),
  syncShopify: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const movements = await prisma.inventoryMovement.findMany({
    where: { productId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const product = await prisma.product.findUnique({
    where: { id },
    select: { stockQty: true, lowStockThreshold: true, inventorySyncedAt: true },
  });
  if (!product) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ...product, movements });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const body = bodySchema.parse(await request.json());
    if (body.quantity === undefined && body.delta === undefined) {
      return Response.json(
        { error: "quantity or delta required" },
        { status: 400 }
      );
    }

    const result = await adjustInventory({
      productId: id,
      quantity: body.quantity,
      delta: body.delta,
      reason: body.reason,
      note: body.note,
      createdBy: auth.user.email,
      syncShopify: body.syncShopify,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid payload", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Adjust failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
