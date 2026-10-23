import jsPDF from 'jspdf'
import autoTable, { type CellHookData, type UserOptions } from 'jspdf-autotable'
import type { SanitaryProduct, StockAlertLevel } from '@/types'
import { computeStockAlert } from '@/lib/supabase/catalog'
import type { Party } from '@/lib/supabase/crm'
import type { Worker, AttendanceMap, TimeLogMap } from '@/lib/supabase/labour'
import type { WorkerLoan } from '@/lib/supabase/loans'
import { calculateEarnedSalary, formatMinutes } from '@/lib/salary'
import type { LabourTask, LabourTaskStatus } from '@/lib/store/useLabourTaskStore'
import { type InwardGatePass, effectiveAcceptedQty, normalizeUom } from '@/lib/supabase/procurement'
import type { JournalEntryWithLines, FinancialStatements, PLRow, BalanceSheetRow } from '@/lib/supabase/ledger'
import { numberToWords, type PaymentVoucher } from '@/lib/supabase/payment-vouchers'
import {
  PAYROLL_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type PayrollEntry,
} from '@/lib/supabase/payroll'
import type { Expense } from '@/lib/supabase/expenses'
import type { ProductCostMarginSummary, ProductPurchase } from '@/lib/supabase/purchases'
import type { Quotation } from '@/lib/supabase/quotations'
import { isTauriRuntime } from '@/lib/desktop'
import { UR, ensureUrduFont, drawUrdu, countUrduLines, numberToUrduWords, formatUrduDate, formatUrduAmount } from '@/lib/pdf-urdu'
import { SANS_FONT, ensureSourceSansFont, hasSourceSansFont } from '@/lib/pdf-font'
import {
  accountUrdu,
  buildTranslatedAccountMap,
  collectJournalAccountNames,
  collectStatementNames,
  staticUrdu,
  type UrduNameMap,
} from '@/lib/report-i18n'
import { getCompanyLogoDataUrl, getExportCompanyName, loadCompanyProfile, DEFAULT_COMPANY } from '@/lib/company-settings'
import { COMPANY_HEADER, COMPANY_LEGAL_NAME, SERIF_FONT_FAMILY_PDF } from '@/lib/branding'
import { balanceAmountLabel, balanceSide } from '@/lib/party-statement'

/* ─── Shared palette & layout ────────────────────────────────────────────── */

type RGB = [number, number, number]

const C = {
  crimson: [220, 38, 38] as RGB,
  ink: [23, 23, 23] as RGB,
  slate: [82, 82, 82] as RGB,
  muted: [115, 115, 115] as RGB,
  line: [229, 229, 229] as RGB,
  /* Minimal report palette: #e5e7eb hairlines, #16a34a / #f0fdf4 accents. */
  hairline: [229, 231, 235] as RGB,
  greenTint: [240, 253, 244] as RGB,
  zebra: [250, 250, 250] as RGB,
  white: [255, 255, 255] as RGB,
  green: [22, 163, 74] as RGB,
  greenSoft: [220, 252, 231] as RGB,
  red: [220, 38, 38] as RGB,
  redSoft: [254, 226, 226] as RGB,
  amber: [217, 119, 6] as RGB,
  amberSoft: [254, 243, 199] as RGB,
  blue: [37, 99, 235] as RGB,
  blueSoft: [219, 234, 254] as RGB,
  track: [229, 231, 235] as RGB,
  weekend: [243, 244, 246] as RGB,
}

const MARGIN = 14
const FOOTER_RESERVE = 20

type Orientation = 'portrait' | 'landscape'

/**
 * `classic` keeps the branded crimson/serif look used by the core documents
 * (invoices, vouchers, ledger statements, payslips). `minimal` is the clean
 * high-contrast enterprise style used by every secondary report.
 */
type StyleVariant = 'classic' | 'minimal'

interface ReportHeader {
  title: string
  subtitle?: string
  operatorName?: string
  titleUr?: string
}

/** Per-document details a minimal report needs when it stamps its top bar / footer at the end. */
interface MinimalHeaderMeta {
  title: string
  subtitle?: string
  operatorName: string
  date: string
  time: string
  titleUr?: string
  /** Y where page content may start (below the top bar), identical on every page. */
  contentTop: number
}

const minimalMeta = new WeakMap<jsPDF, MinimalHeaderMeta>()

/**
 * Dynamic company brand for secondary reports: a company name customized in
 * Settings wins, otherwise the stock brand. Mirrors the footerBrand resolution
 * used by the invoice/voucher templates so every document agrees.
 */
function resolveBrandName(): string {
  try {
    const name = loadCompanyProfile().name.trim()
    if (name && name !== DEFAULT_COMPANY.name) return name
  } catch {
    /* fall through to the stock brand */
  }
  return COMPANY_HEADER
}

function createReportDoc(orientation: Orientation): jsPDF {
  return new jsPDF({ orientation, unit: 'mm', format: 'a4' })
}

/* ─── Typography ─────────────────────────────────────────────────────────── */

/** Weight keys shared with the embedded Source Sans 3 faces (see lib/pdf-font). */
type LatinStyle = 'light' | 'normal' | 'italic' | 'semibold' | 'bold'

/** Legacy builtin faces used by documents that do not embed Source Sans 3. */
const LEGACY_LATIN: Record<LatinStyle, [string, string]> = {
  light: ['helvetica', 'normal'],
  normal: ['helvetica', 'normal'],
  italic: ['helvetica', 'italic'],
  semibold: ['helvetica', 'bold'],
  bold: ['helvetica', 'bold'],
}

/**
 * Body / label text: Source Sans 3 once `ensureSourceSansFont` embedded the
 * faces on this document, the historic helvetica fallback otherwise.
 */
function setLatinFont(doc: jsPDF, style: LatinStyle = 'normal'): void {
  if (hasSourceSansFont(doc)) doc.setFont(SANS_FONT, style)
  else doc.setFont(...LEGACY_LATIN[style])
}

/** Company title face: Source Sans 3 Bold when embedded, the legacy serif otherwise. */
function setBrandFont(doc: jsPDF): void {
  if (hasSourceSansFont(doc)) doc.setFont(SANS_FONT, 'bold')
  else doc.setFont(SERIF_FONT_FAMILY_PDF, 'bold')
}

/** Numeric columns: Source Sans 3 when embedded, the legacy monospace face otherwise. */
function setNumericFont(doc: jsPDF, bold = false): void {
  if (hasSourceSansFont(doc)) doc.setFont(SANS_FONT, bold ? 'semibold' : 'normal')
  else doc.setFont('courier', bold ? 'bold' : 'normal')
}

/** autoTable face: the embedded family, or undefined to keep autotable's default. */
function tableFont(doc: jsPDF): string | undefined {
  return hasSourceSansFont(doc) ? SANS_FONT : undefined
}

/**
 * SemiBold for table headers / summary rows once Source Sans 3 is embedded.
 *
 * The union is cast down to autotable's narrower `FontStyle` input type: at
 * runtime autotable accepts any style registered on the active family (it only
 * falls back when the family lacks that style), so `'semibold'` is valid.
 */
function strongStyle(doc: jsPDF): 'bold' {
  return (hasSourceSansFont(doc) ? 'semibold' : 'bold') as 'bold'
}

/** Draws the company logo (PNG/JPEG data URL from Settings). Returns width drawn (0 if none). */
function drawCompanyLogo(doc: jsPDF, x: number, y: number, maxWidth: number, maxHeight: number): number {
  const dataUrl = getCompanyLogoDataUrl()
  if (!dataUrl) return 0
  try {
    const format = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'
    const props = doc.getImageProperties(dataUrl)
    if (!props.width || !props.height) return 0
    const scale = Math.min(maxWidth / props.width, maxHeight / props.height)
    const w = props.width * scale
    const h = props.height * scale
    doc.addImage(dataUrl, format, x, y, w, h)
    return w
  } catch {
    return 0
  }
}

/** Draws the branded first-page header. Returns the Y where content can start. */
function drawReportHeader(doc: jsPDF, { title, subtitle, operatorName = 'SYSTEM_OPERATOR', titleUr }: ReportHeader & { titleUr?: string }, variant: StyleVariant = 'classic'): number {
  if (variant === 'minimal') {
    // The minimal top bar carries "Page X of Y", so it can only be stamped once
    // every page exists — drawReportFooter draws it on each page at the end.
    // All this does is reserve the space and remember what to draw.
    const hasUrdu = doc.getFontList()['Amiri'] !== undefined
    const contentTop = hasUrdu && titleUr ? 32 : 27
    minimalMeta.set(doc, {
      title,
      subtitle,
      operatorName,
      date: new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      titleUr,
      contentTop,
    })
    return contentTop
  }

  const pageWidth = doc.internal.pageSize.getWidth()
  const timestamp = new Date().toLocaleString()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  doc.setFillColor(...C.crimson)
  doc.rect(0, 0, pageWidth, 5, 'F')

  const logoWidth = drawCompanyLogo(doc, MARGIN, 8, 16, 16)
  const brandX = MARGIN + (logoWidth > 0 ? logoWidth + 4 : 0)

  setBrandFont(doc)
  doc.setFontSize(18)
  doc.setTextColor(...C.ink)
  doc.text(`${COMPANY_HEADER.toUpperCase()}`, brandX, 16)

  doc.setFontSize(9)
  setLatinFont(doc, 'normal')
  doc.setTextColor(...C.muted)
  doc.text('Sanitary Products Distribution & Retail Management System', brandX, 21)

  setLatinFont(doc, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(38, 38, 38)
  doc.text(title.toUpperCase(), MARGIN, 30)
  if (hasUrdu && titleUr) {
    drawUrdu(doc, titleUr, MARGIN, 34.5, { fontSize: 10, color: C.slate })
  }

  if (subtitle) {
    doc.setFontSize(9)
    setLatinFont(doc, 'normal')
    doc.setTextColor(...C.muted)
    doc.text(subtitle, MARGIN, hasUrdu && titleUr ? 39 : 35)
  }

  doc.setFontSize(8)
  setLatinFont(doc, 'normal')
  doc.setTextColor(...C.slate)
  doc.text(`Generated: ${timestamp}`, pageWidth - MARGIN, 16, { align: 'right' })
  doc.text(`Operator: ${operatorName}`, pageWidth - MARGIN, 21, { align: 'right' })
  doc.text(`Node ID: PC-PRIMARY-01`, pageWidth - MARGIN, 26, { align: 'right' })
  if (hasUrdu) {
    drawUrdu(doc, UR.generated, pageWidth - MARGIN, 19, { align: 'right', fontSize: 7, color: C.muted })
    drawUrdu(doc, UR.operator, pageWidth - MARGIN, 24, { align: 'right', fontSize: 7, color: C.muted })
    drawUrdu(doc, UR.nodeId, pageWidth - MARGIN, 29, { align: 'right', fontSize: 7, color: C.muted })
  }

  const ruleY = hasUrdu && titleUr ? 43 : 39
  doc.setDrawColor(...C.line)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, ruleY, pageWidth - MARGIN, ruleY)

  return ruleY + 4
}

/** Minimal top bar: company title left, document title right, subtitle line, page numbering. */
function drawMinimalTopBar(doc: jsPDF, page: number, totalPages: number, meta: MinimalHeaderMeta): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  setLatinFont(doc, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C.ink)
  doc.text(resolveBrandName().toUpperCase(), MARGIN, 11)

  doc.setFontSize(11)
  doc.text(meta.title.toUpperCase(), pageWidth - MARGIN, 11, { align: 'right' })

  doc.setDrawColor(...C.hairline)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, 14.5, pageWidth - MARGIN, 14.5)

  setLatinFont(doc, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.slate)
  doc.text(
    `Date: ${meta.date}  |  Time: ${meta.time}  |  Generated By: ${meta.operatorName}  |  Node ID: PC-PRIMARY-01`,
    MARGIN,
    19
  )
  doc.text(`Page ${page} of ${totalPages}`, pageWidth - MARGIN, 19, { align: 'right' })

  if (meta.subtitle) {
    doc.setTextColor(...C.muted)
    doc.text(meta.subtitle, MARGIN, 23)
  }

  if (page === 1 && hasUrdu && meta.titleUr) {
    drawUrdu(doc, meta.titleUr, MARGIN, 25.5, { fontSize: 9, color: C.slate })
  }
}

