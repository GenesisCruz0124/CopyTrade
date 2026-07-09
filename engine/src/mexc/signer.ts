import { createHmac } from "node:crypto";

/**
 * MEXC Spot v3 signing: HMAC-SHA256 over the exact query string (params in the
 * order provided), using the API secret. Returns hex digest.
 */
export function signQueryString(queryString: string, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

export function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.append(key, String(value));
  }
  return search.toString();
}

export function buildSignedQuery(
  params: Record<string, string | number | boolean | undefined>,
  apiSecret: string,
  timestamp: number = Date.now()
): string {
  const withTimestamp = { ...params, timestamp };
  const qs = toQueryString(withTimestamp);
  const signature = signQueryString(qs, apiSecret);
  return `${qs}&signature=${signature}`;
}
