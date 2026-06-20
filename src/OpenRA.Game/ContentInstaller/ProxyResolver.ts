/**
 * ProxyResolver.ts — Fetch wrapper for the Content Installer.
 *
 * OpenRA 对照: None (OpenRA desktop reads from local filesystem).
 *
 * 核心范式转换:
 * - Desktop direct filesystem access → browser fetch().
 * - Content ZIPs are placed in public/content/ and loaded via same-origin fetch.
 * - External CDN URLs are fetched directly (may fail due to CORS — local
 *   content in public/content/ is the primary path).
 */

/**
 * A thin wrapper around fetch() for Content Installer downloads.
 * Same-origin URLs pass through; external URLs are fetched directly.
 *
 * @param url — Request URL.
 * @param init — RequestInit options.
 * @returns A Response.
 */
export async function proxiedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, init)
}