/** Footer on every page, plus a slim running header on pages after the first. */
function drawReportFooter(doc: jsPDF, runningTitle?: string, variant: StyleVariant = 'classic'): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const totalPages = doc.getNumberOfPages()
  const meta = minimalMeta.get(doc)

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)

    if (variant === 'minimal') {
      if (meta) drawMinimalTopBar(doc, i, totalPages, { ...meta, title: runningTitle || meta.title })

      doc.setDrawColor(...C.hairline)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, pageHeight - 14, pageWidth - MARGIN, pageHeight - 14)

      doc.setFontSize(8)
      setLatinFont(doc, 'normal')
      doc.setTextColor(...C.slate)
      doc.text(`CONFIDENTIAL - ${resolveBrandName()} Verified Record`, MARGIN, pageHeight - 9)
      doc.text(`| Page ${i} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 9, { align: 'right' })
      continue
    }

    if (i > 1 && runningTitle) {
      doc.setFillColor(...C.crimson)
      doc.rect(0, 0, pageWidth, 2, 'F')
      doc.setFontSize(8)
      setLatinFont(doc, 'bold')
      doc.setTextColor(...C.muted)
      doc.text(runningTitle.toUpperCase(), MARGIN, 8)
      setLatinFont(doc, 'normal')
      doc.text(`${getExportCompanyName('GLASSCO SANITARY').toUpperCase()}`, pageWidth - MARGIN, 8, { align: 'right' })
    }

    doc.setDrawColor(...C.line)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, pageHeight - 14, pageWidth - MARGIN, pageHeight - 14)

    doc.setFontSize(8)
    setLatinFont(doc, 'normal')
    doc.setTextColor(...C.muted)
    doc.text('CONFIDENTIAL - Glassco Sanitary System Verified Record', MARGIN, pageHeight - 9)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 9, { align: 'right' })
    if (doc.getFontList()['Amiri']) {
      drawUrdu(doc, `${UR.pageOf} ${i} ${UR.ofWord} ${totalPages}`, pageWidth - MARGIN, pageHeight - 5.5, {
        align: 'right',
        fontSize: 7,
        color: C.muted,
      })
    }
  }
}

function baseTableOptions(doc: jsPDF, variant: StyleVariant = 'classic'): UserOptions {
  const strong = strongStyle(doc)
  const font = tableFont(doc)
  if (variant === 'minimal') {
    return {
      theme: 'plain',
      showFoot: 'lastPage',
      headStyles: {
        fillColor: C.greenTint,
        textColor: C.ink,
        fontSize: 9,
        fontStyle: strong,
        halign: 'left',
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: C.ink,
      },
      footStyles: {
        fillColor: C.greenTint,
        textColor: C.ink,
        fontStyle: strong,
        fontSize: 8.5,
      },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE, top: 34 },
      styles: {
        font,
        cellPadding: { top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 },
        overflow: 'linebreak',
        lineColor: C.hairline,
        lineWidth: 0,
      },
    }
  }
  return {
    theme: 'striped',
    showFoot: 'lastPage',
    headStyles: {
      fillColor: C.ink,
      textColor: C.white,
      fontSize: 9,
      fontStyle: strong,
      halign: 'left',
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [38, 38, 38],
    },
    alternateRowStyles: {
      fillColor: C.zebra,
    },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE, top: 12 },
    styles: {
      font,
      cellPadding: 3,
      overflow: 'linebreak',
    },
  }
}

/**
 * Minimal tables are borderless: light #e5e7eb rules under every row, a #16a34a
 * rule under the head and over the total row. Drawn in didDrawCell so the rules
 * can be chained with the Urdu/highlight hooks the callers already use.
 */
function minimalRowRules(): Pick<UserOptions, 'didDrawCell'> {
  const rule = (data: CellHookData, y: number, colour: RGB, width: number) => {
    data.doc.setDrawColor(...colour)
    data.doc.setLineWidth(width)
    data.doc.line(data.cell.x, y, data.cell.x + data.cell.width, y)
  }
  return {
    didDrawCell: (data) => {
      if (data.section === 'head') rule(data, data.cell.y + data.cell.height, C.green, 0.4)
      else if (data.section === 'foot') rule(data, data.cell.y, C.green, 0.4)
      else if (data.section === 'body') rule(data, data.cell.y + data.cell.height, C.hairline, 0.2)
    },
  }
}

/** Merges autoTable cell hooks so border rules can be layered onto existing hooks. */
function chainCellHooks(
  ...sets: (Pick<UserOptions, 'didParseCell' | 'didDrawCell'> | undefined)[]
): Pick<UserOptions, 'didParseCell' | 'didDrawCell'> {
  const parses = sets.map((s) => s?.didParseCell).filter((f): f is NonNullable<typeof f> => Boolean(f))
  const draws = sets.map((s) => s?.didDrawCell).filter((f): f is NonNullable<typeof f> => Boolean(f))
  const chained: Pick<UserOptions, 'didParseCell' | 'didDrawCell'> = {}
  if (parses.length) chained.didParseCell = (data) => parses.forEach((f) => f(data))
  if (draws.length) chained.didDrawCell = (data) => draws.forEach((f) => f(data))
  return chained
}

function getFinalY(doc: jsPDF): number {
  const withTable = doc as jsPDF & { lastAutoTable?: { finalY?: number } }
  return withTable.lastAutoTable?.finalY ?? 43
}

/** Ensures `needed` mm of vertical room; starts a new page when there isn't. */
function ensureRoom(doc: jsPDF, y: number, needed: number, variant: StyleVariant = 'classic'): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed > pageHeight - FOOTER_RESERVE) {
    doc.addPage()
    // Minimal reports start below the top bar that drawReportFooter stamps on every page.
    return variant === 'minimal' ? minimalMeta.get(doc)?.contentTop ?? 27 : 14
  }
  return y
}

/** Section heading with a crimson tick. Returns the Y where the section body starts. */
function drawSectionTitle(
  doc: jsPDF,
  y: number,
  title: string,
  caption?: string,
  ur?: { title?: string; caption?: string },
  variant: StyleVariant = 'classic'
): number {
  // Title + caption + table head + first row: break early rather than orphan a header.
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined
  const urTitle = hasUrdu ? ur?.title : undefined
  const urCaption = hasUrdu ? ur?.caption : undefined
  y = ensureRoom(doc, y, 48, variant)

  if (variant === 'minimal') {
    const pageWidth = doc.internal.pageSize.getWidth()
    doc.setFillColor(...C.green)
    doc.rect(MARGIN, y - 3.2, 1.2, 4.5, 'F')
    setLatinFont(doc, 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C.ink)
    doc.text(title.toUpperCase(), MARGIN + 3.5, y)
    let nextY = y + 4
    if (urTitle) {
      nextY = drawUrdu(doc, urTitle, MARGIN + 3.5, y + 5.5, { fontSize: 9, color: C.slate })
      nextY += 1
    }
    if (caption) {
      setLatinFont(doc, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.muted)
      doc.text(caption, MARGIN + 3.5, nextY + 4.5)
      nextY += 4.5
      if (urCaption) {
        nextY = drawUrdu(doc, urCaption, MARGIN + 3.5, nextY + 4.5, { fontSize: 8, color: C.muted })
        nextY += 1
      } else {
        nextY += 5.5
      }
    }
    const ruleY = nextY + 1
    doc.setDrawColor(...C.hairline)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, ruleY, pageWidth - MARGIN, ruleY)
    return ruleY + 5
  }

  doc.setFillColor(...C.crimson)
  doc.rect(MARGIN, y - 3.2, 1.2, 4.5, 'F')
  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C.ink)
  doc.text(title.toUpperCase(), MARGIN + 3.5, y)
  let nextY = y + 4
  if (urTitle) {
    nextY = drawUrdu(doc, urTitle, MARGIN + 3.5, y + 5.5, { fontSize: 9, color: C.slate })
    nextY += 1
  }
  if (caption) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.muted)
    doc.text(caption, MARGIN + 3.5, nextY + 4.5)
    nextY += 4.5
    if (urCaption) {
      nextY = drawUrdu(doc, urCaption, MARGIN + 3.5, nextY + 4.5, { fontSize: 8, color: C.muted })
      nextY += 1
    } else {
      nextY += 5.5
    }
    return nextY
  }
  return nextY
}

/**
 * Every export opens the print dialog instead of a save dialog. The PDF is loaded into a hidden
 * iframe and printed from there; "Save as PDF" in the dialog still works, and the document title
 * doubles as the suggested file name. `autoPrint` is kept on the option types for compatibility but
 * no longer changes behaviour.
 *
 * Printing itself works in the desktop shell - see InvoicePreviewDrawer - but that frame is written
 * into with `document.write`, while this one is navigated to a `blob:` URL, which the app CSP has to
 * allow explicitly (`frame-src blob:`) and which needs the webview's own PDF viewer to render. When
 * the frame does not come up, the desktop shell writes the file through the native save dialog
 * instead, so an export always produces something.
 */
const PRINT_FRAME_TIMEOUT_MS = 2500

function outputReport(doc: jsPDF, filename: string): void {
  const title = filename.replace(/\.pdf$/i, '')
  doc.setProperties({ title })
  doc.autoPrint()

  if (typeof document === 'undefined') {
    // Not in a browser (e.g. scripted rendering) - fall back to writing the file.
    doc.save(filename)
    return
  }

  const onDesktop = isTauriRuntime()
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.title = title
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = 'none'

  let settled = false
  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    URL.revokeObjectURL(url)
  }

  const giveUpOnPrinting = (reason: string) => {
    cleanup()
    if (onDesktop) {
      console.warn(`[pdf-exporter] ${reason} - falling back to the native save dialog.`)
      void saveReportOnDesktop(doc, filename)
    } else {
      console.error(`[pdf-exporter] ${reason} - opening the PDF instead.`)
      window.open(url, '_blank')
    }
  }

  iframe.onload = () => {
    settled = true
    // Give the embedded viewer a moment to lay the pages out before printing.
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch (err) {
        giveUpOnPrinting(`Print dialog failed (${err instanceof Error ? err.message : String(err)})`)
      }
    }, 400)
  }

  // A frame the webview refuses to load never fires `onload`, so nothing else would report it.
  setTimeout(() => {
    if (settled) return
    settled = true
    giveUpOnPrinting('Print frame never loaded')
  }, PRINT_FRAME_TIMEOUT_MS)

  document.body.appendChild(iframe)
  iframe.src = url
  // Keep the frame alive long enough for the dialog and any "Save as PDF" to finish. Harmless if
  // the fallback already tore it down.
  setTimeout(cleanup, 5 * 60 * 1000)
}

/** Native save dialog + direct file write, used when the print frame cannot come up. */
async function saveReportOnDesktop(doc: jsPDF, filename: string): Promise<void> {
  const { save, message } = await import('@tauri-apps/plugin-dialog')

  try {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })
    if (!path) return // dialog dismissed

    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(path, new Uint8Array(doc.output('arraybuffer')))
  } catch (err) {
    console.error('[pdf-exporter] Desktop export failed:', err)
    await message(err instanceof Error ? err.message : String(err), {
      title: 'Export failed',
      kind: 'error',
    }).catch(() => {})
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatPKRCell(value: number): string {
  return `PKR ${Math.round(value).toLocaleString()}`
}

/* ─── Generic single-table report ────────────────────────────────────────── */

export interface PDFExportOptions {
  title: string
  titleUr?: string
  subtitle?: string
  operatorName?: string
  headers: string[]
  headersUr?: string[]
  rows: (string | number)[][]
  /** Column index → English cell text → Urdu line under it (status chips, etc.). */
  cellUr?: Record<number, Record<string, string>>
  filename?: string
  autoPrint?: boolean
  orientation?: Orientation
  /** Column index → cell text → text colour. Matching cells are drawn bold in that colour. */
  highlightCells?: Record<number, Record<string, RGB>>
}

/**
 * Hooks that draw an Urdu line under English text in autoTable head/body cells.
 * Chain with any existing didParseCell / didDrawCell.
 */
function urduCellHooks(
  doc: jsPDF,
  opts: {
    headUr?: (string | undefined)[]
    footUr?: (string | undefined)[]
    cellUr?: Record<number, Record<string, string>>
    urduSize?: number
    /** Colour of Urdu lines inside head cells. Defaults to white (dark head fills). */
    headColour?: RGB
    onDidParse?: (data: CellHookData) => void
    onDidDraw?: (data: CellHookData) => void
  }
): Pick<UserOptions, 'didParseCell' | 'didDrawCell'> {
  const urduSize = opts.urduSize ?? 7.5
  const urFor = (data: CellHookData): string | undefined => {
    if (data.section === 'head') return opts.headUr?.[data.column.index]
    if (data.section === 'foot') return opts.footUr?.[data.column.index]
    if (data.section === 'body' && opts.cellUr) {
      return opts.cellUr[data.column.index]?.[String(data.cell.raw)]
    }
    return undefined
  }
  const linesFor = (data: CellHookData, ur?: string): number =>
    ur ? countUrduLines(doc, ur, Math.max(12, data.cell.width - 4), urduSize) : 0

  return {
    didParseCell: (data) => {
      opts.onDidParse?.(data)
      const ur = urFor(data)
      const lines = linesFor(data, ur)
      if (lines > 0) {
        data.cell.styles.cellPadding = {
          top: data.cell.styles.cellPadding && typeof data.cell.styles.cellPadding === 'number'
            ? data.cell.styles.cellPadding
            : 3,
          right: 3,
          left: 3,
          bottom: 3 + lines * URDU_LINE,
        }
      }
    },
    didDrawCell: (data) => {
      opts.onDidDraw?.(data)
      const ur = urFor(data)
      if (!ur) return
      const lines = linesFor(data, ur)
      if (lines < 1) return
      const pad = 3
      const halign = data.cell.styles.halign
      const x =
        halign === 'right'
          ? data.cell.x + data.cell.width - pad
          : halign === 'center'
            ? data.cell.x + data.cell.width / 2
            : data.cell.x + pad
      const lastBaseline = data.cell.y + data.cell.height - pad - 0.4
      const firstBaseline = lastBaseline - (lines - 1) * URDU_LINE
      const colour: RGB = data.section === 'head' ? opts.headColour ?? C.white : C.muted
      drawUrdu(doc, ur, x, firstBaseline, {
        align: halign === 'right' ? 'right' : halign === 'center' ? 'center' : 'left',
        fontSize: urduSize,
        color: colour,
        maxWidth: data.cell.width - pad * 2,
        lineHeight: URDU_LINE,
      })
    },
  }
}

export async function generateERPReportPDF({
  title,
  titleUr,
  subtitle,
  operatorName,
  headers,
  headersUr,
  rows,
  cellUr,
  filename = 'glassco_erp_report.pdf',
  orientation = 'portrait',
  highlightCells,
}: PDFExportOptions): Promise<jsPDF> {
  const doc = createReportDoc(orientation)
  await ensureUrduFont(doc)
  const startY = drawReportHeader(doc, { title, titleUr, subtitle, operatorName }, 'minimal')

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY,
    head: [headers],
    body: rows,
    ...chainCellHooks(
      urduCellHooks(doc, {
        headUr: headersUr,
        headColour: C.ink,
        cellUr,
        onDidParse: (data) => {
          if (data.section !== 'body' || !highlightCells) return
          const palette = highlightCells[data.column.index]
          if (!palette) return
          const colour = palette[String(data.cell.raw)]
          if (colour) {
            data.cell.styles.textColor = colour
            data.cell.styles.fontStyle = 'bold'
          }
        },
      }),
      minimalRowRules()
    ),
  })

  drawReportFooter(doc, title, 'minimal')
  outputReport(doc, filename)
  return doc
}

/* ─── Product Catalog Export ─────────────────────────────────────────────── */

const STOCK_STATUS_LABEL: Record<StockAlertLevel, string> = {
  CRITICAL_LOW: 'CRITICAL LOW',
  REORDER_SOON: 'REORDER SOON',
  IN_STOCK: 'In Stock',
}

const STOCK_STATUS_COLOUR: Record<string, RGB> = {
  [STOCK_STATUS_LABEL.CRITICAL_LOW]: C.red,
  [STOCK_STATUS_LABEL.REORDER_SOON]: C.amber,
  [STOCK_STATUS_LABEL.IN_STOCK]: C.green,
}

const STOCK_STATUS_UR: Record<StockAlertLevel, string> = {
  CRITICAL_LOW: UR.criticalLow,
  REORDER_SOON: UR.reorderSoon,
  IN_STOCK: UR.inStock,
}

export async function exportProductsToPDF(
  products: SanitaryProduct[],
  options: { subtitle?: string; operatorName?: string; autoPrint?: boolean } = {}
): Promise<jsPDF> {
  const inStock = products.filter((p) => p.available_stock > p.reorder_level).length
  const lowStock = products.filter((p) => p.available_stock > 0 && p.available_stock <= p.reorder_level).length
  const outOfStock = products.filter((p) => p.available_stock === 0).length

  const summary = `${products.length} products | In Stock: ${inStock} | Low Stock: ${lowStock} | Out of Stock: ${outOfStock}`
  const subtitle = options.subtitle ? `${options.subtitle} | ${summary}` : summary

  const headers = ['SKU', 'Product Name', 'Category', 'Subcategory', 'Finish', 'Unit Price', 'Available', 'Total', 'Reorder', 'Status']
  const statusColumn = headers.indexOf('Status')

  const rows = products.map((p) => [
    p.sku,
    p.name,
    p.category,
    p.subcategory ?? '-',
    p.finish ?? '-',
    formatPKRCell(p.unit_price),
    p.available_stock,
    p.total_stock,
    p.reorder_level,
    STOCK_STATUS_LABEL[computeStockAlert(p).alert_level],
  ])

  const cellUr: Record<number, Record<string, string>> = {
    [statusColumn]: Object.fromEntries(
      (Object.keys(STOCK_STATUS_LABEL) as StockAlertLevel[]).map((k) => [STOCK_STATUS_LABEL[k], STOCK_STATUS_UR[k]])
    ),
  }

  const dateStamp = new Date().toISOString().slice(0, 10)

  return generateERPReportPDF({
    title: 'Sanitary Product Catalog',
    titleUr: UR.productCatalog,
    subtitle,
    operatorName: options.operatorName,
    headers,
    headersUr: [UR.sku, UR.productName, UR.category, UR.subcategory, UR.finish, UR.unitPrice, UR.available, UR.stockTotal, UR.reorder, UR.status],
    rows,
    cellUr,
    filename: `glassco_product_catalog_${dateStamp}.pdf`,
    autoPrint: options.autoPrint ?? false,
    orientation: 'landscape',
    highlightCells: { [statusColumn]: STOCK_STATUS_COLOUR },
  })
}

/** One product's stock card, printed on its own for filing at the shelf. */
export async function exportProductToPDF(
  product: SanitaryProduct,
  options: { operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  const hasUrdu = await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - MARGIN * 2

  const alert = computeStockAlert(product)
  const statusLabel = STOCK_STATUS_LABEL[alert.alert_level]
  const statusColour = STOCK_STATUS_COLOUR[statusLabel]
  const statusChip = {
    text: `${product.available_stock} in stock`,
    fill: alert.alert_level === 'IN_STOCK' ? C.greenSoft : alert.alert_level === 'REORDER_SOON' ? C.amberSoft : C.redSoft,
    colour: statusColour,
  }

  const title = `Stock Card ${product.sku}`
  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.productCatalog,
    subtitle: `${product.name}  |  ${product.category}`,
    operatorName: options.operatorName,
  }, 'minimal')

  y = drawKpiTiles(doc, y, [
    { label: 'Available', labelUr: UR.available, value: String(product.available_stock), accent: statusColour },
    { label: 'Total Stock', labelUr: UR.stockTotal, value: String(product.total_stock), accent: C.blue },
    { label: 'Reorder Lvl', labelUr: UR.reorder, value: String(product.reorder_level), accent: C.amber },
    { label: 'Unit Price', labelUr: UR.unitPrice, value: formatPKRCell(product.unit_price), accent: C.crimson },
  ], 'minimal')

  y = drawBanner(doc, y, 'Stock Status', statusLabel, statusColour, statusChip, UR.status, 'minimal')

  y = drawSectionTitle(doc, y, 'Product Details', undefined, { title: UR.productName }, 'minimal')

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY: y,
    head: [['Detail', 'Value']],
    body: [
      ['SKU', product.sku],
      ['Product Name', product.name],
      ['Category', product.category],
      ['Subcategory', product.subcategory ?? '-'],
      ['Finish', product.finish ?? '-'],
      ['Material', product.material ?? '-'],
      ['Unit Price', formatPKRCell(product.unit_price)],
      ['Total Stock', String(product.total_stock)],
      ['Available Stock', String(product.available_stock)],
      ['Reorder Level', String(product.reorder_level)],
      ['Stock Status', statusLabel],
      ['Created', formatDate(product.created_at)],
    ],
    columnStyles: {
      0: { cellWidth: 52, fontStyle: 'bold', textColor: C.ink },
      1: { halign: 'left' },
    },
    ...chainCellHooks(
      hasUrdu
        ? urduCellHooks(doc, {
            cellUr: {
              0: {
                SKU: UR.sku,
                'Product Name': UR.productName,
                Category: UR.category,
                Subcategory: UR.subcategory,
                Finish: UR.finish,
                Material: UR.material,
                'Unit Price': UR.unitPrice,
                'Total Stock': UR.stockTotal,
                'Available Stock': UR.available,
                'Reorder Level': UR.reorder,
                'Stock Status': UR.status,
                Created: UR.date,
              },
            },
          })
        : undefined,
      minimalRowRules()
    ),
  })
  y = getFinalY(doc) + 6

  y = drawSectionTitle(doc, y, 'Reorder Guidance', undefined, { title: UR.reorder }, 'minimal')
  setLatinFont(doc, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C.slate)
  const guidance =
    alert.alert_level === 'CRITICAL_LOW'
      ? `Available stock (${product.available_stock}) is at or below the reorder level (${product.reorder_level}). Raise a purchase request.`
      : alert.alert_level === 'REORDER_SOON'
        ? `Available stock (${product.available_stock}) is within 50% of the reorder level (${product.reorder_level}). Plan a replenishment.`
        : `Stock is healthy. Reorder level is ${product.reorder_level}.`
  const guidanceLines: string[] = doc.splitTextToSize(guidance, contentWidth)
  for (const line of guidanceLines) {
    doc.text(line, MARGIN, y)
    y += 4.5
  }
  y += 4

  /* Signatures */
  const sigGap = 10
  const sigWidth = (contentWidth - sigGap) / 2
  const signatures = [
    { en: 'Prepared By', ur: UR.preparedBy },
    { en: 'Checked By', ur: UR.checkedBy },
  ]
  y = ensureRoom(doc, y + 8, 26, 'minimal')
  signatures.forEach((sig, i) => {
    const x = MARGIN + i * (sigWidth + sigGap)
    doc.setDrawColor(...C.ink)
    doc.setLineWidth(0.4)
    doc.line(x, y, x + sigWidth, y)
    setLatinFont(doc, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C.ink)
    doc.text(sig.en, x + sigWidth / 2, y + 5, { align: 'center' })
    let next = y + 5
    if (hasUrdu) {
      next = drawUrdu(doc, sig.ur, x + sigWidth / 2, y + 10, { align: 'center', fontSize: 9.5, color: C.slate })
    }
    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.text('Signature & Date', x + sigWidth / 2, next + 3.5, { align: 'center' })
  })

  drawReportFooter(doc, title, 'minimal')
  outputReport(doc, `glassco_product_${slugForFile(product.sku)}.pdf`)
  return doc
}

/* ─── CRM Contacts Export ────────────────────────────────────────────────── */

const PARTY_TYPE_LABEL: Record<Party['party_type'], string> = {
  CUSTOMER: 'Buyer',
  SUPPLIER: 'Supplier',
  BOTH: 'Both',
}

const PARTY_TYPE_UR: Record<Party['party_type'], string> = {
  CUSTOMER: UR.buyer,
  SUPPLIER: UR.supplier,
  BOTH: UR.both,
}

export async function exportPartiesToPDF(
  parties: Party[],
  options: { subtitle?: string; operatorName?: string; autoPrint?: boolean } = {}
): Promise<jsPDF> {
  const buyers = parties.filter((p) => p.party_type === 'CUSTOMER' || p.party_type === 'BOTH').length
  const suppliers = parties.filter((p) => p.party_type === 'SUPPLIER' || p.party_type === 'BOTH').length

  const summary = `${parties.length} contacts | Buyers: ${buyers} | Suppliers: ${suppliers}`
  const subtitle = options.subtitle ? `${options.subtitle} | ${summary}` : summary

  const rows = parties.map((p) => [
    p.name,
    PARTY_TYPE_LABEL[p.party_type],
    p.phone || '-',
    p.email || '-',
    p.address || '-',
    p.ntn_strn || '-',
    p.is_registered ? 'Yes' : 'No',
  ])

  const typeUr = Object.fromEntries(
    (Object.keys(PARTY_TYPE_LABEL) as Party['party_type'][]).map((k) => [PARTY_TYPE_LABEL[k], PARTY_TYPE_UR[k]])
  )
  const cellUr: Record<number, Record<string, string>> = {
    1: typeUr,
    6: { Yes: UR.yes, No: UR.no },
  }

  const dateStamp = new Date().toISOString().slice(0, 10)

  return generateERPReportPDF({
    title: 'CRM Contacts',
    titleUr: UR.crmContacts,
    subtitle,
    operatorName: options.operatorName,
    headers: ['Name', 'Type', 'Phone', 'Email', 'Address', 'NTN / STRN', 'Registered'],
    headersUr: [UR.name, UR.type, UR.phone, UR.email, UR.address, UR.ntnStrn, UR.registered],
    rows,
    cellUr,
    filename: `glassco_crm_contacts_${dateStamp}.pdf`,
    autoPrint: options.autoPrint ?? false,
    orientation: 'landscape',
  })
}

/* ─── Labour Report (register + attendance + tasks + loans) ──────────────── */

export interface LabourReportInput {
  workers: Worker[]
  attendance: AttendanceMap
  year: number
  month: number
  tasks: LabourTask[]
  loans: WorkerLoan[]
  operatorName?: string
  autoPrint?: boolean
}

type AttendanceStatus = 'P' | 'A' | 'L'

const ATTENDANCE_STYLE: Record<AttendanceStatus, { fill: RGB; text: RGB; label: string; labelUr: string }> = {
  P: { fill: C.greenSoft, text: C.green, label: 'Present', labelUr: UR.present },
  A: { fill: C.redSoft, text: C.red, label: 'Absent', labelUr: UR.absent },
  L: { fill: C.amberSoft, text: C.amber, label: 'Leave', labelUr: UR.leave },
}

const TASK_STATUS_STYLE: Record<LabourTaskStatus, { fill: RGB; text: RGB; label: string; labelUr: string }> = {
  PENDING: { fill: C.amberSoft, text: C.amber, label: 'PENDING', labelUr: UR.pending },
  IN_PROGRESS: { fill: C.blueSoft, text: C.blue, label: 'IN PROGRESS', labelUr: UR.inProgress },
  COMPLETED: { fill: C.greenSoft, text: C.green, label: 'DONE', labelUr: UR.done },
}

const TASK_STATUS_ORDER: Record<LabourTaskStatus, number> = { IN_PROGRESS: 0, PENDING: 1, COMPLETED: 2 }

interface WorkerAttendanceSummary {
  present: number
  absent: number
  leave: number
  marked: number
  rate: number | null
}

function summarizeAttendance(workerId: string, attendance: AttendanceMap): WorkerAttendanceSummary {
  const days = Object.values(attendance[workerId] ?? {})
  const present = days.filter((s) => s === 'P').length
  const absent = days.filter((s) => s === 'A').length
  const leave = days.filter((s) => s === 'L').length
  const marked = present + absent + leave
  return { present, absent, leave, marked, rate: marked > 0 ? present / marked : null }
}

function drawKpiTiles(doc: jsPDF, y: number, tiles: { label: string; value: string; accent: RGB; labelUr?: string }[], variant: StyleVariant = 'classic'): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const gap = 4
  const tileWidth = (pageWidth - MARGIN * 2 - gap * (tiles.length - 1)) / tiles.length
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined
  const anyUr = hasUrdu && tiles.some((t) => t.labelUr)
  const tileHeight = anyUr ? 22 : 18
  const minimal = variant === 'minimal'

  tiles.forEach((tile, i) => {
    const x = MARGIN + i * (tileWidth + gap)
    doc.setFillColor(...(minimal ? C.white : C.zebra))
    doc.setDrawColor(...(minimal ? C.hairline : C.line))
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, tileWidth, tileHeight, 1.5, 1.5, 'FD')
    doc.setFillColor(...tile.accent)
    doc.rect(x, y, 1.2, tileHeight, 'F')

    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.text(tile.label.toUpperCase(), x + 4, y + 6)

    let valueY = y + 14
    if (anyUr && tile.labelUr) {
      drawUrdu(doc, tile.labelUr, x + 4, y + 10.5, { fontSize: 7.5, color: C.muted, maxWidth: tileWidth - 8 })
      valueY = y + 17.5
    }

    setLatinFont(doc, 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...(minimal ? C.ink : tile.accent))
    doc.text(tile.value, x + 4, valueY)
  })

  return y + tileHeight + 8
}

function drawLegend(doc: jsPDF, y: number, items: { fill: RGB; text: RGB; label: string; labelUr?: string }[]): number {
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined
  let x = MARGIN
  doc.setFontSize(7.5)
  setLatinFont(doc, 'normal')
  items.forEach((item) => {
    doc.setFillColor(...item.fill)
    doc.setDrawColor(...item.text)
    doc.setLineWidth(0.2)
    doc.rect(x, y - 2.6, 3.5, 3.5, 'FD')
    doc.setTextColor(...C.slate)
    doc.text(item.label, x + 5, y)
    x += 5 + doc.getTextWidth(item.label) + 7
    if (hasUrdu && item.labelUr) {
      drawUrdu(doc, item.labelUr, x, y, { fontSize: 7, color: C.muted })
      x += doc.getTextWidth(item.labelUr) + 7
    }
  })
  return y + 6
}

export async function exportLabourReportPDF({
  workers,
  attendance,
  year,
  month,
  tasks,
  loans,
  operatorName,
}: LabourReportInput): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const monthLabel = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(year, month, 0).getDate()
  const workerById = new Map(workers.map((w) => [w.id, w]))

  const summaries = new Map(workers.map((w) => [w.id, summarizeAttendance(w.id, attendance)]))
  const totalPresent = [...summaries.values()].reduce((a, s) => a + s.present, 0)
  const totalAbsent = [...summaries.values()].reduce((a, s) => a + s.absent, 0)
  const totalLeave = [...summaries.values()].reduce((a, s) => a + s.leave, 0)
  const totalMarked = totalPresent + totalAbsent + totalLeave
  const overallRate = totalMarked > 0 ? Math.round((totalPresent / totalMarked) * 100) : null
  const outstandingLoans = loans.reduce((a, l) => a + l.current_balance, 0)
  const activeLoans = loans.filter((l) => l.current_balance > 0).length

  const title = `Labour Report - ${monthLabel}`
  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.labourReport,
    subtitle: `${workers.length} workers | Attendance ${overallRate === null ? 'not marked yet' : `${overallRate}%`} | ${tasks.length} tasks on board | ${activeLoans} active loans`,
    operatorName,
  }, 'minimal')

  /* 1. KPI strip */
  y = drawKpiTiles(doc, y, [
    { label: 'Active Workers', labelUr: UR.activeWorkers, value: String(workers.length), accent: C.crimson },
    { label: 'Days Present', labelUr: UR.daysPresent, value: String(totalPresent), accent: C.green },
    { label: 'Days Absent', labelUr: UR.daysAbsent, value: String(totalAbsent), accent: C.red },
    { label: 'Days on Leave', labelUr: UR.daysOnLeave, value: String(totalLeave), accent: C.amber },
    { label: 'Attendance Rate', labelUr: UR.attendanceRate, value: overallRate === null ? '-' : `${overallRate}%`, accent: C.blue },
    { label: 'Loans Outstanding', labelUr: UR.loansOutstanding, value: formatPKRCell(outstandingLoans), accent: C.slate },
  ], 'minimal')

  /* 2. Worker register */
  y = drawSectionTitle(doc, y, 'Worker Register', `Roster with ${monthLabel} attendance totals`, {
    title: UR.workerRegister,
  }, 'minimal')
  const registerHeaders = ['#', 'Worker', 'Role', 'Joined', 'Base Salary', 'Status', 'P', 'A', 'L', 'Attendance']
  const registerRows = workers.map((w, i) => {
    const s = summaries.get(w.id)!
    return [
      i + 1,
      w.full_name,
      w.role_designation,
      formatDate(w.joining_date),
      formatPKRCell(w.base_salary_pkr),
      w.is_active ? 'Active' : 'Inactive',
      s.present,
      s.absent,
      s.leave,
      s.rate === null ? '-' : `${Math.round(s.rate * 100)}%`,
    ]
  })
  const colP = registerHeaders.indexOf('P')
  const colA = registerHeaders.indexOf('A')
  const colL = registerHeaders.indexOf('L')
  const colRate = registerHeaders.indexOf('Attendance')
  const colStatus = registerHeaders.indexOf('Status')

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY: y,
    head: [registerHeaders],
    body: registerRows,
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      [colP]: { halign: 'center', cellWidth: 14 },
      [colA]: { halign: 'center', cellWidth: 14 },
      [colL]: { halign: 'center', cellWidth: 14 },
      [colRate]: { halign: 'right', cellWidth: 24 },
    },
    ...chainCellHooks(
      urduCellHooks(doc, {
        headUr: ['', UR.worker, UR.role, UR.joined, UR.baseSalary, UR.status, UR.present, UR.absent, UR.leave, UR.attendance],
        headColour: C.ink,
        cellUr: {
          [colStatus]: { Active: UR.active, Inactive: UR.inactive },
        },
        onDidParse: (data) => {
          if (data.section === 'head' && [colP, colA, colL].includes(data.column.index)) data.cell.styles.halign = 'center'
          if (data.section === 'head' && data.column.index === colRate) data.cell.styles.halign = 'right'
          if (data.section !== 'body') return
          const value = data.cell.raw
          if (data.column.index === colP && Number(value) > 0) { data.cell.styles.textColor = C.green; data.cell.styles.fontStyle = 'bold' }
          if (data.column.index === colA && Number(value) > 0) { data.cell.styles.textColor = C.red; data.cell.styles.fontStyle = 'bold' }
          if (data.column.index === colL && Number(value) > 0) { data.cell.styles.textColor = C.amber; data.cell.styles.fontStyle = 'bold' }
          if (data.column.index === colStatus) {
            data.cell.styles.textColor = value === 'Active' ? C.green : C.muted
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === colRate && typeof value === 'string' && value.endsWith('%')) {
            const pct = parseInt(value, 10)
            data.cell.styles.textColor = pct >= 90 ? C.green : pct >= 75 ? C.amber : C.red
            data.cell.styles.fontStyle = 'bold'
          }
        },
      }),
      minimalRowRules()
    ),
  })
  y = getFinalY(doc) + 10

  /* 3. Attendance calendar grid */
  y = drawSectionTitle(doc, y, 'Attendance Calendar', `${monthLabel} - one column per day, weekends shaded`, {
    title: UR.attendanceCalendar,
  }, 'minimal')
  y = drawLegend(doc, y, Object.values(ATTENDANCE_STYLE))

  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const weekendDays = new Set(dayNumbers.filter((d) => { const dow = new Date(year, month - 1, d).getDay(); return dow === 0 || dow === 6 }))
  // Day headers are drawn rotated in didDrawCell (e.g. "Tue 01 Sep"); the cell content stays empty.
  const dayLabels = dayNumbers.map((d) => {
    const date = new Date(year, month - 1, d)
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
    const monthName = date.toLocaleDateString('en-US', { month: 'short' })
    return `${weekday} ${String(d).padStart(2, '0')} ${monthName}`
  })
  const calendarHeaders = ['Worker', ...dayNumbers.map(() => ''), 'P', 'A', 'L']
  const calendarRows = workers.map((w) => {
    const days = attendance[w.id] ?? {}
    const s = summaries.get(w.id)!
    const cells = dayNumbers.map((d) => {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      return days[key] ?? ''
    })
    return [w.full_name, ...cells, s.present, s.absent, s.leave]
  })
  const nameWidth = 38
  const totalsWidth = 9
  const dayWidth = (pageWidth - MARGIN * 2 - nameWidth - totalsWidth * 3) / daysInMonth
  const calendarColumnStyles: UserOptions['columnStyles'] = { 0: { cellWidth: nameWidth, halign: 'left' } }
  dayNumbers.forEach((d) => { calendarColumnStyles[d] = { cellWidth: dayWidth, halign: 'center' } })
  for (let i = 1; i <= 3; i++) calendarColumnStyles[daysInMonth + i] = { cellWidth: totalsWidth, halign: 'center', fontStyle: 'bold' }

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY: y,
    theme: 'grid',
    head: [calendarHeaders],
    body: calendarRows,
    ...chainCellHooks(
      urduCellHooks(doc, {
        headUr: [UR.worker, ...dayNumbers.map(() => ''), UR.present, UR.absent, UR.leave],
        urduSize: 6,
        headColour: C.ink,
        onDidParse: (data) => {
          const col = data.column.index
          const isDay = col >= 1 && col <= daysInMonth
          if (data.section === 'head' && isDay && weekendDays.has(col)) data.cell.styles.fillColor = C.weekend
          if (data.section !== 'body') return
          if (isDay) {
            const value = String(data.cell.raw) as AttendanceStatus | ''
            if (value && ATTENDANCE_STYLE[value]) {
              data.cell.styles.fillColor = ATTENDANCE_STYLE[value].fill
              data.cell.styles.textColor = ATTENDANCE_STYLE[value].text
              data.cell.styles.fontStyle = 'bold'
            } else if (weekendDays.has(col)) {
              data.cell.styles.fillColor = C.weekend
            }
          }
          if (col === daysInMonth + 1) data.cell.styles.textColor = C.green
          if (col === daysInMonth + 2) data.cell.styles.textColor = C.red
          if (col === daysInMonth + 3) data.cell.styles.textColor = C.amber
        },
        onDidDraw: (data) => {
          const col = data.column.index
          if (data.section !== 'head' || col < 1 || col > daysInMonth) return
          const label = dayLabels[col - 1]
          setLatinFont(doc, weekendDays.has(col) ? 'normal' : 'bold')
          doc.setFontSize(6)
          doc.setTextColor(...C.ink)
          // Rotated 90° the text runs bottom-to-top; nudge x right by half the cap height to centre the glyphs.
          doc.text(label, data.cell.x + data.cell.width / 2 + 0.8, data.cell.y + data.cell.height - 1.5, { angle: 90 })
        },
      })
    ),
    styles: { cellPadding: 1, overflow: 'hidden', lineColor: C.hairline, lineWidth: 0.15, fontSize: 7 },
    headStyles: { fillColor: C.greenTint, textColor: C.ink, fontSize: 6.5, fontStyle: 'bold', halign: 'center', valign: 'bottom', cellPadding: 1, minCellHeight: 17 },
    bodyStyles: { fontSize: 7, textColor: C.ink, minCellHeight: 6 },
    columnStyles: calendarColumnStyles,
  })
  y = getFinalY(doc) + 10

  /* 4. Task board */
  const pending = tasks.filter((t) => t.status === 'PENDING').length
  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length
  const done = tasks.filter((t) => t.status === 'COMPLETED').length
  y = drawSectionTitle(doc, y, 'Task Board', `${inProgress} in progress | ${pending} pending | ${done} done`, {
    title: UR.taskBoard,
  })
  y = drawLegend(doc, y, [TASK_STATUS_STYLE.IN_PROGRESS, TASK_STATUS_STYLE.PENDING, TASK_STATUS_STYLE.COMPLETED])

  const sortedTasks = [...tasks].sort((a, b) => {
    const wa = workerById.get(a.workerId)?.full_name
    const wb = workerById.get(b.workerId)?.full_name
    // Tasks whose worker isn't in the roster go last.
    if (!wa !== !wb) return wa ? -1 : 1
    if (wa && wb && wa !== wb) return wa.localeCompare(wb)
    if (TASK_STATUS_ORDER[a.status] !== TASK_STATUS_ORDER[b.status]) return TASK_STATUS_ORDER[a.status] - TASK_STATUS_ORDER[b.status]
    return b.createdAt.localeCompare(a.createdAt)
  })
  const taskHeaders = ['Worker', 'Task', 'Batch Order', 'Assigned', 'Status']
  const taskStatusCol = taskHeaders.indexOf('Status')
  const taskRows = sortedTasks.map((t) => [
    workerById.get(t.workerId)?.full_name ?? 'Unassigned',
    t.title,
    t.batchOrder,
    new Date(t.createdAt).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    TASK_STATUS_STYLE[t.status].label,
  ])

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY: y,
    head: [taskHeaders],
    body: taskRows.length > 0 ? taskRows : [[{ content: 'No tasks on the board.', colSpan: taskHeaders.length, styles: { halign: 'center', textColor: C.muted } }]],
    ...chainCellHooks(
      urduCellHooks(doc, {
        headUr: [UR.worker, UR.task, UR.batchOrder, UR.assigned, UR.status],
        headColour: C.ink,
        cellUr: {
          [taskStatusCol]: Object.fromEntries(
            (Object.keys(TASK_STATUS_STYLE) as LabourTaskStatus[]).map((k) => [TASK_STATUS_STYLE[k].label, TASK_STATUS_STYLE[k].labelUr])
          ),
        },
        onDidParse: (data) => {
          if (data.section === 'head' && data.column.index === taskStatusCol) data.cell.styles.halign = 'center'
          if (data.section !== 'body' || data.column.index !== taskStatusCol) return
          const style = Object.values(TASK_STATUS_STYLE).find((s) => s.label === data.cell.raw)
          if (style) {
            data.cell.styles.fillColor = style.fill
            data.cell.styles.textColor = style.text
          }
        },
      }),
      minimalRowRules()
    ),
  })
  y = getFinalY(doc) + 10

  /* 5. Loan ledger */
  const totalOriginal = loans.reduce((a, l) => a + l.original_loan_amount, 0)
  const totalRepaid = totalOriginal - outstandingLoans
  const totalDeduction = loans.reduce((a, l) => a + (l.current_balance > 0 ? l.monthly_deduction_rate : 0), 0)
  y = drawSectionTitle(doc, y, 'Loan Ledger', `${loans.length} loans | ${formatPKRCell(totalRepaid)} recovered | ${formatPKRCell(outstandingLoans)} outstanding`, {
    title: UR.loanLedger,
  }, 'minimal')

  const loanHeaders = ['Worker', 'Role', 'Issued', 'Original', 'Repaid', 'Balance', 'Monthly Deduction', 'Months Left', 'Recovery', 'Status']
  const loanRecoveryCol = loanHeaders.indexOf('Recovery')
  const loanStatusCol = loanHeaders.indexOf('Status')
  const sortedLoans = [...loans].sort((a, b) => b.current_balance - a.current_balance)
  const loanProgress = sortedLoans.map((l) => (l.original_loan_amount > 0 ? Math.min(1, Math.max(0, 1 - l.current_balance / l.original_loan_amount)) : 1))
  const loanRows = sortedLoans.map((l) => {
    const worker = l.workers ?? workerById.get(l.worker_id)
    const repaid = l.original_loan_amount - l.current_balance
    const cleared = l.current_balance <= 0
    const monthsLeft = cleared ? 0 : l.monthly_deduction_rate > 0 ? Math.ceil(l.current_balance / l.monthly_deduction_rate) : null
    return [
      worker?.full_name ?? 'Unknown worker',
      worker?.role_designation ?? '-',
      formatDate(l.created_at),
      formatPKRCell(l.original_loan_amount),
      formatPKRCell(repaid),
      formatPKRCell(l.current_balance),
      formatPKRCell(l.monthly_deduction_rate),
      monthsLeft === null ? '-' : String(monthsLeft),
      '',
      cleared ? 'CLEARED' : 'ACTIVE',
    ]
  })

  autoTable(doc, {
    ...baseTableOptions(doc, 'minimal'),
    startY: y,
    head: [loanHeaders],
    body: loanRows.length > 0 ? loanRows : [[{ content: 'No loans issued.', colSpan: loanHeaders.length, styles: { halign: 'center', textColor: C.muted } }]],
    foot: loanRows.length > 0
      ? [[
          { content: 'TOTAL', colSpan: 3, styles: { fontStyle: 'bold' } },
          formatPKRCell(totalOriginal),
          formatPKRCell(totalRepaid),
          formatPKRCell(outstandingLoans),
          formatPKRCell(totalDeduction),
          '',
          totalOriginal > 0 ? `${Math.round((totalRepaid / totalOriginal) * 100)}%` : '-',
          `${activeLoans} active`,
        ]]
      : undefined,
    footStyles: { fillColor: C.greenTint, textColor: C.ink, fontStyle: 'bold', fontSize: 8.5, lineColor: C.green },
    columnStyles: {
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'center' },
      [loanRecoveryCol]: { cellWidth: 34 },
      [loanStatusCol]: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
    },
    ...chainCellHooks(
      urduCellHooks(doc, {
        headUr: [UR.worker, UR.role, UR.issued, UR.original, UR.repaid, UR.balance, UR.monthlyDeduction, UR.monthsLeft, UR.recovery, UR.status],
        headColour: C.ink,
        cellUr: {
          [loanStatusCol]: { CLEARED: UR.cleared, ACTIVE: UR.activeStatus },
        },
        onDidParse: (data) => {
          if (data.section === 'head') {
            if ([3, 4, 5, 6, loanRecoveryCol].includes(data.column.index)) data.cell.styles.halign = 'right'
            if ([7, loanStatusCol].includes(data.column.index)) data.cell.styles.halign = 'center'
            return
          }
          if (data.section === 'foot' && [3, 4, 5, 6, loanRecoveryCol].includes(data.column.index)) data.cell.styles.halign = 'right'
          if (data.section !== 'body') return
          if (data.column.index === 5 && loanRows.length > 0) {
            data.cell.styles.textColor = loanProgress[data.row.index] >= 1 ? C.green : C.red
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === loanStatusCol) {
            const cleared = data.cell.raw === 'CLEARED'
            data.cell.styles.fillColor = cleared ? C.greenSoft : C.amberSoft
            data.cell.styles.textColor = cleared ? C.green : C.amber
          }
        },
        onDidDraw: (data) => {
          if (data.section !== 'body' || data.column.index !== loanRecoveryCol || loanRows.length === 0) return
          const ratio = loanProgress[data.row.index]
          const padX = 3
          const barX = data.cell.x + padX
          const barW = data.cell.width - padX * 2 - 11
          const barH = 2.6
          const barY = data.cell.y + data.cell.height / 2 - barH / 2
          doc.setFillColor(...C.track)
          doc.roundedRect(barX, barY, barW, barH, 1, 1, 'F')
          if (ratio > 0) {
            doc.setFillColor(...(ratio >= 1 ? C.green : ratio >= 0.5 ? C.blue : C.amber))
            doc.roundedRect(barX, barY, Math.max(1.5, barW * ratio), barH, 1, 1, 'F')
          }
          setLatinFont(doc, 'bold')
          doc.setFontSize(7)
          doc.setTextColor(...C.slate)
          doc.text(`${Math.round(ratio * 100)}%`, data.cell.x + data.cell.width - padX, data.cell.y + data.cell.height / 2 + 1, { align: 'right' })
        },
      }),
      minimalRowRules()
    ),
  })

  drawReportFooter(doc, title, 'minimal')

  const stamp = `${year}-${String(month).padStart(2, '0')}`
  outputReport(doc, `glassco_labour_report_${stamp}.pdf`)
  return doc
}

/* ─── Worker Payslip (single worker, strictly one page) ───────────────────── */

export async function exportWorkerPayslipPDF(
  worker: Worker,
  attendance: AttendanceMap,
  loans: WorkerLoan[],
  year: number,
  month: number,
  timeLogs: TimeLogMap = {},
  operatorName = 'Labour Supervisor'
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  await ensureUrduFont(doc)
  await ensureSourceSansFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth() // 210mm
  const pageHeight = doc.internal.pageSize.getHeight() // 297mm
  const contentWidth = pageWidth - MARGIN * 2 // 182mm
  const profile = loadCompanyProfile()
  const monthLabel = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const salary = calculateEarnedSalary(worker, attendance, year, month, timeLogs)
  const loanTaken = loans.reduce((a, l) => a + l.original_loan_amount, 0)
  const loanRemaining = loans.reduce((a, l) => a + l.current_balance, 0)
  const paidDays = salary.presentDays + salary.leaveDays
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  // Standard template blue tokens — identical to the invoice / quotation documents.
  const BLUE_HEADER: RGB = [29, 82, 152] // #1D5298
  const BLUE_LIGHT_BG: RGB = [235, 243, 250] // #EBF3FA
  const BORDER_DARK: RGB = [60, 63, 66] // #3c3f42

  // 1. Header: company title (centered) + thin blue rule
  const companyName = (profile.name?.trim() || COMPANY_HEADER).toUpperCase()
  setBrandFont(doc)
  doc.setFontSize(22)
  doc.setTextColor(9, 9, 11)
  doc.text(companyName, pageWidth / 2, 14, { align: 'center' })

  doc.setDrawColor(...BLUE_HEADER)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 17, pageWidth - MARGIN, 17)

  // Sub-banner: dark blue background with white bold centered "PAYSLIP — OCTOBER 2026 / تنخواہ پرچی"
  const bannerY = 19
  const bannerHeight = 8
  doc.setFillColor(...BLUE_HEADER)
  doc.roundedRect(MARGIN, bannerY, contentWidth, bannerHeight, 1, 1, 'F')

  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  const bannerTitleEn = `PAYSLIP — ${monthLabel.toUpperCase()}`
  if (hasUrdu) {
    const enW = doc.getTextWidth(bannerTitleEn + '  /  ')
    const startX = pageWidth / 2 - (enW + 18) / 2
    doc.text(bannerTitleEn + '  /  ', startX, bannerY + 5.5)
    drawUrdu(doc, UR.payslip, startX + enW, bannerY + 5.5, { fontSize: 10.5, color: [255, 255, 255] })
  } else {
    doc.text(bannerTitleEn, pageWidth / 2, bannerY + 5.5, { align: 'center' })
  }

  // 2. Meta information: worker block (left) + payroll stamps (right)
  const metaY = bannerY + bannerHeight + 5

  // Left column: worker details (WORKER / کارکن), mirroring the invoice's TO: block
  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  doc.text('WORKER:', MARGIN, metaY + 3.5)
  if (hasUrdu) {
    drawUrdu(doc, UR.worker, MARGIN + doc.getTextWidth('WORKER:  '), metaY + 3.5, {
      fontSize: 8.5,
      color: [...C.slate] as RGB,
    })
  }
  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(9, 9, 11)
  doc.text(worker.full_name, MARGIN, metaY + 9)

  setLatinFont(doc, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  let leftCurY = metaY + 13.5
  doc.text(`${worker.role_designation}  •  Joined ${formatDate(worker.joining_date)}`, MARGIN, leftCurY)
  leftCurY += 4.2
  setNumericFont(doc)
  doc.setTextColor(9, 9, 11)
  doc.text(`Worker ID: ${worker.id.toUpperCase().slice(0, 8)}`, MARGIN, leftCurY)
  leftCurY += 4.2

  // Right column: Mob, Tel, Period, Generated, Operator, Node ID
  const metaRightWidth = 78
  const metaRightX = pageWidth - MARGIN - metaRightWidth
  const contactPhone = profile.phone?.trim() || DEFAULT_COMPANY.phone
  const contactTel = profile.telephone?.trim() || DEFAULT_COMPANY.telephone

  const metaItems = [
    { label: 'Mob', value: contactPhone },
    { label: 'Tel', value: contactTel },
    { label: 'Period', value: monthLabel },
    { label: 'Generated', value: new Date().toLocaleString() },
    { label: 'Operator', value: operatorName },
    { label: 'Node ID', value: 'PC-PRIMARY-01' },
  ]

  let curMetaY = metaY + 2
  for (const item of metaItems) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.slate)
    doc.text(item.label, metaRightX, curMetaY)
    setNumericFont(doc)
    doc.setFontSize(8)
    doc.setTextColor(9, 9, 11)
    doc.text(item.value, pageWidth - MARGIN, curMetaY, { align: 'right' })
    curMetaY += 4
  }

  let y = Math.max(leftCurY, curMetaY) + 3

  // Invoice/quotation-style boxed tables: blue header row, hairline dark grid.
  const payslipTableOpts: UserOptions = {
    theme: 'grid',
    showFoot: 'lastPage',
    styles: {
      font: tableFont(doc),
      cellPadding: 2,
      overflow: 'linebreak',
      fontSize: 8,
      textColor: [9, 9, 11],
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BLUE_HEADER,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: strongStyle(doc),
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      halign: 'left',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [9, 9, 11],
    },
    footStyles: {
      fillColor: BLUE_LIGHT_BG,
      textColor: [9, 9, 11],
      fontSize: 8,
      fontStyle: strongStyle(doc),
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16, top: 4 },
  }

  function drawCompactSectionTitle(secTitle: string, urTitle?: string, note?: string) {
    doc.setFillColor(...BLUE_HEADER)
    doc.rect(MARGIN, y - 2.4, 1.2, 3.8, 'F')
    setLatinFont(doc, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(9, 9, 11)
    doc.text(secTitle.toUpperCase(), MARGIN + 2.8, y)
    if (hasUrdu && urTitle) {
      const titleW = doc.getTextWidth(secTitle.toUpperCase())
      drawUrdu(doc, urTitle, MARGIN + 4.5 + titleW, y + 0.5, { fontSize: 8, color: BLUE_HEADER })
    }
    if (note) {
      setLatinFont(doc, 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.muted)
      doc.text(note, doc.internal.pageSize.getWidth() - MARGIN, y, { align: 'right' })
    }
    y += 2
  }

  /* 1. Attendance summary */
  drawCompactSectionTitle('Attendance Summary', UR.attendanceSummary, `${monthLabel} • Leave is paid, only Absent is unpaid`)
  autoTable(doc, {
    ...payslipTableOpts,
    startY: y,
    head: [['Days in Period', 'Present', 'Absent', 'Leave']],
    body: [[salary.daysInMonth, salary.presentDays, salary.absentDays, salary.leaveDays]],
    columnStyles: {
      0: { halign: 'center' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
    },
    ...urduCellHooks(doc, {
      headUr: [UR.daysInPeriod, UR.present, UR.absent, UR.leave],
      onDidParse: (data) => {
        if (data.section === 'head') {
          data.cell.styles.halign = 'center'
          data.cell.styles.fontStyle = strongStyle(doc)
        }
        if (data.section !== 'body') return
        if (data.column.index === 1) { data.cell.styles.textColor = C.green; data.cell.styles.fontStyle = 'bold' }
        if (data.column.index === 2) { data.cell.styles.textColor = C.red; data.cell.styles.fontStyle = 'bold' }
        if (data.column.index === 3) { data.cell.styles.textColor = C.amber; data.cell.styles.fontStyle = 'bold' }
      },
    }),
  })
  y = getFinalY(doc) + 3

  /* 2. Salary breakdown */
  drawCompactSectionTitle('Salary Breakdown', UR.salaryBreakdown, 'Daily Rate = Base / Days in Period')
  autoTable(doc, {
    ...payslipTableOpts,
    startY: y,
    head: [['Item', 'Value']],
    body: [
      ['Base Salary (monthly)', formatPKRCell(worker.base_salary_pkr)],
      [`Daily Rate (Base / ${salary.daysInMonth} days)`, `PKR ${salary.dailyRate.toFixed(2)}`],
      [`Paid Days (Present ${salary.presentDays} + Leave ${salary.leaveDays})`, String(paidDays)],
      ['Basic Salary (paid days)', formatPKRCell(salary.basicSalary)],
      [`Overtime (${formatMinutes(salary.overtimeMinutes)} x PKR ${salary.overtimeRate}/hr)`, formatPKRCell(salary.overtimePay)],
      [`Undertime Deduction (${formatMinutes(salary.undertimeMinutes)} x PKR ${salary.hourlyRate.toFixed(2)}/hr)`, `- ${formatPKRCell(salary.undertimeDeduction)}`],
      ['Earned Salary', formatPKRCell(salary.earnedSalary)],
    ],
    columnStyles: { 1: { halign: 'right', cellWidth: 52, fontStyle: 'bold' } },
    ...urduCellHooks(doc, {
      headUr: [UR.item, UR.value],
      cellUr: {
        0: {
          'Base Salary (monthly)': UR.baseSalaryMonthly,
          'Daily Rate': UR.dailyRate,
          'Paid Days': UR.paidDays,
          'Earned Salary': UR.earnedSalary,
        },
      },
      onDidParse: (data) => {
        if (data.section === 'head') {
          data.cell.styles.fontStyle = strongStyle(doc)
          if (data.column.index === 1) data.cell.styles.halign = 'right'
        }
        if (data.section === 'body' && data.row.index === 6) {
          data.cell.styles.textColor = BLUE_HEADER
          data.cell.styles.fontStyle = strongStyle(doc)
          data.cell.styles.fillColor = BLUE_LIGHT_BG // total row, matching the invoice grand-total box
        }
      },
    }),
  })
  y = getFinalY(doc) + 3

  /* 3. Loans (informational only) */
  drawCompactSectionTitle('Loans (Informational)', UR.loansInformational, 'NOT deducted from the Earned Salary shown above')
  autoTable(doc, {
    ...payslipTableOpts,
    startY: y,
    head: [['Issued', 'Original', 'Remaining', 'Status']],
    body: loans.length > 0
      ? loans.map((l) => [
          formatDate(l.created_at),
          formatPKRCell(l.original_loan_amount),
          formatPKRCell(l.current_balance),
          l.current_balance > 0 ? 'ACTIVE' : 'CLEARED',
        ])
      : [[{ content: 'No active loan records.', colSpan: 4, styles: { halign: 'center', textColor: C.muted, fontStyle: 'italic' } }]],
    foot: loans.length > 0
      ? [[
          { content: 'TOTAL', styles: { fontStyle: 'bold' } },
          formatPKRCell(loanTaken),
          formatPKRCell(loanRemaining),
          '',
        ]]
      : undefined,
    footStyles: {
      fillColor: BLUE_LIGHT_BG,
      textColor: [9, 9, 11],
      fontStyle: strongStyle(doc),
      fontSize: 8,
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
    },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center', cellWidth: 26 } },
    ...urduCellHooks(doc, {
      headUr: [UR.issued, UR.original, UR.remaining, UR.status],
      cellUr: {
        3: { ACTIVE: UR.activeStatus, CLEARED: UR.cleared },
      },
      onDidParse: (data) => {
        if (data.section === 'head' || data.section === 'foot') {
          data.cell.styles.fontStyle = strongStyle(doc)
          data.cell.styles.textColor = data.section === 'head' ? [255, 255, 255] : [9, 9, 11]
          if (data.column.index === 1 || data.column.index === 2) data.cell.styles.halign = 'right'
          if (data.section === 'head' && data.column.index === 3) data.cell.styles.halign = 'center'
          return
        }
        if (data.section !== 'body' || data.column.index !== 3) return
        const active = data.cell.raw === 'ACTIVE'
        data.cell.styles.fillColor = active ? C.amberSoft : C.greenSoft
        data.cell.styles.textColor = active ? C.amber : C.green
        data.cell.styles.fontStyle = 'bold'
      },
    }),
  })

  // Signatures (bottom-pinned, matching the invoice / quotation footer block)
  y = getFinalY(doc) + 6
  const sigY = Math.min(Math.max(y + 8, pageHeight - 40), pageHeight - 22)
  const sigWidth = 60

  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.3)

  doc.line(MARGIN, sigY, MARGIN + sigWidth, sigY)
  setLatinFont(doc, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(9, 9, 11)
  doc.text('Supervisor Signature', MARGIN + sigWidth / 2, sigY + 4, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'تصدیق نگران', MARGIN + sigWidth / 2, sigY + 8.5, {
      align: 'center',
      fontSize: 8,
      color: [9, 9, 11],
    })
  }

  doc.line(pageWidth - MARGIN - sigWidth, sigY, pageWidth - MARGIN, sigY)
  doc.text('Worker Signature', pageWidth - MARGIN - sigWidth / 2, sigY + 4, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'دستخط کارکن', pageWidth - MARGIN - sigWidth / 2, sigY + 8.5, {
      align: 'center',
      fontSize: 8,
      color: [9, 9, 11],
    })
  }

  // Footer: company identity + contact details (same as invoice / quotation)
  const totalPages = doc.getNumberOfPages()
  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.setPage(pNum)

    doc.setDrawColor(...BORDER_DARK)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, pageHeight - 11, pageWidth - MARGIN, pageHeight - 11)

    setLatinFont(doc, 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(24, 24, 27)
    doc.text(COMPANY_LEGAL_NAME.toUpperCase(), MARGIN, pageHeight - 7)

    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(82, 82, 82)
    const contactLine = `${profile.email || DEFAULT_COMPANY.email}   |   ${profile.website || DEFAULT_COMPANY.website}   |   ${profile.phone || DEFAULT_COMPANY.phone}`
    doc.text(contactLine, pageWidth / 2, pageHeight - 7, { align: 'center' })

    setNumericFont(doc)
    doc.setFontSize(7.5)
    doc.setTextColor(24, 24, 27)
    doc.text(`Page ${pNum} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 7, { align: 'right' })
  }

  const stamp = `${year}-${String(month).padStart(2, '0')}`
  const nameSlug =
    worker.full_name.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'worker'
  outputReport(doc, `glassco_payslip_${nameSlug}_${stamp}.pdf`)
  return doc
}

