/**
 * Runtime detection for the Tauri desktop shell.
 *
 * The same static bundle in `out/` is served on the web and packaged into the
 * .exe, so anything that touches the filesystem has to branch at runtime.
 * `__TAURI_INTERNALS__` is injected by the webview before any app code runs.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
