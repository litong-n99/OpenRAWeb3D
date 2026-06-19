/**
 * ContentInstallerUI.ts -- DOM overlay UI for the content installation
 * pipeline. Displays package list, download progress, and action buttons.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Installation/DownloadPackageLogic.cs
 *             (download progress dialog + package list UI)
 *
 * 核心范式转换:
 * - C# Widget-based UI (Chrome + WidgetLoader + YAML layout)
 *   -> DOM overlay with inline styles (matches Game.ts main menu approach)
 * - C# DownloadPackageLogic.ShowDownloadDialog() modal dialog
 *   -> ContentInstallerUI.show() fixed-position overlay
 * - C# ProgressBarWidget + LabelWidget -> <progress> element + status text
 * - C# button callbacks via Widget.Bounds -> onclick event listeners
 * - C# widget lifecycle (Add/Remove from Ui.Root) -> appendChild / remove()
 */

import type { ContentInstallerService } from './ContentInstallerService.js'
import type {
  ModContentManifest,
  ContentInstallProgress,
  ContentPackage,
} from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// DOM element IDs (used for test querying and cleanup)
// ---------------------------------------------------------------------------

const OVERLAY_ID = 'content-installer-overlay'
const PANEL_ID = 'content-installer-panel'
const PACKAGE_LIST_ID = 'content-installer-package-list'
const PROGRESS_CONTAINER_ID = 'content-installer-progress'
const BUTTON_BAR_ID = 'content-installer-button-bar'
const INSTALL_ALL_BTN_ID = 'content-installer-install-all'
const PLAY_BTN_ID = 'content-installer-play'
const BACK_BTN_ID = 'content-installer-back'
const TITLE_ID = 'content-installer-title'
const DESCRIPTION_ID = 'content-installer-description'

// ---------------------------------------------------------------------------
// ContentInstallerUI
// ---------------------------------------------------------------------------

/**
 * Static DOM overlay UI for the content installer.
 *
 * Creates a fixed-position backdrop + centered panel with:
 * - Title and description
 * - Package list with per-package status and install buttons
 * - Download progress view with progress bar and cancel/retry
 * - Action buttons: Back, Install All, Play (hidden until ready)
 *
 * Follows the same DOM overlay pattern as Game.showMainMenu().
 */
export class ContentInstallerUI {
  /** Whether the UI is currently visible. */
  private static _visible = false

  /** Unsubscribe function for progress listener. */
  private static _unsubscribe: (() => void) | null = null

  /** Current mod ID. */
  private static _modId: string | null = null

  /** Reference to the service instance. */
  private static _service: ContentInstallerService | null = null

  /** Completion callback. */
  private static _onComplete: (() => void) | null = null

  /** Back callback. */
  private static _onBack: (() => void) | undefined = undefined

  /** Cache of package status: installed vs not. */
  private static _installedPackages = new Set<string>()

  /** Timestamp for download speed calculation. */
  private static _lastProgressTime = 0
  private static _lastProgressBytes = 0

  /**
   * Whether the UI is in parallel download mode (installAllParallel active).
   *
   * In parallel mode, the progress view shows per-package rows with
   * individual progress bars instead of a single combined progress view.
   */
  private static _parallelMode = false

  /**
   * Active concurrent package downloads, keyed by package key.
   * Each entry tracks the last received progress for that package.
   */
  private static _activePackages = new Map<
    string,
    { state: string; percent: number; statusText: string }
  >()