/* ─── Inward Gate Pass Export ────────────────────────────────────────────── */

const IGP_STATUS_LABEL: Record<InwardGatePass['status'], string> = {
  PENDING_INSPECTION: 'Pending Inspection',
  CONVERTED_TO_GRN: 'Converted to GRN',
  REJECTED: 'Rejected',
}

const IGP_STATUS_COLOUR: Record<string, RGB> = {
  [IGP_STATUS_LABEL.PENDING_INSPECTION]: C.amber,
  [IGP_STATUS_LABEL.CONVERTED_TO_GRN]: C.green,
  [IGP_STATUS_LABEL.REJECTED]: C.red,
}

const IGP_STATUS_UR: Record<InwardGatePass['status'], string> = {
  PENDING_INSPECTION: UR.pendingInspection,
  CONVERTED_TO_GRN: UR.convertedToGrn,
  REJECTED: UR.rejected,
}

export async function exportGatePassesToPDF(
  igps: InwardGatePass[],
  options: { subtitle?: string; operatorName?: string; autoPrint?: boolean } = {}
): Promise<jsPDF> {
  const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const pending = igps.filter((i) => i.status === 'PENDING_INSPECTION').length
  const converted = igps.filter((i) => i.status === 'CONVERTED_TO_GRN').length
  const rejected = igps.filter((i) => i.status === 'REJECTED').length

  const summary = `${igps.length} gate passes | Pending: ${pending} | Converted to GRN: ${converted} | Rejected: ${rejected}`
  const subtitle = options.subtitle ? `${options.subtitle} | ${summary}` : summary

  const headers = ['IGP Code', 'Material', 'Supplier', 'Lot #', 'CoA #', 'Qty', 'Unit', 'Status', 'Date']
  const statusColumn = headers.indexOf('Status')

  const sorted = [...igps].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const rows = sorted.map((i) => {
    const acceptedQty = effectiveAcceptedQty(i)
    const rejectedQty = i.rejected_qty ?? 0
    return [
      i.igp_code,
      i.material_description,
      i.parties?.name ?? '-',
      i.vendor_lot_code || '-',
      i.coa_code || '-',
      rejectedQty > 0
        ? `${fmtQty(acceptedQty)} (+${fmtQty(rejectedQty)} rejected)`
        : fmtQty(acceptedQty),
      i.uom ?? normalizeUom(i.unit_of_measure),
      IGP_STATUS_LABEL[i.status] ?? i.status,
      formatDate(i.created_at),
    ]
  })

  const statusUr = Object.fromEntries(
    (Object.keys(IGP_STATUS_LABEL) as InwardGatePass['status'][]).map((k) => [IGP_STATUS_LABEL[k], IGP_STATUS_UR[k]])
  )
  const dateStamp = new Date().toISOString().slice(0, 10)

  return generateERPReportPDF({
    title: 'Inward Gate Passes',
    titleUr: UR.inwardGatePasses,
    subtitle,
    operatorName: options.operatorName,
    headers,
    headersUr: [UR.igpCode, UR.material, UR.supplier, UR.lotNo, UR.coaNo, UR.qty, UR.unit, UR.status, UR.date],
    rows,
    cellUr: { [statusColumn]: statusUr },
    filename: `glassco_inward_gate_passes_${dateStamp}.pdf`,
    autoPrint: options.autoPrint ?? false,
    orientation: 'landscape',
    highlightCells: { [statusColumn]: IGP_STATUS_COLOUR },
  })
}

