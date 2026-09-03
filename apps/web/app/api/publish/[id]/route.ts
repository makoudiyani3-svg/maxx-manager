import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { publishProductToShopify } from "@/lib/shopify/publish";
import { adjustInventory } from "@/lib/inventory/adjust";
import { requireDashboardUser } from "@/lib/auth/session";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true },
  });

  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "ready" && product.status !== "error") {
    return Response.json(
      {
        error: `Product is not ready for publishing (status: ${product.status})`,
      },
      { status: 400 }
    );
  }

  const sellPrice = product.suggestedPrice
    ? Number(product.suggestedPrice)
    : product.rawPrice
      ? Number(product.rawPrice)
      : 0;
  if (!(sellPrice > 0)) {
    return Response.json(
      { error: "Prix de vente requis (> 0) avant publication Shopify." },
      { status: 400 }
    );
  }

  const selectedImages = product.images.filter((img) => img.isSelected);
  if (selectedImages.length < 1) {
    return Response.json(
      { error: "Au moins une image sélectionnée est requise pour publier." },
      { status: 400 }
    );
  }

  if (product.shopifyProductId) {
    return Response.json(
      {
        error: "Product already published",
        shopifyProductId: product.shopifyProductId,
      },
      { status: 409 }
    );
  }

  await prisma.product.update({
    where: { id },
    data: { status: "publishing", errorMessage: null },
  });

  try {
    const published = await publishProductToShopify(product, product.images, {
      onProductCreated: async (shopifyProductId) => {
        await prisma.product.update({
          where: { id },
          data: {
            shopifyProductId,
            sku: product.sku ?? `MAXX-${id.slice(0, 8).toUpperCase()}`,
          },
        });
      },
    });

    await prisma.product.update({
      where: { id },
      data: {
        status: "active",
        shopifyProductId: published.shopifyProductId,
        shopifyVariantId: published.shopifyVariantId,
        shopifyInventoryItemId: published.shopifyInventoryItemId,
        shopifyStatus: "ACTIVE",
        bidStatus: "published",
        sku: product.sku ?? `MAXX-${id.slice(0, 8).toUpperCase()}`,
      },
    });

    await adjustInventory({
      productId: id,
      quantity: 0,
      reason: "publish",
      note: "Published pre-win stock 0",
      syncShopify: false,
    });

    return Response.json({
      success: true,
      productId: id,
      shopifyProductId: published.shopifyProductId,
      status: "active",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown publish error";
    await prisma.product.update({
      where: { id },
      data: { status: "error", errorMessage: message },
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
