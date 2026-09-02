import { getShopifyClient } from "@/lib/shopify/client";
import type { Product } from "@prisma/client";

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

const PRODUCT_VARIANT = `
  query productVariant($id: ID!) {
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

const INVENTORY_SET = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

export interface InventorySyncResult {
  quantity: number;
  inventoryItemId: string;
  variantId: string;
}

async function resolveLocationId(): Promise<string> {
  const client = getShopifyClient();
  const locData = await client.query<{
    locations: { nodes: Array<{ id: string; isActive: boolean }> };
  }>(LOCATIONS);
  const locationId =
    locData.locations.nodes.find((l) => l.isActive)?.id ??
    locData.locations.nodes[0]?.id;
  if (!locationId) {
    throw new Error("Aucun emplacement Shopify actif trouvé");
  }
  return locationId;
}

async function resolveVariantIds(
  product: Product
): Promise<{ variantId: string; inventoryItemId: string }> {
  if (product.shopifyVariantId && product.shopifyInventoryItemId) {
    return {
      variantId: product.shopifyVariantId,
      inventoryItemId: product.shopifyInventoryItemId,
    };
  }

  if (!product.shopifyProductId) {
    throw new Error("Produit non publié sur Shopify");
  }

  const client = getShopifyClient();
  const data = await client.query<{
    product: {
      variants: {
        nodes: Array<{ id: string; inventoryItem: { id: string } | null }>;
      };
    } | null;
  }>(PRODUCT_VARIANT, { id: product.shopifyProductId });

  const variant = data.product?.variants.nodes.find((v) => v.inventoryItem?.id);
  if (!variant?.inventoryItem?.id) {
    throw new Error("Variant / inventory item Shopify introuvable");
  }

  return {
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
  };
}

/** Set available inventory to lotQuantity (or explicit qty) after auction win. */
export async function setShopifyInventory(
  product: Product,
  quantity?: number
): Promise<InventorySyncResult> {
  const qty = quantity ?? Math.max(1, product.lotQuantity || 1);
  const client = getShopifyClient();
  const locationId = await resolveLocationId();
  const { variantId, inventoryItemId } = await resolveVariantIds(product);

  const result = await client.query<{
    inventorySetQuantities: {
      userErrors: Array<{ message: string }>;
    };
  }>(INVENTORY_SET, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId,
          locationId,
          quantity: qty,
        },
      ],
    },
  });

  if (result.inventorySetQuantities.userErrors.length > 0) {
    throw new Error(
      result.inventorySetQuantities.userErrors.map((e) => e.message).join(", ")
    );
  }

  return { quantity: qty, inventoryItemId, variantId };
}
