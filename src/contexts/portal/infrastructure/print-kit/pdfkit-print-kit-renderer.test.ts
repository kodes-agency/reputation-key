import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import { printKitFaces, type PrintKitChoice } from '#/shared/domain/portal-print-kit'
import { PANEL_WIDTH_MM, SIDE_MARGIN_MM } from '#/shared/domain/portal-print-kit-layout'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import { qrDarkRuns, qrMatrix } from './print-kit-qr'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const SHORT = 'app.reputationkey.app'
const TITLES = { en: 'Pool & Terrace', bg: 'Басейн и тераса' }
const MM = 72 / 25.4

const renderer = createPdfKitPrintKitRenderer({
  now: () => new Date('2026-10-01T10:00:00Z'),
  compress: false,
})

function inputFor(
  choice: PrintKitChoice,
  overrides: Partial<PrintKitRenderInput> = {},
): PrintKitRenderInput {
  return {
    title: 'Pool & Terrace table tent',
    piece: choice.piece,
    faces: printKitFaces(choice, TITLES, 'Pool & Terrace'),
    wordmark: 'Avela',
    logo: null,
    photo: null,
    accentColour: '#EAD6A8',
    fieldColour: '#15110D',
    qrAddress: ADDRESS,
    shortAddress: SHORT,
    ...overrides,
  }
}

const tentEnBg: PrintKitChoice = {
  piece: 'table_tent',
  languages: ['en', 'bg'],
  callToAction: 'rate',
}

async function renderText(input: PrintKitRenderInput): Promise<string> {
  return Buffer.from(await renderer.render(input)).toString('latin1')
}

function boxOf(text: string, name: string): number[] {
  const match = new RegExp(`/${name} \\[([^\\]]+)\\]`, 'u').exec(text)
  return (match?.[1] ?? '').trim().split(/\s+/u).map(Number)
}

async function jpegPhoto(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 500, channels: 3, background: '#557766' },
  })
    .webp()
    .toBuffer()
}

type DrawnRun = Readonly<{ text: string; left: number; right: number }>

/** Every run of text the renderer sets, with where it starts and ends across its panel. */
async function drawnRuns(input: PrintKitRenderInput): Promise<readonly DrawnRun[]> {
  const runs: DrawnRun[] = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, 'text')
  spy.mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    const [text, x, , options] = args as [
      string,
      number,
      number,
      { characterSpacing?: number },
    ]
    const spacing = options.characterSpacing ?? 0
    const width = this.widthOfString(text, { characterSpacing: spacing }) - spacing
    runs.push({ text, left: x, right: x + width })
    return original.apply(this, args as Parameters<typeof original>)
  })
  try {
    await renderer.render(input)
  } finally {
    spy.mockRestore()
  }
  return runs
}

const panelLeft = SIDE_MARGIN_MM * MM
const panelRight = (PANEL_WIDTH_MM - SIDE_MARGIN_MM) * MM

describe('the address under the code', () => {
  it('sets the host on one line and never the secret path the code carries', async () => {
    const runs = await drawnRuns(inputFor(tentEnBg))
    const texts = runs.map((run) => run.text)
    expect(texts).toContain('app.reputationkey.app')
    expect(texts.filter((text) => /pt_|\/p\/|accessArtifact/u.test(text))).toEqual([])
  })
})

