// What every print has in common, in either style: the words are drawn and the
// address is not, tracked lines keep their letters apart, the fonts are embedded
// and a character they lack is dropped. What each style draws on its sheets is in
// the Paper and Immersive tests beside this one.

import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  PRINT_KIT_STYLES,
  defaultPrintKitOutput,
  printKitFaces,
  type PrintKitWords,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import { qrDarkRuns, qrMatrix } from './print-kit-qr'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
/** What a code carries once print codes are minted: the print host in capitals and a 20-character code. */
const SHORT_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const TITLES = { en: 'Pool & Terrace', bg: 'Басейн и тераса' }

const renderer = createPdfKitPrintKitRenderer({
  now: () => new Date('2026-10-01T10:00:00Z'),
  compress: false,
})

type PickedChoice = PrintKitWords

function inputFor(
  style: PrintKitStyle,
  choice: PickedChoice,
  overrides: Partial<PrintKitRenderInput> = {},
): PrintKitRenderInput {
  return {
    title: 'Pool & Terrace table tent',
    piece: choice.piece,
    style,
    paper: 'letter',
    size: 'large',
    output: defaultPrintKitOutput(style),
    faces: printKitFaces(choice, TITLES, 'Pool & Terrace'),
    wordmark: 'Avela',
    propertyName: 'Avela Beach Resort',
    logo: null,
    photo: null,
    accentColour: '#EAD6A8',
    fieldColour: '#15110D',
    qrAddress: ADDRESS,
    ...overrides,
  }
}

const tentEnBg: PickedChoice = {
  piece: 'table_tent',
  languages: ['en', 'bg'],
  callToAction: 'rate',
}
const cardEn: PickedChoice = {
  piece: 'counter_card',
  languages: ['en'],
  callToAction: 'rate',
}

async function renderText(input: PrintKitRenderInput): Promise<string> {
  return Buffer.from(await renderer.render(input)).toString('latin1')
}

/** Every run of text the renderer sets. */
async function drawnRuns(input: PrintKitRenderInput): Promise<readonly string[]> {
  const runs: string[] = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, 'text')
  spy.mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    runs.push(String(args[0]))
    return original.apply(this, args as Parameters<typeof original>)
  })
  try {
    await renderer.render(input)
  } finally {
    spy.mockRestore()
  }
  return runs
}

