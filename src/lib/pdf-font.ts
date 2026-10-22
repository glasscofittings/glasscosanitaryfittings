import type jsPDF from 'jspdf'

/**
 * Source Sans 3 (SIL OFL) for generated documents.
 *
 * The static TTF faces ship with the app under /public/fonts/Source_Sans_3 and are
 * served same-origin, so both the HTML print templates (via @font-face) and the
 * jsPDF exports (faces embedded into the document VFS) render fully offline.
 */

/** Family name registered on jsPDF documents. */
export const SANS_FONT = 'SourceSans3'

/** CSS stack for the printable HTML templates. */
export const SANS_FONT_FAMILY_CSS = "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', Arial, sans-serif"

/** jsPDF style key, the static face that backs it, and its CSS @font-face mapping. */
const SANS_FACES = [
  { style: 'light', file: 'SourceSans3-Light.ttf', weight: 300, cssStyle: 'normal' },
  { style: 'normal', file: 'SourceSans3-Regular.ttf', weight: 400, cssStyle: 'normal' },
  { style: 'italic', file: 'SourceSans3-Italic.ttf', weight: 400, cssStyle: 'italic' },
  { style: 'semibold', file: 'SourceSans3-SemiBold.ttf', weight: 600, cssStyle: 'normal' },
  { style: 'bold', file: 'SourceSans3-Bold.ttf', weight: 700, cssStyle: 'normal' },
] as const

export type SansStyle = (typeof SANS_FACES)[number]['style']

/** @font-face block (weights 300/400/600/700 + italic) for the print HTML templates. */
export const SANS_FONT_FACES_CSS = SANS_FACES.map(
  ({ file, weight, cssStyle }) =>
    `@font-face{font-family:'Source Sans 3';src:url('/fonts/Source_Sans_3/static/${file}') format('truetype');font-style:${cssStyle};font-weight:${weight};font-display:swap;}`
).join('\n      ')

const base64ByFile = new Map<string, string | null>()
const loadingByFile = new Map<string, Promise<string | null>>()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Fetches one static face and caches it as base64. Resolves null when unavailable. */
function loadFaceBase64(file: string): Promise<string | null> {
  const cached = base64ByFile.get(file)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = loadingByFile.get(file)
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(`/fonts/Source_Sans_3/static/${file}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = bytesToBase64(new Uint8Array(await res.arrayBuffer()))
        base64ByFile.set(file, data)
        return data
      } catch (err) {
        console.error('[pdf-font] Could not load Source Sans 3:', err instanceof Error ? err.message : err)
        base64ByFile.set(file, null)
        loadingByFile.delete(file)
        return null
      }
    })()
    loadingByFile.set(file, pending)
  }
  return pending
}

/**
 * Embeds the Source Sans 3 faces into the document so every subsequent
 * `setFont(SANS_FONT, style)` renders with them. Resolves false when the font
 * files are unavailable, in which case callers keep the legacy builtin faces.
 */
export async function ensureSourceSansFont(doc: jsPDF): Promise<boolean> {
  if (hasSourceSansFont(doc)) return true
  const loaded = await Promise.all(
    SANS_FACES.map(async (face) => ({ face, data: await loadFaceBase64(face.file) }))
  )
  if (loaded.every((entry) => entry.data === null)) return false
  for (const { face, data } of loaded) {
    if (data === null) continue
    doc.addFileToVFS(face.file, data)
    doc.addFont(face.file, SANS_FONT, face.style)
  }
  return true
}

/** Checks whether the Source Sans 3 faces are registered on the document. */
export function hasSourceSansFont(doc: jsPDF): boolean {
  const fontList = doc.getFontList() as Record<string, string[]> | undefined
  return Boolean(fontList && fontList[SANS_FONT])
}
