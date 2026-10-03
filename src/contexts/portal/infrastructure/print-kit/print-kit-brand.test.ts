import PDFDocument from 'pdfkit'
import { describe, expect, it, vi } from 'vitest'
import { PANEL_WIDTH_MM } from '#/shared/domain/portal-print-kit-layout'
import { drawWordmark } from './print-kit-brand'
import { mm } from './print-kit-geometry'
import { PrintKitFonts } from './print-kit-pdf-text'

function drawn(wordmark: string): number {
  const doc = new PDFDocument({ size: [mm(PANEL_WIDTH_MM), mm(200)] })
  const spy = vi.spyOn(doc, 'text')
  drawWordmark(doc, new PrintKitFonts(doc), wordmark)
  const lines = spy.mock.calls.length
  doc.end()
  return lines
}

describe('drawWordmark', () => {
  it('sets a short brand on one line', () => {
    expect(drawn('Pool')).toBeGreaterThan(0)
  })

  it('wraps a long brand to more lines than a short one, within two', () => {
    const long = drawn('The Very Long Named Grand Hotel And Spa Resort Collection')
    expect(long).toBeGreaterThan(drawn('Pool'))
    expect(long).toBeLessThanOrEqual(drawn('Pool') * 2)
  })
})
