import { getShopifyClient } from "@/lib/shopify/client";
import type { Product } from "@prisma/client";
import {
  buildStorefrontDescriptionHtml,
  inferProductType,
  inferVendor,
} from "@/lib/listing/description";

const PRODUCT_UPDATE = `
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_LEGACY = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function updateShopifyProductContent(
  product: Product,
  patch: {
    title?: string;
    descriptionHtml?: string;
    status?: "ACTIVE" | "DRAFT";
    syncListingMeta?: boolean;
  }
) {
  if (!product.shopifyProductId) {
    throw new Error("Produit non publié sur Shopify");
  }

  const client = getShopifyClient();
  const descriptionHtml =
    patch.descriptionHtml !== undefined
      ? patch.descriptionHtml
      : patch.syncListingMeta
        ? buildStorefrontDescriptionHtml({
            descriptionHtml: product.descriptionHtml,
            bulletPoints: product.bulletPoints,
            rawDescription: product.rawDescription,
            title: product.title ?? product.rawTitle,
            preWin: product.bidStatus !== "won",
          })
        : undefined;

  const payload: Record<string, unknown> = {
    id: product.shopifyProductId,
    ...(patch.title !== undefined && { title: patch.title }),
    ...(descriptionHtml !== undefined && { descriptionHtml }),
    ...(patch.status !== undefined && { status: patch.status }),
  };

  if (patch.syncListingMeta) {
    const vendor = inferVendor(product);
    const productType = inferProductType(product);
    payload.vendor = vendor;
    if (productType) payload.productType = productType;
    payload.tags = [
      ...new Set([
        ...product.tags,
        ...(product.eventWeekKey ? [`event:${product.eventWeekKey}`] : []),
        ...(vendor !== "UNIT411" ? [`brand:${vendor}`] : []),
      ]),
    ];
    payload.seo = {
      title: product.seoTitle,
      description: product.seoDescription,
    };
  }

  try {
    const data = await client.query<{
      productUpdate: {
        product: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(PRODUCT_UPDATE, { product: payload });

    if (data.productUpdate.userErrors.length > 0) {
      throw new Error(data.productUpdate.userErrors.map((e) => e.message).join(", "));
    }
    return data.productUpdate.product;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("ProductUpdateInput") ||
      message.includes("unknown field") ||
      message.includes("$product")
    ) {
      const data = await client.query<{
        productUpdate: {
          product: { id: string } | null;
          userErrors: Array<{ message: string }>;
        };
      }>(PRODUCT_UPDATE_LEGACY, { input: payload });
      if (data.productUpdate.userErrors.length > 0) {
        throw new Error(
          data.productUpdate.userErrors.map((e) => e.message).join(", ")
        );
      }
      return data.productUpdate.product;
    }
    throw err;
  }
}

export async function updateShopifyVariantPrice(product: Product, price: number) {
  if (!product.shopifyProductId) {
    throw new Error("Produit non publié sur Shopify");
  }

  const client = getShopifyClient();
  let variantId = product.shopifyVariantId;

  if (!variantId) {
    const data = await client.query<{
      product: {
        variants: { nodes: Array<{ id: string }> };
      } | null;
    }>(
      `query ($id: ID!) {
        product(id: $id) {
          variants(first: 1) { nodes { id } }
        }
      }`,
      { id: product.shopifyProductId }
    );
    variantId = data.product?.variants.nodes[0]?.id ?? null;
  }

  if (!variantId) {
    throw new Error("Variant Shopify introuvable");
  }

  const result = await client.query<{
    productVariantsBulkUpdate: {
      userErrors: Array<{ message: string }>;
    };
  }>(VARIANTS_BULK_UPDATE, {
    productId: product.shopifyProductId,
    variants: [{ id: variantId, price: price.toFixed(2) }],
  });

  if (result.productVariantsBulkUpdate.userErrors.length > 0) {
    throw new Error(
      result.productVariantsBulkUpdate.userErrors.map((e) => e.message).join(", ")
    );
  }

  return { variantId };
}
