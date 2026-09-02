import { getShopifyClient } from "@/lib/shopify/client";
import type { Product, ProductImage } from "@prisma/client";

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

export interface PublishResult {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
}

export async function publishProductToShopify(
  product: Product,
  images: ProductImage[]
): Promise<PublishResult> {
  const client = getShopifyClient();

  const selectedImages = images
    .filter((img) => img.isSelected)
    .sort((a, b) => a.position - b.position);

  const createData = await client.query<{
    productCreate: {
      product: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(PRODUCT_CREATE, {
    input: {
      title: product.title ?? product.rawTitle,
      descriptionHtml: product.descriptionHtml ?? product.rawDescription ?? "",
      vendor: "Maxx",
      tags: [
        ...product.tags,
        "maxx-pre-win",
        ...(product.eventWeekKey ? [`event:${product.eventWeekKey}`] : []),
      ],
      // Live before auction win — inventory stays 0 (DENY)
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

  const shopifyProductId = createData.productCreate.product?.id;
  if (!shopifyProductId) {
    throw new Error("Failed to create Shopify product");
  }

  const price = product.suggestedPrice
    ? Number(product.suggestedPrice).toFixed(2)
    : product.rawPrice
      ? Number(product.rawPrice).toFixed(2)
      : "0.00";

  // Resolve a location so we can set inventory to 0 explicitly
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

  const variantInput: Record<string, unknown> = {
    price,
    inventoryPolicy: "DENY",
    inventoryItem: {
      sku: generateSku(product.id),
      tracked: true,
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
      variantData.productVariantsBulkCreate.userErrors.map((e) => e.message).join(", ")
    );
  }

  let shopifyVariantId =
    variantData.productVariantsBulkCreate.productVariants?.[0]?.id ?? null;
  let shopifyInventoryItemId =
    variantData.productVariantsBulkCreate.productVariants?.[0]?.inventoryItem
      ?.id ?? null;

  if (!shopifyVariantId || !shopifyInventoryItemId) {
    try {
      const variantsData = await client.query<{
        product: {
          variants: {
            nodes: Array<{ id: string; inventoryItem: { id: string } | null }>;
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

  // Ensure product stays ACTIVE (some stores default draft on variant create)
  await client.query(PRODUCT_UPDATE, {
    input: { id: shopifyProductId, status: "ACTIVE" },
  });

  if (selectedImages.length > 0) {
    const mediaData = await client.query<{
      productCreateMedia: {
        mediaUserErrors: Array<{ message: string }>;
      };
    }>(PRODUCT_CREATE_MEDIA, {
      productId: shopifyProductId,
      media: selectedImages.map((img, index) => ({
        mediaContentType: "IMAGE",
        originalSource: img.url,
        alt: `${product.title ?? product.rawTitle} - Image ${index + 1}`,
      })),
    });

    if (mediaData.productCreateMedia.mediaUserErrors.length > 0) {
      throw new Error(
        mediaData.productCreateMedia.mediaUserErrors.map((e) => e.message).join(", ")
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
        publishData.publishablePublish.userErrors.map((e) => e.message).join(", ")
      );
    }
  }

  return {
    shopifyProductId,
    shopifyVariantId,
    shopifyInventoryItemId,
  };
}
