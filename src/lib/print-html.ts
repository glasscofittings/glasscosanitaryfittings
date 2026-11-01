export type PrintResult = { success: boolean; message: string };

/** Meta tags for the <head> of every printable HTML template. */
export const PRINT_HEAD_META =
  '<meta name="viewport" content="width=794"><meta name="format-detection" content="telephone=no,email=no,address=no,date=no">';

/** Base CSS for every printable HTML template (put right after the box-sizing rule). */
export const PRINT_BASE_CSS =
  "html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}" +
  'a,a:link,a:visited,a[href^="tel:"],a[href^="mailto:"],a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-weight:inherit!important;}';

const FRAME_CSS =
  "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;";

function waitFrameReady(win: Window): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const run = async () => {
      try { await (win.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
      const pending = Array.from(win.document.images).filter((i) => !i.complete);
      await Promise.all(pending.map((i) => new Promise<void>((r) => { i.onload = () => r(); i.onerror = () => r(); })));
      win.requestAnimationFrame(() => win.requestAnimationFrame(finish));
    };
    if (win.document.readyState === "complete") void run();
    else win.addEventListener("load", () => void run(), { once: true });
    setTimeout(finish, 8000); // hard cap so print never hangs
  });
}

/** Browser print through an off-screen, full-size iframe. Safe on desktop and Android Chrome. */
export function printHtmlInBrowser(html: string): Promise<PrintResult> {
  return new Promise((resolve) => {
    let iframe: HTMLIFrameElement | null = null;
    let cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; try { iframe?.remove(); } catch { /* ignore */ } };
    try {
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = FRAME_CSS;
      document.body.appendChild(iframe);
      const win = iframe.contentWindow;
      const doc = win?.document;
      if (!win || !doc) { cleanup(); resolve({ success: false, message: "Could not open print frame" }); return; }
      doc.open(); doc.write(html); doc.close();
      void waitFrameReady(win).then(() => {
        win.addEventListener("afterprint", () => setTimeout(cleanup, 500), { once: true });
        win.focus();
        win.print();
        setTimeout(cleanup, 120000); // safety net only; normal cleanup is afterprint
        resolve({ success: true, message: "Print dialog opened" });
      });
    } catch (err) {
      cleanup();
      resolve({ success: false, message: err instanceof Error ? err.message : "Print failed" });
    }
  });
}
