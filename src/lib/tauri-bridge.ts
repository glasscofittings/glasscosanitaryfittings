interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface TauriWindow {
  __TAURI__?: { invoke?: TauriInvoke };
}

function getTauri(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as TauriWindow;
  if (w.__TAURI__?.invoke) return w.__TAURI__.invoke;
  return null;
}

export async function getHardwareNodeId(): Promise<string> {
  const invoke = getTauri();
  if (!invoke) return "WEB-NODE";
  try {
    const result = await invoke("get_hardware_node_id");
    return (result.node_id as string) ?? "WEB-NODE";
  } catch {
    return "WEB-NODE";
  }
}

export async function printPdfDocument(
  printerName: string,
  pdfBase64: string
): Promise<{ success: boolean; message: string }> {
  const invoke = getTauri();
  if (!invoke) {
    try {
      const bin = atob(pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);
      iframe.src = url;
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow?.print();
          setTimeout(() => {
            document.body.removeChild(iframe);
            URL.revokeObjectURL(url);
          }, 1000);
        }, 500);
      };
      return { success: true, message: "PDF opened for printing" };
    } catch {
      return { success: false, message: "Failed to open PDF for printing" };
    }
  }
  try {
    const result = await invoke("plugin:printer|print_pdf", {
      printer_name: printerName,
      document_data_base64: pdfBase64,
    });
    return {
      success: result.success as boolean,
      message: result.message as string,
    };
  } catch {
    return { success: false, message: "Print failed. Check printer connection and retry." };
  }
}
