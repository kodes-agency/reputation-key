import { describe, expect, it } from 'vitest'
import {
  estimatedAdvanceEm,
  estimatedLineWidthPt,
} from '#/shared/domain/portal-print-kit-text-widths'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { measureLine, type PdfTextStyle } from './print-kit-pdf-text'

// The preview's width tables against the fonts the PDF embeds: an estimate may
// be wide, never narrow, or a preview line could set larger than the file's.

const LATIN = [
  ...' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~’‘“”–—…·',
  ...'ßàáâäçèéêëìíîïñòóôöùúûüÀÉÜÖÄ',
]
const CYRILLIC = [...'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯабвгдежзийклмнопрстуфхцчшщъьюя']

const SAMPLES = [
  'The rooftop terrace bar and lounge overlooking the old harbour',
  'La terrasse panoramique du bar et du salon sur le vieux port',
  'Die Dachterrassenbar und Lounge mit Blick auf den alten Hafen',
  'Басейн и тераса до градинския ресторант',
  'Comment s’est passée votre visite ?',
  'Chair 3 · Sala 12',
]

const style = (face: PdfTextStyle['face'], size = 1000, spacing = 0): PdfTextStyle => ({
  face,
  size,
  spacing,
  colour: '#000000',
  opacity: 1,
})

describe('the estimated widths', () => {
  const { doc, fonts } = newDocument()

  it('never say a character is narrower than the font sets it', () => {
    for (const character of [...LATIN, ...CYRILLIC]) {
      const display = measureLine(doc, fonts, character, style('display')) / 1000
      expect(estimatedAdvanceEm('display', character), character).toBeGreaterThanOrEqual(
        display,
      )
      for (const face of ['body', 'bodyStrong'] as const) {
        const text = measureLine(doc, fonts, character, style(face)) / 1000
        expect(estimatedAdvanceEm('text', character), character).toBeGreaterThanOrEqual(
          text,
        )
      }
    }
  })

  it('err wide by a few percent on a line, tracking included', () => {
    for (const sample of SAMPLES) {
      const display = measureLine(doc, fonts, sample, style('display', 24, -0.12))
      const estimate = estimatedLineWidthPt(sample, 'display', 24, -0.005)
      expect(estimate, sample).toBeGreaterThanOrEqual(display)
      expect(estimate, sample).toBeLessThanOrEqual(display * 1.05)
      const title = measureLine(doc, fonts, sample, style('bodyStrong', 9.5, 0.19))
      expect(
        estimatedLineWidthPt(sample, 'text', 9.5, 0.02),
        sample,
      ).toBeGreaterThanOrEqual(title)
    }
  })
})
