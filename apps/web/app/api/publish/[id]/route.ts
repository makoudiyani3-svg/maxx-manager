import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { publishProductToShopify } from "@/lib/shopify/publish";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { error: `Product is not ready for publishing (status: ${product.status})` },
      { status: 400 }
    );
  }

  if (product.shopifyProductId) {
    return Response.json(
      { error: "Product already published", shopifyProductId: product.shopifyProductId },
      { status: 409 }
    );
  }

  await prisma.product.update({
    where: { id },
    data: { status: "publishing", errorMessage: null },
  });

  try {
    const shopifyProductId = await publishProductToShopify(product, product.images);

    await prisma.product.update({
      where: { id },
      data: {
        status: "active",
        shopifyProductId,
        shopifyStatus: "ACTIVE",
        bidStatus: "published",
      },
    });

    return Response.json({
      success: true,
      productId: id,
      shopifyProductId,
      status: "active",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    await prisma.product.update({
      where: { id },
      data: { status: "error", errorMessage: message },
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
