const PRIVATE_IPV4_RANGES = [
  { first: 10 },
  { first: 172, secondMin: 16, secondMax: 31 },
  { first: 192, secondMin: 168, secondMax: 168 },
  { first: 169, secondMin: 254, secondMax: 254 },
] as const;

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return PRIVATE_IPV4_RANGES.some(range => {
    if (octets[0] !== range.first) return false;
    if (!("secondMin" in range)) return true;
    return octets[1] >= range.secondMin && octets[1] <= range.secondMax;
  });
}

function isPrivateIpv6(hostname: string): boolean {
  const unwrapped = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const firstGroup = Number.parseInt(unwrapped.split(":", 1)[0], 16);
  if (!Number.isFinite(firstGroup)) return false;

  // Unique-local fc00::/7 and link-local fe80::/10.
  return (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80;
}

/**
 * Accept only a local Leaf Web App destination and return a normalized URL.
 * This is deliberately narrower than a general redirect validator.
 */
export function leafWebAppUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const localHost =
      isPrivateIpv4(hostname) ||
      isPrivateIpv6(hostname) ||
      (hostname.endsWith(".local") && hostname.length > ".local".length);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      !localHost
    ) {
      return null;
    }

    // The Leaf supplies its current app page. Do not carry local query data or
    // fragments through Leaf Log or the magic-link URL.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
