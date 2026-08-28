import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { ProductStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") as ProductStatus | null;

  const products = await prisma.product.findMany({
    where: status ? { status } : undefined,
    include: {
      images: {
        where: { isSelected: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(products);
}
