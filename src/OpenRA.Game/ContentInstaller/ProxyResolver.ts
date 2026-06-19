/**
 * ProxyResolver.ts — URL proxy wrapper for bypassing browser CORS restrictions
 * during content download.
 *
 * OpenRA 对照: None (OpenRA desktop has no CORS — it reads from local filesystem).
 *   This is a web-specific adaptation.
 *
 * 核心范式转换:
 * - Desktop direct filesystem access → browser can only fetch() same-origin or
 *   CORS-permissive URLs. OpenRA CDN mirrors do NOT set CORS headers, so the
 *   Vite dev server acts as a relay: /api/proxy?url=<target>
 *
 * In production, assets would be served from the same origin or a CORS-configured
 * CDN, so the proxy is only used in development mode.
 */

// ---------------------------------------------------------------------------
// ProxyResolver — URL wrapping for CORS bypass
// ---------------------------------------------------------------------------

/** Prefix for the Vite dev server CORS proxy endpoint. */
const PROXY_PREFIX = '/api/proxy?url='

/** Whether we are running in Vite dev server mode (not production, not test). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _isDev: boolean = (() => {
  try {
    const env = (import.meta as unknown as { env?: { MODE?: string } }).env
    if (!env) return false
    // MODE === 'development' only in vite dev server. vitest sets MODE to 'test'.
    return env.MODE === 'development'
  } catch {
    return false
  }
})()

/**
 * Wrap a URL through the Vite dev server CORS proxy if running in development
 * mode. In production, returns the URL unchanged.
 *
 * The Vite dev server middleware at `/api/proxy?url=<encoded>` fetches the
 * target URL server-side (where there are no CORS restrictions) and returns
 * the response with `Access-Control-Allow-Origin: *`.
 *
 * @param url — The original download URL (may point to a third-party CDN).
 * @returns The URL wrapped through the proxy (dev) or unchanged (prod).
 */
export function proxiedUrl(url: string): string {
  if (_isDev) {
    return PROXY_PREFIX + encodeURIComponent(url)
  }
  return url
}

/**
 * A drop-in replacement for `fetch()` that routes external HTTP/HTTPS URLs
 * through the Vite CORS proxy in development mode. Same-origin URLs are NOT
 * proxied (they pass through directly).
 *
 * In production mode, this is equivalent to a direct `fetch()` call.
 *
 * @param url — Request URL.
 * @param init — RequestInit options (same as fetch()).
 * @returns A Response, same as the global fetch().
 */
export async function proxiedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  // In production (or test), use direct fetch.
  // Also skip proxying for same-origin URLs (start with '/' or the current origin).
  if (!_isDev) {
    return fetch(url, init)
  }
  try {
    if (url.startsWith('/') || url.startsWith(location.origin)) {
      return fetch(url, init)
    }
  } catch {
    // location not available (test environment) — fall through to proxied
  }
  return fetch(proxiedUrl(url), init)
}
