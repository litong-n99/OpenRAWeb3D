/**
 * ContentSourceResolver.ts — File upload fallback for users who have game
 * files locally (CD, Steam, Origin installations).
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Installation/ModContentLogic.cs
 *             (CD/Steam/Origin source detection and file copy logic)
 *
 * 核心范式转换:
 * - C# System.IO.File.Exists() + Directory.GetFiles() local file system detection
 *   → browser `<input type="file">` + FileReader API for user-selected files
 * - C# Registry key lookups (Steam/Origin install paths)
 *   → showSourceInstructions() returning user-facing HTML instructions
 * - C# auto-detection of game installations
 *   → manual user file selection (browsers can't access arbitrary filesystem)
 * - C# idFiles verification via file system scan
 *   → IndexedDB `openra-content` lookup for previously uploaded source files
 *
 * NOTE: Browser sandbox prevents automatic detection of game installations
 * (CD drives, Steam directories, Origin directories). The user must manually
 * select the relevant files via a file picker dialog.
 */

import type { ContentSource } from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for content package tracking (shared). */
const DB_NAME = 'openra-content'

/** Object store name. */
const STORE_NAME = 'packages'

// ---------------------------------------------------------------------------
// ContentSourceResolver
// ---------------------------------------------------------------------------

/**
 * Static utilities for resolving content from local/CD-based game installations.
 *
 * Provides a browser-safe equivalent of OpenRA's CD/Steam/Origin source
 * detection: programmatic file input creation, IndexedDB-based source
 * file presence checks, and human-readable installation instructions.
 */