  /**
   * Total number of packages started in the current parallel batch.
   * Used to determine when all concurrent downloads are finished.
   */
  private static _parallelTotalCount = 0

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Show the content installer overlay.
   *
   * Creates a full-screen overlay with a centered panel showing the
   * package list and action buttons. Loads the content manifest and
   * subscribes to progress updates.
   *
   * OpenRA 对照: DownloadPackageLogic widget initialization + layout
   *
   * @param service -- ContentInstallerService instance.
   * @param modId -- Mod to install content for.
   * @param onComplete -- Called when all required packages are installed
   *   and the user clicks "Play".
   * @param onBack -- Optional callback when user clicks "Back" (return to
   *   mod selector).
   */
  static async show(
    service: ContentInstallerService,
    modId: string,
    onComplete: () => void,
    onBack?: () => void,
  ): Promise<void> {
    // Clean up any existing overlay
    ContentInstallerUI.hide()

    ContentInstallerUI._visible = true
    ContentInstallerUI._service = service
    ContentInstallerUI._modId = modId
    ContentInstallerUI._onComplete = onComplete
    ContentInstallerUI._onBack = onBack
    ContentInstallerUI._installedPackages = new Set()
    ContentInstallerUI._lastProgressTime = 0
    ContentInstallerUI._lastProgressBytes = 0

    // Subscribe to progress
    ContentInstallerUI._unsubscribe = service.onProgress((progress) => {
      ContentInstallerUI._handleProgress(progress)
    })

    // Create backdrop
    const backdrop = document.createElement('div')
    backdrop.id = OVERLAY_ID
    backdrop.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;' +
      'justify-content:center;z-index:1000;' +
      'background:rgba(0,0,0,0.7);'

    // Create panel
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.style.cssText =
      'background:rgba(15,15,40,0.92);border:1px solid rgba(100,100,180,0.3);' +
      'border-radius:12px;padding:2rem 2.5rem;max-width:600px;width:90vw;' +
      'max-height:85vh;overflow-y:auto;color:#e0e0f0;' +
      'font-family:system-ui,sans-serif;'

    // Title
    const title = document.createElement('h2')
    title.id = TITLE_ID
    title.textContent = 'Game Content Required'
    title.style.cssText =
      'margin:0 0 0.5rem 0;font-size:1.4rem;font-weight:700;color:#f0f0f0;'
    panel.appendChild(title)

    // Description
    const desc = document.createElement('p')
    desc.id = DESCRIPTION_ID
    desc.textContent =
      'This game needs additional assets to run. ' +
      'You can download them from OpenRA mirrors.'
    desc.style.cssText =
      'margin:0 0 1.5rem 0;font-size:0.9rem;color:#9999bb;line-height:1.4;'
    panel.appendChild(desc)

    // Package list container
    const pkgList = document.createElement('div')
    pkgList.id = PACKAGE_LIST_ID
    panel.appendChild(pkgList)

    // Progress container (hidden initially)
    const progressContainer = document.createElement('div')
    progressContainer.id = PROGRESS_CONTAINER_ID
    progressContainer.style.display = 'none'
    panel.appendChild(progressContainer)

    // Button bar
    const buttonBar = document.createElement('div')
    buttonBar.id = BUTTON_BAR_ID
    buttonBar.style.cssText =
      'display:flex;gap:10px;margin-top:1.5rem;justify-content:space-between;'
    panel.appendChild(buttonBar)

    backdrop.appendChild(panel)
    document.body.appendChild(backdrop)

    // Load manifest and render package list
    const manifest = await service.getContentManifest(modId)
    if (manifest) {
      ContentInstallerUI._renderPackageList(pkgList, manifest, modId)
    }

    // Render button bar
    ContentInstallerUI._renderButtonBar(buttonBar, manifest)
  }

  /**
   * Hide and clean up the content installer overlay.
   *
   * Removes all DOM elements, unsubscribes from progress,
   * and resets internal state.
   */
  static hide(): void {
    ContentInstallerUI._visible = false

    // Unsubscribe from progress
    if (ContentInstallerUI._unsubscribe) {
      ContentInstallerUI._unsubscribe()
      ContentInstallerUI._unsubscribe = null
    }

    // Remove DOM elements
    const overlay = document.getElementById(OVERLAY_ID)
    if (overlay) {
      overlay.remove()
    }

    ContentInstallerUI._service = null
    ContentInstallerUI._modId = null
    ContentInstallerUI._onComplete = null
    ContentInstallerUI._onBack = undefined
    ContentInstallerUI._installedPackages.clear()
    ContentInstallerUI._parallelMode = false
    ContentInstallerUI._activePackages.clear()
    ContentInstallerUI._parallelTotalCount = 0
  }

  // -------------------------------------------------------------------------
  // Private: Package List Rendering
  // -------------------------------------------------------------------------

  /**
   * Render the package list showing all packages from the manifest.
   *
   * Each package row shows: title, required/optional badge, description,
   * and an install button or "Installed" status.
   *
   * @param container -- DOM element to render into.
   * @param manifest -- The content manifest.
   * @param modId -- The mod identifier.
   */
  private static _renderPackageList(
    container: HTMLElement,
    manifest: ModContentManifest,
    modId: string,
  ): void {
    // NOTE: innerHTML = '' is adequate for Phase A (typical mods have
    // <10 packages). If package count grows significantly in Phase C,
    // switch to incremental DOM diffing or a <template>-based approach.
    container.innerHTML = ''

    // Group packages: required first, then optional
    const entries = Object.entries(manifest.packages)
    const required = entries.filter(([, p]) => p.required)
    const optional = entries.filter(([, p]) => !p.required)

    // Required section header
    if (required.length > 0) {
      const requiredHeader = document.createElement('h3')
      requiredHeader.textContent = 'Required Packages'
      requiredHeader.style.cssText =
        'margin:0 0 0.8rem 0;font-size:1rem;font-weight:600;color:#ddd;'
      container.appendChild(requiredHeader)
    }

    for (const [key, pkg] of required) {
      container.appendChild(
        ContentInstallerUI._renderPackageRow(pkg, key, modId),
      )
    }

    // Optional section (collapsible)
    if (optional.length > 0) {
      const optHeader = document.createElement('h3')
      optHeader.textContent = 'Optional Content'
      optHeader.style.cssText =
        'margin:1.2rem 0 0.8rem 0;font-size:1rem;font-weight:600;color:#999;'
      container.appendChild(optHeader)

      for (const [key, pkg] of optional) {
        container.appendChild(
          ContentInstallerUI._renderPackageRow(pkg, key, modId),
        )
      }
    }
  }

