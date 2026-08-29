import {
  clearShopifyAccessTokenCache,
  getShopifyStoreDomain,
  resolveShopifyAccessToken,
} from "@/lib/shopify/accessToken";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class ShopifyClient {
  private storeDomain: string;
  private apiVersion: string;

  constructor() {
    const storeDomain = getShopifyStoreDomain();
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2025-04";

    if (!storeDomain) {
      throw new Error("SHOPIFY_STORE_DOMAIN is not configured");
    }

    this.storeDomain = storeDomain;
    this.apiVersion = apiVersion;
  }

  async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.queryOnce<T>(query, variables, true);
  }

  private async queryOnce<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    allowRetry: boolean
  ): Promise<T> {
    const accessToken = await resolveShopifyAccessToken();

    const response = await fetch(
      `https://${this.storeDomain}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      // Stale cached client-credentials token after secret rotate / reinstall
      if (
        response.status === 401 &&
        allowRetry &&
        !process.env.SHOPIFY_ADMIN_API_TOKEN?.startsWith("shpat_")
      ) {
        clearShopifyAccessTokenCache();
        return this.queryOnce<T>(query, variables, false);
      }
      if (response.status === 401) {
        throw new Error(
          `Shopify HTTP error (401): token invalide. Vérifie SHOPIFY_CLIENT_ID/SECRET (ou SHOPIFY_ADMIN_API_TOKEN) et redémarre le serveur Next.`
        );
      }
      throw new Error(`Shopify HTTP error (${response.status}): ${text}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors?.length) {
      throw new Error(
        `Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`
      );
    }

    if (!result.data) {
      throw new Error("Shopify returned no data");
    }

    return result.data;
  }
}

export function getShopifyClient(): ShopifyClient {
  return new ShopifyClient();
}