export class ContentSourceResolver {
  /**
   * Prompt the user to select local game files via a file input dialog.
   *
   * Programmatically creates an `<input type="file">`, triggers the file
   * picker, reads each selected file as an ArrayBuffer via FileReader,
   * and returns a Map of filename → ArrayBuffer.
   *
   * OpenRA 对照: ModContentLogic detection + file copy loop
   *
   * @param accept — Comma-separated file extensions to accept
   *   (e.g. ".mix,.pak,.big,.meg,.zip").
   * @returns Map of filename (basename only, no path) → file contents as
   *   ArrayBuffer. Empty Map if the user cancels the dialog.
   */
  static async selectFiles(accept: string): Promise<Map<string, ArrayBuffer>> {
    return new Promise((resolve) => {
      // Create file input element
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.accept = accept
      input.style.display = 'none'
      document.body.appendChild(input)

      // Clean up after selection
      const cleanup = () => {
        try { document.body.removeChild(input) } catch { /* already removed */ }
      }

      input.addEventListener('change', async () => {
        const files = input.files
        if (!files || files.length === 0) {
          cleanup()
          resolve(new Map())
          return
        }

        const result = new Map<string, ArrayBuffer>()

        try {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]!
            const buffer = await ContentSourceResolver._readFileAsArrayBuffer(file)
            // Use basename only — browsers strip the full path for security
            result.set(file.name, buffer)
          }
        } catch (err) {
          console.warn('[ContentSourceResolver] Error reading files:', err)
        }

        cleanup()
        resolve(result)
      })

      // Handle cancellation (no files selected)
      input.addEventListener('cancel', () => {
        cleanup()
        resolve(new Map())
      })

      // Fallback: if the dialog is dismissed without triggering 'change' or
      // 'cancel' (some browsers), resolve on window focus return with empty map
      // after a grace period.
      const onFocus = () => {
        // If 'change' hasn't fired within the next tick, assume cancelled
        window.removeEventListener('focus', onFocus)
        setTimeout(() => {
          if (document.body.contains(input)) {
            cleanup()
            resolve(new Map())
          }
        }, 300)
      }
      window.addEventListener('focus', onFocus, { once: true })

      // Trigger file picker
      input.click()
    })
  }

  /**
   * Check if the idFiles from a ContentSource exist in IndexedDB.
   *
   * Used to determine whether the user has previously uploaded the files
   * required by a particular installation source (CD, Steam, etc.).
   *
   * OpenRA 对照: ModContentLogic idFiles existence check
   *
   * @param source — The content source definition with idFiles map.
   * @returns `true` if ALL idFiles for this source exist in IndexedDB
   *   records, `false` if any are missing or IndexedDB is unavailable.
   */
  static async checkSourceFiles(source: ContentSource): Promise<boolean> {
    if (!source.idFiles || Object.keys(source.idFiles).length === 0) {
      // No idFiles defined — source detection is not applicable
      return false
    }

    const idFileNames = Object.keys(source.idFiles)

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME)
        request.onsuccess = () => {
          const db = request.result
          try {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const store = tx.objectStore(STORE_NAME)

            // Collect all filenames from all records
            const getAllReq = store.getAll()
            getAllReq.onsuccess = () => {
              const records = (getAllReq.result as { files?: string[] }[]) ?? []
              const allKnownFiles = new Set<string>()
              for (const record of records) {
                if (record.files) {
                  for (const f of record.files) {
                    allKnownFiles.add(f)
                  }
                }
              }

              // Check if ALL idFiles are present
              const allFound = idFileNames.every((f) => allKnownFiles.has(f))
              try { db.close() } catch { /* ignore */ }
              resolve(allFound)
            }
            getAllReq.onerror = () => {
              try { db.close() } catch { /* ignore */ }
              resolve(false)
            }
          } catch {
            try { db.close() } catch { /* ignore */ }
            resolve(false)
          }
        }
        request.onerror = () => resolve(false)
        request.onblocked = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  }

  /**
   * Generate user-facing HTML instructions for locating game files from a
   * specific source type.
   *
   * Since browsers cannot auto-detect Steam/Origin/CD installations, this
   * provides the user with clear instructions on where to find the files.
   *
   * OpenRA 对照: ModContentLogic error messages + UI tooltip text
   *
   * @param source — The content source definition.
   * @returns HTML string with installation instructions for the source type.
   *   Safe to set as `innerHTML` on a DOM element.
   */
  static showSourceInstructions(source: ContentSource): string {
    const sourceType = (source.type ?? '').toLowerCase()

    switch (sourceType) {
      case 'disc':
        return (
          '<p><strong>Insert the game disc</strong> and locate the following files:</p>' +
          '<p>Copy <code>.mix</code> files from the <code>INSTALL/</code> directory ' +
          'on the disc.</p>' +
          '<p>Use the <strong>Select Files</strong> button above to upload them.</p>' +
          (source.idFiles
            ? `<p><small>Required files: ${Object.keys(source.idFiles).join(', ')}</small></p>`
            : '')
        )

      case 'steam':
        return (
          '<p><strong>Locate your Steam game directory</strong>:</p>' +
          '<p>Typically found at:</p>' +
          '<ul>' +
          '<li>Windows: <code>C:\\Program Files (x86)\\Steam\\steamapps\\common\\</code></li>' +
          '<li>macOS: <code>~/Library/Application Support/Steam/steamapps/common/</code></li>' +
          '<li>Linux: <code>~/.steam/steam/steamapps/common/</code></li>' +
          '</ul>' +
          '<p>Enter the game folder and select the <code>.mix</code> files using the ' +
          '<strong>Select Files</strong> button above.</p>' +
          (source.idFiles
            ? `<p><small>Look for: ${Object.keys(source.idFiles).join(', ')}</small></p>`
            : '')
        )

      case 'origin':
        return (
          '<p><strong>Locate your Origin game directory</strong>:</p>' +
          '<p>Typically found at:</p>' +
          '<ul>' +
          '<li>Windows: <code>C:\\Program Files (x86)\\Origin Games\\</code></li>' +
          '</ul>' +
          '<p>Enter the game folder and select the <code>.mix</code> files using the ' +
          '<strong>Select Files</strong> button above.</p>' +
          (source.idFiles
            ? `<p><small>Look for: ${Object.keys(source.idFiles).join(', ')}</small></p>`
            : '')
        )

      default:
        return (
          '<p><strong>Locate your game installation</strong>.</p>' +
          '<p>Select the <code>.mix</code> files from your game directory using the ' +
          '<strong>Select Files</strong> button above.</p>' +
          (source.idFiles
            ? `<p><small>Required files: ${Object.keys(source.idFiles).join(', ')}</small></p>`
            : '')
        )
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a File object as an ArrayBuffer using FileReader.
   *
   * @param file — The browser File object.
   * @returns The file contents as an ArrayBuffer.
   */
  private static _readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer)
      }
      reader.onerror = () => {
        reject(new Error(`Failed to read file: ${file.name}`))
      }
      reader.readAsArrayBuffer(file)
    })
  }
}
