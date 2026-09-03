import { getShopifyClient } from "@/lib/shopify/client";

const PRODUCT_DELETE = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

/** Permanently remove a product from the Shopify storefront catalog. */
export async function deleteShopifyProduct(
  shopifyProductId: string
): Promise<{ deletedProductId: string }> {
  const client = getShopifyClient();
  const data = await client.query<{
    productDelete: {
      deletedProductId: string | null;
      userErrors: Array<{ message: string }>;
    };
  }>(PRODUCT_DELETE, {
    input: { id: shopifyProductId },
  });

  if (data.productDelete.userErrors.length > 0) {
    throw new Error(
      data.productDelete.userErrors.map((e) => e.message).join(", ")
    );
  }

  const deletedId = data.productDelete.deletedProductId;
  if (!deletedId) {
    throw new Error("Shopify n’a pas confirmé la suppression du produit");
  }

  return { deletedProductId: deletedId };
}
