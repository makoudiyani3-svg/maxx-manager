import { getShopifyClient } from "@/lib/shopify/client";
import { getShopifyStoreDomain } from "@/lib/shopify/accessToken";
import { prisma } from "@/lib/db";

const PRODUCTS_QUERY = `
  query catalogProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        vendor
        tags
        descriptionHtml
        featuredImage {
          url
        }
        media(first: 8) {
          nodes {
            ... on MediaImage {
              image {
                url
                width
                height
              }
            }
          }
        }
        variants(first: 1) {
          nodes {
            id
            price
            sku
            inventoryQuantity
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

type CatalogPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      status: string;
      vendor: string | null;
      tags: string[];
      descriptionHtml: string | null;
      featuredImage: { url: string } | null;
      media: {
        nodes: Array<{
          image?: { url: string; width: number | null; height: number | null } | null;
        }>;
      };
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          sku: string | null;
          inventoryQuantity: number | null;
          inventoryItem: { id: string } | null;
        }>;
      };
    }>;
  };
};

function shopifySourceUrl(productGid: string): string {
  const domain = getShopifyStoreDomain() ?? "shopify";
  const shop = domain.replace(/\.myshopify\.com$/i, "");
  const numeric = productGid.match(/Product\/(\d+)/)?.[1] ?? productGid;
  return `shopify://${shop}/products/${numeric}`;
}

/**
 * Import / refresh Shopify catalog into Maxx Manager.
 * Creates local products for Shopify items not yet in DB (initial stock from Shopify).
 * Updates metadata/IDs for matches — does NOT overwrite stockQty (ledger + order sync own qty).
 * No location UI — uses Shopify inventoryQuantity aggregate only on create.
 */
export async function syncShopifyCatalog(options?: { maxPages?: number }) {
  const client = getShopifyClient();
  let cursor: string | null = null;
  let pages = 0;
  const maxPages = options?.maxPages ?? 20;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  while (pages < maxPages) {
    pages += 1;
    const page: CatalogPage = await client.query(PRODUCTS_QUERY, { cursor });

    for (const node of page.products.nodes) {
      const variant = node.variants.nodes[0];
      if (!variant) {
        skipped += 1;
        continue;
      }

      const stockQty = Math.max(0, variant.inventoryQuantity ?? 0);
      const price = Number(variant.price);
      const sourceUrl = shopifySourceUrl(node.id);

      try {
        const existing = await prisma.product.findFirst({
          where: {
            OR: [{ shopifyProductId: node.id }, { sourceUrl }],
          },
        });

        if (existing) {
          // Do NOT overwrite stockQty — Maxx ledger + order sync own sellable qty.
          // Catalog refresh updates metadata / Shopify IDs only.
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              title: node.title,
              descriptionHtml: node.descriptionHtml ?? existing.descriptionHtml,
              suggestedPrice: Number.isFinite(price) ? price : existing.suggestedPrice,
              tags: node.tags?.length ? node.tags : existing.tags,
              sku: variant.sku ?? existing.sku,
              shopifyAvailableQty: variant.inventoryQuantity ?? null,
              shopifyProductId: node.id,
              shopifyVariantId: variant.id,
              shopifyInventoryItemId: variant.inventoryItem?.id ?? existing.shopifyInventoryItemId,
              shopifyStatus: node.status,
              status: existing.status === "captured" ? "active" : existing.status,
              bidStatus:
                existing.bidStatus === "watching" && stockQty > 0
                  ? "won"
                  : existing.bidStatus === "watching"
                    ? "published"
                    : existing.bidStatus,
            },
          });

          // Refresh images if none selected
          const imageCount = await prisma.productImage.count({
            where: { productId: existing.id },
          });
          if (imageCount === 0) {
            await upsertImages(existing.id, node);
          }

          updated += 1;
        } else {
          const createdProduct = await prisma.product.create({
            data: {
              sourceUrl,
              sourceSite: "shopify",
              sourceId: node.id,
              status: "active",
              title: node.title,
              rawTitle: node.title,
              descriptionHtml: node.descriptionHtml,
              tags: node.tags ?? [],
              suggestedPrice: Number.isFinite(price) ? price : null,
              stockQty,
              sku: variant.sku,
              shopifyAvailableQty: variant.inventoryQuantity ?? null,
              bidStatus: stockQty > 0 ? "won" : "published",
              shopifyProductId: node.id,
              shopifyVariantId: variant.id,
              shopifyInventoryItemId: variant.inventoryItem?.id ?? null,
              shopifyStatus: node.status,
              inventorySyncedAt: new Date(),
              lotQuantity: 1,
            },
          });

          await upsertImages(createdProduct.id, node);

          await prisma.inventoryMovement.create({
            data: {
              productId: createdProduct.id,
              delta: stockQty,
              quantityAfter: stockQty,
              reason: "receive",
              note: "Imported from Shopify",
              createdBy: "shopify-catalog-sync",
            },
          });

          created += 1;
        }
      } catch (err) {
        errors.push(
          `${node.title}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (!page.products.pageInfo.hasNextPage) break;
    cursor = page.products.pageInfo.endCursor;
  }

  return { created, updated, skipped, errors, pages };
}

async function upsertImages(
  productId: string,
  node: CatalogPage["products"]["nodes"][number]
) {
  const urls: Array<{ url: string; width: number | null; height: number | null }> =
    [];

  for (const media of node.media.nodes) {
    if (media.image?.url) {
      urls.push({
        url: media.image.url,
        width: media.image.width,
        height: media.image.height,
      });
    }
  }
  if (urls.length === 0 && node.featuredImage?.url) {
    urls.push({ url: node.featuredImage.url, width: null, height: null });
  }

  for (let i = 0; i < urls.length; i += 1) {
    const img = urls[i];
    await prisma.productImage.create({
      data: {
        productId,
        url: img.url,
        width: img.width,
        height: img.height,
        source: "shopify",
        isSelected: true,
        position: i,
      },
    });
  }
}
