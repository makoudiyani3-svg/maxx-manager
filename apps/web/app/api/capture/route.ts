import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateApiKey, unauthorizedResponse } from "@/lib/auth";
import { normalizeImageUrl } from "@/lib/enrichment/images";
import { parseMaxxEventFromUrl } from "@/lib/enrichment/pricing";

const captureSchema = z.object({
  sourceUrl: z.string().url(),
  sourceSite: z.string().default("maxx.ca"),
  sourceId: z.string().optional(),
  title: z.string().min(1),
  price: z.number().optional(),
  description: z.string().optional(),
  images: z.array(z.string().min(1)).default([]).transform((arr) =>
    arr.filter((u) => {
      try {
        const parsed = new URL(u);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    })
  ),
  variants: z.array(z.record(z.string(), z.unknown())).optional(),
  eventId: z.string().optional(),
  eventName: z.string().optional(),
  eventWeekKey: z.string().optional(),
  auctionEndsAt: z.string().optional(),
  lotQuantity: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  if (!validateApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const data = captureSchema.parse(body);

    const existing = await prisma.product.findUnique({
      where: { sourceUrl: data.sourceUrl },
    });

    if (existing) {
      return Response.json(
        { error: "Product already captured", productId: existing.id },
        { status: 409 }
      );
    }

    const normalizedImages = data.images.map(normalizeImageUrl);
    const parsedEvent = parseMaxxEventFromUrl(data.sourceUrl);

    const product = await prisma.product.create({
      data: {
        sourceUrl: data.sourceUrl,
        sourceSite: data.sourceSite,
        sourceId: data.sourceId ?? parsedEvent.sourceLotId,
        status: "captured",
        rawTitle: data.title,
        rawPrice: data.price,
        rawDescription: data.description,
        rawVariants: {
          variants: data.variants ?? [],
          maxxImageRefs: normalizedImages.slice(0, 8),
        } as Prisma.InputJsonValue,
        eventId: data.eventId ?? parsedEvent.eventId,
        eventName: data.eventName ?? null,
        eventWeekKey: data.eventWeekKey ?? parsedEvent.eventWeekKey,
        lotQuantity: data.lotQuantity ?? 1,
        bidStatus: "watching",
        auctionEndsAt: (() => {
          if (!data.auctionEndsAt) return null;
          const d = new Date(data.auctionEndsAt);
          return Number.isNaN(d.getTime()) ? null : d;
        })(),
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    const enrichUrl = `${appUrl}/api/enrich/${product.id}`;

    fetch(enrichUrl, {
      method: "POST",
      headers: {
        Authorization: request.headers.get("authorization") ?? "",
      },
    }).catch((err) => console.error("Failed to trigger enrichment:", err));

    return Response.json({
      success: true,
      productId: product.id,
      status: product.status,
      eventWeekKey: product.eventWeekKey,
      dashboardUrl: `${appUrl}/products/${product.id}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid payload", details: error.issues }, { status: 400 });
    }
    console.error("Capture error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
