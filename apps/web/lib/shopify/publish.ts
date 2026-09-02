import { getShopifyClient } from "@/lib/shopify/client";
import type { Product, ProductImage } from "@prisma/client";
import {
  buildStorefrontDescriptionHtml,
  inferProductType,
  inferVendor,
  marketCompareAtPrice,
} from "@/lib/listing/description";

const PRODUCT_CREATE = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
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

const VARIANTS_BULK_CREATE = `
  mutation productVariantsBulkCreate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
    $strategy: ProductVariantsBulkCreateStrategy
  ) {
    productVariantsBulkCreate(
      productId: $productId
      variants: $variants
      strategy: $strategy
    ) {
      productVariants {
        id
        price
        inventoryItem {
          id
          sku
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS = `
  query productVariants($id: ID!) {
    product(id: $id) {
      variants(first: 5) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          status
          image {
            url
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_MEDIA_STATUS = `
  query productMediaStatus($id: ID!) {
    product(id: $id) {
      media(first: 20) {
        nodes {
          ... on MediaImage {
            id
            status
          }
        }
      }
    }
  }
`;

const PUBLICATIONS = `
  query publications {
    publications(first: 10) {
      nodes {
        id
        name
      }
    }
  }
`;

const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
          status
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const LOCATIONS = `
  query locations {
    locations(first: 5, includeInactive: false) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_ITEM_UPDATE = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
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

function generateSku(productId: string): string {
  return `MAXX-${productId.slice(0, 8).toUpperCase()}`;
}

async function waitForMediaReady(shopifyProductId: string, maxWaitMs = 30000): Promise<void> {
  const client = getShopifyClient();
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const data = await client.query<{
      product: {
        media: {
          nodes: Array<{ status: string }>;
        };
      } | null;
    }>(PRODUCT_MEDIA_STATUS, { id: shopifyProductId });

    const media = data.product?.media.nodes ?? [];
    if (media.length === 0) return;

    const allReady = media.every((m) => m.status === "READY");
    const anyFailed = media.some((m) => m.status === "FAILED");

    if (anyFailed) {
      throw new Error("One or more product images failed to import on Shopify");
    }
    if (allReady) return;

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for Shopify media to be ready");
}

async function countShopifyMedia(shopifyProductId: string): Promise<number> {
  const client = getShopifyClient();
  const data = await client.query<{
    product: { media: { nodes: Array<{ status: string }> } } | null;
  }>(PRODUCT_MEDIA_STATUS, { id: shopifyProductId });
  return data.product?.media.nodes.length ?? 0;
}

export interface PublishResult {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
}

export async function publishProductToShopify(
  product: Product,
  images: ProductImage[],
  options?: {
    onProductCreated?: (shopifyProductId: string) => Promise<void>;
  }
): Promise<PublishResult> {
  const client = getShopifyClient();
  const isFirstCreate = !product.shopifyProductId;

  const descriptionHtml = buildStorefrontDescriptionHtml({
    descriptionHtml: product.descriptionHtml,
    bulletPoints: product.bulletPoints,
    rawDescription: product.rawDescription,
    title: product.title ?? product.rawTitle,
    preWin: product.bidStatus !== "won",
  });

  const vendor = inferVendor(product);
  const productType = inferProductType(product);
  const tags = [
    ...new Set([
      ...product.tags,
      "maxx-pre-win",
      ...(product.eventWeekKey ? [`event:${product.eventWeekKey}`] : []),
      ...(vendor && vendor !== "UNIT411" ? [`brand:${vendor}`] : []),
    ]),
  ];

  let shopifyProductId = product.shopifyProductId;
  if (!shopifyProductId) {
    const createData = await client.query<{
      productCreate: {
        product: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(PRODUCT_CREATE, {
      input: {
        title: product.title ?? product.rawTitle,
        descriptionHtml,
        vendor,
        ...(productType ? { productType } : {}),
        tags,
        status: "ACTIVE",
        seo: {
          title: product.seoTitle,
          description: product.seoDescription,
        },
      },
    });

    if (createData.productCreate.userErrors.length > 0) {
      throw new Error(
        createData.productCreate.userErrors.map((e) => e.message).join(", ")
      );
    }

    shopifyProductId = createData.productCreate.product?.id ?? null;
    if (!shopifyProductId) {
      throw new Error("Failed to create Shopify product");
    }

    if (options?.onProductCreated) {
      await options.onProductCreated(shopifyProductId);
    }
  } else {
    // Keep listing content fresh on retry / re-publish
    await client.query(PRODUCT_UPDATE, {
      input: {
        id: shopifyProductId,
        title: product.title ?? product.rawTitle,
        descriptionHtml,
        vendor,
        ...(productType ? { productType } : {}),
        tags,
        status: "ACTIVE",
        seo: {
          title: product.seoTitle,
          description: product.seoDescription,
        },
      },
    });
  }

  // Manufacturer first, Maxx last (position order; source maxx ties last)
  const selectedImages = images
    .filter((img) => img.isSelected)
    .sort((a, b) => {
      const aMaxx = a.source === "maxx" ? 1 : 0;
      const bMaxx = b.source === "maxx" ? 1 : 0;
      if (aMaxx !== bMaxx) return aMaxx - bMaxx;
      return a.position - b.position;
    });

  const price = product.suggestedPrice
    ? Number(product.suggestedPrice).toFixed(2)
    : product.rawPrice
      ? Number(product.rawPrice).toFixed(2)
      : "0.00";

  const compareAt = marketCompareAtPrice(product.marketAnalysis);
  const compareAtPrice =
    compareAt && product.suggestedPrice && compareAt > Number(product.suggestedPrice)
      ? compareAt.toFixed(2)
      : undefined;

  let locationId: string | null = null;
  try {
    const locData = await client.query<{
      locations: { nodes: Array<{ id: string; isActive: boolean }> };
    }>(LOCATIONS);
    locationId =
      locData.locations.nodes.find((l) => l.isActive)?.id ??
      locData.locations.nodes[0]?.id ??
      null;
  } catch (err) {
    console.warn("Could not fetch Shopify locations:", err);
  }

  const sku = product.sku ?? generateSku(product.id);
  const cost =
    product.costPrice != null && Number(product.costPrice) > 0
      ? Number(product.costPrice).toFixed(2)
      : undefined;

  let shopifyVariantId = product.shopifyVariantId;
  let shopifyInventoryItemId = product.shopifyInventoryItemId;

  if (!shopifyVariantId || !shopifyInventoryItemId) {
    const variantInput: Record<string, unknown> = {
      price,
      ...(compareAtPrice ? { compareAtPrice } : {}),
      inventoryPolicy: "DENY",
      inventoryItem: {
        sku,
        tracked: true,
        ...(cost ? { cost } : {}),
      },
    };

    if (locationId) {
      variantInput.inventoryQuantities = [
        {
          availableQuantity: 0,
          locationId,
        },
      ];
    }

    const variantData = await client.query<{
      productVariantsBulkCreate: {
        productVariants: Array<{
          id: string;
          inventoryItem: { id: string } | null;
        }> | null;
        userErrors: Array<{ message: string }>;
      };
    }>(VARIANTS_BULK_CREATE, {
      productId: shopifyProductId,
      strategy: "REMOVE_STANDALONE_VARIANT",
      variants: [variantInput],
    });

    if (variantData.productVariantsBulkCreate.userErrors.length > 0) {
      throw new Error(
        variantData.productVariantsBulkCreate.userErrors
          .map((e) => e.message)
          .join(", ")
      );
    }

    shopifyVariantId =
      variantData.productVariantsBulkCreate.productVariants?.[0]?.id ?? null;
    shopifyInventoryItemId =
      variantData.productVariantsBulkCreate.productVariants?.[0]?.inventoryItem
        ?.id ?? null;

    if (!shopifyVariantId || !shopifyInventoryItemId) {
      try {
        const variantsData = await client.query<{
          product: {
            variants: {
              nodes: Array<{
                id: string;
                inventoryItem: { id: string } | null;
              }>;
            };
          } | null;
        }>(PRODUCT_VARIANTS, { id: shopifyProductId });
        const first = variantsData.product?.variants.nodes.find(
          (v) => v.inventoryItem?.id
        );
        shopifyVariantId = first?.id ?? shopifyVariantId;
        shopifyInventoryItemId =
          first?.inventoryItem?.id ?? shopifyInventoryItemId;
      } catch (err) {
        console.warn("Could not resolve Shopify variant ids:", err);
      }
    }
  }

  if (shopifyInventoryItemId && cost) {
    try {
      await client.query(INVENTORY_ITEM_UPDATE, {
        id: shopifyInventoryItemId,
        input: { cost },
      });
    } catch (err) {
      console.warn("Could not set inventory item cost:", err);
    }
  }

  // Refresh price / compare-at when variant already existed
  if (shopifyVariantId && product.shopifyProductId) {
    try {
      await client.query(VARIANTS_BULK_UPDATE, {
        productId: shopifyProductId,
        variants: [
          {
            id: shopifyVariantId,
            price,
            ...(compareAtPrice ? { compareAtPrice } : {}),
          },
        ],
      });
    } catch (err) {
      console.warn("Could not update variant price/compare-at:", err);
    }
  }

  await client.query(PRODUCT_UPDATE, {
    input: { id: shopifyProductId, status: "ACTIVE" },
  });

  const existingMediaCount = isFirstCreate
    ? 0
    : await countShopifyMedia(shopifyProductId).catch(() => 0);

  if (selectedImages.length > 0 && (isFirstCreate || existingMediaCount === 0)) {
    const mediaData = await client.query<{
      productCreateMedia: {
        mediaUserErrors: Array<{ message: string }>;
      };
    }>(PRODUCT_CREATE_MEDIA, {
      productId: shopifyProductId,
      media: selectedImages.map((img, index) => ({
        mediaContentType: "IMAGE",
        originalSource: img.url,
        alt: `${product.title ?? product.rawTitle}${
          img.source === "maxx" ? " (lot Maxx)" : ""
        } - Image ${index + 1}`,
      })),
    });

    if (mediaData.productCreateMedia.mediaUserErrors.length > 0) {
      throw new Error(
        mediaData.productCreateMedia.mediaUserErrors
          .map((e) => e.message)
          .join(", ")
      );
    }

    await waitForMediaReady(shopifyProductId);
  }

  const pubsData = await client.query<{
    publications: { nodes: Array<{ id: string; name: string }> };
  }>(PUBLICATIONS);

  const onlineStore = pubsData.publications.nodes.find(
    (p) => p.name === "Online Store" || p.name.includes("Online")
  );

  if (onlineStore) {
    const publishData = await client.query<{
      publishablePublish: {
        userErrors: Array<{ message: string }>;
      };
    }>(PUBLISHABLE_PUBLISH, {
      id: shopifyProductId,
      input: [{ publicationId: onlineStore.id }],
    });

    if (publishData.publishablePublish.userErrors.length > 0) {
      throw new Error(
        publishData.publishablePublish.userErrors
          .map((e) => e.message)
          .join(", ")
      );
    }
  }

  return {
    shopifyProductId,
    shopifyVariantId: shopifyVariantId ?? null,
    shopifyInventoryItemId: shopifyInventoryItemId ?? null,
  };
}
