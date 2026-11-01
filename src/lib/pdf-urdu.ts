import type jsPDF from 'jspdf'

export const URDU_FONT = 'Helvetica'

export async function ensureUrduFont(_doc: jsPDF): Promise<boolean> {
  return false
}

export interface UrduTextOptions {
  fontSize?: number
  color?: [number, number, number]
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  maxWidth?: number
}

export function hasUrduFont(_doc: jsPDF): boolean {
  return false
}

export function drawUrdu(
  _doc: jsPDF,
  _text: string,
  _x: number,
  y: number,
  _options: UrduTextOptions = {}
): number {
  return y
}

export function splitUrdu(_doc: jsPDF, _text: string, _maxWidth: number): string[] {
  return []
}

export function countUrduLines(
  _doc: jsPDF,
  _text: string,
  _maxWidth: number,
  _fontSize = 9
): number {
  return 0
}

export function numberToUrduWords(_num: number): string {
  return ''
}

export function formatUrduDate(_iso: string): string {
  return ''
}

export function formatUrduAmount(_value: number): string {
  return ''
}

// Proxied dummy UR keys so any lingering UR.<property> access cleanly evaluates to empty string
export const UR: Record<string, string> = new Proxy(
  {},
  {
    get: () => '',
  }
)

export type UrKey = string

export const URDU_HTML_FONT_CSS = ''
export const URDU_HTML_LINE_CSS = ''
export const URDU_HTML_STYLES = ''

export function urUnder(en: string, _ur?: string): string {
  return en
}

export function urSpan(_text: string, _style = ''): string {
  return ''
}
