import { describe, expect, it } from 'vitest'
import { previewFinalMeasurer } from '#/components/features/portal/portal-share/print-final-face-layout'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { layoutPrintFinalFace } from '#/shared/domain/portal-print-final-face'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import type { PrintFinalTextMeasurer } from '#/shared/domain/portal-print-final-text'
import { printFinalWordsFit } from '#/shared/domain/portal-print-final-words-fit'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The manager's own words through the shared planner (spec 5.7, 12.1 "Shared
// planner parity"): the file, measured with the fonts it embeds, and Share's
// preview, measured by its estimates, agree on the measured custom headlines of
// the spec. A headline that steps prints at 17 pt on US tents; one that is
// refused on the upright tent fits the wide one at the floor.

const { doc, fonts } = newDocument()
const MEASURERS: Readonly<Record<string, PrintFinalTextMeasurer>> = {
  pdf: pdfFinalMeasurer(doc, fonts),
  preview: previewFinalMeasurer,
}

const tent = (orientation: PrintFinalFace['orientation']): PrintFinalFace => ({
  piece: 'tent',
  orientation,
  look: 'paper',
  region: 'us',
})

const fitOf = (
  headline: string,
  face: PrintFinalFace,
  measurer: PrintFinalTextMeasurer,
) =>
  printFinalWordsFit(
    face,
    printFinalBlocks(
      ['en'],
      {
        preset: 'how_did_we_do',
        custom: { en: { headline, subline: 'About 30 seconds' } },
      },
      {},
      'Reception',
    ),
    (each, blocks, ownStepOnly) =>
      layoutPrintFinalFace({
        face: each,
        blocks,
        // A square badge, as the boards' Oakmere logo the spec measured with.
        brand: { kind: 'logo', inkWidth: 1, inkHeight: 1, onPlate: false },
        tile: choosePrintFinalTile({
          ...each,
          address: 'short',
          symbolModules: 29,
        })._unsafeUnwrap(),
        measurer,
        ownStepOnly,
      }),
  )

describe.each(Object.entries(MEASURERS))(
  'own words, measured by the %s',
  (_name, measurer) => {
    it('prints "Thanks for staying with us" at full size on a wide tent', () => {
      expect(fitOf('Thanks for staying with us', tent('wide'), measurer)).toMatchObject({
        state: 'full',
        headlinePt: 19,
      })
    })

    it('steps "How was your stay with us tonight?" to 17 pt on US tents', () => {
      expect(
        fitOf('How was your stay with us tonight?', tent('wide'), measurer),
      ).toMatchObject({
        state: 'step',
        headlinePt: 17,
      })
    })

    it('refuses the 48-character headline on the upright tent, and the wide tent takes it at the floor', () => {
      const headline = 'Tell us how your visit went today, in a few taps'
      expect(fitOf(headline, tent('upright'), measurer).state).toBe('refused')
      expect(fitOf(headline, tent('wide'), measurer)).toMatchObject({
        state: 'step',
        headlinePt: 16.5,
        otherRefused: true,
      })
    })
  },
)
