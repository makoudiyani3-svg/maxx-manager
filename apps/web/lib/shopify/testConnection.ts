import { getShopifyClient } from "@/lib/shopify/client";
import {
  getShopifyAuthMode,
  isShopifyConfigured,
} from "@/lib/shopify/accessToken";

const SHOP_QUERY = `
  query shopInfo {
    shop {
      name
      myshopifyDomain
      primaryDomain {
        url
      }
      currencyCode
    }
    publications(first: 5) {
      nodes {
        id
        name
      }
    }
    locations(first: 3) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

export interface ShopifyConnectionStatus {
  configured: boolean;
  connected: boolean;
  authMode?: "admin_token" | "client_credentials";
  shopName?: string;
  myshopifyDomain?: string;
  currencyCode?: string;
  onlineStorePublication?: string | null;
  locations?: string[];
  missingScopesHint?: string;
  error?: string;
}

export { isShopifyConfigured };

export async function testShopifyConnection(): Promise<ShopifyConnectionStatus> {
  if (!isShopifyConfigured()) {
    return {
      configured: false,
      connected: false,
      error:
        "Shopify: SHOPIFY_STORE_DOMAIN + (SHOPIFY_ADMIN_API_TOKEN ou SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)",
    };
  }

  const authMode = getShopifyAuthMode() ?? undefined;

  try {
    const client = getShopifyClient();
    const data = await client.query<{
      shop: {
        name: string;
        myshopifyDomain: string;
        currencyCode: string;
        primaryDomain: { url: string } | null;
      };
      publications: { nodes: Array<{ id: string; name: string }> };
      locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> };
    }>(SHOP_QUERY);

    const onlineStore = data.publications.nodes.find(
      (p) => p.name === "Online Store" || p.name.includes("Online")
    );

    return {
      configured: true,
      connected: true,
      authMode,
      shopName: data.shop.name,
      myshopifyDomain: data.shop.myshopifyDomain,
      currencyCode: data.shop.currencyCode,
      onlineStorePublication: onlineStore?.name ?? null,
      locations: data.locations.nodes
        .filter((l) => l.isActive)
        .map((l) => l.name),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let hint: string | undefined;

    if (message.includes("shop_not_permitted")) {
      hint =
        "Installez l'app sur une boutique de votre org Dev Dashboard (Dev stores)";
    } else if (message.includes("401") || message.includes("Invalid API key")) {
      hint = "Vérifiez Client ID/Secret ou régénérez le token Admin";
    } else if (
      message.includes("Access denied") ||
      message.includes("ACCESS_DENIED")
    ) {
      hint =
        "Scopes manquants sur la version de l'app: read/write products, publications, locations, inventory";
    }

    return {
      configured: true,
      connected: false,
      authMode,
      error: message,
      missingScopesHint: hint,
    };
  }
}
