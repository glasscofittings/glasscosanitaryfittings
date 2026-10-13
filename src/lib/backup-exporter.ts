import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

export async function exportBackupData(
  filename: string,
  dataSnapshot: object | string
): Promise<{ success: boolean; filePath?: string; byteSize: number }> {
  const jsonString =
    typeof dataSnapshot === 'string'
      ? dataSnapshot
      : JSON.stringify(dataSnapshot, null, 2)
  const byteSize = new Blob([jsonString]).size

  const isTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  if (isTauri) {
    try {
      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      })

      if (filePath) {
        await writeTextFile(filePath, jsonString)
        return { success: true, filePath, byteSize }
      } else {
        return { success: false, byteSize: 0 }
      }
    } catch (err) {
      console.warn('Tauri export failed, falling back to browser download', err)
      return fallbackWebDownload(filename, jsonString, byteSize)
    }
  } else {
    return fallbackWebDownload(filename, jsonString, byteSize)
  }
}

function fallbackWebDownload(
  filename: string,
  jsonString: string,
  byteSize: number
): { success: boolean; filePath?: string; byteSize: number } {
  try {
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    return { success: true, filePath: filename, byteSize }
  } catch (err) {
    console.error('Web export failed', err)
    return { success: false, byteSize: 0 }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
