import { NextRequest } from "next/server";

export type ApiKeyFailure =
  | "missing_server_key"
  | "missing_header"
  | "invalid_key";

export function validateApiKey(
  request: NextRequest
): { ok: true } | { ok: false; reason: ApiKeyFailure } {
  const apiKey = process.env.MAXX_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "missing_server_key" };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_header" };
  }

  if (authHeader.slice(7) !== apiKey) {
    return { ok: false, reason: "invalid_key" };
  }

  return { ok: true };
}

export function unauthorizedResponse(reason?: ApiKeyFailure) {
  const messages: Record<ApiKeyFailure, string> = {
    missing_server_key:
      "MAXX_API_KEY manquante sur le serveur (Vercel → Environment Variables)",
    missing_header: "Clé API manquante — configurez l'extension Chrome",
    invalid_key: "Clé API incorrecte — doit correspondre à MAXX_API_KEY sur Vercel",
  };

  return Response.json(
    {
      error: "Unauthorized",
      reason: reason ?? "invalid_key",
      message: reason ? messages[reason] : messages.invalid_key,
    },
    { status: 401 }
  );
}