  /**
   * Render a single package row.
   *
   * @param pkg -- The package definition.
   * @param key -- The package key (identifier in manifest.packages).
   * @param modId -- The mod identifier.
   * @returns The DOM element for the row.
   */
  private static _renderPackageRow(
    pkg: ContentPackage,
    key: string,
    modId: string,
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = 'content-pkg-row'
    row.dataset.packageKey = key
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:10px 12px;margin-bottom:8px;' +
      'background:rgba(40,40,70,0.4);border:1px solid rgba(80,80,130,0.25);' +
      'border-radius:8px;gap:12px;'

    // Left side: title + status badge + description
    const left = document.createElement('div')
    left.style.cssText = 'flex:1;min-width:0;'

    const titleRow = document.createElement('div')
    titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;'

    const titleEl = document.createElement('span')
    titleEl.textContent = pkg.title
    titleEl.style.cssText = 'font-weight:600;font-size:0.95rem;color:#e0e0f0;'
    titleRow.appendChild(titleEl)

    // Status badge
    const badge = document.createElement('span')
    if (pkg.required) {
      badge.textContent = 'Required'
      badge.style.cssText =
        'font-size:0.7rem;padding:2px 6px;border-radius:3px;' +
        'background:rgba(200,60,60,0.3);color:#ff8888;' +
        'border:1px solid rgba(200,60,60,0.3);'
    } else {
      badge.textContent = 'Optional'
      badge.style.cssText =
        'font-size:0.7rem;padding:2px 6px;border-radius:3px;' +
        'background:rgba(80,80,130,0.3);color:#8888bb;' +
        'border:1px solid rgba(80,80,130,0.3);'
    }
    titleRow.appendChild(badge)

    left.appendChild(titleRow)

    // Description (if title differs from key, show a brief note)
    if (pkg.title !== key) {
      const descEl = document.createElement('div')
      descEl.textContent = `Package: ${key}`
      descEl.style.cssText =
        'font-size:0.75rem;color:#7777aa;margin-top:2px;'
      left.appendChild(descEl)
    }

    row.appendChild(left)

    // Right side: action button or status
    const right = document.createElement('div')
    right.style.cssText = 'flex-shrink:0;'

    const installed = ContentInstallerUI._installedPackages.has(key)
    if (installed) {
      right.textContent = 'Installed'
      right.style.cssText += 'color:#66cc88;font-size:0.85rem;font-weight:600;'
    } else {
      const installBtn = document.createElement('button')
      installBtn.textContent = 'Install'
      installBtn.style.cssText =
        'padding:6px 16px;border:1px solid rgba(100,140,220,0.5);' +
        'border-radius:5px;background:linear-gradient(135deg,#334488,#4466cc);' +
        'color:#e0e0f0;font-size:0.85rem;font-weight:600;cursor:pointer;' +
        'transition:all 0.15s ease;'

      installBtn.addEventListener('mouseenter', () => {
        installBtn.style.background =
          'linear-gradient(135deg,#4466cc,#5577ee)'
      })
      installBtn.addEventListener('mouseleave', () => {
        installBtn.style.background =
          'linear-gradient(135deg,#334488,#4466cc)'
      })

      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true
        installBtn.textContent = 'Installing...'
        try {
          await ContentInstallerUI._service!.installPackage(modId, key)
          ContentInstallerUI._installedPackages.add(key)
          // Refresh the package list
          const listEl = document.getElementById(PACKAGE_LIST_ID)
          const manifest = ContentInstallerUI._service
            ? await ContentInstallerUI._service.getContentManifest(modId)
            : null
          if (listEl && manifest) {
            ContentInstallerUI._renderPackageList(listEl, manifest, modId)
          }
          // Update button bar (may need to show Play button)
          ContentInstallerUI._updatePlayButton()
        } catch {
          installBtn.disabled = false
          installBtn.textContent = 'Retry'
          installBtn.style.background =
            'linear-gradient(135deg,#883333,#cc5555)'
        }
      })

