import { after, NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateApiKey, unauthorizedResponse } from "@/lib/auth";
import { requireDashboardUser } from "@/lib/auth/session";
import { enrichProduct } from "@/lib/enrichment";
import { normalizeImageUrl } from "@/lib/enrichment/images";
import { parseMaxxEventFromUrl } from "@/lib/enrichment/pricing";
import { assertSafeExternalUrl } from "@/lib/urlSafety";
import { hydrateMaxxLotPage } from "@/lib/maxx/hydrate";

const captureSchema = z.object({
  sourceUrl: z.string().url(),
  sourceSite: z.string().default("maxx.ca"),
  sourceId: z.string().optional(),
  title: z.string().min(1).optional(),
  price: z.number().optional(),
  description: z.string().optional(),
  images: z
    .array(z.string().min(1))
    .default([])
    .transform((arr) =>
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

function isMaxxHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "maxx.ca" || host.endsWith(".maxx.ca");
}

export async function POST(request: NextRequest) {
  const apiAuth = validateApiKey(request);
  if (!apiAuth.ok) {
    const dash = await requireDashboardUser();
    if (!dash.ok) {
      if (apiAuth.reason === "missing_header") return dash.response;
      return unauthorizedResponse(apiAuth.reason);
    }
  }

  try {
    const body = await request.json();
    const data = captureSchema.parse(body);

    let sourceUrl: URL;
    try {
      sourceUrl = assertSafeExternalUrl(data.sourceUrl);
    } catch (err) {
      return Response.json(
        {
          error: "Invalid URL",
          message: err instanceof Error ? err.message : "URL invalide",
        },
        { status: 400 }
      );
    }

    if (!apiAuth.ok && !isMaxxHost(sourceUrl.hostname)) {
      return Response.json(
        {
          error: "Invalid host",
          message: "Depuis le dashboard, seuls les liens maxx.ca sont acceptés",
        },
        { status: 400 }
      );
    }

    const existing = await prisma.product.findUnique({
      where: { sourceUrl: data.sourceUrl },
    });

    if (existing) {
      return Response.json(
        { error: "Product already captured", productId: existing.id },
        { status: 409 }
      );
    }

    const needsHydrate =
      isMaxxHost(sourceUrl.hostname) &&
      (!data.title?.trim() || data.images.length === 0);

    let hydrated: Awaited<ReturnType<typeof hydrateMaxxLotPage>> | null = null;
    if (needsHydrate) {
      try {
        hydrated = await hydrateMaxxLotPage(data.sourceUrl);
      } catch (err) {
        console.warn("Maxx hydrate failed:", err);
      }
    }

    const parsedEvent = parseMaxxEventFromUrl(data.sourceUrl);
    const imagePool = [
      ...data.images,
      ...(hydrated?.images ?? []),
    ].map(normalizeImageUrl);
    const normalizedImages = [...new Set(imagePool.filter(Boolean))];

    const fallbackTitle =
      data.title?.trim() ||
      hydrated?.title?.trim() ||
      (parsedEvent.sourceLotId
        ? `Lot Maxx ${parsedEvent.sourceLotId}`
        : `Lot Maxx ${sourceUrl.pathname.split("/").filter(Boolean).pop() ?? "nouveau"}`);

    const eventId =
      data.eventId ?? hydrated?.eventId ?? parsedEvent.eventId ?? null;
    const eventWeekKey =
      data.eventWeekKey ??
      hydrated?.eventWeekKey ??
      (eventId ? `maxx-event-${eventId}` : parsedEvent.eventWeekKey);

    const auctionEndsAtRaw =
      data.auctionEndsAt ?? hydrated?.auctionEndsAt ?? null;

    const product = await prisma.product.create({
      data: {
        sourceUrl: data.sourceUrl,
        sourceSite: data.sourceSite,
        sourceId:
          data.sourceId ?? hydrated?.sourceId ?? parsedEvent.sourceLotId,
        status: "captured",
        rawTitle: fallbackTitle,
        rawPrice: data.price ?? hydrated?.price ?? null,
        rawDescription: data.description ?? hydrated?.description ?? null,
        rawVariants: {
          variants: data.variants ?? [],
          maxxImageRefs: normalizedImages.slice(0, 12),
        } as Prisma.InputJsonValue,
        eventId,
        eventName: data.eventName ?? hydrated?.eventName ?? null,
        eventWeekKey,
        lotQuantity: data.lotQuantity ?? hydrated?.lotQuantity ?? 1,
        bidStatus: "watching",
        auctionEndsAt: (() => {
          if (!auctionEndsAtRaw) return null;
          const d = new Date(auctionEndsAtRaw);
          return Number.isNaN(d.getTime()) ? null : d;
        })(),
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;

    after(async () => {
      try {
        await enrichProduct(product.id);
      } catch (err) {
        console.error(`Enrichment after capture failed for ${product.id}:`, err);
      }
    });

    return Response.json({
      success: true,
      productId: product.id,
      status: product.status,
      eventWeekKey: product.eventWeekKey,
      hydrated: Boolean(hydrated),
      dashboardUrl: `${appUrl}/products/${product.id}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid payload", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Capture error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