/* ─── General Ledger Report (journal + trial balance + P&L + balance sheet) ── */

export interface LedgerReportInput {
  entries: JournalEntryWithLines[]
  statements: FinancialStatements
  operatorName?: string
  autoPrint?: boolean
  /** Pre-built English → Urdu account map; built on the fly when omitted. */
  urduMap?: UrduNameMap
}

/** Resolve the account translation map once per export (callers may pass their own). */
async function resolveStatementMap(
  statements: FinancialStatements,
  urduMap?: UrduNameMap
): Promise<UrduNameMap> {
  return urduMap ?? (await buildTranslatedAccountMap(collectStatementNames(statements)))
}

async function resolveJournalMap(
  entries: JournalEntryWithLines[],
  urduMap?: UrduNameMap
): Promise<UrduNameMap> {
  return urduMap ?? (await buildTranslatedAccountMap(collectJournalAccountNames(entries)))
}

const ACCOUNT_TYPE_COLOUR: Record<string, RGB> = {
  ASSET: C.crimson,
  LIABILITY: C.amber,
  EQUITY: C.green,
  REVENUE: C.green,
  EXPENSE: C.red,
}

/** Full-width banner with a label on the left and a value (plus optional chip) on the right. */
function drawBanner(
  doc: jsPDF,
  y: number,
  label: string,
  value: string,
  accent: RGB,
  chip?: { text: string; fill: RGB; colour: RGB },
  labelUr?: string,
  variant: StyleVariant = 'classic'
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined
  const urLabel = hasUrdu ? labelUr : undefined
  const height = urLabel ? 16 : 12
  const minimal = variant === 'minimal'
  y = ensureRoom(doc, y, height + 4, variant)
  doc.setFillColor(...(minimal ? C.greenTint : C.zebra))
  doc.setDrawColor(...(minimal ? C.hairline : C.line))
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, pageWidth - MARGIN * 2, height, 1.5, 1.5, 'FD')
  doc.setFillColor(...accent)
  doc.rect(MARGIN, y, 1.2, height, 'F')

  setLatinFont(doc, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.ink)
  doc.text(label, MARGIN + 5, y + (urLabel ? 6.5 : 7.5))
  if (urLabel) drawUrdu(doc, urLabel, MARGIN + 5, y + 12, { fontSize: 8.5, color: C.slate })

  let rightEdge = pageWidth - MARGIN - 4
  if (chip) {
    doc.setFontSize(7)
    const chipWidth = doc.getTextWidth(chip.text) + 6
    doc.setFillColor(...chip.fill)
    doc.roundedRect(rightEdge - chipWidth, y + 3.5, chipWidth, 5, 1, 1, 'F')
    doc.setTextColor(...chip.colour)
    doc.text(chip.text, rightEdge - chipWidth / 2, y + 7, { align: 'center' })
    rightEdge -= chipWidth + 6
  }

  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...accent)
  doc.text(value, rightEdge, y + height / 2 + 2, { align: 'right' })

  return y + height + 8
}

/** Two-column account/amount table at an explicit x/width, used for side-by-side statements. */
function drawStatementTable(
  doc: jsPDF,
  startY: number,
  x: number,
  width: number,
  heading: string,
  rows: (PLRow | BalanceSheetRow)[],
  total: { label: string; value: number; colour: RGB },
  emptyText: string,
  ur?: { heading?: string; amount?: string; total?: string; empty?: string },
  urduMap: UrduNameMap = {}
): number {
  const pageWidth = doc.internal.pageSize.getWidth()

  // English `code  name` cell → Urdu line drawn underneath it.
  const bodyCellUr: Record<string, string> = {}
  rows.forEach((r) => {
    const source = `${r.account_code}  ${r.account_name}`.trim()
    const translated = accountUrdu(r.account_name, urduMap, r.name_urdu)
    if (translated) bodyCellUr[source] = translated
  })
  if (ur?.empty) bodyCellUr[emptyText] = ur.empty

  autoTable(doc, {
    ...baseTableOptions(doc),
    startY,
    tableWidth: width,
    margin: { left: x, right: pageWidth - x - width, bottom: FOOTER_RESERVE, top: 12 },
    head: [[heading, 'Amount']],
    body: rows.length > 0
      ? rows.map((r) => [`${r.account_code}  ${r.account_name}`.trim(), formatPKRCell(r.amount)])
      : [[{ content: emptyText, colSpan: 2, styles: { halign: 'center', textColor: C.muted, fontStyle: 'italic' } }]],
    foot: [[
      { content: total.label, styles: { fontStyle: 'bold' } },
      { content: formatPKRCell(total.value), styles: { fontStyle: 'bold', halign: 'right', textColor: total.colour } },
    ]],
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontSize: 8.5, lineWidth: { top: 0.4 }, lineColor: C.ink },
    columnStyles: { 1: { halign: 'right', cellWidth: 34 } },
    ...urduCellHooks(doc, {
      headUr: [ur?.heading, ur?.amount],
      footUr: [ur?.total, undefined],
      cellUr: { 0: bodyCellUr },
      onDidParse: (data) => {
        if (data.section === 'head' && data.column.index === 1) data.cell.styles.halign = 'right'
        if (data.section === 'foot' && data.column.index === 1) data.cell.styles.halign = 'right'
      },
    }),
  })
  return getFinalY(doc)
}

/* ─── Ledger sections ─────────────────────────────────────────────────────
 * Each section draws itself and returns the Y to carry on from, so the combined
 * report and the per-section exports below render identical output.
 */

function entryTotals(entry: JournalEntryWithLines): { debit: number; credit: number; balanced: boolean } {
  const lines = entry.journal_lines ?? []
  const debit = lines.reduce((a, l) => a + l.debit_pkr, 0)
  const credit = lines.reduce((a, l) => a + l.credit_pkr, 0)
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 }
}

/** Pushes one entry's group header, its lines and its balance row onto a journal table body. */
function pushJournalEntryRows(
  body: NonNullable<UserOptions['body']>,
  entry: JournalEntryWithLines,
  cellUr: Record<string, string> = {},
  urduMap: UrduNameMap = {}
): void {
  const isPosted = entry.status === 'POSTED'
  body.push([
    {
      content: `${entry.entry_number}   ${formatDate(entry.entry_date)}   -   ${entry.narration || 'No narration'}`,
      colSpan: 2,
      styles: { fillColor: C.line, textColor: C.ink, fontStyle: 'bold' },
    },
    {
      content: entry.status,
      styles: { fillColor: isPosted ? C.greenSoft : C.amberSoft, textColor: isPosted ? C.green : C.amber, fontStyle: 'bold', halign: 'center' },
    },
  ])

  const lines = entry.journal_lines ?? []
  if (lines.length === 0) {
    body.push([{ content: 'No lines recorded for this entry.', colSpan: 3, styles: { textColor: C.muted, fontStyle: 'italic' } }])
    return
  }

  lines.forEach((line) => {
    const account = line.accounts_chart
    const source = `${account?.account_code ?? ''}  ${account?.account_name ?? 'Unknown account'}`.trim()
    const translated = accountUrdu(account?.account_name ?? '', urduMap, account?.name_urdu)
    if (translated) cellUr[source] = translated
    body.push([
      source,
      line.debit_pkr > 0 ? formatPKRCell(line.debit_pkr) : '',
      line.credit_pkr > 0 ? formatPKRCell(line.credit_pkr) : '',
    ])
  })

  const { debit, credit, balanced } = entryTotals(entry)
  body.push([
    { content: balanced ? 'Entry balanced' : `Entry OUT OF BALANCE by ${formatPKRCell(Math.abs(debit - credit))}`, styles: { textColor: balanced ? C.muted : C.red, fontStyle: 'italic', fontSize: 7.5 } },
    { content: formatPKRCell(debit), styles: { fontStyle: 'bold', fontSize: 7.5, textColor: C.slate } },
    { content: formatPKRCell(credit), styles: { fontStyle: 'bold', fontSize: 7.5, textColor: C.slate } },
  ])
}

/** Newest first, matching the order the ledger screen lists entries in. */
function sortEntries(entries: JournalEntryWithLines[]): JournalEntryWithLines[] {
  return [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.entry_number.localeCompare(a.entry_number))
}

function drawJournalSection(doc: jsPDF, startY: number, entries: JournalEntryWithLines[], urduMap: UrduNameMap = {}): number {
  const y = drawSectionTitle(
    doc,
    startY,
    'Journal',
    'Every entry with its debit / credit lines - drafts are not yet in the books',
    { title: UR.journal }
  )
  const journalBody: NonNullable<UserOptions['body']> = []
  const journalCellUr: Record<string, string> = {}
  sortEntries(entries).forEach((entry) => pushJournalEntryRows(journalBody, entry, journalCellUr, urduMap))

  autoTable(doc, {
    ...baseTableOptions(doc),
    startY: y,
    head: [['Account', 'Debit', 'Credit']],
    body: journalBody.length > 0 ? journalBody : [[{ content: 'No journal entries yet.', colSpan: 3, styles: { halign: 'center', textColor: C.muted } }]],
    columnStyles: { 1: { halign: 'right', cellWidth: 42 }, 2: { halign: 'right', cellWidth: 42 } },
    styles: { cellPadding: 2.2, overflow: 'linebreak' },
    ...urduCellHooks(doc, {
      headUr: [UR.account, UR.debit, UR.credit],
      cellUr: { 0: journalCellUr },
      onDidParse: (data) => {
        if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'
      },
    }),
  })
  return getFinalY(doc) + 10
}

function drawTrialBalanceSection(doc: jsPDF, startY: number, statements: FinancialStatements, urduMap: UrduNameMap = {}): number {
  const booksBalance = Math.abs(statements.totalDebit - statements.totalCredit) < 0.01
  const y = drawSectionTitle(
    doc,
    startY,
    'Trial Balance',
    booksBalance ? 'Debits equal credits - the books balance' : `Debits and credits differ by ${formatPKRCell(Math.abs(statements.totalDebit - statements.totalCredit))}`,
    { title: UR.trialBalance }
  )

  // Account column: dynamic database names translated up front.
  const nameCellUr: Record<string, string> = {}
  statements.trialBalance.forEach((r) => {
    const translated = accountUrdu(r.account_name, urduMap, r.name_urdu)
    if (translated) nameCellUr[r.account_name] = translated
  })
  // Type column: static account types straight from the dictionary.
  const typeCellUr: Record<string, string> = {}
  Object.keys(ACCOUNT_TYPE_COLOUR).forEach((type) => {
    const translated = staticUrdu(type)
    if (translated) typeCellUr[type] = translated
  })

  autoTable(doc, {
    ...baseTableOptions(doc),
    startY: y,
    head: [['Code', 'Account', 'Type', 'Debit', 'Credit']],
    body: statements.trialBalance.length > 0
      ? statements.trialBalance.map((r) => [
          r.account_code,
          r.account_name,
          r.account_type,
          r.total_debit > 0 ? formatPKRCell(r.total_debit) : '',
          r.total_credit > 0 ? formatPKRCell(r.total_credit) : '',
        ])
      : [[{ content: 'No posted entries.', colSpan: 5, styles: { halign: 'center', textColor: C.muted } }]],
    foot: statements.trialBalance.length > 0
      ? [[
          { content: 'TOTALS', colSpan: 3, styles: { fontStyle: 'bold' } },
          { content: formatPKRCell(statements.totalDebit), styles: { fontStyle: 'bold', halign: 'right' } },
          { content: formatPKRCell(statements.totalCredit), styles: { fontStyle: 'bold', halign: 'right' } },
        ]]
      : undefined,
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontSize: 8.5, lineWidth: { top: 0.4 }, lineColor: C.ink },
    columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 30, fontStyle: 'bold' }, 3: { halign: 'right', cellWidth: 42 }, 4: { halign: 'right', cellWidth: 42 } },
    ...urduCellHooks(doc, {
      headUr: [UR.code, UR.account, UR.type, UR.debit, UR.credit],
      footUr: [staticUrdu('Grand Totals') ?? UR.total, undefined, undefined, undefined, undefined],
      cellUr: { 1: nameCellUr, 2: typeCellUr },
      onDidParse: (data) => {
        if (data.section === 'head' && data.column.index >= 3) data.cell.styles.halign = 'right'
        if (data.section === 'foot' && data.column.index >= 3) data.cell.styles.halign = 'right'
        if (data.section === 'body' && data.column.index === 2) {
          const colour = ACCOUNT_TYPE_COLOUR[String(data.cell.raw)]
          if (colour) data.cell.styles.textColor = colour
        }
      },
    }),
  })
  return getFinalY(doc) + 10
}

const STATEMENT_GAP = 6

function drawProfitLossSection(doc: jsPDF, startY: number, statements: FinancialStatements, urduMap: UrduNameMap = {}): number {
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2
  const halfWidth = (contentWidth - STATEMENT_GAP) / 2
  const totalRevenue = statements.pl.revenue.reduce((a, r) => a + r.amount, 0)
  const totalExpenses = statements.pl.expenses.reduce((a, r) => a + r.amount, 0)
  const plRows = Math.max(statements.pl.revenue.length, statements.pl.expenses.length, 1)

  // Keep title, both tables and the Net Profit banner on one page when possible.
  let y = ensureRoom(doc, startY, 14 + plRows * 8 + 24 + 20)
  y = drawSectionTitle(doc, y, 'Profit & Loss', 'Revenue against expenses from posted entries', {
    title: UR.profitLoss,
  })
  const revenueEnd = drawStatementTable(doc, y, MARGIN, halfWidth, 'Revenue', statements.pl.revenue, { label: 'Total Revenue', value: totalRevenue, colour: C.green }, 'No revenue entries', {
    heading: UR.revenue,
    amount: UR.amount,
    total: UR.totalRevenue,
    empty: UR.noRevenueEntries,
  }, urduMap)
  const expensesEnd = drawStatementTable(doc, y, MARGIN + halfWidth + STATEMENT_GAP, halfWidth, 'Expenses', statements.pl.expenses, { label: 'Total Expenses', value: totalExpenses, colour: C.red }, 'No expense entries', {
    heading: UR.expenses,
    amount: UR.amount,
    total: UR.totalExpenses,
    empty: UR.noExpenseEntries,
  }, urduMap)
  y = Math.max(revenueEnd, expensesEnd) + 6
  return drawBanner(
    doc,
    y,
    statements.pl.netProfit >= 0 ? 'Net Profit' : 'Net Loss',
    formatPKRCell(statements.pl.netProfit),
    statements.pl.netProfit >= 0 ? C.green : C.red,
    undefined,
    statements.pl.netProfit >= 0 ? UR.netProfit : UR.netLoss
  )
}

function drawBalanceSheetSection(doc: jsPDF, startY: number, statements: FinancialStatements, urduMap: UrduNameMap = {}): number {
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2
  const thirdWidth = (contentWidth - STATEMENT_GAP * 2) / 3
  const liabilitiesPlusEquity = statements.totalLiabilities + statements.totalEquity
  const isBalanced = Math.abs(statements.totalAssets - liabilitiesPlusEquity) < 0.01
  const equityRows: BalanceSheetRow[] = [
    ...statements.balanceSheet.equity,
    { account_code: '', account_name: 'Net Profit (P&L)', amount: statements.pl.netProfit },
  ]
  // Synthetic carry-forward row: make sure it always has an Urdu line.
  const map: UrduNameMap = { ...urduMap }
  if (!map['Net Profit (P&L)']) {
    const fallback = staticUrdu('Net Profit (P&L)') ?? UR.netProfitPnl
    if (fallback) map['Net Profit (P&L)'] = fallback
  }
  const bsRows = Math.max(statements.balanceSheet.assets.length, statements.balanceSheet.liabilities.length, equityRows.length, 1)

  let y = ensureRoom(doc, startY, 14 + bsRows * 8 + 24 + 20)
  y = drawSectionTitle(doc, y, 'Balance Sheet', 'Assets = Liabilities + Equity', { title: UR.balanceSheet })
  const assetsEnd = drawStatementTable(doc, y, MARGIN, thirdWidth, 'Assets', statements.balanceSheet.assets, { label: 'Total Assets', value: statements.totalAssets, colour: C.ink }, 'No asset entries', {
    heading: UR.assets,
    amount: UR.amount,
    total: UR.totalAssets,
    empty: UR.noAssetEntries,
  }, map)
  const liabilitiesEnd = drawStatementTable(doc, y, MARGIN + thirdWidth + STATEMENT_GAP, thirdWidth, 'Liabilities', statements.balanceSheet.liabilities, { label: 'Total Liabilities', value: statements.totalLiabilities, colour: C.ink }, 'No liability entries', {
    heading: UR.liabilities,
    amount: UR.amount,
    total: UR.totalLiabilities,
    empty: UR.noLiabilityEntries,
  }, map)
  const equityEnd = drawStatementTable(doc, y, MARGIN + (thirdWidth + STATEMENT_GAP) * 2, thirdWidth, 'Equity + Profit', equityRows, { label: 'Total Equity', value: statements.totalEquity, colour: C.ink }, 'No equity entries', {
    heading: UR.equityProfit,
    amount: UR.amount,
    total: UR.totalEquity,
    empty: UR.noEquityEntries,
  }, map)
  y = Math.max(assetsEnd, liabilitiesEnd, equityEnd) + 6

  return drawBanner(
    doc,
    y,
    `Balance Check   -   Assets ${formatPKRCell(statements.totalAssets)}  vs  Liabilities + Equity ${formatPKRCell(liabilitiesPlusEquity)}`,
    isBalanced ? 'Difference: PKR 0' : `Difference: ${formatPKRCell(Math.abs(statements.totalAssets - liabilitiesPlusEquity))}`,
    isBalanced ? C.green : C.red,
    { text: isBalanced ? 'BALANCED' : 'OUT OF BALANCE', fill: isBalanced ? C.greenSoft : C.redSoft, colour: isBalanced ? C.green : C.red },
    isBalanced ? UR.balanced : UR.outOfBalance
  )
}

function ledgerDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Entry numbers can carry slashes; keep them out of the suggested file name. */
function slugForFile(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'entry'
}

/* ─── Ledger exports ─────────────────────────────────────────────────────── */

export async function exportLedgerReportPDF({ entries, statements, operatorName, urduMap }: LedgerReportInput): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  // One batch call covers both the journal lines and the statement rows.
  const map =
    urduMap ??
    (await buildTranslatedAccountMap([
      ...collectJournalAccountNames(entries),
      ...collectStatementNames(statements),
    ]))
  const posted = entries.filter((e) => e.status === 'POSTED').length
  const drafts = entries.length - posted

  const title = 'General Ledger Report'
  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.generalLedger,
    subtitle: `${entries.length} journal entries (${posted} posted, ${drafts} draft) | ${statements.trialBalance.length} accounts with activity | Statements reflect posted entries only`,
    operatorName,
  })

  y = drawKpiTiles(doc, y, [
    { label: 'Total Debit', labelUr: UR.totalDebit, value: formatPKRCell(statements.totalDebit), accent: C.crimson },
    { label: 'Total Credit', labelUr: UR.totalCredit, value: formatPKRCell(statements.totalCredit), accent: C.crimson },
    { label: 'Net Profit', labelUr: UR.netProfit, value: formatPKRCell(statements.pl.netProfit), accent: statements.pl.netProfit >= 0 ? C.green : C.red },
    { label: 'Assets', labelUr: UR.assets, value: formatPKRCell(statements.totalAssets), accent: C.amber },
    { label: 'Liabilities', labelUr: UR.liabilities, value: formatPKRCell(statements.totalLiabilities), accent: C.amber },
    { label: 'Equity', labelUr: UR.equity, value: formatPKRCell(statements.totalEquity), accent: C.blue },
  ])

  y = drawJournalSection(doc, y, entries, map)
  y = drawTrialBalanceSection(doc, y, statements, map)
  y = drawProfitLossSection(doc, y, statements, map)
  drawBalanceSheetSection(doc, y, statements, map)

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_general_ledger_${ledgerDateStamp()}.pdf`)
  return doc
}

/** The journal on its own - every entry with its lines, no statements. */
export async function exportJournalPDF({
  entries,
  operatorName,
  urduMap,
}: {
  entries: JournalEntryWithLines[]
  operatorName?: string
  urduMap?: UrduNameMap
}): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const map = await resolveJournalMap(entries, urduMap)
  const title = 'Journal'
  const posted = entries.filter((e) => e.status === 'POSTED')
  const totalDebit = posted.reduce((a, e) => a + entryTotals(e).debit, 0)
  const totalCredit = posted.reduce((a, e) => a + entryTotals(e).credit, 0)

  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.journal,
    subtitle: `${entries.length} journal entries (${posted.length} posted, ${entries.length - posted.length} draft) | Drafts are not yet in the books`,
    operatorName,
  })
  y = drawKpiTiles(doc, y, [
    { label: 'Entries', labelUr: UR.entries, value: String(entries.length), accent: C.blue },
    { label: 'Posted', labelUr: UR.posted, value: String(posted.length), accent: C.green },
    { label: 'Draft', labelUr: UR.draft, value: String(entries.length - posted.length), accent: C.amber },
    { label: 'Posted Debit', labelUr: UR.postedDebit, value: formatPKRCell(totalDebit), accent: C.crimson },
    { label: 'Posted Credit', labelUr: UR.postedCredit, value: formatPKRCell(totalCredit), accent: C.crimson },
  ])
  drawJournalSection(doc, y, entries, map)

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_journal_${ledgerDateStamp()}.pdf`)
  return doc
}

/** A single journal entry as its own document, for filing against the voucher. */
export async function exportJournalEntryPDF({
  entry,
  operatorName,
  urduMap,
}: {
  entry: JournalEntryWithLines
  operatorName?: string
  urduMap?: UrduNameMap
}): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  await ensureUrduFont(doc)
  const map = await resolveJournalMap([entry], urduMap)
  const title = `Journal Entry ${entry.entry_number}`
  const isPosted = entry.status === 'POSTED'
  const { debit, credit, balanced } = entryTotals(entry)
  const lines = entry.journal_lines ?? []

  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.journal,
    subtitle: `${formatDate(entry.entry_date)} | ${entry.status} | ${lines.length} line${lines.length === 1 ? '' : 's'}`,
    operatorName,
  })

  y = drawKpiTiles(doc, y, [
    { label: 'Entry No.', labelUr: UR.entryNo, value: entry.entry_number, accent: C.blue },
    { label: 'Status', labelUr: UR.status, value: entry.status, accent: isPosted ? C.green : C.amber },
    { label: 'Total Debit', labelUr: UR.totalDebit, value: formatPKRCell(debit), accent: C.crimson },
    { label: 'Total Credit', labelUr: UR.totalCredit, value: formatPKRCell(credit), accent: C.crimson },
  ])

  y = drawSectionTitle(doc, y, 'Narration', entry.narration || 'No narration recorded', {
    title: UR.narration,
    caption: entry.narration ? undefined : UR.noNarration,
  })

  // Account column: the same `code  name` string used as the cell key.
  const lineCellUr: Record<string, string> = {}
  lines.forEach((line) => {
    const name = line.accounts_chart?.account_name ?? 'Unknown account'
    const translated = accountUrdu(name, map, line.accounts_chart?.name_urdu)
    if (translated) lineCellUr[`${line.accounts_chart?.account_code ?? ''}  ${name}`.trim()] = translated
  })

  autoTable(doc, {
    ...baseTableOptions(doc),
    startY: y,
    head: [['Account', 'Debit', 'Credit']],
    body: lines.length > 0
      ? lines.map((line) => [
          `${line.accounts_chart?.account_code ?? ''}  ${line.accounts_chart?.account_name ?? 'Unknown account'}`.trim(),
          line.debit_pkr > 0 ? formatPKRCell(line.debit_pkr) : '',
          line.credit_pkr > 0 ? formatPKRCell(line.credit_pkr) : '',
        ])
      : [[{ content: 'No lines recorded for this entry.', colSpan: 3, styles: { halign: 'center', textColor: C.muted, fontStyle: 'italic' } }]],
    foot: lines.length > 0
      ? [[
          { content: 'TOTALS', styles: { fontStyle: 'bold' } },
          { content: formatPKRCell(debit), styles: { fontStyle: 'bold', halign: 'right' } },
          { content: formatPKRCell(credit), styles: { fontStyle: 'bold', halign: 'right' } },
        ]]
      : undefined,
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontSize: 8.5, lineWidth: { top: 0.4 }, lineColor: C.ink },
    columnStyles: { 1: { halign: 'right', cellWidth: 36 }, 2: { halign: 'right', cellWidth: 36 } },
    ...urduCellHooks(doc, {
      headUr: [UR.account, UR.debit, UR.credit],
      footUr: [UR.total, undefined, undefined],
      cellUr: { 0: lineCellUr },
      onDidParse: (data) => {
        if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'
        if (data.section === 'foot' && data.column.index > 0) data.cell.styles.halign = 'right'
      },
    }),
  })
  y = getFinalY(doc) + 8

  drawBanner(
    doc,
    y,
    balanced ? 'Entry balanced' : 'Entry out of balance',
    balanced ? 'Difference: PKR 0' : `Difference: ${formatPKRCell(Math.abs(debit - credit))}`,
    balanced ? C.green : C.red,
    { text: entry.status, fill: isPosted ? C.greenSoft : C.amberSoft, colour: isPosted ? C.green : C.amber },
    balanced ? UR.entryBalanced : UR.entryOutOfBalance
  )

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_journal_entry_${slugForFile(entry.entry_number)}.pdf`)
  return doc
}

export async function exportTrialBalancePDF({
  statements,
  operatorName,
  urduMap,
}: {
  statements: FinancialStatements
  operatorName?: string
  urduMap?: UrduNameMap
}): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const map = await resolveStatementMap(statements, urduMap)
  const title = 'Trial Balance'

  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.trialBalance,
    subtitle: `${statements.trialBalance.length} accounts with activity | Posted entries only`,
    operatorName,
  })
  y = drawKpiTiles(doc, y, [
    { label: 'Accounts', labelUr: UR.accounts, value: String(statements.trialBalance.length), accent: C.blue },
    { label: 'Total Debit', labelUr: UR.totalDebit, value: formatPKRCell(statements.totalDebit), accent: C.crimson },
    { label: 'Total Credit', labelUr: UR.totalCredit, value: formatPKRCell(statements.totalCredit), accent: C.crimson },
  ])
  drawTrialBalanceSection(doc, y, statements, map)

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_trial_balance_${ledgerDateStamp()}.pdf`)
  return doc
}

export async function exportProfitLossPDF({
  statements,
  operatorName,
  urduMap,
}: {
  statements: FinancialStatements
  operatorName?: string
  urduMap?: UrduNameMap
}): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const map = await resolveStatementMap(statements, urduMap)
  const title = 'Profit & Loss'
  const totalRevenue = statements.pl.revenue.reduce((a, r) => a + r.amount, 0)
  const totalExpenses = statements.pl.expenses.reduce((a, r) => a + r.amount, 0)

  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.profitLoss,
    subtitle: `${statements.pl.revenue.length} revenue accounts | ${statements.pl.expenses.length} expense accounts | Posted entries only`,
    operatorName,
  })
  y = drawKpiTiles(doc, y, [
    { label: 'Total Revenue', labelUr: UR.totalRevenue, value: formatPKRCell(totalRevenue), accent: C.green },
    { label: 'Total Expenses', labelUr: UR.totalExpenses, value: formatPKRCell(totalExpenses), accent: C.red },
    {
      label: statements.pl.netProfit >= 0 ? 'Net Profit' : 'Net Loss',
      labelUr: statements.pl.netProfit >= 0 ? UR.netProfit : UR.netLoss,
      value: formatPKRCell(statements.pl.netProfit),
      accent: statements.pl.netProfit >= 0 ? C.green : C.red,
    },
  ])
  drawProfitLossSection(doc, y, statements, map)

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_profit_and_loss_${ledgerDateStamp()}.pdf`)
  return doc
}

export async function exportBalanceSheetPDF({
  statements,
  operatorName,
  urduMap,
}: {
  statements: FinancialStatements
  operatorName?: string
  urduMap?: UrduNameMap
}): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const map = await resolveStatementMap(statements, urduMap)
  const title = 'Balance Sheet'

  let y = drawReportHeader(doc, {
    title,
    titleUr: UR.balanceSheet,
    subtitle: 'Assets = Liabilities + Equity | Posted entries only',
    operatorName,
  })
  y = drawKpiTiles(doc, y, [
    { label: 'Assets', labelUr: UR.assets, value: formatPKRCell(statements.totalAssets), accent: C.amber },
    { label: 'Liabilities', labelUr: UR.liabilities, value: formatPKRCell(statements.totalLiabilities), accent: C.amber },
    { label: 'Equity', labelUr: UR.equity, value: formatPKRCell(statements.totalEquity), accent: C.blue },
    { label: 'Net Profit', labelUr: UR.netProfit, value: formatPKRCell(statements.pl.netProfit), accent: statements.pl.netProfit >= 0 ? C.green : C.red },
  ])
  drawBalanceSheetSection(doc, y, statements, map)

  drawReportFooter(doc, title)
  outputReport(doc, `glassco_balance_sheet_${ledgerDateStamp()}.pdf`)
  return doc
}

/* ─── Bilingual (English + Urdu) tables ──────────────────────────────────── */

interface BilingualCell {
  en: string
  ur?: string
}

interface BilingualTableSpec {
  head?: BilingualCell[]
  body: BilingualCell[][]
  foot?: BilingualCell[]
  /** Explicit widths in mm; needed for Urdu word-wrap inside the cell. */
  columnWidths: number[]
  halign?: ('left' | 'center' | 'right')[]
  /** Column indexes whose body cells are drawn bold on a shaded background (label columns). */
  labelColumns?: number[]
  startY: number
  urduFontSize?: number
}

const URDU_LINE = 4.6
const CELL_PAD = 3

/**
 * Draws an autoTable where every cell can carry an Urdu line directly under its English text.
 * The English text is the cell content; the Urdu is drawn in the reserved bottom padding.
 */
function drawBilingualTable(doc: jsPDF, spec: BilingualTableSpec): number {
  const urduSize = spec.urduFontSize ?? 9
  const cellFor = (section: 'head' | 'body' | 'foot', row: number, col: number): BilingualCell | undefined => {
    if (section === 'head') return spec.head?.[col]
    if (section === 'foot') return spec.foot?.[col]
    return spec.body[row]?.[col]
  }
  const urduLines = (cell: BilingualCell | undefined, col: number): number =>
    cell?.ur ? countUrduLines(doc, cell.ur, spec.columnWidths[col] - CELL_PAD * 2, urduSize) : 0

  const columnStyles: UserOptions['columnStyles'] = {}
  spec.columnWidths.forEach((w, i) => {
    columnStyles[i] = { cellWidth: w, halign: spec.halign?.[i] ?? 'left' }
  })

  const strong = strongStyle(doc)
  autoTable(doc, {
    ...baseTableOptions(doc),
    startY: spec.startY,
    theme: 'grid',
    head: spec.head ? [spec.head.map((c) => c.en)] : undefined,
    body: spec.body.map((row) => row.map((c) => c.en)),
    foot: spec.foot ? [spec.foot.map((c) => c.en)] : undefined,
    styles: { font: tableFont(doc), cellPadding: CELL_PAD, overflow: 'linebreak', lineColor: C.line, lineWidth: 0.2, valign: 'top' },
    headStyles: { fillColor: C.ink, textColor: C.white, fontSize: 9, fontStyle: strong, lineColor: C.ink },
    bodyStyles: { fontSize: 9, textColor: [38, 38, 38] },
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontSize: 9, fontStyle: strong, lineWidth: { top: 0.4 }, lineColor: C.ink },
    columnStyles,
    didParseCell: (data: CellHookData) => {
      const cell = cellFor(data.section, data.row.index, data.column.index)
      const lines = urduLines(cell, data.column.index)
      const halign = spec.halign?.[data.column.index] ?? 'left'
      data.cell.styles.halign = halign
      if (lines > 0) {
        data.cell.styles.cellPadding = { top: CELL_PAD, right: CELL_PAD, left: CELL_PAD, bottom: CELL_PAD + lines * URDU_LINE }
      }
      if (data.section === 'body' && spec.labelColumns?.includes(data.column.index)) {
        data.cell.styles.fillColor = C.zebra
        data.cell.styles.fontStyle = strong
        data.cell.styles.textColor = C.slate
      }
    },
    didDrawCell: (data: CellHookData) => {
      const cell = cellFor(data.section, data.row.index, data.column.index)
      if (!cell?.ur) return
      const lines = urduLines(cell, data.column.index)
      const halign = spec.halign?.[data.column.index] ?? 'left'
      const x = halign === 'right' ? data.cell.x + data.cell.width - CELL_PAD : halign === 'center' ? data.cell.x + data.cell.width / 2 : data.cell.x + CELL_PAD
      const lastBaseline = data.cell.y + data.cell.height - CELL_PAD - 0.4
      const firstBaseline = lastBaseline - (lines - 1) * URDU_LINE
      const colour: RGB = data.section === 'head' ? C.white : data.section === 'foot' ? C.ink : spec.labelColumns?.includes(data.column.index) ? C.slate : C.muted
      drawUrdu(doc, cell.ur, x, firstBaseline, { align: halign, fontSize: urduSize, color: colour, maxWidth: data.cell.width - CELL_PAD * 2, lineHeight: URDU_LINE })
    },
  })
  return getFinalY(doc)
}

/* ─── Payment Vouchers ───────────────────────────────────────────────────── */

const VOUCHER_TYPE_EN: Record<PaymentVoucher['voucher_type'], { short: string; label: string; title: string }> = {
  CASH_PAYMENT: { short: 'CPV', label: 'Cash Payment', title: 'Cash Payment Voucher' },
  PARTY_PAYMENT: { short: 'PPV', label: 'Party Payment', title: 'Party Payment Voucher' },
  BANK_PAYMENT: { short: 'BPV', label: 'Bank Payment', title: 'Bank Payment Voucher' },
  SALARY_PAYMENT: { short: 'SPV', label: 'Salary Payment', title: 'Salary Payment Voucher' },
}

const VOUCHER_TYPE_UR: Record<PaymentVoucher['voucher_type'], { label: string; title: string }> = {
  CASH_PAYMENT: { label: UR.cashPayment, title: UR.cashPaymentVoucher },
  PARTY_PAYMENT: { label: UR.partyPayment, title: UR.partyPaymentVoucher },
  BANK_PAYMENT: { label: UR.bankPayment, title: UR.bankPaymentVoucher },
  SALARY_PAYMENT: { label: UR.salaryPayment, title: UR.salaryPaymentVoucher },
}

function accountLabel(account?: { account_code: string; account_name: string } | null): string {
  return account ? `${account.account_code}  ${account.account_name}` : '-'
}

function formatPKRPrecise(value: number): string {
  return `PKR ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** All vouchers currently listed, as one bilingual table. */
export async function exportPaymentVouchersToPDF(
  vouchers: PaymentVoucher[],
  options: { subtitle?: string; operatorName?: string; autoPrint?: boolean } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  const hasUrdu = await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()

  const total = vouchers.reduce((a, v) => a + v.amount, 0)
  const cash = vouchers.filter((v) => v.voucher_type === 'CASH_PAYMENT').length
  const party = vouchers.filter((v) => v.voucher_type === 'PARTY_PAYMENT').length
  const bank = vouchers.filter((v) => v.voucher_type === 'BANK_PAYMENT').length
  const salary = vouchers.filter((v) => v.voucher_type === 'SALARY_PAYMENT').length
  const summary = `${vouchers.length} vouchers | Cash: ${cash} | Party: ${party}${bank ? ` | Bank: ${bank}` : ''}${salary ? ` | Salary: ${salary}` : ''} | Total ${formatPKRCell(total)}`

  const title = 'Payment Vouchers'
  const y = drawReportHeader(doc, { title, subtitle: options.subtitle ? `${options.subtitle} | ${summary}` : summary, operatorName: options.operatorName })
  if (hasUrdu) drawUrdu(doc, UR.paymentVouchers, pageWidth - MARGIN, 35, { align: 'right', fontSize: 11, color: C.slate })

  const ur = (text: string) => (hasUrdu ? text : undefined)
  const sorted = [...vouchers].sort((a, b) => b.voucher_date.localeCompare(a.voucher_date) || b.voucher_no.localeCompare(a.voucher_no))

  drawBilingualTable(doc, {
    startY: y,
    columnWidths: [28, 30, 28, 44, 44, 32, 32, 31],
    halign: ['left', 'left', 'left', 'left', 'left', 'left', 'left', 'right'],
    head: [
      { en: 'Voucher No', ur: ur(UR.voucherNo) },
      { en: 'Type', ur: ur(UR.voucherType) },
      { en: 'Date', ur: ur(UR.date) },
      { en: 'Payee', ur: ur(UR.payee) },
      { en: 'Purpose', ur: ur(UR.purpose) },
      { en: 'Debit Account', ur: ur(UR.debitAccount) },
      { en: 'Credit Account', ur: ur(UR.creditAccount) },
      { en: 'Amount', ur: ur(UR.amount) },
    ],
    body: sorted.map((v) => [
      { en: v.voucher_no },
      { en: `${VOUCHER_TYPE_EN[v.voucher_type].short} - ${VOUCHER_TYPE_EN[v.voucher_type].label}`, ur: ur(VOUCHER_TYPE_UR[v.voucher_type].label) },
      { en: formatDate(v.voucher_date), ur: ur(formatUrduDate(v.voucher_date)) },
      { en: v.payee_name, ur: ur(v.payee_name_ur || v.payee_name) },
      { en: v.purpose || '-', ur: ur(v.purpose_ur || '') || undefined },
      { en: v.debit_account_name || accountLabel(v.debit_account) },
      { en: v.credit_account_name || accountLabel(v.credit_account) },
      { en: formatPKRCell(v.amount), ur: ur(formatUrduAmount(v.amount)) },
    ]),
    foot: [
      { en: 'TOTAL', ur: ur(UR.total) },
      { en: `${vouchers.length} vouchers` },
      { en: '' }, { en: '' }, { en: '' }, { en: '' }, { en: '' },
      { en: formatPKRCell(total), ur: ur(formatUrduAmount(total)) },
    ],
  })

  drawReportFooter(doc, title)
  const dateStamp = new Date().toISOString().slice(0, 10)
  outputReport(doc, `glassco_payment_vouchers_${dateStamp}.pdf`)
  return doc
}