      right.appendChild(installBtn)
    }

    row.appendChild(right)
    return row
  }

  // -------------------------------------------------------------------------
  // Private: Button Bar Rendering
  // -------------------------------------------------------------------------

  /**
   * Render the bottom button bar with Back, Install All, and Play buttons.
   *
   * @param container -- DOM element to render into.
   * @param manifest -- The content manifest (null if no installer for this mod).
   */
  private static _renderButtonBar(
    container: HTMLElement,
    manifest: ModContentManifest | null,
  ): void {
    container.innerHTML = ''
    const modId = ContentInstallerUI._modId!

    // Back button
    if (ContentInstallerUI._onBack) {
      const backBtn = document.createElement('button')
      backBtn.id = BACK_BTN_ID
      backBtn.textContent = 'Back'
      backBtn.style.cssText =
        'padding:10px 24px;border:1px solid rgba(100,100,180,0.3);' +
        'border-radius:6px;background:rgba(30,30,50,0.6);color:#9999bb;' +
        'font-size:0.9rem;font-weight:600;cursor:pointer;' +
        'transition:all 0.15s ease;'
      backBtn.addEventListener('mouseenter', () => {
        backBtn.style.background = 'rgba(50,50,80,0.6)'
        backBtn.style.color = '#ccc'
      })
      backBtn.addEventListener('mouseleave', () => {
        backBtn.style.background = 'rgba(30,30,50,0.6)'
        backBtn.style.color = '#9999bb'
      })
      backBtn.addEventListener('click', () => {
        ContentInstallerUI._onBack?.()
        ContentInstallerUI.hide()
      })
      container.appendChild(backBtn)
    }

    // Right-aligned buttons
    const rightBtns = document.createElement('div')
    rightBtns.style.cssText = 'display:flex;gap:10px;margin-left:auto;'
    container.appendChild(rightBtns)

    // Install All button
    if (manifest && Object.keys(manifest.packages).length > 0) {
      const installAllBtn = document.createElement('button')
      installAllBtn.id = INSTALL_ALL_BTN_ID
      installAllBtn.textContent = 'Install All'
      installAllBtn.style.cssText =
        'padding:10px 24px;border:1px solid rgba(100,140,220,0.5);' +
        'border-radius:6px;background:linear-gradient(135deg,#334488,#4466cc);' +
        'color:#e0e0f0;font-size:0.9rem;font-weight:600;cursor:pointer;' +
        'transition:all 0.15s ease;'
      installAllBtn.addEventListener('mouseenter', () => {
        installAllBtn.style.background =
          'linear-gradient(135deg,#4466cc,#5577ee)'
      })
      installAllBtn.addEventListener('mouseleave', () => {
        installAllBtn.style.background =
          'linear-gradient(135deg,#334488,#4466cc)'
      })
      installAllBtn.addEventListener('click', async () => {
        installAllBtn.disabled = true
        installAllBtn.textContent = 'Installing...'
        try {
          // CI-B.3: Use parallel install for better throughput
          await ContentInstallerUI._service!.installAllParallel(modId, 2)
          // Re-check and refresh
          const m = await ContentInstallerUI._service!.getContentManifest(
            modId,
          )
          const listEl = document.getElementById(PACKAGE_LIST_ID)
          if (listEl && m) {
            ContentInstallerUI._installedPackages = new Set(
              Object.keys(m.packages),
            )
            ContentInstallerUI._renderPackageList(listEl, m, modId)
          }
          ContentInstallerUI._updatePlayButton()
        } catch {
          installAllBtn.disabled = false
          installAllBtn.textContent = 'Retry All'
        }
      })
      rightBtns.appendChild(installAllBtn)
    }

    // Play button (hidden until ready, or always visible if no content needed)
    const playBtn = document.createElement('button')
    playBtn.id = PLAY_BTN_ID
    playBtn.textContent = 'Play'
    playBtn.style.cssText =
      'padding:10px 24px;border:1px solid rgba(100,200,140,0.5);' +
      'border-radius:6px;background:linear-gradient(135deg,#338844,#44bb66);' +
      'color:#e0f0e0;font-size:0.9rem;font-weight:700;cursor:pointer;' +
      'transition:all 0.15s ease;'
    playBtn.addEventListener('mouseenter', () => {
      playBtn.style.background =
        'linear-gradient(135deg,#44aa55,#55cc77)'
    })
    playBtn.addEventListener('mouseleave', () => {
      playBtn.style.background =
        'linear-gradient(135deg,#338844,#44bb66)'
    })
    playBtn.addEventListener('click', () => {
      const onComplete = ContentInstallerUI._onComplete
      ContentInstallerUI.hide()
      onComplete?.()
    })

    // Initially hidden if there are packages to install
    if (manifest && Object.keys(manifest.packages).length > 0) {
      playBtn.style.display = 'none'
    }

    rightBtns.appendChild(playBtn)
  }

  /**
   * Check if all required packages are installed and show the Play button.
   */
  private static _updatePlayButton(): void {
    const playBtn = document.getElementById(PLAY_BTN_ID) as HTMLButtonElement
    const installAllBtn = document.getElementById(
      INSTALL_ALL_BTN_ID,
    ) as HTMLButtonElement | null
    if (!playBtn) return

    // If play button is hidden, show it
    if (playBtn.style.display === 'none') {
      playBtn.style.display = ''
    }

    // Hide Install All button if no more packages to install
    if (installAllBtn) {
      const rows = document.querySelectorAll('.content-pkg-row')
      let allInstalled = true
      for (const row of rows) {
        const key = (row as HTMLElement).dataset.packageKey
        if (key && !ContentInstallerUI._installedPackages.has(key)) {
          allInstalled = false
          break
        }
      }
      if (allInstalled) {
        installAllBtn.style.display = 'none'
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Download Progress Rendering
  // -------------------------------------------------------------------------

  /**
   * Show the download progress view, replacing the package list.
   *
   * @param packageId -- The package being installed.
   * @returns The progress container DOM element.
   */
  private static _showProgressView(packageId: string): HTMLElement {
    const pkgList = document.getElementById(PACKAGE_LIST_ID)
    if (pkgList) {
      pkgList.style.display = 'none'
    }

    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) {
      // RESOLVED (R1 BLOCKER): The orphan fallback div is now appended to
      // the panel (or document.body as last resort), preventing DOM leaks.
      // The warning is retained for diagnostics — if this fires, the panel
      // element (PANEL_ID) was removed or renamed without updating show().
      console.warn(
        '[ContentInstallerUI] PROGRESS_CONTAINER_ID not found in DOM — ' +
        'appending fallback to panel.',
      )
      const fallback = document.createElement('div')
      fallback.id = PROGRESS_CONTAINER_ID
      const panel = document.getElementById(PANEL_ID)
      if (panel) {
        panel.appendChild(fallback)
      } else {
        // Last resort: append to body
        document.body.appendChild(fallback)
      }
      return fallback
    }

    container.style.display = ''
    container.innerHTML = ''

    // Status text
    const statusEl = document.createElement('div')
    statusEl.className = 'progress-status'
    statusEl.textContent = 'Starting...'
    statusEl.style.cssText =
      'font-size:0.9rem;color:#ccc;margin-bottom:10px;text-align:center;'
    container.appendChild(statusEl)

    // Progress bar
    const progressEl = document.createElement('progress')
    progressEl.className = 'progress-bar'
    progressEl.max = 100
    progressEl.value = 0
    progressEl.style.cssText =
      'width:100%;height:24px;border-radius:4px;appearance:none;'
    container.appendChild(progressEl)

    // Bytes text
    const bytesEl = document.createElement('div')
    bytesEl.className = 'progress-bytes'
    bytesEl.textContent = '0 B / --'
    bytesEl.style.cssText =
      'font-size:0.8rem;color:#8888aa;margin-top:6px;text-align:center;'
    container.appendChild(bytesEl)

    // Speed text
    const speedEl = document.createElement('div')
    speedEl.className = 'progress-speed'
    speedEl.textContent = ''
    speedEl.style.cssText =
      'font-size:0.8rem;color:#7777aa;margin-top:2px;text-align:center;'
    container.appendChild(speedEl)

    // Error message (hidden)
    const errorEl = document.createElement('div')
    errorEl.className = 'progress-error'
    errorEl.style.cssText =
      'display:none;color:#ff6666;font-size:0.85rem;margin-top:10px;' +
      'text-align:center;'
    container.appendChild(errorEl)

    // Cancel/Retry button
    const actionBtn = document.createElement('button')
    actionBtn.className = 'progress-action-btn'
    actionBtn.textContent = 'Cancel'
    actionBtn.style.cssText =
      'display:block;margin:12px auto 0;padding:8px 20px;' +
      'border:1px solid rgba(100,100,180,0.4);border-radius:5px;' +
      'background:rgba(30,30,50,0.8);color:#9999bb;' +
      'font-size:0.85rem;cursor:pointer;'
    actionBtn.addEventListener('click', () => {
      ContentInstallerUI._service?.cancel()
      // Hide progress and show package list again
      ContentInstallerUI._hideProgressView()
    })
    container.appendChild(actionBtn)

    // Store packageId for progress updates
    container.dataset.currentPackage = packageId

    return container
  }

  /**
   * Hide the progress view and restore the package list.
   */
  private static _hideProgressView(): void {
    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (container) {
      container.style.display = 'none'
    }
    const pkgList = document.getElementById(PACKAGE_LIST_ID)
    if (pkgList) {
      pkgList.style.display = ''
    }
  }

  // -------------------------------------------------------------------------
  // Private: Progress Handler
  // -------------------------------------------------------------------------

  /**
   * Handle progress events from the ContentInstallerService.
   *
   * Updates the progress view based on the current installation state.
   */
  private static _handleProgress(progress: ContentInstallProgress): void {
    if (!ContentInstallerUI._visible) return

    const state = progress.state

    // CI-B.3: Detect parallel mode — when we see progress for a package
    // that isn't the "current" single-download package, switch to parallel UI.
    // Also detect when multiple active packages exist simultaneously.
    if (progress.packageId) {
      // Extract package key from packageId ("ra:quickinstall" -> "quickinstall")
      const pkgKey = ContentInstallerUI._extractPackageKey(progress.packageId)

      // Track active/in-progress states
      if (
        state === 'downloading' ||
        state === 'verifying' ||
        state === 'extracting' ||
        state === 'mounting'
      ) {
        if (pkgKey) {
          ContentInstallerUI._activePackages.set(pkgKey, {
            state,
            percent: progress.progressPercent,
            statusText: progress.statusText,
          })
        }

        // If we have 2+ active packages, switch to parallel mode
        if (
          ContentInstallerUI._activePackages.size >= 2 &&
          !ContentInstallerUI._parallelMode
        ) {
          ContentInstallerUI._parallelMode = true
          ContentInstallerUI._parallelTotalCount =
            ContentInstallerUI._activePackages.size
          ContentInstallerUI._showParallelProgressView()
        }
      }

      // If in parallel mode, handle all state transitions
      if (ContentInstallerUI._parallelMode) {
        if (pkgKey) {
          ContentInstallerUI._updateParallelPackageRow(
            pkgKey,
            state,
            progress.progressPercent,
            progress.statusText,
          )
        }
        // Track completion/error
        if (state === 'complete' || state === 'error') {
          // Remove from active packages
          if (pkgKey) ContentInstallerUI._activePackages.delete(pkgKey)
        }
        // Check if all packages in this parallel batch are done
        // (no more active packages, and we've started the expected total)
        if (
          ContentInstallerUI._activePackages.size === 0 &&
          ContentInstallerUI._parallelTotalCount > 0
        ) {
          ContentInstallerUI._hideProgressView()
          ContentInstallerUI._parallelMode = false
          ContentInstallerUI._activePackages.clear()
          ContentInstallerUI._parallelTotalCount = 0
          ContentInstallerUI._updatePlayButton()
        }
        return
      }
    }

    // Single-package mode (existing behavior)
    if (state === 'downloading') {
      const container = document.getElementById(PROGRESS_CONTAINER_ID)
      if (!container || container.style.display === 'none') {
        ContentInstallerUI._showProgressView(progress.packageId)
      }
      ContentInstallerUI._updateProgressView(progress)
    } else if (state === 'verifying') {
      ContentInstallerUI._updateStatusText(progress.statusText)
    } else if (state === 'extracting') {
      ContentInstallerUI._updateStatusText(progress.statusText)
      if (progress.progressPercent >= 0) {
        ContentInstallerUI._updateProgressBar(progress.progressPercent)
      }
    } else if (state === 'mounting') {
      ContentInstallerUI._updateStatusText(progress.statusText)
      if (progress.progressPercent >= 0) {
        ContentInstallerUI._updateProgressBar(progress.progressPercent)
      }
    } else if (state === 'error') {
      const container = document.getElementById(PROGRESS_CONTAINER_ID)
      if (container) {
        const errorEl = container.querySelector(
          '.progress-error',
        ) as HTMLElement | null
        const actionBtn = container.querySelector(
          '.progress-action-btn',
        ) as HTMLButtonElement | null
        const statusEl = container.querySelector(
          '.progress-status',
        ) as HTMLElement | null

        if (errorEl) {
          errorEl.style.display = ''
          errorEl.textContent = progress.error ?? 'Unknown error'
        }
        if (statusEl) {
          statusEl.textContent = 'Installation Failed'
          statusEl.style.color = '#ff6666'
        }
        if (actionBtn) {
          actionBtn.textContent = 'Back to Packages'
          actionBtn.style.background = 'rgba(200,60,60,0.3)'
          actionBtn.style.borderColor = 'rgba(200,60,60,0.5)'
          actionBtn.style.color = '#ff8888'
          actionBtn.onclick = () => {
            ContentInstallerUI._hideProgressView()
            // Reset action button for next use
            actionBtn.textContent = 'Cancel'
            actionBtn.style.background = 'rgba(30,30,50,0.8)'
            actionBtn.style.borderColor = 'rgba(100,100,180,0.4)'
            actionBtn.style.color = '#9999bb'
            actionBtn.onclick = () => {
              ContentInstallerUI._service?.cancel()
              ContentInstallerUI._hideProgressView()
            }
          }
        }
      }
    } else if (state === 'complete') {
      ContentInstallerUI._hideProgressView()
      ContentInstallerUI._updatePlayButton()
    }
  }

  /**
   * Update elements in the progress view.
   */
  private static _updateProgressView(progress: ContentInstallProgress): void {
    ContentInstallerUI._updateStatusText(progress.statusText)
    if (progress.progressPercent >= 0) {
      ContentInstallerUI._updateProgressBar(progress.progressPercent)
    }
    ContentInstallerUI._updateBytesText(
      progress.bytesReceived,
      progress.bytesTotal,
    )
    ContentInstallerUI._updateSpeedText(progress.bytesReceived)
  }

  /**
   * Update the status text element.
   */
  private static _updateStatusText(text: string): void {
    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) return
    const el = container.querySelector('.progress-status') as HTMLElement | null
    if (el) {
      el.textContent = text
    }
  }

  /**
   * Update the progress bar value.
   */
  private static _updateProgressBar(percent: number): void {
    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) return
    const el = container.querySelector('.progress-bar') as HTMLProgressElement | null
    if (el) {
      el.value = Math.min(100, Math.max(0, percent))
    }
  }

  /**
   * Update the bytes text.
   */
  private static _updateBytesText(received: number, total: number): void {
    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) return
    const el = container.querySelector('.progress-bytes') as HTMLElement | null
    if (el) {
      const receivedStr = ContentInstallerUI._formatBytes(received)
      const totalStr = total > 0 ? ContentInstallerUI._formatBytes(total) : '--'
      el.textContent = `${receivedStr} / ${totalStr}`
    }
  }

  /**
   * Update the speed text based on consecutive progress updates.
   */
  private static _updateSpeedText(received: number): void {
    const now = Date.now()
    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) return
    const el = container.querySelector('.progress-speed') as HTMLElement | null
    if (!el) return

    if (
      ContentInstallerUI._lastProgressTime > 0 &&
      now > ContentInstallerUI._lastProgressTime
    ) {
      const deltaTime = (now - ContentInstallerUI._lastProgressTime) / 1000 // seconds
      const deltaBytes =
        received - ContentInstallerUI._lastProgressBytes
      if (deltaTime > 0 && deltaBytes > 0) {
        const speed = deltaBytes / deltaTime
        el.textContent = ContentInstallerUI._formatSpeed(speed)
      }
    }

    ContentInstallerUI._lastProgressTime = now
    ContentInstallerUI._lastProgressBytes = received
  }

  // -------------------------------------------------------------------------
  // Private: Formatting Helpers
  // -------------------------------------------------------------------------

  /**
   * Format bytes into a human-readable string.
   *
   * @param bytes -- Number of bytes.
   * @returns Formatted string (e.g. "1.2 MB", "340 KB", "0 B").
   */
  private static _formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  /**
   * Format bytes per second into a human-readable speed string.
   *
   * @param bytesPerSec -- Bytes per second.
   * @returns Formatted string (e.g. "2.5 MB/s", "340 KB/s").
   */
  private static _formatSpeed(bytesPerSec: number): string {
    return `${ContentInstallerUI._formatBytes(Math.round(bytesPerSec))}/s`
  }

  // -------------------------------------------------------------------------
  // Parallel Progress (CI-B.3)
  // -------------------------------------------------------------------------

  /**
   * Show the parallel progress view with per-package rows.
   *
   * Replaces the package list with a container that shows each package
   * being downloaded concurrently, each with its own progress bar.
   */
  private static _showParallelProgressView(): void {
    const pkgList = document.getElementById(PACKAGE_LIST_ID)
    if (pkgList) {
      pkgList.style.display = 'none'
    }

    const container = document.getElementById(PROGRESS_CONTAINER_ID)
    if (!container) {
      console.warn(
        '[ContentInstallerUI] PROGRESS_CONTAINER_ID not found for parallel view',
      )
      return
    }

    container.style.display = ''
    container.innerHTML = ''

    // Header
    const header = document.createElement('div')
    header.textContent = 'Downloading content packages...'
    header.style.cssText =
      'font-size:0.9rem;color:#ccc;margin-bottom:12px;text-align:center;font-weight:600;'
    container.appendChild(header)

    // Per-package rows container
    const rowsContainer = document.createElement('div')
    rowsContainer.className = 'parallel-progress-rows'
    rowsContainer.style.cssText =
      'display:flex;flex-direction:column;gap:8px;'
    container.appendChild(rowsContainer)

    // Create a row for each active package
    for (const [pkgKey, info] of ContentInstallerUI._activePackages) {
      ContentInstallerUI._createParallelPackageRow(
        rowsContainer,
        pkgKey,
        info.state,
        info.percent,
        info.statusText,
      )
    }

    // Cancel All button
    const cancelAllBtn = document.createElement('button')
    cancelAllBtn.textContent = 'Cancel All'
    cancelAllBtn.style.cssText =
      'display:block;margin:12px auto 0;padding:8px 20px;' +
      'border:1px solid rgba(100,100,180,0.4);border-radius:5px;' +
      'background:rgba(30,30,50,0.8);color:#9999bb;' +
      'font-size:0.85rem;cursor:pointer;'
    cancelAllBtn.addEventListener('click', () => {
      ContentInstallerUI._service?.cancel()
      ContentInstallerUI._hideProgressView()
      ContentInstallerUI._parallelMode = false
      ContentInstallerUI._activePackages.clear()
      ContentInstallerUI._parallelTotalCount = 0
    })
    container.appendChild(cancelAllBtn)
  }

  /**
   * Create a row in the parallel progress container for one package.
   */
  private static _createParallelPackageRow(
    container: HTMLElement,
    pkgKey: string,
    state: string,
    percent: number,
    statusText: string,
  ): void {
    const row = document.createElement('div')
    row.className = 'parallel-pkg-row'
    row.dataset.packageKey = pkgKey
    row.style.cssText =
      'display:flex;align-items:center;gap:10px;' +
      'padding:8px 12px;background:rgba(40,40,70,0.4);' +
      'border:1px solid rgba(80,80,130,0.25);border-radius:6px;'

    // Package name
    const nameEl = document.createElement('span')
    nameEl.className = 'parallel-pkg-name'
    nameEl.textContent = ContentInstallerUI._packageDisplayName(pkgKey)
    nameEl.style.cssText =
      'min-width:100px;font-size:0.85rem;font-weight:600;color:#e0e0f0;'
    row.appendChild(nameEl)

    // Mini progress bar
    const progressEl = document.createElement('progress')
    progressEl.className = 'parallel-pkg-progress'
    progressEl.max = 100
    progressEl.value = Math.min(100, Math.max(0, percent))
    progressEl.style.cssText = 'flex:1;height:10px;border-radius:3px;'
    row.appendChild(progressEl)

    // Status text
    const statusEl = document.createElement('span')
    statusEl.className = 'parallel-pkg-status'
    statusEl.textContent = statusText || state
    statusEl.style.cssText =
      'min-width:80px;font-size:0.75rem;color:#8888aa;text-align:right;'
    row.appendChild(statusEl)

    container.appendChild(row)
  }

  /**
   * Update a parallel package row with new progress data.
   */
  private static _updateParallelPackageRow(
    pkgKey: string,
    state: string,
    percent: number,
    statusText: string,
  ): void {
    const row = document.querySelector(
      `.parallel-pkg-row[data-package-key="${CSS.escape(pkgKey)}"]`,
    ) as HTMLElement | null
    if (!row) return

    const progressEl = row.querySelector(
      '.parallel-pkg-progress',
    ) as HTMLProgressElement | null
    if (progressEl && percent >= 0) {
      progressEl.value = Math.min(100, Math.max(0, percent))
    }

    const statusEl = row.querySelector(
      '.parallel-pkg-status',
    ) as HTMLElement | null
    if (statusEl) {
      statusEl.textContent = statusText || state
      if (state === 'complete') {
        statusEl.style.color = '#66cc88'
      } else if (state === 'error') {
        statusEl.style.color = '#ff6666'
      }
    }
  }

  /**
   * Extract the package key from a packageId string.
   *
   * @param packageId — e.g. "ra:quickinstall" → "quickinstall"
   * @returns The package key, or null if packageId is empty.
   */
  private static _extractPackageKey(packageId: string): string | null {
    if (!packageId) return null
    const colonIdx = packageId.indexOf(':')
    return colonIdx > 0 ? packageId.substring(colonIdx + 1) : packageId
  }

  /**
   * Convert a package key to a display-friendly name.
   */
  private static _packageDisplayName(pkgKey: string): string {
    // Capitalize first letter, replace hyphens with spaces
    return pkgKey
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
}