describe('text longer than any brand or title', () => {
  const longTitle =
    'Spa & Wellness Centre Reception Desk and Lobby, Ground Floor East Wing'
  const cases = [
    ['a 24 character brand', 'GRAND HOTEL EUROPE & SPA', 'Pool & Terrace'],
    [
      'a 34 character brand',
      'Kempinski Hotel Grand Arena Bansko',
      'Spa & Wellness Centre',
    ],
    [
      'a 40 character brand',
      'Hotel Imperial Palace Grand Resort Sofia',
      'Pool & Terrace',
    ],
    ['a 120 character title', 'Avela', longTitle.padEnd(120, ' and more').slice(0, 120)],
    ['a long brand and a long title', 'Kempinski Hotel Grand Arena Bansko', longTitle],
  ] as const

  it.each(cases)(
    'keeps every line inside the panel margins, with %s',
    async (_name, wordmark, title) => {
      const choice: PrintKitChoice = {
        piece: 'table_tent',
        languages: ['en', 'bg'],
        callToAction: 'rate',
      }
      const input = inputFor(choice, {
        wordmark,
        faces: printKitFaces(choice, { en: title, bg: title }, title),
      })
      const runs = await drawnRuns(input)
      expect(runs.length).toBeGreaterThan(8)
      for (const run of runs) {
        expect(run.left, run.text).toBeGreaterThanOrEqual(panelLeft - 0.5)
        expect(run.right, run.text).toBeLessThanOrEqual(panelRight + 0.5)
      }
    },
  )

  it('still draws the whole of a long brand, on more than one line when it must', async () => {
    const runs = await drawnRuns(
      inputFor(tentEnBg, { wordmark: 'Kempinski Hotel Grand Arena Bansko' }),
    )
    const drawn = runs.map((run) => run.text).join(' ')
    for (const word of ['KEMPINSKI', 'HOTEL', 'GRAND', 'ARENA', 'BANSKO']) {
      expect(drawn).toContain(word)
    }
  })

  it('keeps a long title whole, and the call to action unchanged', async () => {
    const runs = await drawnRuns(
      inputFor(
        { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
        {
          faces: printKitFaces(
            { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
            { en: longTitle },
            longTitle,
          ),
        },
      ),
    )
    const drawn = runs.map((run) => run.text).join(' ')
    expect(drawn).toContain('Rate your visit')
    for (const word of longTitle.toUpperCase().split(/\s+/u))
      expect(drawn).toContain(word)
  })
})

describe('the print kit PDF', () => {
  it('is a PDF', async () => {
    const pdf = await renderer.render(inputFor(tentEnBg))
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('makes a folded table tent one sheet of two A6 panels', async () => {
    const text = await renderText(inputFor(tentEnBg))
    expect(text.match(/\/Type \/Page\n/gu)).toHaveLength(1)
    const [left, bottom, right, top] = boxOf(text, 'TrimBox')
    expect(((right ?? 0) - (left ?? 0)) / MM).toBeCloseTo(105, 1)
    expect(((top ?? 0) - (bottom ?? 0)) / MM).toBeCloseTo(296, 1)
  })

  it('makes a counter card one A6 page per face', async () => {
    const two = await renderText(
      inputFor({ piece: 'counter_card', languages: ['en', 'bg'], callToAction: 'rate' }),
    )
    expect(two.match(/\/Type \/Page\n/gu)).toHaveLength(2)
    const [left, bottom, right, top] = boxOf(two, 'TrimBox')
    expect(((right ?? 0) - (left ?? 0)) / MM).toBeCloseTo(105, 1)
    expect(((top ?? 0) - (bottom ?? 0)) / MM).toBeCloseTo(148, 1)
    const one = await renderText(
      inputFor({ piece: 'counter_card', languages: ['en'], callToAction: 'rate' }),
    )
    expect(one.match(/\/Type \/Page\n/gu)).toHaveLength(1)
  })

  it('declares a 3 mm bleed round the trim, with room for the crop marks beyond it', async () => {
    const text = await renderText(inputFor(tentEnBg))
    const [trimLeft, trimBottom, trimRight, trimTop] = boxOf(text, 'TrimBox')
    const [bleedLeft, bleedBottom, bleedRight, bleedTop] = boxOf(text, 'BleedBox')
    expect(((trimLeft ?? 0) - (bleedLeft ?? 0)) / MM).toBeCloseTo(3, 2)
    expect(((trimBottom ?? 0) - (bleedBottom ?? 0)) / MM).toBeCloseTo(3, 2)
    expect(((bleedRight ?? 0) - (trimRight ?? 0)) / MM).toBeCloseTo(3, 2)
    expect(((bleedTop ?? 0) - (trimTop ?? 0)) / MM).toBeCloseTo(3, 2)
    // The page is the trim and a 10 mm margin on every side.
    const [, , pageWidth, pageHeight] = boxOf(text, 'MediaBox')
    expect((pageWidth ?? 0) / MM).toBeCloseTo(125, 1)
    expect((pageHeight ?? 0) / MM).toBeCloseTo(316, 1)
  })

  it('draws crop marks in registration colour, and a fold mark on a table tent', async () => {
    const tent = await renderText(inputFor(tentEnBg))
    expect(tent).toContain('/DeviceCMYK CS')
    expect(tent).toContain('[2 2] 0 d')
    const card = await renderText(
      inputFor({ piece: 'counter_card', languages: ['en'], callToAction: 'rate' }),
    )
    expect(card).toContain('/DeviceCMYK CS')
    expect(card).not.toContain('[2 2] 0 d')
  })

  it('draws the code as vectors, never as a picture', async () => {
    const text = await renderText(inputFor(tentEnBg))
    expect(text).not.toContain('/Subtype /Image')
    const runs = qrDarkRuns(qrMatrix(ADDRESS)).length
    // Two panels, each with every run as a rectangle (and a handful more for the art).
    expect(text.match(/ re\n/gu)?.length ?? 0).toBeGreaterThanOrEqual(runs * 2)
  })

  it('embeds the guest fonts as subsets', async () => {
    const text = await renderText(inputFor(tentEnBg))
    expect(text).toMatch(/\+CormorantGaramond/u)
    expect(text).toMatch(/\+YsabeauOffice-SemiBold/u)
    expect(text).toMatch(/\+YsabeauOffice-Regular/u)
    expect(text.match(/\/FontFile2/gu)?.length ?? 0).toBeGreaterThanOrEqual(4)
    // No standard font stands in for a missing one.
    expect(text).not.toContain('/Helvetica')
  })

  it('sets Cyrillic text in an embedded font: it reaches the text map', async () => {
    const withBulgarian = await renderText(inputFor(tentEnBg))
    // U+041E, the capital O of "Оценете", is mapped back to text in the file.
    expect(withBulgarian).toMatch(/<041E>/iu)
    const englishOnly = await renderText(
      inputFor({ piece: 'table_tent', languages: ['en'], callToAction: 'rate' }),
    )
    expect(englishOnly).not.toMatch(/<041E>/iu)
  })

  it('carries a photo once, even on a sheet that shows it twice, and none without one', async () => {
    const photo = { bytes: await jpegPhoto(), focalX: 0.5, focalY: 0.5 }
    const withPhoto = await renderText(inputFor(tentEnBg, { photo }))
    expect(withPhoto.match(/\/Subtype \/Image/gu)).toHaveLength(1)
    expect(withPhoto).toContain('/DCTDecode')
    expect(await renderText(inputFor(tentEnBg))).not.toContain('/Subtype /Image')
  })

  it('carries a logo as a picture in place of the wordmark', async () => {
    const logo = await sharp({
      create: { width: 200, height: 50, channels: 4, background: '#ffffff' },
    })
      .webp()
      .toBuffer()
    const text = await renderText(inputFor(tentEnBg, { logo, wordmark: 'Avela' }))
    expect(text.match(/\/Subtype \/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('drops characters no guest font carries instead of drawing broken glyphs', async () => {
    const input = inputFor(tentEnBg, { wordmark: 'Avela 酒' })
    const drawn = (await drawnRuns(input)).map((run) => run.text).join(' ')
    expect(drawn).toContain('AVELA')
    expect(drawn).not.toContain('酒')
    // Nor does the file map a glyph for U+9152, while it does for the V of AVELA.
    const text = await renderText(input)
    expect(text).not.toMatch(/<9152>/iu)
    expect(text).toMatch(/<0056>/iu)
  })

  it('is the same bytes for the same input', async () => {
    const first = await renderer.render(inputFor(tentEnBg))
    const second = await renderer.render(inputFor(tentEnBg))
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('titles the document', async () => {
    expect(await renderText(inputFor(tentEnBg))).toContain('/Title ')
  })
})
