import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  PrintFinalRenderRefusal,
  type PrintFinalRenderInput,
} from '../../application/ports/portal-print-final-renderer.port'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'

// The final kit's single pieces as PDFs: one face per page at its trim, the
// words drawn in the embedded guest fonts, the address never drawn as text, and
// a piece whose symbol would print too small refused before any page.

const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const LONG =
  'https://web-closed-beta-v2.up.railway.app/p/pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hR?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

const renderer = createPdfKitPrintFinalRenderer({
  now: () => new Date('2026-10-25T10:00:00Z'),
  compress: false,
})

function inputFor(
  face: PrintFinalFace,
  languages: readonly GuestLocale[] = ['en'],
  over: Partial<PrintFinalRenderInput> = {},
): PrintFinalRenderInput {
  const blocks = printFinalBlocks(
    languages,
    { preset: 'how_did_we_do' },
    { en: 'Review us on Google', es: 'Reseñe en Google' },
    'Reception',
  )
  return {
    title: 'Hotel Elegance counter card',
    face,
    blocks: blocks,
    wordmark: 'Hotel Elegance',
    logo: null,
    accentColour: '#A8C6FE',
    fieldColour: '#001E57',
    photo: null,
    qrAddress: SHORT,
    address: 'short',
    ...over,
  }
}

const paper = (
  piece: PrintFinalFace['piece'],
  orientation: PrintFinalFace['orientation'],
) => ({ piece, orientation, look: 'paper', region: 'us' }) as const

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')

describe('createPdfKitPrintFinalRenderer', () => {
  it.each(
    PRINT_FINAL_PIECES.flatMap((piece) =>
      PRINT_FINAL_ORIENTATIONS.map((orientation) => [piece, orientation] as const),
    ),
  )('prints a Paper %s %s on one page at its trim', async (piece, orientation) => {
    const face = paper(piece, orientation)
    const pdf = text(await renderer.render(inputFor(face)))
    const area = printFinalLiveArea(face)
    const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gu)]
    expect(boxes).toHaveLength(1)
    expect(Number(boxes[0]?.[1])).toBeCloseTo(area.widthPt, 1)
    expect(Number(boxes[0]?.[2])).toBeCloseTo(area.heightPt, 1)
    expect(pdf).not.toContain('AP.UP.RAILWAY.APP')
  })

  it('embeds the true italic for the second-language line on the upright tent', async () => {
    const pdf = text(
      await renderer.render(inputFor(paper('tent', 'upright'), ['en', 'es'])),
    )
    expect(pdf).toMatch(/\/FontName \/[A-Z]{6}\+YsabeauOffice-Italic/u)
    const wide = text(
      await renderer.render(inputFor(paper('tent', 'wide'), ['en', 'es'])),
    )
    expect(wide).not.toMatch(/YsabeauOffice-Italic/u)
  })

  it('prints the Counter card on today’s long address, on its 2.1 in tile', async () => {
    const pdf = await renderer.render(
      inputFor(paper('counter', 'upright'), ['en'], { qrAddress: LONG, address: 'long' }),
    )
    expect(text(pdf)).toContain('/MediaBox [0 0 288 432]')
  })

  it('refuses a tent or a Small card on the long address before drawing', async () => {
    for (const piece of ['tent', 'small'] as const) {
      const refused = renderer.render(
        inputFor(paper(piece, 'wide'), ['en'], { qrAddress: LONG, address: 'long' }),
      )
      await expect(refused).rejects.toBeInstanceOf(PrintFinalRenderRefusal)
      await expect(refused).rejects.toMatchObject({
        refusal: { code: 'needs_short_code' },
      })
    }
  })

  it.each(
    PRINT_FINAL_PIECES.flatMap((piece) =>
      PRINT_FINAL_ORIENTATIONS.map((orientation) => [piece, orientation] as const),
    ),
  )(
    'prints a Paper %s %s in English and Spanish, the cues in the bar',
    async (piece, orientation) => {
      const pdf = await renderer.render(inputFor(paper(piece, orientation), ['en', 'es']))
      expect(text(pdf)).toContain('/MediaBox')
    },
  )

  it('keeps every short cue on one line, alone and beside English, on the pieces whose bars are narrowest', async () => {
    for (const locale of ['fr', 'de', 'bg', 'it'] as const) {
      const alone = await renderer.render(inputFor(paper('tent', 'wide'), [locale]))
      expect(text(alone)).toContain('/MediaBox')
      for (const piece of ['tent', 'small'] as const) {
        const pair = await renderer.render(inputFor(paper(piece, 'wide'), ['en', locale]))
        expect(text(pair)).toContain('/MediaBox')
      }
    }
  })

  it('refuses words the piece cannot hold at the smallest headline, before any page, and prints the other way up', async () => {
    const [block] = printFinalBlocks(['en'], { preset: 'how_did_we_do' }, {}, 'Reception')
    if (block === undefined) throw new Error('one block')
    const long = [
      {
        ...block,
        headline: 'Tell us how your visit went today, in a few quick taps now',
      },
    ]
    const upright = renderer.render(
      inputFor(paper('tent', 'upright'), ['en'], { blocks: long }),
    )
    await expect(upright).rejects.toBeInstanceOf(PrintFinalRenderRefusal)
    await expect(upright).rejects.toMatchObject({ refusal: { code: 'words_do_not_fit' } })
    const wide = await renderer.render(
      inputFor(paper('tent', 'wide'), ['en'], { blocks: long }),
    )
    expect(text(wide)).toContain('/MediaBox')
  })

  it('refuses "How was your visit?" in English and Spanish on an upright Paper tent, as the sweep says, and prints it wide', async () => {
    const blocks = printFinalBlocks(
      ['en', 'es'],
      { preset: 'how_was_visit' },
      {},
      'Reception',
    )
    // A badge as wide as Harborline's, so the brand is as tall as the boards' (8.2 mm on a tent).
    const logo = new Uint8Array(
      await sharp({
        create: { width: 910, height: 506, channels: 4, background: '#1D4FB8' },
      })
        .png()
        .toBuffer(),
    )
    const upright = renderer.render(
      inputFor(paper('tent', 'upright'), ['en', 'es'], { blocks, logo }),
    )
    await expect(upright).rejects.toMatchObject({ refusal: { code: 'words_do_not_fit' } })
    const wide = await renderer.render(
      inputFor(paper('tent', 'wide'), ['en', 'es'], { blocks, logo }),
    )
    expect(text(wide)).toContain('/MediaBox')
  })
})
