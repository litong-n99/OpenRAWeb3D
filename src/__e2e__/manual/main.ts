/**
 * Acceptance Test Hub Page — Auto-discovery logic
 *
 * Uses Vite's import.meta.glob with a relative pattern to discover all
 * acceptance test pages under src/__e2e__/manual/ and renders them as
 * clickable links. The relative glob ensures Vite resolves patterns
 * correctly against this module's directory.
 *
 * No manual registry maintenance is needed — adding a new directory with
 * an index.html will cause it to appear on the next dev server restart.
 */

// ---------------------------------------------------------------------------
// Glob: discover all test page entry points (relative pattern)
// ---------------------------------------------------------------------------

/**
 * Relative glob from this module's location (src/__e2e__/manual/).
 * Matches: ./hardware-palette/color-accuracy/index.html, etc.
 * Excludes: ./index.html (this hub page itself).
 */
const discoveredPages = import.meta.glob(
  './**/index.html',
  { eager: false },
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestPageInfo {
  /** Relative glob key, e.g. "./hardware-palette/color-accuracy/index.html" */
  globKey: string
  /** Clean hub URL, e.g. "/test/manual/hardware-palette/color-accuracy/" */
  hubUrl: string
  /** Directory path segments, e.g. ["hardware-palette", "color-accuracy"] */
  segments: string[]
  /** Human-readable display name, e.g. "Hardware Palette / Color Accuracy" */
  displayName: string
}

// ---------------------------------------------------------------------------
// Page discovery
// ---------------------------------------------------------------------------

function discoverTestPages(): TestPageInfo[] {
  const keys = Object.keys(discoveredPages)

  return keys
    .filter((key) => key !== './index.html') // exclude hub page itself
    .map((key): TestPageInfo => {
      // Remove leading "./" and trailing "index.html" to get directory path
      // "./hardware-palette/color-accuracy/index.html" → "hardware-palette/color-accuracy"
      const relativeDir = key
        .replace(/^\.\//, '')
        .replace(/\/index\.html$/, '')

      const segments = relativeDir.split('/').filter(Boolean)

      // Build clean hub URL: /test/hardware-palette/color-accuracy/
      const hubUrl = `/test/${relativeDir}/`

      // Derive display name: capitalize each segment, join with " / "
      const displayName = segments
        .map((s) =>
          s
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
        )
        .join(' / ')

      return { globKey: key, hubUrl, segments, displayName }
    })
    .sort((a, b) => a.hubUrl.localeCompare(b.hubUrl))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTestList(): void {
  const listEl = document.getElementById('test-list') as HTMLUListElement
  const emptyEl = document.getElementById('empty-state') as HTMLDivElement
  const countEl = document.getElementById('page-count') as HTMLParagraphElement

  const pages = discoverTestPages()

  if (pages.length === 0) {
    emptyEl.style.display = 'block'
    countEl.textContent = ''
    return
  }

  countEl.textContent = `${pages.length} test page${pages.length === 1 ? '' : 's'} found`

  for (const page of pages) {
    const li = document.createElement('li')
    li.innerHTML = `
      <a href="${page.hubUrl}">
        <div class="test-name">${page.displayName}</div>
        <div class="test-id">${page.segments.join(' / ')}</div>
        <div class="test-path">${page.hubUrl}</div>
      </a>
    `
    listEl.appendChild(li)
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderTestList()

// Support HMR: re-render when this module is hot-updated
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    const listEl = document.getElementById('test-list') as HTMLUListElement
    listEl.innerHTML = ''
    renderTestList()
  })
}
