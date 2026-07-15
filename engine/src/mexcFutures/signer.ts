import { createHmac } from "node:crypto";

/**
 * MEXC Futures/Contract API signing — distinct from the Spot v3 scheme.
 * Signed string = accessKey + timestamp + paramsString, where paramsString
 * is the sorted "key=value&..." query string for GET or the raw JSON body
 * string for POST. Signature is lowercase hex HMAC-SHA256.
 */
export function signFuturesRequest(
  accessKey: string,
  secretKey: string,
  timestamp: number,
  paramsString: string
): string {
  const toSign = `${accessKey}${timestamp}${paramsString}`;
  return createHmac("sha256", secretKey).update(toSign).digest("hex").toLowerCase();
}

export function sortedQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort();
  return keys.map((k) => `${k}=${params[k]}`).join("&");
}
