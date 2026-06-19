/**
 * MirrorResolver.ts — Fetches a mirror list from a URL and selects a random
 * mirror for content download.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Installation/DownloadPackageLogic.cs
 *             (mirror list fetch + random selection via MersenneTwister)
 *
 * 核心范式转换:
 * - C# HttpClient.GetAsync() + ReadAsStringAsync()
 *   → browser `fetch()` API with `.text()`
 * - C# `result.Split('\n', StringSplitOptions.RemoveEmptyEntries)`
 *   → TypeScript `split('\n').map(l => l.trim()).filter(l => l.length > 0)`
 * - C# `mirrorList.Random(new MersenneTwister())`
 *   → `crypto.getRandomValues(new Uint32Array(1))[0] % mirrors.length`
 * - C# Task.Run + Exception handling via logging
 *   → thrown Errors with descriptive messages
 */

// ---------------------------------------------------------------------------
// MirrorResolver — Static mirror list utilities
// ---------------------------------------------------------------------------

export class MirrorResolver {
  /**
   * Fetch the mirror list from the given URL and return a randomly selected
   * mirror URL.
   *
   * OpenRA 对照: DownloadPackageLogic.ShowDownloadDialog() — mirror list fetch
   *             block that calls `DownloadUrl(mirrorList.Random(...))`
   *
   * @param mirrorListUrl — The URL to fetch the mirror list from (plain text,
   *                        one URL per line).
   * @returns A randomly selected mirror URL.
   * @throws Error if the mirror list is empty or all lines are blank.
   * @throws Error if the HTTP request fails (non-2xx status).
   */
  static async resolveMirror(mirrorListUrl: string): Promise<string> {
    const mirrors = await MirrorResolver.fetchMirrors(mirrorListUrl);

    if (mirrors.length === 0) {
      throw new Error('No mirrors available');
    }

    const index =
      crypto.getRandomValues(new Uint32Array(1))[0] % mirrors.length;
    return mirrors[index];
  }

  /**
   * Fetch all mirrors from the given mirror list URL.
   *
   * The response body is expected to be plain text with one URL per line.
   * Blank lines and lines containing only whitespace are filtered out.
   * Each line is trimmed of leading and trailing whitespace.
   *
   * OpenRA 对照: DownloadPackageLogic.ShowDownloadDialog() —
   *             `result.Split('\n', StringSplitOptions.RemoveEmptyEntries)`
   *
   * @param mirrorListUrl — The URL to fetch the mirror list from.
   * @returns Array of non-empty mirror URL strings.
   * @throws Error if the HTTP request fails (non-2xx status).
   */
  static async fetchMirrors(mirrorListUrl: string): Promise<string[]> {
    const response = await fetch(mirrorListUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch mirror list: HTTP ${response.status}`,
      );
    }

    const text = await response.text();
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