/** One voucher as a printable, signable bilingual document. */
export async function exportPaymentVoucherPDF(
  voucher: PaymentVoucher,
  options: { operatorName?: string; autoPrint?: boolean } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  const hasUrdu = await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - MARGIN * 2
  const typeEn = VOUCHER_TYPE_EN[voucher.voucher_type]
  const typeUr = VOUCHER_TYPE_UR[voucher.voucher_type]
  const ur = (text: string) => (hasUrdu ? text : undefined)
  const missing = (value: string | null | undefined): BilingualCell => (value ? { en: value } : { en: '-', ur: ur(UR.notProvided) })

  const title = typeEn.title
  let y = drawReportHeader(doc, {
    title,
    subtitle: `${voucher.voucher_no}  |  ${formatDate(voucher.voucher_date)}`,
    operatorName: options.operatorName ?? voucher.created_by ?? undefined,
  })
  if (hasUrdu) drawUrdu(doc, typeUr.title, pageWidth - MARGIN, 35, { align: 'right', fontSize: 12, color: C.slate })

  /* Amount banner */
  const bannerHeight = hasUrdu ? 22 : 16
  doc.setFillColor(...C.zebra)
  doc.setDrawColor(...C.line)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, contentWidth, bannerHeight, 1.5, 1.5, 'FD')
  doc.setFillColor(...C.crimson)
  doc.rect(MARGIN, y, 1.2, bannerHeight, 'F')
  setLatinFont(doc, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.ink)
  doc.text('Amount Paid', MARGIN + 5, y + 7.5)
  doc.setFontSize(16)
  doc.setTextColor(...C.crimson)
  doc.text(formatPKRPrecise(voucher.amount), pageWidth - MARGIN - 4, y + 8.5, { align: 'right' })
  if (hasUrdu) {
    drawUrdu(doc, UR.amountPaid, MARGIN + 5, y + 15.5, { fontSize: 10, color: C.slate })
    drawUrdu(doc, formatUrduAmount(voucher.amount), pageWidth - MARGIN - 4, y + 17, { align: 'right', fontSize: 11, color: C.crimson })
  }
  y += bannerHeight + 8

  /* Details: short fields two pairs per row, long fields full width underneath */
  const labelWidth = 36
  const pairValueWidth = contentWidth / 2 - labelWidth
  y = drawBilingualTable(doc, {
    startY: y,
    columnWidths: [labelWidth, pairValueWidth, labelWidth, pairValueWidth],
    labelColumns: [0, 2],
    body: [
      [
        { en: 'Voucher No', ur: ur(UR.voucherNo) }, { en: voucher.voucher_no },
        { en: 'Date', ur: ur(UR.date) }, { en: formatDate(voucher.voucher_date), ur: ur(formatUrduDate(voucher.voucher_date)) },
      ],
      [
        { en: 'Voucher Type', ur: ur(UR.voucherType) }, { en: `${typeEn.short} - ${typeEn.label}`, ur: ur(typeUr.label) },
        { en: 'Payee Name', ur: ur(UR.payeeName) }, { en: voucher.payee_name, ur: ur(voucher.payee_name_ur || voucher.payee_name) },
      ],
      [
        { en: 'CNIC / NTN', ur: ur(UR.cnicNtn) }, missing(voucher.cnic_ntn),
        { en: 'Reference No', ur: ur(UR.referenceNo) }, missing(voucher.reference_no),
      ],
      [
        { en: 'Debit Account', ur: ur(UR.debitAccount) }, missing(voucher.debit_account_name || (voucher.debit_account ? accountLabel(voucher.debit_account) : null)),
        { en: 'Credit Account', ur: ur(UR.creditAccount) }, missing(voucher.credit_account_name || (voucher.credit_account ? accountLabel(voucher.credit_account) : null)),
      ],
      [
        { en: 'Amount', ur: ur(UR.amount) }, { en: formatPKRPrecise(voucher.amount), ur: ur(formatUrduAmount(voucher.amount)) },
        { en: 'Created By', ur: ur(UR.createdBy) }, { en: options.operatorName || voucher.created_by || '-' },
      ],
    ],
  })
  y = drawBilingualTable(doc, {
    startY: y + 4,
    columnWidths: [labelWidth, contentWidth - labelWidth],
    labelColumns: [0],
    body: [
      [{ en: 'Address', ur: ur(UR.address) }, missing(voucher.payee_address)],
      [{ en: 'Purpose', ur: ur(UR.purpose) }, voucher.purpose ? { en: voucher.purpose, ur: ur(voucher.purpose_ur || '') || undefined } : missing(null)],
      [{ en: 'Amount in Words', ur: ur(UR.amountInWords) }, { en: voucher.amount_in_words || numberToWords(voucher.amount), ur: ur(numberToUrduWords(voucher.amount)) }],
      [{ en: 'Remarks', ur: ur(UR.remarks) }, missing(voucher.remarks)],
    ],
  })
  y += 14

  /* Signatures */
  const signatures = [
    { en: 'Prepared By', ur: UR.preparedBy },
    { en: 'Approved By', ur: UR.approvedBy },
    { en: 'Received By', ur: UR.receivedBy },
  ]
  const sigGap = 10
  const sigWidth = (contentWidth - sigGap * 2) / 3
  y = ensureRoom(doc, y + 14, 26)
  signatures.forEach((sig, i) => {
    const x = MARGIN + i * (sigWidth + sigGap)
    doc.setDrawColor(...C.ink)
    doc.setLineWidth(0.4)
    doc.line(x, y, x + sigWidth, y)
    setLatinFont(doc, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C.ink)
    doc.text(sig.en, x + sigWidth / 2, y + 5, { align: 'center' })
    let next = y + 5
    if (hasUrdu) next = drawUrdu(doc, sig.ur, x + sigWidth / 2, y + 10, { align: 'center', fontSize: 9.5, color: C.slate })
    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.text('Signature & Date', x + sigWidth / 2, next + 3.5, { align: 'center' })
    if (hasUrdu) drawUrdu(doc, UR.signatureDate, x + sigWidth / 2, next + 8, { align: 'center', fontSize: 8, color: C.muted })
  })

  drawReportFooter(doc, `${title} ${voucher.voucher_no}`)
  outputReport(doc, `glassco_${typeEn.short.toLowerCase()}_${voucher.voucher_no}.pdf`)
  return doc
}

/* ─── Payroll Payment Voucher (traditional blue Glassco layout) ──────────── */

export async function exportPayrollVoucherPDF(
  entry: PayrollEntry,
  options: { operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  const hasUrdu = await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - MARGIN * 2
  /* Traditional voucher palette: #0B3B82 navy title, #1E56A0 banner/grid blue, #EBF3FA total tint. */
  const NAVY: RGB = [11, 59, 130]
  const BLUE: RGB = [30, 86, 160]
  const TINT: RGB = [235, 243, 250]
  const ur = (text: string) => (hasUrdu ? text : undefined)
  const profile = loadCompanyProfile()

  /* 1. Masthead — centred navy company title */
  drawCompanyLogo(doc, MARGIN, 6, 15, 15)
  setBrandFont(doc)
  doc.setFontSize(20)
  doc.setTextColor(...NAVY)
  doc.text(COMPANY_HEADER.toUpperCase(), pageWidth / 2, 18, { align: 'center' })
  setLatinFont(doc, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.text('Sanitary Products Distribution & Retail Management System', pageWidth / 2, 23, { align: 'center' })

  /* 2. Blue banner — bilingual voucher title */
  let y = 28
  const bannerHeight = hasUrdu ? 13 : 9
  const bannerTitle = 'PAYROLL PAYMENT VOUCHER'
  doc.setFillColor(...BLUE)
  doc.rect(MARGIN, y, contentWidth, bannerHeight, 'F')
  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C.white)
  if (hasUrdu) {
    const enWidth = doc.getTextWidth(bannerTitle)
    const blockX = (pageWidth - (enWidth + 8 + 30)) / 2
    doc.text(bannerTitle, blockX, y + 8)
    doc.text('/', blockX + enWidth + 4, y + 8)
    drawUrdu(doc, 'پے رول واؤچر', blockX + enWidth + 9, y + 8.4, { fontSize: 11, color: C.white })
  } else {
    doc.text(bannerTitle, pageWidth / 2, y + 6.4, { align: 'center' })
  }
  y += bannerHeight + 6

  /* 3. Meta grid — two label/value pairs per row, then full-width rows */
  const labelWidth = 36
  const pairValueWidth = contentWidth / 2 - labelWidth
  const missing = (value: string | null | undefined): BilingualCell =>
    value ? { en: value } : { en: '-', ur: ur(UR.notProvided) }
  y = drawBilingualTable(doc, {
    startY: y,
    columnWidths: [labelWidth, pairValueWidth, labelWidth, pairValueWidth],
    labelColumns: [0, 2],
    body: [
      [
        { en: 'Voucher No', ur: ur(UR.voucherNo) },
        { en: entry.entry_number },
        { en: 'Payment Date', ur: ur(UR.date) },
        { en: formatDate(entry.payroll_date), ur: ur(formatUrduDate(entry.payroll_date)) },
      ],
      [
        { en: 'Payee / Employee', ur: ur(UR.payeeName) },
        { en: entry.employee_name },
        { en: 'Payment Method', ur: ur(UR.paymentMethod) },
        { en: PAYMENT_METHOD_LABELS[entry.payment_method] },
      ],
      [
        { en: 'Debit Account', ur: ur(UR.debitAccount) },
        missing(entry.expense_account ? accountLabel(entry.expense_account) : null),
        { en: 'Credit Account', ur: ur(UR.creditAccount) },
        missing(entry.payment_account ? accountLabel(entry.payment_account) : null),
      ],
    ],
  })
  y = drawBilingualTable(doc, {
    startY: y + 4,
    columnWidths: [labelWidth, contentWidth - labelWidth],
    labelColumns: [0],
    body: [
      [
        { en: 'Amount in Words', ur: ur(UR.amountInWords) },
        { en: numberToWords(entry.amount), ur: ur(numberToUrduWords(entry.amount)) },
      ],
      [{ en: 'Notes', ur: ur(UR.remarks) }, missing(entry.notes)],
      [{ en: 'Created By', ur: ur(UR.createdBy) }, { en: options.operatorName || entry.operator_name || '-' }],
    ],
  })
  y += 6

  /* 4. Items table — blue header + grid borders */
  y = ensureRoom(doc, y, 46)
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR. #', 'EMPLOYEE / PAYEE', 'COST CATEGORY', 'EMPLOYMENT TYPE', 'AMOUNT (PKR)']],
    body: [
      [
        '1',
        entry.employee_name,
        PAYROLL_TYPE_LABELS[entry.payroll_type],
        EMPLOYMENT_TYPE_LABELS[entry.employment_type],
        entry.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ],
    ],
    margin: { left: MARGIN, right: MARGIN },
    styles: { cellPadding: 3, overflow: 'linebreak', lineColor: BLUE, lineWidth: 0.35, fontSize: 8.5, valign: 'middle' },
    headStyles: { fillColor: BLUE, textColor: C.white, fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: BLUE },
    bodyStyles: { textColor: C.ink },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.08, halign: 'center' },
      1: { cellWidth: contentWidth * 0.32, halign: 'left' },
      2: { cellWidth: contentWidth * 0.22, halign: 'center' },
      3: { cellWidth: contentWidth * 0.2, halign: 'center' },
      4: { cellWidth: contentWidth * 0.18, halign: 'right' },
    },
  })
  y = getFinalY(doc) + 8

  /* 5. Totals box — light-blue tint row, right aligned */
  y = ensureRoom(doc, y, 18)
  const boxWidth = contentWidth * 0.45
  const boxX = pageWidth - MARGIN - boxWidth
  doc.setFillColor(...TINT)
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.4)
  doc.rect(boxX, y, boxWidth, 11, 'FD')
  setLatinFont(doc, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text('Total Disbursed', boxX + 4, y + 7)
  doc.text(formatPKRPrecise(entry.amount), pageWidth - MARGIN - 4, y + 7, { align: 'right' })
  y += 17

  /* 6. Signatures — Received By + Authorised Signatory */
  const signatures = [
    { en: 'Received By (Employee / Payee)', ur: UR.receivedBy },
    { en: 'Authorised Signatory', ur: UR.approvedBy },
  ]
  const sigWidth = contentWidth * 0.4
  const sigGap = contentWidth - sigWidth * 2
  y += 22
  y = ensureRoom(doc, y, 30)
  signatures.forEach((sig, i) => {
    const x = MARGIN + i * (sigWidth + sigGap)
    doc.setDrawColor(...BLUE)
    doc.setLineWidth(0.4)
    doc.line(x, y, x + sigWidth, y)
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...NAVY)
    doc.text(sig.en, x + sigWidth / 2, y + 5, { align: 'center' })
    let next = y + 5
    if (hasUrdu) next = drawUrdu(doc, sig.ur, x + sigWidth / 2, y + 10, { align: 'center', fontSize: 9, color: C.slate })
    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.text('Signature & Date', x + sigWidth / 2, next + 3.5, { align: 'center' })
    if (hasUrdu) drawUrdu(doc, UR.signatureDate, x + sigWidth / 2, next + 8, { align: 'center', fontSize: 8, color: C.muted })
  })

  /* 7. Footer — legal name + contact line under a blue rule */
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p)
    doc.setDrawColor(...BLUE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, pageHeight - 15, pageWidth - MARGIN, pageHeight - 15)
    setLatinFont(doc, 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...NAVY)
    doc.text(COMPANY_LEGAL_NAME.toUpperCase(), pageWidth / 2, pageHeight - 11, { align: 'center' })
    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.slate)
    doc.text(
      `${profile.email || DEFAULT_COMPANY.email}   |   ${profile.website || DEFAULT_COMPANY.website}   |   ${profile.phone || DEFAULT_COMPANY.phone}`,
      pageWidth / 2,
      pageHeight - 7,
      { align: 'center' }
    )
  }

  outputReport(doc, `glassco_payroll_voucher_${entry.entry_number}.pdf`)
  return doc
}

