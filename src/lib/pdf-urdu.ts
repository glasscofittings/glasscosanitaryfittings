import type jsPDF from 'jspdf'

/**
 * Urdu text support for jsPDF.
 *
 * jsPDF shapes Arabic-script letters into their contextual forms and runs its Unicode bidi
 * engine on embedded TTF text. The engine defaults to a left-to-right base direction, so
 * every Urdu string is drawn with `RTL_OPTIONS` (logical RTL in, visual order out), which also
 * keeps digit runs such as "44,000" left-to-right inside the Urdu.
 * The glyphs come from Amiri (SIL OFL), served from /public/fonts and embedded on demand.
 */

export const URDU_FONT = 'Amiri'
const URDU_FONT_FILE = 'Amiri-Regular.ttf'
const URDU_FONT_URL = `/fonts/${URDU_FONT_FILE}`

let fontBase64: string | null = null
let fontLoading: Promise<string | null> | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function loadFontBase64(): Promise<string | null> {
  if (fontBase64) return fontBase64
  if (!fontLoading) {
    fontLoading = (async () => {
      try {
        const res = await fetch(URDU_FONT_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        fontBase64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()))
        return fontBase64
      } catch (err) {
        console.error('[pdf-urdu] Could not load Urdu font:', err instanceof Error ? err.message : err)
        fontLoading = null
        return null
      }
    })()
  }
  return fontLoading
}

/** Registers the Urdu font on the document. Resolves false when the font is unavailable. */
export async function ensureUrduFont(doc: jsPDF): Promise<boolean> {
  const data = await loadFontBase64()
  if (!data) return false
  const fontList = doc.getFontList() as Record<string, string[]>
  if (!fontList[URDU_FONT]) {
    doc.addFileToVFS(URDU_FONT_FILE, data)
    doc.addFont(URDU_FONT_FILE, URDU_FONT, 'normal')
  }
  return true
}

/** Bidi options for a right-to-left paragraph in logical order. */
const RTL_OPTIONS = { isInputVisual: false, isInputRtl: true, isOutputVisual: true, isOutputRtl: false } as const

export interface UrduTextOptions {
  align?: 'left' | 'center' | 'right'
  fontSize?: number
  color?: [number, number, number]
  maxWidth?: number
  lineHeight?: number
}

/** Draws one or more lines of Urdu text. Returns the Y just below the last line. */
export function drawUrdu(doc: jsPDF, text: string, x: number, y: number, options: UrduTextOptions = {}): number {
  const { align = 'left', fontSize = 9, color, maxWidth, lineHeight = fontSize * 0.5 } = options
  const previousFont = doc.getFont()
  const previousSize = doc.getFontSize()
  doc.setFont(URDU_FONT, 'normal')
  doc.setFontSize(fontSize)
  if (color) doc.setTextColor(...color)

  const lines = maxWidth ? splitUrdu(doc, text, maxWidth) : [text]
  lines.forEach((line, i) => {
    doc.text(line, x, y + i * lineHeight, { align, ...RTL_OPTIONS })
  })

  doc.setFont(previousFont.fontName, previousFont.fontStyle)
  doc.setFontSize(previousSize)
  return y + lines.length * lineHeight
}

