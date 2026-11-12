import { describe, expect, it } from 'vitest'
import { previewMeasurer } from '#/components/features/portal/portal-share/print-face-layout'
import type { PrintFace } from '#/shared/domain/portal-print'
import { choosePrintTile } from '#/shared/domain/portal-print-code'
import { layoutPrintFace } from '#/shared/domain/portal-print-face'
import { printBlocks } from '#/shared/domain/portal-print-languages'
import type { PrintTextMeasurer } from '#/shared/domain/portal-print-text'
import { printWordsFit } from '#/shared/domain/portal-print-words-fit'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfMeasurer } from './print-kit-face'

// The manager's own words through the shared planner (spec 5.7, 12.1 "Shared
// planner parity"): the file, measured with the fonts it embeds, and Share's
// preview, measured by its estimates, agree on the measured custom headlines of
// the spec. A headline that steps prints at 17 pt on US tents; one that is
// refused on the upright tent fits the wide one at the floor.

const { doc, fonts } = newDocument()
const MEASURERS: Readonly<Record<string, PrintTextMeasurer>> = {
  pdf: pdfMeasurer(doc, fonts),
  preview: previewMeasurer,
}

const tent = (orientation: PrintFace['orientation']): PrintFace => ({
  piece: 'tent',
  orientation,
  look: 'paper',
  region: 'us',
})

const fitOf = (headline: string, face: PrintFace, measurer: PrintTextMeasurer) =>
  printWordsFit(
    face,
    printBlocks(
      ['en'],
      {
        preset: 'how_did_we_do',
        custom: { en: { headline, subline: 'About 30 seconds' } },
      },
      {},
      'Reception',
    ),
    (each, blocks, ownStepOnly) =>
      layoutPrintFace({
        face: each,
        blocks,
        // A square badge, as the boards' Oakmere logo the spec measured with.
        brand: { kind: 'logo', inkWidth: 1, inkHeight: 1, onPlate: false },
        tile: choosePrintTile({
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
    it.each(['upright', 'wide'] as const)(
      'refuses an unbreakable 60-W headline on a %s tent',
      (orientation) => {
        expect(fitOf('W'.repeat(60), tent(orientation), measurer).state).toBe('refused')
      },
    )

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