export async function exportPayrollRunSlipPDF(
  item: {
    worker_name: string;
    cost_class: string;
    employment_type: string;
    days_in_period: number;
    present_days: number;
    absent_days: number;
    leave_days: number;
    overtime_minutes: number;
    undertime_minutes: number;
    gross_earnings: number;
    total_deductions: number;
    net_pay: number;
    amount_paid: number;
    status: string;
    lines?: Array<{ wage_type_name: string; category: string; amount: number }>;
  },
  runMeta: { run_no: string; period_code: string },
  options: { operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  const hasUrdu = await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - MARGIN * 2
  const NAVY: RGB = [11, 59, 130]
  const BLUE: RGB = [30, 86, 160]

  drawCompanyLogo(doc, MARGIN, 6, 15, 15)
  setBrandFont(doc)
  doc.setFontSize(18)
  doc.setTextColor(...NAVY)
  doc.text(COMPANY_HEADER.toUpperCase(), pageWidth / 2, 18, { align: 'center' })
  setLatinFont(doc, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.text('Employee Remuneration Statement / Payslip', pageWidth / 2, 23, { align: 'center' })

  let y = 28
  doc.setFillColor(...BLUE)
  doc.rect(MARGIN, y, contentWidth, 8, 'F')
  setLatinFont(doc, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.white)
  doc.text(`PAYSLIP — ${runMeta.period_code} (${runMeta.run_no})`, pageWidth / 2, y + 5.5, { align: 'center' })
  y += 14

  const labelW = 35
  const valW = contentWidth / 2 - labelW
  y = drawBilingualTable(doc, {
    startY: y,
    columnWidths: [labelW, valW, labelW, valW],
    labelColumns: [0, 2],
    body: [
      [{ en: 'Employee Name' }, { en: item.worker_name }, { en: 'Cost Class' }, { en: item.cost_class }],
      [{ en: 'Employment' }, { en: item.employment_type }, { en: 'Attendance' }, { en: `P: ${item.present_days} | A: ${item.absent_days} | L: ${item.leave_days}` }],
      [{ en: 'Overtime' }, { en: `${Math.floor(item.overtime_minutes / 60)}h ${item.overtime_minutes % 60}m` }, { en: 'Undertime' }, { en: `${Math.floor(item.undertime_minutes / 60)}h ${item.undertime_minutes % 60}m` }],
    ],
  })

  y = ensureRoom(doc, y + 6, 40)
  const lines = item.lines || []
  const earnings = lines.filter((l) => l.category === 'EARNING')
  const deductions = lines.filter((l) => l.category === 'DEDUCTION')

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['EARNINGS COMPONENT', 'AMOUNT (PKR)', 'DEDUCTIONS COMPONENT', 'AMOUNT (PKR)']],
    body: Array.from({ length: Math.max(earnings.length, deductions.length, 1) }).map((_, idx) => [
      earnings[idx]?.wage_type_name || '-',
      earnings[idx] ? earnings[idx].amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-',
      deductions[idx]?.wage_type_name || '-',
      deductions[idx] ? deductions[idx].amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-',
    ]),
    margin: { left: MARGIN, right: MARGIN },
    styles: { cellPadding: 2.5, fontSize: 8.5 },
    headStyles: { fillColor: BLUE, textColor: C.white, fontStyle: 'bold' },
  })

  y = getFinalY(doc) + 8
  const boxW = contentWidth * 0.45
  const boxX = pageWidth - MARGIN - boxW
  doc.setFillColor(...C.greenSoft)
  doc.setDrawColor(...C.green)
  doc.rect(boxX, y, boxW, 10, 'FD')
  setLatinFont(doc, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.green)
  doc.text('NET SALARY PAYABLE', boxX + 4, y + 6.5)
  doc.text(`PKR ${item.net_pay.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth - MARGIN - 4, y + 6.5, { align: 'right' })

  drawReportFooter(doc, 'Employee Payslip')
  outputReport(doc, `payslip_${item.worker_name.replace(/\s+/g, '_')}_${runMeta.period_code}.pdf`)
  return doc
}

export async function exportDisbursementListPDF(
  disbursements: Array<{
    worker_name: string;
    cost_class: string;
    payment_method: string;
    bank_name?: string | null;
    account_iban?: string | null;
    amount: number;
    disbursement_batch_no?: string | null;
  }>,
  titleText = 'Payroll Disbursement Sheet',
  operatorName = 'System Operator'
): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - MARGIN * 2
  const BLUE: RGB = [30, 86, 160]

  let y = drawReportHeader(doc, {
    title: titleText,
    subtitle: `Total Staff: ${disbursements.length} · Bank & Cash Outflows`,
    operatorName,
  })

  autoTable(doc, {
    startY: y + 4,
    theme: 'grid',
    head: [['SR.', 'EMPLOYEE NAME', 'COST CLASS', 'PAY METHOD', 'BANK / BRANCH', 'ACCOUNT / IBAN', 'DISBURSEMENT REF', 'AMOUNT (PKR)']],
    body: disbursements.map((d, i) => [
      String(i + 1),
      d.worker_name,
      d.cost_class,
      d.payment_method,
      d.bank_name || '-',
      d.account_iban || '-',
      d.disbursement_batch_no || '-',
      d.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }),
    ]),
    foot: [['TOTAL', '', '', '', '', '', '', disbursements.reduce((s, d) => s + d.amount, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })]],
    margin: { left: MARGIN, right: MARGIN },
    styles: { cellPadding: 2.5, fontSize: 8 },
    headStyles: { fillColor: BLUE, textColor: C.white, fontStyle: 'bold' },
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      7: { halign: 'right' },
    },
  })

  drawReportFooter(doc, titleText)
  outputReport(doc, `payroll_disbursement_${ledgerDateStamp()}.pdf`)
  return doc
}

/* ─── Individual / Party Ledger Export ───────────────────────────────────── */

export interface IndividualLedgerExportInput {
  targetName: string
  accountCode?: string
  accountType?: string
  partyType?: string
  phone?: string
  address?: string
  ntn?: string
  startDate?: string
  endDate?: string
  openingBalance: number
  periodDebit: number
  periodCredit: number
  closingBalance: number
  transactions: {
    date: string
    voucherNo: string
    narration: string
    debit: number
    credit: number
    balance: number
  }[]
  operatorName?: string
}

export async function exportPartyLedgerPDF({
  targetName,
  accountCode,
  partyType,
  startDate,
  endDate,
  openingBalance,
  periodDebit,
  periodCredit,
  closingBalance,
  transactions,
  operatorName = 'Accounts Dept',
}: IndividualLedgerExportInput): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  await ensureUrduFont(doc)
  await ensureSourceSansFont(doc)
  const title = 'Individual Ledger Statement'
  const periodText = startDate || endDate
    ? `${startDate ? formatDate(startDate) : 'Inception'} to ${endDate ? formatDate(endDate) : 'Present'}`
    : 'All Recorded Transactions'

  const subtitle = `${targetName}${accountCode ? ` [${accountCode}]` : ''} | Period: ${periodText} | ${transactions.length} Transaction${transactions.length === 1 ? '' : 's'}`

  let y = drawReportHeader(doc, { title, titleUr: UR.individualLedger, subtitle, operatorName })

  // Party statements name who owes whom; generic account statements stay neutral.
  const closingLabel = partyType ? balanceAmountLabel(partyType, closingBalance) : 'Net Balance'
  const closingLabelUr =
    closingLabel === 'Amount Payable' ? UR.amountPayable
    : closingLabel === 'Amount Receivable' ? UR.amountReceivable
    : UR.netBalance

  // KPI Summary Tiles
  y = drawKpiTiles(doc, y, [
    { label: 'Opening Balance', labelUr: UR.openingBalance, value: `${formatPKRCell(Math.abs(openingBalance))} ${balanceSide(openingBalance)}`, accent: openingBalance >= 0 ? C.blue : C.amber },
    { label: 'Total Debit', labelUr: UR.totalDebit, value: formatPKRCell(periodDebit), accent: C.crimson },
    { label: 'Total Credit', labelUr: UR.totalCredit, value: formatPKRCell(periodCredit), accent: C.crimson },
    { label: closingLabel, labelUr: closingLabelUr, value: `${formatPKRCell(Math.abs(closingBalance))} ${balanceSide(closingBalance)}`, accent: closingBalance >= 0 ? C.green : C.red },
  ])

  // Table
  const tableBody: (string | { content: string; styles?: Record<string, unknown>; colSpan?: number })[][] = []

  // Opening balance row
  tableBody.push([
    startDate ? formatDate(startDate) : '—',
    '—',
    'OPENING BALANCE B/F',
    '—',
    '—',
    `${formatPKRCell(Math.abs(openingBalance))} ${openingBalance >= 0 ? 'Dr' : 'Cr'}`,
  ])

  transactions.forEach((tx) => {
    tableBody.push([
      formatDate(tx.date),
      tx.voucherNo,
      tx.narration || '—',
      tx.debit > 0 ? formatPKRCell(tx.debit) : '—',
      tx.credit > 0 ? formatPKRCell(tx.credit) : '—',
      `${formatPKRCell(Math.abs(tx.balance))} ${tx.balance >= 0 ? 'Dr' : 'Cr'}`,
    ])
  })

  autoTable(doc, {
    ...baseTableOptions(doc),
    startY: y,
    head: [['Date', 'Voucher #', 'Narration / Description', 'Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)']],
    body: tableBody,
    foot: [[
      { content: 'TOTALS & CLOSING BALANCE', colSpan: 3, styles: { fontStyle: 'bold' } },
      { content: formatPKRCell(periodDebit), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: formatPKRCell(periodCredit), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: `${formatPKRCell(Math.abs(closingBalance))} ${closingBalance >= 0 ? 'Dr' : 'Cr'}`, styles: { fontStyle: 'bold', halign: 'right' } },
    ]],
    footStyles: { fillColor: C.zebra, textColor: C.ink, fontSize: 8.5, lineWidth: { top: 0.4 }, lineColor: C.ink },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 26 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 32 },
    },
    ...urduCellHooks(doc, {
      headUr: [UR.date, UR.voucherNo, UR.narrationDescription, UR.debitPKR, UR.creditPKR, UR.balancePKR],
      onDidParse: (data) => {
        if (data.section === 'head' && data.column.index >= 3) data.cell.styles.halign = 'right'
      },
    }),
  })

  y = getFinalY(doc) + 14

  // Signatures
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2
  const signatures = [
    { en: 'Prepared By', role: 'Accounts Dept', ur: UR.accountsDept },
    { en: 'Checked By', role: 'Audit Dept', ur: UR.auditDept },
    { en: 'Authorized Signature', role: 'Management', ur: UR.management },
  ]
  const sigGap = 12
  const sigWidth = (contentWidth - sigGap * 2) / 3
  y = ensureRoom(doc, y + 14, 28)
  signatures.forEach((sig, i) => {
    const x = MARGIN + i * (sigWidth + sigGap)
    doc.setDrawColor(...C.ink)
    doc.setLineWidth(0.4)
    doc.line(x, y, x + sigWidth, y)
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C.ink)
    doc.text(sig.en, x + sigWidth / 2, y + 4.5, { align: 'center' })
    if (doc.getFontList()['Amiri'] !== undefined) {
      drawUrdu(doc, sig.ur, x + sigWidth / 2, y + 9.5, { align: 'center', fontSize: 7.5, color: C.slate, maxWidth: sigWidth - 4 })
      setLatinFont(doc, 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.muted)
      doc.text(sig.role, x + sigWidth / 2, y + 13.5, { align: 'center' })
    } else {
      setLatinFont(doc, 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.muted)
      doc.text(sig.role, x + sigWidth / 2, y + 8, { align: 'center' })
    }
  })

  drawReportFooter(doc, `${targetName} Statement`)
  outputReport(doc, `glassco_ledger_${slugForFile(targetName)}_${ledgerDateStamp()}.pdf`)
  return doc
}

/** Complete Expense Management Report export */
export async function exportExpensesReportPDF(
  expenses: Expense[],
  options: { subtitle?: string; operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  await ensureSourceSansFont(doc)

  const total = expenses.reduce((a, e) => a + (e.status !== 'CANCELLED' ? Number(e.amount) : 0), 0)
  const paidCount = expenses.filter((e) => e.status === 'PAID').length
  const unpaidCount = expenses.filter((e) => e.status === 'UNPAID').length
  const draftCount = expenses.filter((e) => e.status === 'DRAFT').length
  const summary = `${expenses.length} Records | Paid: ${paidCount} | Unpaid: ${unpaidCount} | Draft: ${draftCount} | Total ${formatPKRCell(total)}`

  const title = 'Expense Management Report'
  const y = drawReportHeader(doc, {
    title,
    subtitle: options.subtitle ? `${options.subtitle} | ${summary}` : summary,
    operatorName: options.operatorName,
  })

  const sorted = [...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.expense_number.localeCompare(a.expense_number))

  drawBilingualTable(doc, {
    startY: y,
    // Columns must fit the 269mm landscape content box (297 - 2x14 margin).
    columnWidths: [32, 24, 30, 45, 24, 38, 38, 38],
    halign: ['left', 'left', 'left', 'left', 'left', 'left', 'left', 'right'],
    head: [
      { en: 'Expense #' },
      { en: 'Date' },
      { en: 'Category' },
      { en: 'Description / Payee' },
      { en: 'Status' },
      { en: 'Debit Account' },
      { en: 'Credit Account' },
      { en: 'Amount' },
    ],
    body: sorted.map((e) => [
      { en: e.expense_number },
      { en: formatDate(e.expense_date) },
      { en: e.category },
      { en: `${e.description}${e.payee_name ? ` (${e.payee_name})` : ''}` },
      { en: e.status },
      {
        en: e.expense_account
          ? `[${e.expense_account.account_code}] ${e.expense_account.account_name}`
          : 'Expense Account',
      },
      {
        en: e.status === 'UNPAID'
          ? (e.payable_account ? `[${e.payable_account.account_code}] ${e.payable_account.account_name}` : '[2001] Accounts Payable')
          : (e.payment_account ? `[${e.payment_account.account_code}] ${e.payment_account.account_name}` : 'Cash/Bank'),
      },
      { en: formatPKRCell(e.amount) },
    ]),
    foot: [
      { en: 'TOTAL' },
      { en: `${expenses.length} entries` },
      { en: '' },
      { en: '' },
      { en: '' },
      { en: '' },
      { en: '' },
      { en: formatPKRCell(total) },
    ],
  })

  drawReportFooter(doc, title)
  const dateStamp = new Date().toISOString().slice(0, 10)
  outputReport(doc, `glassco_expense_report_${dateStamp}.pdf`)
  return doc
}

/**
 * Individual Expense Voucher printable PDF.
 *
 * Redesigned to strictly match the reference standard template (SALE INVOICE
 * blue style): navy serif brand header, #1D5298 sub-banner, bilingual meta
 * grid, dark-blue bilingual table header, #EBF3FA grand-total box, three
 * equal signature columns — with Amiri embedded so every Urdu glyph renders
 * crisply with no mojibake.
 */
export async function exportExpenseVoucherPDF(
  expense: Expense,
  options: { operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth() // 210mm
  const pageHeight = doc.internal.pageSize.getHeight() // 297mm
  const contentWidth = pageWidth - MARGIN * 2 // 182mm
  const profile = loadCompanyProfile()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  // Standard reference template tokens (SALE INVOICE blue style)
  const BLUE_HEADER: RGB = [29, 82, 152] // #1D5298
  const BLUE_LIGHT_BG: RGB = [235, 243, 250] // #EBF3FA
  const BORDER_DARK: RGB = [60, 63, 66] // #3c3f42
  const BORDER_BLUE: RGB = [29, 82, 152] // #1D5298
  const SOFT_OUTLINE: RGB = [148, 163, 184] // soft outer box outline

  // 1. Brand header — bold serif title centred in dark navy blue (#1D5298)
  const companyName = (profile.name?.trim() || COMPANY_HEADER).toUpperCase()
  setBrandFont(doc)
  doc.setFontSize(22)
  doc.setTextColor(...BLUE_HEADER)
  doc.text(companyName, pageWidth / 2, 14, { align: 'center' })

  // Thin solid blue horizontal rule beneath the primary header
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 17, pageWidth - MARGIN, 17)

  // Sub-banner: full-width #1D5298 bar with centred bold white bilingual title
  const bannerY = 19
  const bannerHeight = 8
  doc.setFillColor(...BLUE_HEADER)
  doc.roundedRect(MARGIN, bannerY, contentWidth, bannerHeight, 1, 1, 'F')

  doc.setTextColor(255, 255, 255)
  const bannerTitleEn = 'EXPENSE VOUCHER'
  const bannerTitleUr = 'واؤچر ایکسپینس'

  if (hasUrdu) {
    // Measure both runs so the EN / UR pair sits optically centred in the bar.
    doc.setFont('Amiri', 'normal')
    doc.setFontSize(10.5)
    const urW = doc.getTextWidth(bannerTitleUr)
    setLatinFont(doc, 'bold')
    doc.setFontSize(11)
    const enText = `${bannerTitleEn}  /  `
    const enW = doc.getTextWidth(enText)
    const startX = pageWidth / 2 - (enW + urW) / 2
    doc.text(enText, startX, bannerY + 5.5)
    drawUrdu(doc, bannerTitleUr, startX + enW, bannerY + 5.5, {
      fontSize: 10.5,
      color: [255, 255, 255],
    })
  } else {
    setLatinFont(doc, 'bold')
    doc.setFontSize(11)
    doc.text(bannerTitleEn, pageWidth / 2, bannerY + 5.5, { align: 'center' })
  }

  // 2. Meta details: left payee block + right bilingual key/value list
  const metaY = bannerY + bannerHeight + 5 // 32mm

  // Left block — PAYEE / VENDOR: / وصول کنندہ:
  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  const payeeLabelEn = 'PAYEE / VENDOR: / '
  doc.text(payeeLabelEn, MARGIN, metaY + 3.5)
  if (hasUrdu) {
    drawUrdu(doc, 'وصول کنندہ:', MARGIN + doc.getTextWidth(payeeLabelEn), metaY + 3.5, {
      fontSize: 8.5,
      color: C.slate,
    })
  }

  // Payee name — bold navy (#1D5298)
  const payeeName = expense.payee_name?.trim() || expense.party?.name?.trim() || 'Counter / General Payee'
  setBrandFont(doc)
  doc.setFontSize(11)
  doc.setTextColor(...BLUE_HEADER)
  doc.text(payeeName, MARGIN, metaY + 9)

  // Address / sub details
  setLatinFont(doc, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  let leftCurY = metaY + 13.5
  const subDetails = [expense.party?.address?.trim(), expense.party?.phone?.trim()]
    .filter((v): v is string => Boolean(v))
    .join('  •  ')
  if (subDetails) {
    const lines = doc.splitTextToSize(subDetails, contentWidth * 0.5) as string[]
    for (const line of lines.slice(0, 2)) {
      doc.text(line, MARGIN, leftCurY)
      leftCurY += 4.2
    }
  }

  // Category & ref notes
  doc.text(`Category: ${expense.category}`, MARGIN, leftCurY)
  leftCurY += 4.2
  if (expense.notes?.trim()) {
    const noteLines = doc.splitTextToSize(`Ref Note: ${expense.notes.trim()}`, contentWidth * 0.5) as string[]
    for (const line of noteLines.slice(0, 2)) {
      doc.text(line, MARGIN, leftCurY)
      leftCurY += 4.2
    }
  }

  // Right block — clean 2-column right-aligned bilingual key/value list
  const metaRightWidth = 78
  const metaRightX = pageWidth - MARGIN - metaRightWidth
  const contactPhone = profile.phone?.trim() || DEFAULT_COMPANY.phone
  const contactTel = profile.telephone?.trim() || DEFAULT_COMPANY.telephone

  const metaItems = [
    { labelEn: 'Mob / ', labelUr: 'موبائل نمبر:', value: contactPhone },
    { labelEn: 'Tel / ', labelUr: 'ٹیلی فون:', value: contactTel },
    { labelEn: 'Expense No / ', labelUr: 'واؤچر نمبر:', value: expense.expense_number },
    { labelEn: 'Date / ', labelUr: 'تاریخ:', value: formatDate(expense.expense_date) },
    { labelEn: 'Payment Method / ', labelUr: 'طریقہ ادائیگی:', value: expense.payment_method },
    { labelEn: 'Page / ', labelUr: 'صفحہ:', value: '1 of 1' },
  ]

  let curMetaY = metaY + 2
  for (const item of metaItems) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.slate)
    doc.text(item.labelEn, metaRightX, curMetaY)
    if (hasUrdu) {
      drawUrdu(doc, item.labelUr, metaRightX + doc.getTextWidth(item.labelEn), curMetaY, {
        fontSize: 7.5,
        color: C.slate,
      })
    }
    setNumericFont(doc, true)
    doc.setFontSize(8)
    doc.setTextColor(9, 9, 11)
    doc.text(item.value, pageWidth - MARGIN, curMetaY, { align: 'right' })
    curMetaY += 4
  }

  const tableStartY = Math.max(leftCurY + 2, curMetaY + 3, metaY + 27)

  // Accounts descriptions
  const debitDesc = expense.expense_account
    ? `[${expense.expense_account.account_code}] ${expense.expense_account.account_name}`
    : 'Debit Expense Account'
  const creditDesc =
    expense.status === 'UNPAID'
      ? (expense.payable_account ? `[${expense.payable_account.account_code}] ${expense.payable_account.account_name}` : '[2001] Accounts Payable')
      : (expense.payment_account ? `[${expense.payment_account.account_code}] ${expense.payment_account.account_name}` : 'Cash/Bank')

  // 4. Line items table — #1D5298 bilingual header bar, dark blue column
  // borders wrapped in a soft outer box outline, clean ~6px cell padding.
  // Column widths sum to 182mm (contentWidth). ACCOUNTS gets extra room so
  // the DR/CR account pairs stay on one line instead of wrapping awkwardly.
  const columnWidths = [11, 28, 32, 40, 41, 30] // total 182mm
  const halign: ('left' | 'center' | 'right')[] = ['center', 'center', 'left', 'left', 'left', 'right']

  const columnStyles: UserOptions['columnStyles'] = {}
  columnWidths.forEach((w, i) => {
    columnStyles[i] = {
      cellWidth: w,
      halign: halign[i],
    }
  })

  const headerEn = ['SR. #', 'CATEGORY', 'PAYEE / VENDOR', 'DESCRIPTION', 'ACCOUNTS', 'AMOUNT (PKR)']
  const headerUr = ['نمبر', 'کیٹیگری', 'وصول کنندہ', 'تفصیل', 'اکاؤنٹس', 'رقم']

  autoTable(doc, {
    startY: tableStartY,
    theme: 'grid',
    head: [headerEn],
    body: [
      [
        '1',
        expense.category,
        payeeName,
        expense.description || 'General Business Expense',
        `DR: ${debitDesc}\nCR: ${creditDesc}`,
        (expense.amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ],
    ],
    margin: { left: MARGIN, right: MARGIN, bottom: 28 },
    styles: {
      cellPadding: 1.6, // ≈ 6px — clean padding that avoids crushed or awkwardly wrapped glyphs
      overflow: 'linebreak',
      fontSize: 8,
      textColor: [9, 9, 11],
      lineColor: BORDER_BLUE, // dark blue column borders
      lineWidth: 0.25,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BLUE_HEADER,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      valign: 'top',
      minCellHeight: 11,
    },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 0 || data.column.index === 5) {
          data.cell.styles.font = 'courier'
        }
        if (data.column.index === 5) {
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
    didDrawCell: (data) => {
      // Urdu half of each bilingual header, drawn with the embedded Amiri face
      // so Arabic-script glyphs stay crisp (never the base-14 fonts, which have
      // no Arabic coverage and would emit mojibake).
      if (data.section !== 'head' || !hasUrdu) return
      const urLabel = headerUr[data.column.index]
      if (!urLabel) return
      const align = halign[data.column.index]
      const pad = 1.6
      const x =
        align === 'center'
          ? data.cell.x + data.cell.width / 2
          : align === 'right'
            ? data.cell.x + data.cell.width - pad
            : data.cell.x + pad
      drawUrdu(doc, urLabel, x, data.cell.y + data.cell.height - 2.6, {
        align,
        fontSize: 7,
        color: [255, 255, 255],
      })
    },
  })

  // Soft outer box outline around the dark blue grid
  doc.setDrawColor(...SOFT_OUTLINE)
  doc.setLineWidth(0.5)
  doc.rect(MARGIN, tableStartY, contentWidth, getFinalY(doc) - tableStartY, 'S')

  // 5. Amount in words (left) + totals summary block (bottom right)
  const finalY = getFinalY(doc) + 6

  // Left block — AMOUNT IN WORDS / رقم بحروف with the formatted currency text below
  const wordsBoxWidth = 100
  const wordsBoxHeight = 23
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, finalY, wordsBoxWidth, wordsBoxHeight, 'FD')

  setLatinFont(doc, 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLUE_HEADER)
  const wordsLabelEn = 'AMOUNT IN WORDS / '
  doc.text(wordsLabelEn, MARGIN + 3, finalY + 4.5)
  if (hasUrdu) {
    drawUrdu(doc, 'رقم بحروف', MARGIN + 3 + doc.getTextWidth(wordsLabelEn), finalY + 4.5, {
      fontSize: 7.5,
      color: BLUE_HEADER,
    })
  }

  setLatinFont(doc, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  const amountWords = numberToWords(expense.amount || 0)
  const splitWords = doc.splitTextToSize(amountWords, wordsBoxWidth - 6) as string[]
  let wordsY = finalY + 9
  for (const line of splitWords.slice(0, 2)) {
    doc.text(line, MARGIN + 3, wordsY)
    wordsY += 3.8
  }
  if (hasUrdu) {
    // Urdu rendering of the amount, right-aligned inside the words box
    drawUrdu(doc, numberToUrduWords(expense.amount || 0), MARGIN + wordsBoxWidth - 3, wordsY + 1.6, {
      align: 'right',
      fontSize: 8,
      color: BLUE_HEADER,
      maxWidth: wordsBoxWidth - 10,
    })
  }

  // Right block — light blue fill (#EBF3FA) with a solid blue border (#1D5298)
  const summaryBoxWidth = 80
  const summaryBoxX = pageWidth - MARGIN - summaryBoxWidth
  const summaryBoxHeight = 10
  const formattedAmt = `PKR ${(expense.amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  doc.setFillColor(...BLUE_LIGHT_BG)
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.rect(summaryBoxX, finalY, summaryBoxWidth, summaryBoxHeight, 'FD')

  const totalLabelY = finalY + 6.2
  doc.setTextColor(...BLUE_HEADER)
  if (hasUrdu) {
    const totalEn = 'Total Amount ('
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.text(totalEn, summaryBoxX + 3, totalLabelY)
    const totalEnW = doc.getTextWidth(totalEn)
    doc.setFont('Amiri', 'normal')
    doc.setFontSize(8.5)
    const totalUrW = doc.getTextWidth('کل رقم')
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.text(')', summaryBoxX + 3 + totalEnW + totalUrW, totalLabelY)
    drawUrdu(doc, 'کل رقم', summaryBoxX + 3 + totalEnW, totalLabelY, {
      fontSize: 8.5,
      color: BLUE_HEADER,
    })
  } else {
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.text('Total Amount', summaryBoxX + 3, totalLabelY)
  }

  setNumericFont(doc, true)
  doc.setFontSize(9.5)
  doc.setTextColor(...BLUE_HEADER)
  doc.text(formattedAmt, summaryBoxX + summaryBoxWidth - 3, totalLabelY, { align: 'right' })

  // 6. Signatures — three equal-width columns
  const sigY = pageHeight - 38
  const sigColW = contentWidth / 3
  const signatureCols = [
    { en: 'Prepared By', ur: 'تیار کنندہ' },
    { en: 'Approved By', ur: 'منظور کنندہ' },
    { en: 'Received By', ur: 'وصول کنندہ' },
  ]

  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, sigY, pageWidth - MARGIN, sigY)

  signatureCols.forEach((sig, i) => {
    const cx = MARGIN + sigColW * i + sigColW / 2
    setLatinFont(doc, 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(9, 9, 11)
    doc.text(sig.en, cx, sigY + 4.5, { align: 'center' })
    if (hasUrdu) {
      drawUrdu(doc, sig.ur, cx, sigY + 9, { align: 'center', fontSize: 8.5, color: [9, 9, 11] })
    }
  })

  // 7. Bottom footer — thin top border, centred legal name and contact line
  const totalPages = doc.getNumberOfPages()
  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.setPage(pNum)

    doc.setDrawColor(...BORDER_DARK)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, pageHeight - 15, pageWidth - MARGIN, pageHeight - 15)

    setLatinFont(doc, 'bold')
    doc.setFontSize(8)
    doc.setTextColor(24, 24, 27)
    doc.text(COMPANY_LEGAL_NAME.toUpperCase(), pageWidth / 2, pageHeight - 11, { align: 'center' })

    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(82, 82, 82)
    const contactLine = `${profile.email || DEFAULT_COMPANY.email}   |   ${profile.website || DEFAULT_COMPANY.website}   |   ${profile.phone || DEFAULT_COMPANY.phone}`
    doc.text(contactLine, pageWidth / 2, pageHeight - 7, { align: 'center' })
  }

  outputReport(doc, `expense_voucher_${expense.expense_number}.pdf`)
  return doc
}

