export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  /** Landline / telephone shown next to the mobile number on printed documents. */
  telephone: string;
  email: string;
  website: string;
  /** Optional social handles shown on printed documents; never defaulted. */
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  ntn: string;
  logo: string;
}

const STORAGE_KEY = "glassco_company_profile";

export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Glassco Sanitary",
  address: "Main G.T. Road, Gujranwala",
  phone: "+92 55 123 4567",
  telephone: "+92 55 325 4567",
  email: "info@glassco.pk",
  website: "www.glassco.pk",
  facebook: "",
  instagram: "",
  whatsapp: "",
  ntn: "1234567-8",
  logo: "",
};

export function loadCompanyProfile(): CompanyProfile {
  if (typeof window === "undefined") return { ...DEFAULT_COMPANY };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMPANY };
    const parsed = JSON.parse(raw) as Partial<CompanyProfile>;
    return { ...DEFAULT_COMPANY, ...parsed, logo: parsed.logo ?? "" };
  } catch {
    return { ...DEFAULT_COMPANY };
  }
}

export function saveCompanyProfile(profile: CompanyProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // quota exceeded — logo may be too large; ignore so UI does not crash
  }
}

/** Company name for printed/exported docs; falls back to the stock brand. */
export function getExportCompanyName(fallback = "GLASSCO SANITARY"): string {
  const name = loadCompanyProfile().name.trim();
  return name || fallback;
}

/**
 * Centered document title for prints: the corporate brand banner.
 * The word "ERP" is never shown — the default / stock brand renders as
 * "GLASSCO SANITARY FITTINGS".
 */
export function getExportDocumentTitle(): string {
  const name = getExportCompanyName()
    .toUpperCase()
    .replace(/\s*ERP\b/g, "")
    .trim();
  if (!name || name === "GLASSCO SANITARY") return "GLASSCO SANITARY FITTINGS";
  return name;
}

interface LogoHtmlOptions {
  width?: number;
  height?: number;
  style?: string;
}

/** Inline <img> tag for HTML print exports, or "" when no logo is set. */
export function getCompanyLogoHtml(options: LogoHtmlOptions = {}): string {
  const { logo } = loadCompanyProfile();
  if (!logo) return "";
  const width = options.width ?? 44;
  const height = options.height ?? 44;
  const base = `width:${width}px;height:${height}px;object-fit:contain;vertical-align:middle;`;
  const style = options.style ? `${base}${options.style}` : base;
  return `<img src="${logo}" alt="" style="${style}" />`;
}

/** jsPDF-ready logo image (PNG/JPEG data URLs only). SVG is not supported by addImage. */
export function getCompanyLogoDataUrl(): string | null {
  const { logo } = loadCompanyProfile();
  if (!logo) return null;
  if (logo.startsWith("data:image/png") || logo.startsWith("data:image/jpeg") || logo.startsWith("data:image/jpg")) {
    return logo;
  }
  return null;
}
