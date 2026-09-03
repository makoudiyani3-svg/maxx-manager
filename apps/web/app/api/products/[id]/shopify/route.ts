import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireDashboardUser } from "@/lib/auth/session";
import { deleteShopifyProduct } from "@/lib/shopify/deleteProduct";

/** Remove product from Shopify Online Store; keep it in War Room as unpublished. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  if (!product.shopifyProductId) {
    return Response.json(
      { error: "Ce produit n’est pas sur la boutique Shopify." },
      { status: 400 }
    );
  }

  try {
    await deleteShopifyProduct(product.shopifyProductId);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
        shopifyStatus: null,
        inventorySyncedAt: null,
        shopifyAvailableQty: null,
        status: "ready",
        bidStatus:
          product.bidStatus === "published" || product.bidStatus === "won"
            ? "capped"
            : product.bidStatus,
        errorMessage: null,
      },
    });

    return Response.json({
      success: true,
      productId: id,
      status: updated.status,
      bidStatus: updated.bidStatus,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Échec suppression Shopify";
    return Response.json({ error: message }, { status: 500 });
  }
}