/** Word-wraps Urdu text to a width. Call with the Urdu font already active for accurate metrics. */
export function splitUrdu(doc: jsPDF, text: string, maxWidth: number): string[] {
  const previousFont = doc.getFont()
  doc.setFont(URDU_FONT, 'normal')
  const lines: string[] = []
  let current = ''
  text.split(/\s+/).filter(Boolean).forEach((word) => {
    const candidate = current ? `${current} ${word}` : word
    if (current && doc.getTextWidth(candidate) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  })
  if (current) lines.push(current)
  doc.setFont(previousFont.fontName, previousFont.fontStyle)
  return lines.length > 0 ? lines : ['']
}

/** Measures how many lines Urdu text needs at a font size and width. */
export function countUrduLines(doc: jsPDF, text: string, maxWidth: number, fontSize = 9): number {
  const previousSize = doc.getFontSize()
  doc.setFontSize(fontSize)
  const count = splitUrdu(doc, text, maxWidth).length
  doc.setFontSize(previousSize)
  return count
}

/* ─── Numbers & dates ────────────────────────────────────────────────────── */

const URDU_NUMBERS_TO_99 = [
  'صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو',
  'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس',
  'بیس', 'اکیس', 'بائیس', 'تیئس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس',
  'تیس', 'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس',
  'چالیس', 'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس',
  'پچاس', 'اکاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ',
  'ساٹھ', 'اکسٹھ', 'باسٹھ', 'تریسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر',
  'ستر', 'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچہتر', 'چھہتر', 'ستتر', 'اٹھتر', 'اناسی',
  'اسی', 'اکیاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی',
  'نوے', 'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے',
]

function urduGroup(n: number): string {
  if (n === 0) return ''
  if (n < 100) return URDU_NUMBERS_TO_99[n]
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  return `${URDU_NUMBERS_TO_99[hundreds]} سو${rest ? ' ' + URDU_NUMBERS_TO_99[rest] : ''}`
}

/** Amount in Urdu words using the South Asian lakh / crore grouping, e.g. "چوالیس ہزار روپے صرف". */
export function numberToUrduWords(num: number): string {
  const intPart = Math.floor(Math.abs(num))
  const paisa = Math.round((Math.abs(num) - intPart) * 100)
  if (intPart === 0 && paisa === 0) return 'صفر روپے صرف'

  const parts: string[] = []
  const crore = Math.floor(intPart / 10000000)
  const lakh = Math.floor((intPart % 10000000) / 100000)
  const thousand = Math.floor((intPart % 100000) / 1000)
  const rest = intPart % 1000
  if (crore > 0) parts.push(`${urduGroup(crore)} کروڑ`)
  if (lakh > 0) parts.push(`${urduGroup(lakh)} لاکھ`)
  if (thousand > 0) parts.push(`${urduGroup(thousand)} ہزار`)
  if (rest > 0) parts.push(urduGroup(rest))

  let words = parts.length > 0 ? `${parts.join(' ')} روپے` : ''
  if (paisa > 0) words += `${words ? ' اور ' : ''}${urduGroup(paisa)} پیسے`
  return `${words} صرف`
}

const URDU_MONTHS = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر']

/** "18 ستمبر 2026" for an ISO date; returns '-' when the date is invalid. */
export function formatUrduDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getDate()} ${URDU_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "PKR 44,000" → "44,000 روپے" */
export function formatUrduAmount(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} روپے`
}

/* ─── Labels ─────────────────────────────────────────────────────────────── */

export const UR = {
  voucherNo: 'واؤچر نمبر',
  date: 'تاریخ',
  voucherType: 'واؤچر کی قسم',
  payeeName: 'وصول کنندہ کا نام',
  address: 'پتہ',
  cnicNtn: 'شناختی کارڈ / این ٹی این',
  purpose: 'مقصد',
  referenceNo: 'حوالہ نمبر',
  debitAccount: 'ڈیبٹ اکاؤنٹ',
  creditAccount: 'کریڈٹ اکاؤنٹ',
  amount: 'رقم',
  amountInWords: 'رقم بحروف',
  remarks: 'ریمارکس',
  createdBy: 'تیار کردہ از',
  total: 'کل رقم',
  payee: 'وصول کنندہ',
  preparedBy: 'تیار کنندہ',
  approvedBy: 'منظور کنندہ',
  receivedBy: 'وصول کنندہ',
  signatureDate: 'دستخط و تاریخ',
  paymentVouchers: 'ادائیگی واؤچرز',
  amountPaid: 'ادا شدہ رقم',
  notProvided: 'درج نہیں',
  cashPaymentVoucher: 'نقد ادائیگی واؤچر',
  partyPaymentVoucher: 'پارٹی ادائیگی واؤچر',
  bankPaymentVoucher: 'بینک ادائیگی واؤچر',
  cashPayment: 'نقد ادائیگی',
  partyPayment: 'پارٹی ادائیگی',
  bankPayment: 'بینک ادائیگی',
  salaryPayment: 'تنخواہ ادائیگی',
  salaryPaymentVoucher: 'تنخواہ ادائیگی واؤچر',

  generated: 'تیار کیا گیا',
  operator: 'آپریٹر',
  nodeId: 'نوڈ شناخت',
  pageOf: 'صفحہ',
  ofWord: 'کل',

  productCatalog: 'سینیٹری پروڈکٹ کیٹلاگ',
  sku: 'پروڈکٹ کوڈ',
  category: 'زمرہ',
  subcategory: 'ذیلی زمرہ',
  finish: 'فنش',
  unitPrice: 'فی یونٹ قیمت',
  available: 'دستیاب',
  stockTotal: 'کل اسٹاک',
  reorder: 'دوبارہ آرڈر کی حد',
  status: 'صورتحال',
  inStock: 'اسٹاک میں',
  lowStock: 'کم اسٹاک',
  outOfStock: 'اسٹاک ختم',
  criticalLow: 'شدید کمی',
  reorderSoon: 'جلد دوبارہ آرڈر',

  crmContacts: 'کاروباری رابطے',
  name: 'نام',
  type: 'قسم',
  phone: 'فون',
  email: 'ای میل',
  ntnStrn: 'این ٹی این / ایس ٹی آر این',
  registered: 'ثبت شدہ',
  buyer: 'خریدار',
  supplier: 'سپلائر',
  both: 'دونوں',
  contacts: 'رابطے',
  yes: 'ہاں',
  no: 'نہیں',

  labourReport: 'لیبر رپورٹ',
  activeWorkers: 'فعال کارکن',
  daysPresent: 'حاضری کے دن',
  daysAbsent: 'غیر حاضری کے دن',
  daysOnLeave: 'چھٹی کے دن',
  attendanceRate: 'حاضری کی شرح',
  loansOutstanding: 'بقایا قرضے',
  workerRegister: 'کارکن فہرست',
  attendanceCalendar: 'حاضری کیلینڈر',
  taskBoard: 'ٹاسک بورڈ',
  loanLedger: 'قرضوں کا لیجر',
  worker: 'کارکن',
  role: 'عہدہ',
  joined: 'شمولیت کی تاریخ',
  baseSalary: 'بنیادی تنخواہ',
  active: 'فعال',
  inactive: 'غیر فعال',
  present: 'حاضر',
  absent: 'غیر حاضر',
  leave: 'چھٹی',
  attendance: 'حاضری',
  task: 'کام',
  batchOrder: 'بیچ آرڈر',
  assigned: 'تفویض کی تاریخ',
  unassigned: 'تفویض نہیں',
  pending: 'زیرِ التوا',
  inProgress: 'جاری ہے',
  done: 'مکمل',
  issued: 'تاریخ اجراء',
  original: 'اصل رقم',
  repaid: 'واپس کی گئی رقم',
  balance: 'بقایا رقم',
  monthlyDeduction: 'ماہانہ کٹوتی',
  monthsLeft: 'بقایا ماہ',
  recovery: 'واپسی',

  payslip: 'تنخواہ پرچی',
  workerId: 'کارکن شناخت',
  attendanceSummary: 'حاضری کا خلاصہ',
  daysInPeriod: 'مدت میں دن',
  salaryBreakdown: 'تنخواہ کی تفصیل',
  item: 'شے',
  value: 'قدر',
  baseSalaryMonthly: 'بنیادی تنخواہ (ماہانہ)',
  dailyRate: 'فی دن کی تنخواہ',
  paidDays: 'ادا شدہ دن',
  earnedSalary: 'کمائی گئی تنخواہ',
  loansInformational: 'قرضے (صرف معلوماتی)',
  noActiveLoan: 'کوئی فعال قرضہ نہیں۔',
  remaining: 'بقایا',
  cleared: 'ادا شدہ',
  activeStatus: 'فعال',

  inwardGatePasses: 'آنے والے گیٹ پاس',
  igpCode: 'آئی جی پی کوڈ',
  material: 'مواد',
  lotNo: 'لوٹ نمبر',
  coaNo: 'سی او اے نمبر',
  qty: 'مقدار',
  unit: 'اکائی',
  pendingInspection: 'معائنے کا انتظار',
  convertedToGrn: 'جی آر این میں تبدیل',
  rejected: 'مسترد',
  gatePasses: 'گیٹ پاس',
  noLoansIssued: 'کوئی قرضہ جاری نہیں۔',

  journal: 'جارنل',
  account: 'اکاؤنٹ',
  debit: 'ڈیبٹ',
  credit: 'کریڈٹ',
  trialBalance: 'ٹرائل بیلنس',
  code: 'کوڈ',
  profitLoss: 'نفع و نقصان',
  revenue: 'آمدن',
  expenses: 'اخراجات',
  totalRevenue: 'کل آمدن',
  totalExpenses: 'کل اخراجات',
  balanceSheet: 'میزانیہ',
  assets: 'اثاثے',
  liabilities: 'واجبات',
  equity: 'ایکویٹی',
  netProfit: 'خالص نفع',
  netLoss: 'خالص نقصان',
  totalDebit: 'کل ڈیبٹ',
  totalCredit: 'کل کریڈٹ',
  totalAssets: 'کل اثاثے',
  totalLiabilities: 'کل واجبات',
  totalEquity: 'کل ایکویٹی',
  entries: 'اقلام',
  posted: 'پوسٹ شدہ',
  draft: 'مسودہ',
  entryNo: 'اندراج نمبر',
  narration: 'تفصیل',
  openingBalance: 'ابتدائی بیلنس',
  netBalance: 'خالص بیلنس',
  accounts: 'اکاؤنٹس',
  noJournalEntries: 'ابھی کوئی روزنامچہ اندراج نہیں۔',
  noPostedEntries: 'کوئی پوسٹ شدہ اندراج نہیں۔',
  noRevenueEntries: 'کوئی آمدن اندراج نہیں',
  noExpenseEntries: 'کوئی اخراج اندراج نہیں',
  noAssetEntries: 'کوئی اثاثہ اندراج نہیں',
  noLiabilityEntries: 'کوئی واجب اندراج نہیں',
  noEquityEntries: 'کوئی ایکویٹی اندراج نہیں',
  balanced: 'متوازن',
  outOfBalance: 'غیر متوازن',
  generalLedger: 'جنرل لیجر',
  postedDebit: 'پوسٹ شدہ ڈیبٹ',
  postedCredit: 'پوسٹ شدہ کریڈٹ',
  noNarration: 'کوئی تفصیل درج نہیں',
  noLines: 'اس اندراج میں کوئی سطر نہیں۔',
  unknownAccount: 'نامعلوم اکاؤنٹ',
  entryBalanced: 'اندراج متوازن ہے',
  entryOutOfBalance: 'اندراج غیر متوازن ہے',
  difference: 'فرق',
  equityProfit: 'ایکویٹی + نفع',
  netProfitPnl: 'خالص نفع (نفع و نقصان)',

  customerLedger: 'گاہک لیجر',
  supplierLedger: 'سپلائر لیجر',
  buyerSupplierLedger: 'خریدار / سپلائر لیجر',
  individualLedger: 'انفرادی لیجر statement',
  docNo: 'دستاویز نمبر',
  narrationDescription: 'تفصیل',
  balancePKR: 'بیلنس (PKR)',
  debitPKR: 'ڈیبٹ (PKR)',
  creditPKR: 'کریڈٹ (PKR)',
  from: 'از',
  to: 'تا',
  period: 'مدت',
  entriesCount: 'اقلام',
  noPartyDocs: 'کوئی مالی دستاویز درج نہیں',
  accountCode: 'اکاؤنٹ کوڈ',
  netClosingBalance: 'خالص اختتامی بیلنس',
  totalsNetBalance: 'کل اور خالص بیلنس',
  openingBalanceBf: 'ابتدائی بیلنس (سابقہ)',
  totalsClosingBalance: 'کل اور اختتامی بیلنس',
  generatedBy: 'تیار کردہ: گلسکو سینٹری ای آر پی',
  currency: 'کرنسی',
  accountsDept: 'شعبۂ حسابات',
  checkedBy: 'چیک کردہ',
  auditDept: 'آڈٹ شعبہ',
  authorizedSignature: 'مجاز دستخط',
  management: 'انتظام',
  ledgerFooterNote: 'انوائسڈیبٹ ہیں — ادائیگیاں کریڈٹ — بیلنس بقایا رقم',
  ledgerFooterNoteCustomer: 'سیلز انوائس ڈیبٹ — وصولی کریڈٹ — بیلنس واجب الوصول',
  ledgerFooterNoteSupplier: 'خریداری انوائس کریڈٹ — ادائیگی ڈیبٹ — بیلنس قابلِ ادائیگی',
  ledgerFooterNoteBoth: 'گاہک کا رخ: انوائس ڈیبٹ / ادائیگی کریڈٹ — سپلائر کا رخ: انوائس کریڈٹ / ادائیگی ڈیبٹ',
  amountPayable: 'واجب الادا رقم',
  amountReceivable: 'واجب الوصول رقم',
  statementOfAccount: 'کھاتہ بیان / انفرادی لیجر',
  phoneLabel: 'فون',
  addressLabel: 'پتہ',
  accountStatement: 'کھاتہ بیان',
  statementBalance: 'بقایا',
  totalShort: 'کل',

  gstTaxInvoice: 'جی ایس ٹی ٹیکس انوائس',
  invoiceNo: 'انوائس نمبر',
  billTo: 'بنام',
  product: 'پروڈکٹ',
  lineTotal: 'سطری میزان',
  taxableValue: 'قابلِ ٹیکس مالیت',
  salesTax: 'سیلز ٹیکس',
  furtherTax: 'فرتھر ٹیکس',
  totalPayable: 'کل قابل ادائیگی',
  totalInvoiceValue: 'کل انوائس مالیت',
  authorisedSignatory: 'اختیار دار دستخط کنندہ',
  receivedByCustomer: 'وصول کنندہ (گاہک)',
  noLineItemsRecorded: 'اس انوائس میں کوئی سطر درج نہیں',

  saleInvoice: 'سیلز انوائس',
  srNo: 'سیریل نمبر',
  productDetail: 'تفصیل پروڈکٹ',
  price: 'قیمت',
  discPercent: 'ڈسکاؤنٹ',
  totalPrice: 'کل قیمت',
  totalRow: 'میزان',
  discountXd: 'ڈسکاؤنٹ / اضافی ڈسکاؤنٹ (ایکس ڈی)',
  totalAmount: 'کل واجب الادا',
  billNo: 'بل نمبر',
  tel: 'ٹیلی فون',
  unitPieces: 'اکائی / پیسز',
  salesPerson: 'سیلز پرسن',
  paymentMethod: 'ادائیگی کا طریقہ',
  brandCategory: 'برانڈ / زمرہ',
  customerDetails: 'گاہک کی تفصیلات',
  salesPaymentMeta: 'سیلز و ادائیگی کی معلومات',
  contact: 'رابطہ',
  subTotal: 'ذیلی میزان',
  quotation: 'کوٹیشن',
  quotationNo: 'کوٹیشن نمبر',
  validUntil: 'تاریخ میعاد',
  productName: 'پروڈکٹ کا نام',
  totalQuotedAmount: 'کل رقم (کوٹیشن)',

  outwardGatePass: 'روانگی گیٹ پاس و ٹیکس خلاصہ',
  invoiceReference: 'انوائس حوالہ',
  customer: 'گاہک',
  time: 'وقت',
  noLineItems: 'کوئی سطر درج نہیں',
  storeKeeper: 'سٹور کیپر',
  driverTransporter: 'ڈرائیور / ٹرانسپورٹر',
  securityGuard: 'سیکیورٹی گارڈ',

  dr: 'ڈیبٹ',
  cr: 'کریڈٹ',
  signature: 'دستخط',
  allRecordedTransactions: 'تمام درج شدہ لین دین',
  inception: 'آغاز سے',
  presentTense: ' الحال تک',

  particulars: 'تفصیلات',
  purchaseNumber: 'خریداری نمبر',
  rate: 'نرخ',
  subtotal: 'ذیلی میزان',
  discount: 'رعایت',
  taxFreight: 'ٹیکس / کرایہ',
  totalLanded: 'کل لینڈڈ لاگت',
  purchaseReport: 'پرچیز رپورٹ',
  purchaseOrders: 'خریداری آرڈرز رپورٹ',
  expenseVoucher: 'اخراجات واؤچر',
} as const

export type UrKey = keyof typeof UR

/* ─── Shared HTML helpers (System B iframe prints) ──────────────────────── */

/** Offline Amiri face for print HTML. Path is absolute so nested routes resolve. */
export const URDU_HTML_FONT_CSS = `@font-face{font-family:'Amiri';src:url('/fonts/Amiri-Regular.ttf') format('truetype');font-display:swap;}`

/** Base style for an Urdu line under an English label in print HTML. */
export const URDU_HTML_LINE_CSS = `.ur{font-family:'Amiri','Noto Nastaliq Urdu',serif;direction:rtl;text-align:right;unicode-bidi:isolate;font-size:0.92em;line-height:1.35;margin-top:1px;color:inherit;}`

/** English label with an Urdu line under it (no-op when `ur` is missing). */
export function urUnder(en: string, ur?: string): string {
  if (!ur) return en
  return `${en}<div class="ur" lang="ur" dir="rtl">${ur}</div>`
}

/** Inline Urdu (same line / RTL span) for compact spots like header meta. */
export function urSpan(text: string, style = ''): string {
  return `<span class="ur" lang="ur" dir="rtl" style="display:inline-block;${style}">${text}</span>`
}

/** Full style block to inject once inside each print document's &lt;style&gt;. */
export const URDU_HTML_STYLES = `${URDU_HTML_FONT_CSS}${URDU_HTML_LINE_CSS}`