/** Product Purchase Cost and Profit Margin Summary PDF Report */
export async function exportProductCostMarginReportPDF(
  summaries: ProductCostMarginSummary[],
  options: { subtitle?: string; operatorName?: string; costingMethod?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  const title = 'Product Purchase Cost & Profit Margin Analysis'
  const methodLabel = options.costingMethod ? ` [Costing: ${options.costingMethod}]` : ''
  const y = drawReportHeader(doc, {
    title: `${title}${methodLabel}`,
    subtitle: options.subtitle ?? `Comprehensive Unit Cost, Gross Profit & Markup Performance (${summaries.length} Products)`,
    operatorName: options.operatorName,
  })

  const totalCostValue = summaries.reduce((sum, s) => sum + s.effective_cost, 0)
  const totalSellingValue = summaries.reduce((sum, s) => sum + s.selling_price, 0)
  const totalProfitValue = summaries.reduce((sum, s) => sum + s.gross_profit, 0)
  const avgMargin = totalSellingValue > 0 ? (totalProfitValue / totalSellingValue) * 100 : 0
  const avgMarkup = totalCostValue > 0 ? (totalProfitValue / totalCostValue) * 100 : 0

  drawBilingualTable(doc, {
    startY: y,
    columnWidths: [26, 45, 28, 28, 28, 28, 28, 28, 31],
    halign: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left'],
    head: [
      { en: 'SKU' },
      { en: 'Product Name' },
      { en: 'Category' },
      { en: 'Purchase Rate' },
      { en: 'Unit Cost' },
      { en: 'Selling Price' },
      { en: 'Gross Profit' },
      { en: 'Margin / Markup' },
      { en: 'Latest Supplier' },
    ],
    body: summaries.map((s) => [
      { en: s.sku },
      { en: s.product_name },
      { en: s.category },
      { en: s.latest_purchase_rate > 0 ? formatPKRCell(s.latest_purchase_rate) : '—' },
      { en: formatPKRCell(s.effective_cost) },
      { en: formatPKRCell(s.selling_price) },
      { en: `${s.gross_profit >= 0 ? '+' : ''}${formatPKRCell(s.gross_profit)}` },
      { en: `${s.gross_margin_percent.toFixed(1)}% / ${s.markup_percent.toFixed(1)}%` },
      { en: s.latest_supplier_name || '—' },
    ]),
    foot: [
      { en: 'SUMMARY' },
      { en: `${summaries.length} products` },
      { en: '' },
      { en: '' },
      { en: formatPKRCell(totalCostValue) },
      { en: formatPKRCell(totalSellingValue) },
      { en: `${totalProfitValue >= 0 ? '+' : ''}${formatPKRCell(totalProfitValue)}` },
      { en: `${avgMargin.toFixed(1)}% / ${avgMarkup.toFixed(1)}%` },
      { en: '' },
    ],
  })

  drawReportFooter(doc, title)
  const dateStamp = new Date().toISOString().slice(0, 10)
  outputReport(doc, `cost_profit_margin_report_${dateStamp}.pdf`)
  return doc
}

/** Product Purchases History PDF Report — Redesigned to match Sale Invoice template aesthetics */
export async function exportProductPurchasesReportPDF(
  purchases: ProductPurchase[],
  options: { subtitle?: string; operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('landscape')
  await ensureUrduFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth() // 297mm
  const pageHeight = doc.internal.pageSize.getHeight() // 210mm
  const contentWidth = pageWidth - MARGIN * 2 // 269mm
  const profile = loadCompanyProfile()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  // Invoice Branding Tokens
  const BLUE_HEADER: RGB = [27, 85, 165] // #1b55a5
  const BLUE_LIGHT_BG: RGB = [235, 243, 250] // #ebf3fa
  const BORDER_DARK: RGB = [60, 63, 66] // #3c3f42
  const BORDER_BLUE: RGB = [27, 85, 165] // #1b55a5

  // 1. Company Header (Centered, bold serif)
  const companyName = (profile.name?.trim() || COMPANY_HEADER).toUpperCase()
  setBrandFont(doc)
  doc.setFontSize(22)
  doc.setTextColor(9, 9, 11)
  doc.text(companyName, pageWidth / 2, 14, { align: 'center' })

  // Thin blue separator rule
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 17, pageWidth - MARGIN, 17)

  // 2. Solid Blue Title Banner
  const bannerY = 19
  const bannerHeight = 7.5
  doc.setFillColor(...BLUE_HEADER)
  doc.roundedRect(MARGIN, bannerY, contentWidth, bannerHeight, 1, 1, 'F')

  setLatinFont(doc, 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(255, 255, 255)
  const bannerTitleEn = 'PURCHASE ORDERS & LANDED COST REPORT'
  const bannerTitleUr = 'پرچیز آرڈر رپورٹ'

  if (hasUrdu) {
    const enW = doc.getTextWidth(bannerTitleEn + '  /  ')
    const startX = pageWidth / 2 - (enW + 28) / 2
    doc.text(bannerTitleEn + '  /  ', startX, bannerY + 5.2)
    drawUrdu(doc, bannerTitleUr, startX + enW, bannerY + 5.2, {
      fontSize: 10,
      color: [255, 255, 255],
    })
  } else {
    doc.text(bannerTitleEn, pageWidth / 2, bannerY + 5.2, { align: 'center' })
  }

  // 3. Metadata Header Block
  const metaY = bannerY + bannerHeight + 3.5
  const generatedDate = new Date().toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const generatedTime = new Date().toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase()
  const operator = options.operatorName || 'Purchase Dept'
  const subtitleInfo = options.subtitle || `Procurement History (${purchases.length} Orders)`

  // Left side: Subtitle / Scope
  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  doc.text('REPORT SCOPE:', MARGIN, metaY + 3.5)
  setLatinFont(doc, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(subtitleInfo, MARGIN + 28, metaY + 3.5)

  // Right side: Aligned metadata block
  const metaRightWidth = 72
  const metaRightX = pageWidth - MARGIN - metaRightWidth

  const metaItems = [
    { label: 'Generated Date', value: `${generatedDate}, ${generatedTime}` },
    { label: 'Operator', value: operator },
    { label: 'Page No', value: 'Page 1 of 1' },
  ]

  let curMetaY = metaY + 2
  for (const item of metaItems) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.slate)
    doc.text(item.label, metaRightX, curMetaY)
    setNumericFont(doc, true)
    doc.setFontSize(8)
    doc.setTextColor(9, 9, 11)
    doc.text(item.value, pageWidth - MARGIN, curMetaY, { align: 'right' })
    curMetaY += 3.8
  }

  const tableStartY = Math.max(metaY + 14, curMetaY + 1)

  // Calculations
  const totalQty = purchases.reduce((sum, p) => sum + (p.quantity || 0), 0)
  const totalSubtotal = purchases.reduce((sum, p) => sum + (p.purchase_subtotal_pkr || 0), 0)
  const totalDiscounts = purchases.reduce((sum, p) => sum + (p.discount_pkr || 0), 0)
  const totalTaxFreight = purchases.reduce(
    (sum, p) => sum + ((p.tax_amount_pkr || 0) + (p.additional_cost_pkr || 0)),
    0
  )
  const grandLandedCost = purchases.reduce((sum, p) => sum + (p.purchase_total_pkr || 0), 0)

  // 4. Main Data Table with Recalibrated Column Widths (sum = 269mm = contentWidth)
  //    Landscape A4 (297mm) − 2×14mm margins = 269mm
  //    Courier 7pt metrics ≈ 1.48mm/char; Helvetica proportional ≈ 1.5mm/char avg.
  //    Purchase # "PUR-2026-00002" = 14 chars × 1.48 + 4mm padding ≈ 25mm → 30mm safe
  //    Date "13 Oct 2026" = 11 chars × 1.48 + 4mm ≈ 20mm → 23mm safe
  //    Status "CONFIRMED" (bold) ≈ 9 chars × 1.6 + 4mm ≈ 18mm → 20mm safe
  const columnWidths = [8, 30, 23, 40, 51, 13, 21, 22, 17, 24, 20] // total 269mm
  const halign: ('left' | 'center' | 'right')[] = [
    'center', // SR.#
    'center', // PURCHASE #
    'center', // DATE
    'left',   // SUPPLIER
    'left',   // PRODUCT NAME
    'right',  // QTY
    'right',  // RATE
    'right',  // SUBTOTAL
    'right',  // DISCOUNT
    'right',  // TAX/FREIGHT
    'center', // STATUS
  ]

  // Columns that should NOT wrap (codes, dates, numbers, status)
  const noWrapCols = new Set([0, 1, 2, 5, 6, 7, 8, 9, 10])

  const columnStyles: UserOptions['columnStyles'] = {}
  columnWidths.forEach((w, i) => {
    columnStyles[i] = {
      cellWidth: w,
      halign: halign[i],
      // Supplier & Product Name: allow clean line-breaks; all others: ellipsize to one line
      overflow: noWrapCols.has(i) ? 'ellipsize' : 'linebreak',
    }
  })

  autoTable(doc, {
    startY: tableStartY,
    theme: 'grid',
    head: [
      [
        'SR.#',
        'PURCHASE #',
        'DATE',
        'SUPPLIER',
        'PRODUCT NAME',
        'QTY',
        'RATE (PKR)',
        'SUBTOTAL',
        'DISC.',
        'TAX / FREIGHT',
        'STATUS',
      ],
    ],
    body: purchases.map((p, idx) => [
      String(idx + 1),
      p.purchase_number,
      formatDate(p.purchase_date),
      p.supplier_name,
      p.product_name,
      `${p.quantity} ${p.unit_of_measure || 'PCS'}`,
      Math.round(p.purchase_rate).toLocaleString('en-PK'),
      Math.round(p.purchase_subtotal_pkr).toLocaleString('en-PK'),
      p.discount_pkr > 0 ? `-${Math.round(p.discount_pkr).toLocaleString('en-PK')}` : '—',
      Math.round((p.tax_amount_pkr || 0) + (p.additional_cost_pkr || 0)).toLocaleString('en-PK'),
      p.status.toUpperCase(),
    ]),
    foot: [
      [
        '',
        '',
        '',
        `${purchases.length} Orders`,
        `${[...new Set(purchases.map(p => p.product_name))].length} Products`,
        totalQty.toLocaleString('en-PK'),
        '',
        Math.round(totalSubtotal).toLocaleString('en-PK'),
        totalDiscounts > 0 ? `-${Math.round(totalDiscounts).toLocaleString('en-PK')}` : '—',
        Math.round(totalTaxFreight).toLocaleString('en-PK'),
        '',
      ],
    ],
    margin: { left: MARGIN, right: MARGIN, bottom: 28 },
    styles: {
      cellPadding: { horizontal: 2.5, vertical: 2 },
      overflow: 'ellipsize',
      fontSize: 7,
      textColor: [9, 9, 11],
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      valign: 'middle',
      minCellHeight: 5.5,
    },
    headStyles: {
      fillColor: BLUE_HEADER,
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: 'bold',
      lineColor: [29, 82, 152],
      lineWidth: 0.3,
      halign: 'center',
      valign: 'middle',
      cellPadding: { horizontal: 2, vertical: 2.5 },
    },
    footStyles: {
      fillColor: BLUE_LIGHT_BG,
      textColor: BLUE_HEADER,
      fontSize: 7,
      fontStyle: 'bold',
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // very subtle slate-50
    },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === 'body') {
        // Monospace font for codes, dates, and numeric columns
        if ([1, 2, 5, 6, 7, 8, 9].includes(data.column.index)) {
          data.cell.styles.font = 'courier'
          data.cell.styles.fontSize = 7
        }
        if (data.column.index === 10) {
          // Status badge styling
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fontSize = 6.5
          const val = String(data.cell.raw).toUpperCase()
          if (val === 'CONFIRMED') {
            data.cell.styles.textColor = [22, 163, 74]  // green-600
          } else if (val === 'DRAFT') {
            data.cell.styles.textColor = [217, 119, 6]  // amber-600
          } else if (val === 'CANCELLED') {
            data.cell.styles.textColor = [148, 163, 184] // slate-400
          } else {
            data.cell.styles.textColor = [220, 38, 38]   // red-600
          }
        }
        // SR.# and index numbers
        if (data.column.index === 0) {
          data.cell.styles.font = 'courier'
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = [100, 116, 139] // slate-500
        }
      }
      if (data.section === 'foot') {
        // Totals row: monospace for numeric columns
        if ([5, 7, 8, 9].includes(data.column.index)) {
          data.cell.styles.font = 'courier'
        }
        // Summary labels for supplier/product counts
        if ([3, 4].includes(data.column.index)) {
          data.cell.styles.textColor = [71, 85, 105] // slate-600
          data.cell.styles.fontStyle = 'normal'
          data.cell.styles.fontSize = 6.5
        }
      }
    },
  })

  // 5. Summary & Totals Block (Bottom Right, matching invoice style)
  let finalY = getFinalY(doc) + 4
  const neededSummaryHeight = 46

  if (finalY + neededSummaryHeight > pageHeight - 24) {
    doc.addPage()
    finalY = 16
  }

  // Left side of bottom section: Order Count Summary Chip
  doc.setFillColor(...BLUE_LIGHT_BG)
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, finalY, 110, 10, 1.5, 1.5, 'FD')

  setLatinFont(doc, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...BLUE_HEADER)
  doc.text(
    `TOTAL ORDERS: ${purchases.length}   |   TOTAL QUANTITY: ${totalQty.toLocaleString()} UNITS`,
    MARGIN + 5,
    finalY + 6.2
  )

  // Right side: Bordered blue container summary
  const summaryBoxWidth = 84
  const summaryBoxX = pageWidth - MARGIN - summaryBoxWidth
  const summaryRows = [
    { label: 'Total Subtotal', value: `PKR ${Math.round(totalSubtotal).toLocaleString()}` },
    { label: 'Total Discount', value: totalDiscounts > 0 ? `-PKR ${Math.round(totalDiscounts).toLocaleString()}` : 'PKR 0' },
    { label: 'Total Tax / Freight', value: `PKR ${Math.round(totalTaxFreight).toLocaleString()}` },
  ]

  let sY = finalY
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...BORDER_DARK)
  doc.setLineWidth(0.2)
  doc.rect(summaryBoxX, sY, summaryBoxWidth, summaryRows.length * 5.2, 'FD')

  for (const row of summaryRows) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(15, 23, 42)
    doc.text(row.label, summaryBoxX + 3, sY + 3.8)

    setNumericFont(doc, true)
    doc.setFontSize(8)
    doc.setTextColor(9, 9, 11)
    doc.text(row.value, summaryBoxX + summaryBoxWidth - 3, sY + 3.8, { align: 'right' })
    sY += 5.2
  }

  // Grand Total Box in Soft Blue (#EBF3FA)
  const grandBoxHeight = 7.5
  doc.setFillColor(...BLUE_LIGHT_BG)
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.rect(summaryBoxX, sY, summaryBoxWidth, grandBoxHeight, 'FD')

  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BLUE_HEADER)
  doc.text('Grand Total (Landed Cost)', summaryBoxX + 3, sY + 5)

  setNumericFont(doc, true)
  doc.setFontSize(9)
  doc.setTextColor(...BLUE_HEADER)
  doc.text(`PKR ${Math.round(grandLandedCost).toLocaleString()}`, summaryBoxX + summaryBoxWidth - 3, sY + 5, {
    align: 'right',
  })

  // 6. Signatures Section
  const sigY = Math.max(sY + grandBoxHeight + 8, pageHeight - 24)
  const sigWidth = 70

  // Prepared By line
  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, sigY, MARGIN + sigWidth, sigY)
  setLatinFont(doc, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(9, 9, 11)
  doc.text('Prepared By', MARGIN + sigWidth / 2, sigY + 3.8, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'تیار کنندہ', MARGIN + sigWidth / 2, sigY + 8, { align: 'center', fontSize: 8, color: [9, 9, 11] })
  }

  // Authorised Signatory line
  doc.line(pageWidth - MARGIN - sigWidth, sigY, pageWidth - MARGIN, sigY)
  doc.text('Authorised Signatory', pageWidth - MARGIN - sigWidth / 2, sigY + 3.8, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'مجاز دستخط', pageWidth - MARGIN - sigWidth / 2, sigY + 8, { align: 'center', fontSize: 8, color: [9, 9, 11] })
  }

  // 7. Footer / Contact Banner (Very bottom of page)
  const totalPages = doc.getNumberOfPages()
  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.setPage(pNum)

    // Footer hairline
    doc.setDrawColor(...BORDER_DARK)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, pageHeight - 9.5, pageWidth - MARGIN, pageHeight - 9.5)

    setLatinFont(doc, 'bold')
    doc.setFontSize(7)
    doc.setTextColor(24, 24, 27)
    doc.text(COMPANY_LEGAL_NAME.toUpperCase(), MARGIN, pageHeight - 6.5)

    setLatinFont(doc, 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(82, 82, 82)
    const contactLine = `${profile.email || DEFAULT_COMPANY.email}   |   ${profile.website || DEFAULT_COMPANY.website}   |   ${profile.phone || DEFAULT_COMPANY.phone}`
    doc.text(contactLine, pageWidth / 2, pageHeight - 6.5, { align: 'center' })

    setNumericFont(doc)
    doc.setFontSize(7)
    doc.text(`Page ${pNum} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 6.5, { align: 'right' })
  }

  const dateStamp = new Date().toISOString().slice(0, 10)
  outputReport(doc, `purchase_orders_landed_cost_report_${dateStamp}.pdf`)
  return doc
}

/* ─── Quotation (customer-facing A4 document) ────────────────────────────── */

/**
 * Professional A4 quotation PDF for the Quotations module.
 *
 * Customer-facing ONLY: internal estimated cost, profit, margin and internal
 * notes are never read here (the allow-listed customer view lives in
 * src/lib/quotation-print.ts). The document is permanently labelled
 * "QUOTATION — NOT A FINAL INVOICE" and carries signature/date spaces for
 * both the customer and the company.
 */
/**
 * Professional A4 quotation PDF for the Quotations module.
 * Redesigned to strictly match the reference standard template (SALE INVOICE blue style).
 */
export async function exportQuotationPDF(
  quotation: Quotation,
  options: { operatorName?: string } = {}
): Promise<jsPDF> {
  const doc = createReportDoc('portrait')
  await ensureUrduFont(doc)
  await ensureSourceSansFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth() // 210mm
  const pageHeight = doc.internal.pageSize.getHeight() // 297mm
  const contentWidth = pageWidth - MARGIN * 2 // 182mm
  const profile = loadCompanyProfile()
  const hasUrdu = doc.getFontList()['Amiri'] !== undefined

  // Standard Template Blue Tokens
  const BLUE_HEADER: RGB = [29, 82, 152] // #1D5298
  const BLUE_LIGHT_BG: RGB = [235, 243, 250] // #EBF3FA
  const BORDER_DARK: RGB = [60, 63, 66] // #3c3f42
  const BORDER_BLUE: RGB = [29, 82, 152] // #1D5298

  // 1. Header: Company Title (Centered at top)
  const companyName = (profile.name?.trim() || COMPANY_HEADER).toUpperCase()
  setBrandFont(doc)
  doc.setFontSize(22)
  doc.setTextColor(9, 9, 11)
  doc.text(companyName, pageWidth / 2, 14, { align: 'center' })

  // Thin blue separator rule
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 17, pageWidth - MARGIN, 17)

  // Sub-banner: Dark blue background (#1D5298) with white bold centered text: "QUOTATION / کوٹیشن"
  const bannerY = 19
  const bannerHeight = 8
  doc.setFillColor(...BLUE_HEADER)
  doc.roundedRect(MARGIN, bannerY, contentWidth, bannerHeight, 1, 1, 'F')

  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  const bannerTitleEn = 'QUOTATION'
  const bannerTitleUr = 'کوٹیشن'

  if (hasUrdu) {
    const enW = doc.getTextWidth(bannerTitleEn + '  /  ')
    const startX = pageWidth / 2 - (enW + 18) / 2
    doc.text(bannerTitleEn + '  /  ', startX, bannerY + 5.5)
    drawUrdu(doc, bannerTitleUr, startX + enW, bannerY + 5.5, {
      fontSize: 10.5,
      color: [255, 255, 255],
    })
  } else {
    doc.text(bannerTitleEn, pageWidth / 2, bannerY + 5.5, { align: 'center' })
  }

  // 2. Meta Information Section: Two-column grid layout
  const metaY = bannerY + bannerHeight + 5

  // Left column: Customer details (TO / وصول کنندہ)
  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  doc.text('TO:', MARGIN, metaY + 3.5)
  if (hasUrdu) {
    drawUrdu(doc, 'وصول کنندہ', MARGIN + doc.getTextWidth('TO:  '), metaY + 3.5, { fontSize: 8.5, color: [...C.slate] as [number, number, number] })
  }
  setLatinFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(9, 9, 11)
  doc.text(quotation.customer_name || 'Counter Customer', MARGIN, metaY + 9)

  setLatinFont(doc, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.slate)
  let leftCurY = metaY + 13.5
  if (quotation.customer_address?.trim()) {
    const lines = doc.splitTextToSize(quotation.customer_address.trim(), contentWidth * 0.5) as string[]
    for (const line of lines.slice(0, 2)) {
      doc.text(line, MARGIN, leftCurY)
      leftCurY += 4.2
    }
  }
  if (quotation.customer_phone?.trim()) {
    doc.text(quotation.customer_phone.trim(), MARGIN, leftCurY)
    leftCurY += 4.2
  }

  // Right column: Quotation details (Mob, Tel, QTN No, Date, Page 1 of 1)
  const metaRightWidth = 75
  const metaRightX = pageWidth - MARGIN - metaRightWidth
  const contactPhone = profile.phone?.trim() || DEFAULT_COMPANY.phone
  const contactTel = profile.telephone?.trim() || DEFAULT_COMPANY.telephone

  const metaItems = [
    { label: 'Mob', value: contactPhone },
    { label: 'Tel', value: contactTel },
    { label: 'QTN No', value: quotation.quotation_number },
    { label: 'Date', value: formatDate(quotation.quotation_date) },
    ...(quotation.valid_until ? [{ label: 'Valid Until', value: formatDate(quotation.valid_until) }] : []),
    { label: 'Page', value: '1 of 1' },
  ]

  let curMetaY = metaY + 2
  for (const item of metaItems) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.slate)
    doc.text(item.label, metaRightX, curMetaY)
    setNumericFont(doc, true)
    doc.setFontSize(8)
    doc.setTextColor(9, 9, 11)
    doc.text(item.value, pageWidth - MARGIN, curMetaY, { align: 'right' })
    curMetaY += 4
  }

  const tableStartY = Math.max(leftCurY + 2, curMetaY + 2, metaY + 24)

  // 3. Line Items Table (Tax% column removed, matching the reference grid)
  const items = (quotation.items ?? []).map((item, index) => ({
    index: index + 1,
    name: item.product_name,
    code: item.product_code ?? '',
    unit: item.unit || 'PCS',
    quantity: Number(item.quantity) || 0,
    price: Number(item.unit_price_pkr) || 0,
    discount: Number(item.discount_percent) || 0,
    lineTotal: Number(item.line_total_pkr) || 0,
  }))
  const totalQty = items.reduce((a, i) => a + i.quantity, 0)
  const grossLinesTotal = items.reduce((a, i) => a + (i.quantity * i.price), 0)

  // Column widths sum = 182mm (contentWidth)
  const columnWidths = [12, 52, 20, 16, 16, 22, 18, 26]
  const halign: ('left' | 'center' | 'right')[] = [
    'center',
    'left',
    'center',
    'center',
    'center',
    'right',
    'right',
    'right',
  ]

  const columnStyles: UserOptions['columnStyles'] = {}
  columnWidths.forEach((w, i) => {
    columnStyles[i] = { cellWidth: w, halign: halign[i] }
  })

  autoTable(doc, {
    startY: tableStartY,
    theme: 'grid',
    head: [
      [
        'SR. #',
        'PRODUCT NAME',
        'CODE',
        'UNIT',
        'QTY',
        'RATE',
        'DISC. %',
        'TOTAL PRICE',
      ],
    ],
    body: items.map((i) => [
      String(i.index),
      i.name,
      i.code || '—',
      i.unit,
      String(i.quantity),
      Math.round(i.price).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      i.discount ? `${i.discount}%` : '0%',
      Math.round(i.lineTotal).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]),
    foot: [
      [
        'TOTAL',
        '',
        '',
        '',
        String(totalQty),
        '',
        '',
        Math.round(grossLinesTotal).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ],
    ],
    margin: { left: MARGIN, right: MARGIN, bottom: 28 },
    styles: {
      font: tableFont(doc),
      cellPadding: 2.5,
      overflow: 'linebreak',
      fontSize: 8,
      textColor: [9, 9, 11],
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BLUE_HEADER,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: strongStyle(doc),
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
      halign: 'center',
    },
    footStyles: {
      fillColor: BLUE_LIGHT_BG,
      textColor: [9, 9, 11],
      fontSize: 8,
      fontStyle: strongStyle(doc),
      lineColor: BORDER_DARK,
      lineWidth: 0.2,
    },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === 'foot') {
        if (data.column.index === 0) {
          data.cell.colSpan = 4
        }
        if (data.column.index === 7 || data.column.index === 4) {
          data.cell.styles.fontStyle = strongStyle(doc)
        }
      }
    },
  })

  // 4. Summary & Totals Block (Bottom Right)
  let finalY = getFinalY(doc) + 5
  const subtotal = Number(quotation.subtotal_pkr) || 0
  const discount = Number(quotation.discount_pkr) || 0
  const tax = Number(quotation.tax_amount_pkr) || 0
  const grand = Number(quotation.grand_total_pkr) || 0

  // Left side: Terms & Conditions and Disclaimer note
  const leftBlockWidth = 98
  let termsBoxHeight = 0
  if (quotation.terms?.trim() || quotation.notes?.trim()) {
    const termLines = [
      ...(quotation.terms?.trim() ? [`Terms: ${quotation.terms.trim()}`] : []),
      ...(quotation.notes?.trim() ? [`Notes: ${quotation.notes.trim()}`] : []),
    ]
    termsBoxHeight = 16
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(...BORDER_DARK)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, finalY, leftBlockWidth, termsBoxHeight, 'FD')

    setLatinFont(doc, 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...BLUE_HEADER)
    doc.text('TERMS & NOTES:', MARGIN + 3, finalY + 4.5)

    // Terms & notes print as italic accents, matching the HTML templates.
    setLatinFont(doc, 'italic')
    doc.setFontSize(7)
    doc.setTextColor(15, 23, 42)
    let tY = finalY + 8.5
    for (const t of termLines) {
      doc.text(doc.splitTextToSize(t, leftBlockWidth - 6)[0] || '', MARGIN + 3, tY)
      tY += 3.8
    }
  }

  // Right side: Summary box
  const summaryBoxWidth = 80
  const summaryBoxX = pageWidth - MARGIN - summaryBoxWidth

  const summaryRows = [
    {
      labelEn: 'Discount / Extra Discount (XD)',
      labelUr: 'ڈسکاؤنٹ / اضافی ڈسکاؤنٹ (ایکس ڈی)',
      value: discount > 0 ? `-PKR ${discount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'PKR 0.00',
    },
    {
      labelEn: 'Sales Tax (GST)',
      labelUr: 'سیلز ٹیکس',
      value: `PKR ${tax.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
  ]

  let sY = finalY
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...BORDER_DARK)
  doc.setLineWidth(0.2)
  doc.rect(summaryBoxX, sY, summaryBoxWidth, summaryRows.length * 6, 'FD')

  for (const r of summaryRows) {
    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(15, 23, 42)
    doc.text(r.labelEn, summaryBoxX + 3, sY + 3.8)

    setNumericFont(doc, true)
    doc.setFontSize(7.5)
    doc.setTextColor(9, 9, 11)
    doc.text(r.value, summaryBoxX + summaryBoxWidth - 3, sY + 4, { align: 'right' })
    sY += 6
  }

  // Total Quoted Amount Box: Soft blue tint (#EBF3FA), solid blue border (#1D5298)
  const grandBoxHeight = 12
  doc.setFillColor(...BLUE_LIGHT_BG)
  doc.setDrawColor(...BORDER_BLUE)
  doc.setLineWidth(0.4)
  doc.rect(summaryBoxX, sY, summaryBoxWidth, grandBoxHeight, 'FD')

  setLatinFont(doc, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BLUE_HEADER)
  doc.text('Total Amount', summaryBoxX + 3, sY + 5)
  if (hasUrdu) {
    drawUrdu(doc, 'کل رقم', summaryBoxX + 3, sY + 9.8, { fontSize: 8, color: BLUE_HEADER })
  }

  setNumericFont(doc, true)
  doc.setFontSize(10)
  doc.setTextColor(...BLUE_HEADER)
  const grandFormatted = `PKR ${grand.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  doc.text(grandFormatted, summaryBoxX + summaryBoxWidth - 3, sY + 7.5, { align: 'right' })

  // 5. Signature & Footer Section
  const sigY = pageHeight - 38
  const sigWidth = 72

  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.3)

  // Received By (Customer) / وصول کنندہ (گاہک)
  doc.line(MARGIN, sigY, MARGIN + sigWidth, sigY)
  setLatinFont(doc, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(9, 9, 11)
  doc.text('Received By (Customer)', MARGIN + sigWidth / 2, sigY + 4, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'وصول کنندہ (گاہک)', MARGIN + sigWidth / 2, sigY + 8.5, { align: 'center', fontSize: 8, color: [9, 9, 11] })
  }

  // Authorised Signatory
  doc.line(pageWidth - MARGIN - sigWidth, sigY, pageWidth - MARGIN, sigY)
  doc.text('Authorised Signatory', pageWidth - MARGIN - sigWidth / 2, sigY + 4, { align: 'center' })
  if (hasUrdu) {
    drawUrdu(doc, 'اختیار یافتہ دستخط کنندہ', pageWidth - MARGIN - sigWidth / 2, sigY + 8.5, { align: 'center', fontSize: 8, color: [9, 9, 11] })
  }

  // Footer: Centered company contact details
  const totalPages = doc.getNumberOfPages()
  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.setPage(pNum)

    doc.setDrawColor(...BORDER_DARK)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, pageHeight - 11, pageWidth - MARGIN, pageHeight - 11)

    setLatinFont(doc, 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(24, 24, 27)
    doc.text(COMPANY_LEGAL_NAME.toUpperCase(), MARGIN, pageHeight - 7)

    setLatinFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(82, 82, 82)
    const contactLine = `${profile.email || DEFAULT_COMPANY.email}   |   ${profile.website || DEFAULT_COMPANY.website}   |   ${profile.phone || DEFAULT_COMPANY.phone}`
    doc.text(contactLine, pageWidth / 2, pageHeight - 7, { align: 'center' })

    setNumericFont(doc)
    doc.setFontSize(7.5)
    doc.text(`Page ${pNum} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 7, { align: 'right' })
  }

  outputReport(doc, `quotation_${quotation.quotation_number}.pdf`)
  return doc
}


