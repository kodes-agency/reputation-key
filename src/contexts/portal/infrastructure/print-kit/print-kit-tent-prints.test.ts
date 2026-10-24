// The small table tent as the PDF draws it (round-3 spec-delta S5): exact page
// sizes and boxes, the code on Table's tile rebuilding the symbol at that tile's
// module, the refusal of today's long address, one language a face, no name
// line, and the photo panel cropped once and held to the band's resolutions.

import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  printKitFaces,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitStyle,
  type PrintKitWords,
} from '#/shared/domain/portal-print-kit'
import { inToPt, mmToPt, ptToMm } from '#/shared/domain/portal-print-kit-measures'
import { pdfSubject } from './__fixtures__/print-kit-face-fixtures'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import type { PrintKitWarning } from './print-kit-pages'
import { qrMatrix } from './print-kit-qr'

const TOKEN = 'pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hRy3t'
/** Today's beta address: 159 characters, a version 9 symbol. */
const LONG = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10`
/** A short print address on the print host: version 3. */
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

type Case = Readonly<{
  style: PrintKitStyle
  paper?: PrintKitPaper
  output?: PrintKitOutput
  languages?: PrintKitWords['languages']
  address?: string
  photo?: PrintKitRenderInput['photo']
}>

function inputFor(options: Case): PrintKitRenderInput {
  return {
    title: 'Reception table tent',
    piece: 'table_tent',
    style: options.style,
    paper: options.paper ?? 'letter',
    size: 'table',
    output: options.output ?? (options.style === 'immersive' ? 'print_shop' : 'office'),
    faces: printKitFaces(
      {
        piece: 'table_tent',
        languages: options.languages ?? ['en'],
        callToAction: 'rate',
      },
      { en: 'Reception', es: 'Recepción' },
      'Reception',
    ),
    wordmark: 'Hotel Elegance',
    propertyName: 'Hotel Elegance by the Sea',
    logo: null,
    photo: options.photo ?? null,
    accentColour: '#D58400',
    fieldColour: '#232323',
    qrAddress: options.address ?? SHORT,
  }
}

const renderer = createPdfKitPrintKitRenderer({
  now: () => new Date('2026-10-24T12:00:00Z'),
  compress: false,
})

const render = async (options: Case) =>
  Buffer.from(await renderer.render(inputFor(options))).toString('latin1')

const boxes = (text: string, name: string): number[][] =>
  [...text.matchAll(new RegExp(`/${name} \\[([^\\]]+)\\]`, 'gu'))].map((match) =>
    (match[1] ?? '').trim().split(/\s+/u).map(Number),
  )

/** Every call of a document method while one print is drawn. */
async function callsOf(
  method: 'rect' | 'text',
  options: Case,
): Promise<readonly unknown[][]> {
  const spy = vi.spyOn(PDFDocument.prototype, method)
  try {
    await renderer.render(inputFor(options))
    return spy.mock.calls.map((call) => [...call])
  } finally {
    spy.mockRestore()
  }
}

const textsOf = async (options: Case) =>
  (await callsOf('text', options)).map(([value]) => String(value))

const photoOf = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#6D7F6A' } })
    .png()
    .toBuffer()

describe('the small tent’s pages', () => {
  it.each([
    ['paper', 'letter', [inToPt(11), inToPt(8.5)]],
    ['paper', 'a4', [mmToPt(297), mmToPt(210)]],
    ['immersive', 'letter', [inToPt(5.75), inToPt(7.75)]],
    ['immersive', 'a4', [mmToPt(150), mmToPt(200)]],
  ] as const)(
    'prints a %s tent on %s on one page of exactly %j pt',
    async (style, paper, page) => {
      const text = await render({ style, paper })
      const media = boxes(text, 'MediaBox')
      expect(media).toHaveLength(1)
      expect(media[0]?.[2]).toBeCloseTo(page[0], 2)
      expect(media[0]?.[3]).toBeCloseTo(page[1], 2)
      // Paper is for an office printer: its trim is the sheet, with no bleed declared.
      expect(boxes(text, 'BleedBox')).toHaveLength(style === 'immersive' ? 1 : 0)
    },
  )

  it('names the tent and its faces in the subject', async () => {
    expect(pdfSubject(await render({ style: 'immersive' }))).toBe(
      'Print kit: Immersive style, table tent, 5 × 3.5 in faces',
    )
    expect(pdfSubject(await render({ style: 'paper', paper: 'a4' }))).toBe(
      'Print kit: Paper style, table tent, A4',
    )
  })

  it('sets the sheet’s note, every word of it, with the bar’s width', async () => {
    const texts = await textsOf({ style: 'paper' })
    const start = texts.findIndex((text) => text.startsWith('Print at Actual size'))
    expect(start).toBeGreaterThanOrEqual(0)
    expect(texts.slice(start).join(' ')).toContain(
      'The bar under each code measures 1.4 in (3.6 cm). Cut on the ticks, score and fold on the dashed line: each tent stands about 3.4 in tall.',
    )
  })

  it('refuses an Immersive office sheet: it is not drawn', async () => {
    await expect(
      renderer.render(inputFor({ style: 'immersive', output: 'office' })),
    ).rejects.toThrow(/Not a printable choice/u)
  })
})

describe('the small tent’s code', () => {
  it.each([
    ['paper', 'letter', inToPt(1.4), 0.961],
    ['immersive', 'a4', mmToPt(36), 0.973],
  ] as const)(
    'on a %s tent on %s rebuilds the short address’s symbol at its tile’s module',
    async (style, paper, tilePt, moduleMm) => {
      const expected = qrMatrix(SHORT)
      const module = tilePt / (expected.size + 8)
      const runs = (await callsOf('rect', { style, paper }))
        .map((call) => call.map(Number))
        .filter(([, , , h]) => Math.abs((h ?? 0) - module) < 1e-6)
      const left = Math.min(...runs.map(([x]) => x ?? 0))
      const top = Math.min(...runs.map(([, y]) => y ?? 0))
      const dark = new Set<string>()
      for (const [x = 0, y = 0, width = 0] of runs) {
        const row = Math.round((y - top) / module)
        const column = Math.round((x - left) / module)
        for (let step = 0; step < Math.round(width / module); step += 1) {
          dark.add(`${row}:${column + step}`)
        }
      }
      for (let row = 0; row < expected.size; row += 1) {
        for (let column = 0; column < expected.size; column += 1) {
          expect(dark.has(`${row}:${column}`), `${row}:${column}`).toBe(
            expected.isDark(row, column),
          )
        }
      }
      expect(ptToMm(module)).toBeCloseTo(moduleMm, 3)
    },
  )

  it.each(['paper', 'immersive'] as const)(
    'refuses today’s long beta address on a %s tent: it needs a short code',
    async (style) => {
      await expect(
        renderer.render(inputFor({ style, address: LONG })),
      ).rejects.toMatchObject({
        name: 'PrintKitRenderRefusal',
        refusal: {
          code: 'print_code_too_small',
          cause: 'needs_short_code',
          size: 'table',
        },
      })
    },
  )
})

describe('the small tent’s words', () => {
  it('prints one language a face: the lead on the fronts, the second on the backs, and their cues', async () => {
    const texts = await textsOf({ style: 'paper', languages: ['en', 'es'] })
    const count = (text: string) => texts.filter((value) => value === text).length
    expect(count('Rate your visit')).toBe(2)
    expect(count('Valore su visita')).toBe(2)
    expect(count('Scan with your camera')).toBe(2)
    expect(count('Escanee con la cámara')).toBe(2)
  })

  it('prints no name under the brand (D12)', async () => {
    const texts = await textsOf({ style: 'immersive' })
    expect(texts.some((text) => text.includes('BY THE SEA'))).toBe(false)
  })
})

describe('the photo panel', () => {
  it('crops the photo once for both faces of an Immersive tent', async () => {
    const bytes = await photoOf(1200, 1600)
    const text = await render({
      style: 'immersive',
      photo: { bytes, focalX: 0.5, focalY: 0.5 },
    })
    expect(text.match(/\/Subtype \/Image/gu) ?? []).toHaveLength(1)
  })

  it('warns under 200 dpi, and still prints under 120', async () => {
    const warnings: PrintKitWarning[] = []
    const warned = createPdfKitPrintKitRenderer({
      now: () => new Date('2026-10-24T12:00:00Z'),
      warn: (warning) => warnings.push(warning),
    })
    const soft = await photoOf(240, 640)
    await warned.render({
      ...inputFor({ style: 'immersive' }),
      photo: { bytes: soft, focalX: 0.5, focalY: 0.5 },
    })
    expect(warnings).toContainEqual(
      expect.objectContaining({
        message: 'The print kit photo prints below the resolution a print needs',
      }),
    )
    const blurred = await photoOf(100, 300)
    const pdf = await warned.render({
      ...inputFor({ style: 'immersive' }),
      photo: { bytes: blurred, focalX: 0.5, focalY: 0.5 },
    })
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
