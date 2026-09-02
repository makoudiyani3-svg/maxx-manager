/**
 * Block server-side fetches to private / metadata IPs (basic SSRF guard).
 * Allows only http(s) public hosts.
 */
export function assertSafeExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL invalide: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Protocole interdit: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Hôte interdit: ${host}`);
  }

  // IPv4 private / link-local / loopback
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    const [a, b] = parts;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      throw new Error(`IP privée interdite: ${host}`);
    }
  }

  // IPv6 loopback / ULA / link-local
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    throw new Error(`IP privée interdite: ${host}`);
  }

  return url;
}

export function isSafeExternalUrl(raw: string): boolean {
  try {
    assertSafeExternalUrl(raw);
    return true;
  } catch {
    return false;
  }
}
