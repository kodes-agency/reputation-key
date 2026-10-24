// Table and Mini prints and the Immersive office sheets, as the PDF draws them
// (round-3 spec-delta S2, S4 and S6; round-2 R4): exact page sizes and boxes, the
// code on each size's tile rebuilding the symbol at that tile's module, the
// refusal of today's long address on the small tiles, the per-edge bleed of an
// office sheet's abutting cards, the Mini turned a quarter in its cell, and the
// sheet's note set in its box.

import PDFDocument from 'pdfkit'
import { describe, expect, it, vi } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  printKitFaces,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitSize,
  type PrintKitStyle,
  type PrintKitWords,
} from '#/shared/domain/portal-print-kit'
import { inToPt, mmToPt, ptToMm } from '#/shared/domain/portal-print-kit-measures'
import { pdfSubject } from './__fixtures__/print-kit-face-fixtures'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

const TOKEN = 'pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hRy3t'
/** Today's beta address: 159 characters, a version 9 symbol. */
const LONG = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10`
/** A short print address on the print host: version 3. */
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

const renderer = createPdfKitPrintKitRenderer({
  now: () => new Date('2026-10-24T12:00:00Z'),
  compress: false,
})

type Case = Readonly<{
  size: PrintKitSize
  style: PrintKitStyle
  paper?: PrintKitPaper
  output?: PrintKitOutput
  languages?: PrintKitWords['languages']
  address?: string
}>

function inputFor(options: Case): PrintKitRenderInput {
  const languages = options.languages ?? ['en']
  return {
    title: 'Reception table card',
    piece: 'counter_card',
    style: options.style,
    paper: options.paper ?? 'letter',
    size: options.size,
    output: options.output ?? (options.style === 'immersive' ? 'print_shop' : 'office'),
    faces: printKitFaces(
      { piece: 'counter_card', languages, callToAction: 'rate' },
      { en: 'Reception', es: 'Recepción' },
      'Reception',
    ),
    wordmark: 'Hotel Elegance',
    propertyName: 'Hotel Elegance',
    logo: null,
    photo: null,
    accentColour: '#D58400',
    fieldColour: '#232323',
    qrAddress: options.address ?? SHORT,
  }
}

const render = async (options: Case) =>
  Buffer.from(await renderer.render(inputFor(options))).toString('latin1')

const boxes = (text: string, name: string): number[][] =>
  [...text.matchAll(new RegExp(`/${name} \\[([^\\]]+)\\]`, 'gu'))].map((match) =>
    (match[1] ?? '').trim().split(/\s+/u).map(Number),
  )

/** Every call of a document method while one print is drawn. */
async function callsOf(
  method: 'rect' | 'rotate' | 'text',
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

/** The symbol rebuilt from the runs one module tall, read from the first card's top-left run. */
function rebuild(rects: readonly unknown[][], module: number, size: number): QrMatrix {
  const runs = rects
    .map((call) => call.map(Number))
    .filter(([, , , h]) => Math.abs((h ?? 0) - module) < 1e-6)
  const left = Math.min(...runs.map(([x]) => x ?? 0))
  const top = Math.min(...runs.map(([, y]) => y ?? 0))
  const dark = new Set<string>()
  for (const [x = 0, y = 0, width = 0] of runs) {
    const row = Math.round((y - top) / module)
    const column = Math.round((x - left) / module)
    if (row >= size || column >= size) continue
    for (let step = 0; step < Math.round(width / module); step += 1) {
      dark.add(`${row}:${column + step}`)
    }
  }
  return { size, isDark: (row, column) => dark.has(`${row}:${column}`) }
}

describe('the small sizes’ code', () => {
  it.each([
    ['table', 'paper', 'letter', inToPt(1.4), 0.961],
    ['table', 'immersive', 'a4', mmToPt(36), 0.973],
    ['mini', 'paper', 'letter', inToPt(1.25), 0.858],
    ['mini', 'immersive', 'a4', mmToPt(32), 0.865],
  ] as const)(
    'on a %s %s card on %s rebuilds the short address’s symbol at its tile’s module',
    async (size, style, paper, tilePt, moduleMm) => {
      const expected = qrMatrix(SHORT)
      const module = tilePt / (expected.size + 8)
      const rebuilt = rebuild(
        await callsOf('rect', { size, style, paper }),
        module,
        expected.size,
      )
      for (let row = 0; row < expected.size; row += 1) {
        for (let column = 0; column < expected.size; column += 1) {
          expect(rebuilt.isDark(row, column), `${row}:${column}`).toBe(
            expected.isDark(row, column),
          )
        }
      }
      expect(ptToMm(module)).toBeCloseTo(moduleMm, 3)
      expect(ptToMm(module)).toBeGreaterThanOrEqual(0.85)
    },
  )

  it.each(['table', 'mini'] as const)(
    'refuses today’s long beta address on a %s card: it needs a short code',
    async (size) => {
      await expect(
        renderer.render(inputFor({ size, style: 'paper', address: LONG })),
      ).rejects.toMatchObject({
        name: 'PrintKitRenderRefusal',
        refusal: { code: 'print_code_too_small', cause: 'needs_short_code', size },
      })
    },
  )
})

describe('the small sizes’ pages', () => {
  it.each([
    ['table', 'paper', 'letter', 'office', [612, 792]],
    ['table', 'paper', 'a4', 'office', [mmToPt(210), mmToPt(297)]],
    ['table', 'immersive', 'letter', 'office', [612, 792]],
    ['table', 'immersive', 'a4', 'office', [mmToPt(210), mmToPt(297)]],
    ['table', 'immersive', 'letter', 'print_shop', [inToPt(4.25), inToPt(5.75)]],
    ['mini', 'paper', 'letter', 'office', [612, 792]],
    ['mini', 'paper', 'a4', 'office', [mmToPt(210), mmToPt(297)]],
    ['mini', 'immersive', 'a4', 'print_shop', [mmToPt(75), mmToPt(105)]],
  ] as const)(
    'prints a %s %s card on %s for %s on pages of exactly %j pt',
    async (size, style, paper, output, page) => {
      const text = await render({ size, style, paper, output })
      const [media] = boxes(text, 'MediaBox')
      expect(media?.[2]).toBeCloseTo(page[0], 2)
      expect(media?.[3]).toBeCloseTo(page[1], 2)
      // An office sheet declares no bleed: its trim is the sheet, for an office printer.
      expect(boxes(text, 'BleedBox')).toHaveLength(output === 'print_shop' ? 1 : 0)
    },
  )

  it('names the size in the subject', async () => {
    expect(pdfSubject(await render({ size: 'table', style: 'immersive' }))).toBe(
      'Print kit: Immersive style, table card, 3.5 × 5 in',
    )
    expect(pdfSubject(await render({ size: 'mini', style: 'paper' }))).toBe(
      'Print kit: Paper style, mini card, US Letter',
    )
  })

  it('bleeds each abutting Immersive Table card only on the block’s outer edges', async () => {
    const rects = (
      await callsOf('rect', { size: 'table', style: 'immersive', output: 'office' })
    ).map((call) => call.map((value) => Number(Number(value).toFixed(3))))
    const bleed = 9
    const card = [inToPt(3.5), inToPt(5)]
    const fieldOf = (left: number, top: number, right: number, bottom: number) => [
      -left || 0,
      -top || 0,
      (card[0] ?? 0) + left + right,
      (card[1] ?? 0) + top + bottom,
    ]
    for (const field of [
      fieldOf(bleed, bleed, 0, 0),
      fieldOf(0, bleed, bleed, 0),
      fieldOf(bleed, 0, 0, bleed),
      fieldOf(0, 0, bleed, bleed),
    ]) {
      expect(rects).toContainEqual(field)
    }
  })

  it('turns each of the ten Mini cards a quarter, anticlockwise', async () => {
    const turns = (await callsOf('rotate', { size: 'mini', style: 'paper' })).filter(
      ([angle]) => angle === -90,
    )
    // Ten cards, and the note runs flat under the Letter grid.
    expect(turns).toHaveLength(10)
  })

  it('sets the Table sheet’s note in its box, every word of it', async () => {
    const texts = (await callsOf('text', { size: 'table', style: 'paper' })).map(
      ([text]) => String(text),
    )
    const start = texts.findIndex((text) =>
      text.startsWith('Print at Actual size (100%).'),
    )
    expect(start).toBeGreaterThanOrEqual(0)
    expect(texts.slice(start).join(' ')).toContain(
      'The bar under each code measures 1.4 in (3.6 cm). Cut on the ticks: 3 cuts down, 3 across.',
    )
  })

  it('prints the Immersive Large office sheet: two cards on a landscape Letter sheet at the tile the address allows', async () => {
    const text = await render({
      size: 'large',
      style: 'immersive',
      output: 'office',
      address: LONG,
    })
    const [media] = boxes(text, 'MediaBox')
    expect(media?.slice(2)).toEqual([792, 612])
    const texts = (
      await callsOf('text', {
        size: 'large',
        style: 'immersive',
        output: 'office',
        address: LONG,
      })
    ).map(([value]) => String(value))
    expect(texts.join(' ')).toContain('measures 2 in (5.1 cm)')
  })
})
