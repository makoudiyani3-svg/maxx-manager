function normalizeStoreDomain(raw: string): string {
  let domain = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Drop cached client-credentials token (e.g. after 401 / secret rotate). */
export function clearShopifyAccessTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export function getShopifyStoreDomain(): string | null {
  const raw = process.env.SHOPIFY_STORE_DOMAIN;
  if (!raw || raw.includes("your-store")) return null;
  return normalizeStoreDomain(raw);
}

export function getShopifyClientId(): string | undefined {
  return process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_API_KEY;
}

export function getShopifyClientSecret(): string | undefined {
  return process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_API_SECRET;
}

/** Static Admin API token (custom app) or Dev Dashboard client credentials. */
export function isShopifyConfigured(): boolean {
  const domain = getShopifyStoreDomain();
  if (!domain) return false;

  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (
    staticToken &&
    staticToken !== "shpat_xxx" &&
    staticToken.startsWith("shpat_")
  ) {
    return true;
  }

  const clientId = getShopifyClientId();
  const clientSecret = getShopifyClientSecret();
  return Boolean(
    clientId &&
      clientSecret &&
      clientSecret !== "shpss_xxx" &&
      (clientSecret.startsWith("shpss_") || clientSecret.length > 20)
  );
}

export type ShopifyAuthMode = "admin_token" | "client_credentials";

export function getShopifyAuthMode(): ShopifyAuthMode | null {
  if (!isShopifyConfigured()) return null;
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (
    staticToken &&
    staticToken !== "shpat_xxx" &&
    staticToken.startsWith("shpat_")
  ) {
    return "admin_token";
  }
  return "client_credentials";
}

/**
 * Resolves Admin API access token.
 * - Custom app: SHOPIFY_ADMIN_API_TOKEN (shpat_...)
 * - Dev Dashboard app: client credentials grant (24h token, cached)
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
 */
export async function resolveShopifyAccessToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (
    staticToken &&
    staticToken !== "shpat_xxx" &&
    staticToken.startsWith("shpat_")
  ) {
    return staticToken;
  }

  const storeDomain = getShopifyStoreDomain();
  const clientId = getShopifyClientId();
  const clientSecret = getShopifyClientSecret();

  if (!storeDomain || !clientId || !clientSecret) {
    throw new Error(
      "Shopify: configurez SHOPIFY_STORE_DOMAIN + (SHOPIFY_ADMIN_API_TOKEN ou SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)"
    );
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  clearShopifyAccessTokenCache();

  const response = await fetch(
    `https://${storeDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("shop_not_permitted")) {
      throw new Error(
        "Shopify shop_not_permitted: l'app et la boutique doivent être dans la même organisation Dev Dashboard"
      );
    }
    throw new Error(`Shopify token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Shopify token response missing access_token");
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 86_400) * 1000;
  return cachedToken;
}
