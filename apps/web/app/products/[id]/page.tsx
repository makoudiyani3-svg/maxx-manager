import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProductDetailClient } from "@/components/ProductDetailClient";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { position: "asc" } },
      movements: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });

  if (!product) {
    notFound();
  }

  const serialized = JSON.parse(
    JSON.stringify(product, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );

  return <ProductDetailClient product={serialized} />;
}