describe.each(PRINT_KIT_STYLES)('the %s print', (style) => {
  it('does not print the address as words: the code and its cue carry the action (owner decision D2)', async () => {
    for (const choice of [tentEnBg, cardEn]) {
      const runs = await drawnRuns(inputFor(style, choice))
      expect(
        runs.filter((text) => /reputationkey|\/p\/|pt_|accessArtifact/u.test(text)),
      ).toEqual([])
    }
  })

  // ADR 0069: a print code is a credential. It is the code's picture and nothing
  // else: never a run of text, whether or not the address around it is shown.
  it('does not print a print code as words either', async () => {
    for (const choice of [tentEnBg, cardEn]) {
      const runs = await drawnRuns(inputFor(style, choice, { qrAddress: SHORT_ADDRESS }))
      expect(
        runs.filter((text) =>
          /up\.railway|HTTPS?:|\/p\/|7K3QZ0VD9MWX4HT2BN6R|[0-9A-HJKMNP-TV-Z]{20}/iu.test(
            text,
          ),
        ),
      ).toEqual([])
    }
  })

  it('draws the short print address as a version 3 symbol, 29 modules across', async () => {
    expect(qrMatrix(SHORT_ADDRESS).size).toBe(29)
    // The print draws the same symbol the Share tab downloads and a phone reads.
    expect(
      await renderText(inputFor(style, cardEn, { qrAddress: SHORT_ADDRESS })),
    ).toMatch(/^%PDF-1\.4/u)
  })

  it('still draws the whole of a long brand, on more than one line when it must', async () => {
    const runs = await drawnRuns(
      inputFor(style, tentEnBg, { wordmark: 'Kempinski Hotel Grand Arena Bansko' }),
    )
    const drawn = runs.join(' ')
    for (const word of ['KEMPINSKI', 'HOTEL', 'GRAND', 'ARENA', 'BANSKO']) {
      expect(drawn).toContain(word)
    }
  })

  it('keeps a long place label whole, and the call to action unchanged', async () => {
    const longTitle =
      'Spa & Wellness Centre Reception Desk and Lobby, Ground Floor East Wing'
    const runs = await drawnRuns(
      inputFor(style, cardEn, {
        faces: printKitFaces(cardEn, { en: longTitle }, longTitle),
      }),
    )
    const drawn = runs.join(' ')
    expect(drawn).toContain('Rate your visit')
    // The counter card sets the title as its eyebrow, in capitals.
    for (const word of longTitle.split(/\s+/u)) {
      expect(drawn.toUpperCase()).toContain(word.toUpperCase())
    }
  })

  it('declares PDF 1.4, the first level with the transparency a print may use', async () => {
    const text = await renderText(inputFor(style, tentEnBg))
    expect(text.startsWith('%PDF-1.4')).toBe(true)
  })

  it('draws the code as vectors, never as a picture', async () => {
    const text = await renderText(inputFor(style, tentEnBg))
    expect(text).not.toContain('/Subtype /Image')
    // Every run of the code is a rectangle, on each face the sheet shows.
    expect(text.match(/ re\n/gu)?.length ?? 0).toBeGreaterThanOrEqual(
      qrDarkRuns(qrMatrix(ADDRESS)).length,
    )
  })

  it('embeds the guest fonts as subsets', async () => {
    const text = await renderText(inputFor(style, tentEnBg))
    expect(text).toMatch(/\+CormorantGaramond/u)
    expect(text).toMatch(/\+YsabeauOffice-SemiBold/u)
    expect(text).toMatch(/\+YsabeauOffice-Regular/u)
    expect(text.match(/\/FontFile2/gu)?.length ?? 0).toBeGreaterThanOrEqual(4)
    // No standard font stands in for a missing one.
    expect(text).not.toContain('/Helvetica')
  })

  it('sets Cyrillic text in an embedded font: it reaches the text map', async () => {
    // U+041E, the capital O of "Оценете", is mapped back to text in the file.
    expect(await renderText(inputFor(style, tentEnBg))).toMatch(/<041E>/iu)
    const englishOnly = await renderText(
      inputFor(style, { piece: 'table_tent', languages: ['en'], callToAction: 'rate' }),
    )
    expect(englishOnly).not.toMatch(/<041E>/iu)
  })

  it('carries a logo as a picture in place of the wordmark', async () => {
    const logo = await sharp({
      create: { width: 200, height: 50, channels: 4, background: '#ffffff' },
    })
      .webp()
      .toBuffer()
    const text = await renderText(inputFor(style, tentEnBg, { logo, wordmark: 'Avela' }))
    expect(text.match(/\/Subtype \/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('drops characters no guest font carries instead of drawing broken glyphs', async () => {
    const input = inputFor(style, tentEnBg, { wordmark: 'Avela 酒' })
    const drawn = (await drawnRuns(input)).join(' ')
    expect(drawn).toContain('AVELA')
    expect(drawn).not.toContain('酒')
    // Nor does the file map a glyph for U+9152, while it does for the V of AVELA.
    const text = await renderText(input)
    expect(text).not.toMatch(/<9152>/iu)
    expect(text).toMatch(/<0056>/iu)
  })

  it('is the same bytes for the same input', async () => {
    const first = await renderer.render(inputFor(style, tentEnBg))
    const second = await renderer.render(inputFor(style, tentEnBg))
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('titles the document', async () => {
    expect(await renderText(inputFor(style, tentEnBg))).toContain('/Title ')
  })
})

/** The glyphs each tracked line (one set with a `Tc`) shows, in the order they are drawn. */
function trackedGlyphCounts(text: string): readonly number[] {
  return [...text.matchAll(/BT\n[^]*?\n([\d.]+) Tc\n\[([^\]]*)\] TJ\nET/gu)].map(
    ([, , shown]) =>
      (shown ?? '')
        .match(/<[0-9a-f]+>/gu)
        ?.join('')
        .replace(/[<>]/gu, '').length ?? 0,
  )
}

describe.each(PRINT_KIT_STYLES)('tracked lines in the %s print', (style) => {
  // Cormorant Garamond (the display face the wordmark is set in) has a TT ligature:
  // "TRATTORIA" lays out as eight glyphs, and the tracking, which acts between
  // glyphs, has nothing to put between the two T's.
  it('draws every letter of a tracked wordmark as its own glyph, so no ligature joins the TT of TRATTORIA', async () => {
    const text = await renderText(inputFor(style, tentEnBg, { wordmark: 'Trattoria' }))
    const [wordmark] = trackedGlyphCounts(text)

    // Four hex digits to a glyph.
    expect((wordmark ?? 0) / 4).toBe('TRATTORIA'.length)
  })

  it('lays a tracked line out without ligatures to measure it as well as to draw it', async () => {
    const drawn: { text: string; features: unknown }[] = []
    const measuredWithoutLigatures = new Set<string>()
    const text = PDFDocument.prototype.text
    const widthOfString = PDFDocument.prototype.widthOfString
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text')
    const widthSpy = vi.spyOn(PDFDocument.prototype, 'widthOfString')
    textSpy.mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      const [line, , , options] = args as [
        string,
        number,
        number,
        { features?: unknown; characterSpacing?: number },
      ]
      if ((options.characterSpacing ?? 0) > 0) {
        drawn.push({ text: line, features: options.features })
      } else {
        // An untracked line keeps its ligatures; the display face asks for lining figures.
        expect(options.features ?? {}, line).not.toHaveProperty('liga')
      }
      return text.apply(this, args as Parameters<typeof text>)
    })
    widthSpy.mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      const [line, options] = args as [
        string,
        { features?: { liga?: boolean } } | undefined,
      ]
      // PDFKit measures with no options inside text() too: keep the calls that ask.
      if (options?.features?.liga === false) measuredWithoutLigatures.add(line)
      return widthOfString.apply(this, args as Parameters<typeof widthOfString>)
    })
    try {
      await renderer.render(inputFor(style, tentEnBg, { wordmark: 'Trattoria' }))
    } finally {
      textSpy.mockRestore()
      widthSpy.mockRestore()
    }

    const noLigatures = { liga: false, clig: false, dlig: false }
    expect(drawn.map((line) => line.text)).toContain('TRATTORIA')
    for (const line of drawn) {
      // fontkit adds the features it applied to the object it is given.
      expect(line.features, line.text).toMatchObject(noLigatures)
      expect(measuredWithoutLigatures.has(line.text), line.text).toBe(true)
    }
  })
})
