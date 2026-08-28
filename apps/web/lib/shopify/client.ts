interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class ShopifyClient {
  private storeDomain: string;
  private accessToken: string;
  private apiVersion: string;

  constructor() {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2025-04";

    if (!storeDomain || !accessToken) {
      throw new Error("Shopify credentials are not configured");
    }

    this.storeDomain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(
      `https://${this.storeDomain}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify HTTP error (${response.status}): ${text}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`);
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
