import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  printKitFaces,
  type PrintKitChoice,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { BAND_PHOTO_DPI } from '#/shared/domain/portal-print-kit-sizes'
import {
  SOFT_PHOTO_NOTICE,
  lowestPhotoDpi,
  softPhotoNotice,
} from './print-kit-photo-notice'

const LOOK: PortalPrintKitView['look'] = {
  wordmark: 'Oakmere',
  propertyName: 'Oakmere by Larkspur Hotel',
  accentColour: '#D4E3FE',
  fieldColour: '#001E57',
  heroUrl: '/media/hero',
  heroFocal: { x: 0.5, y: 0.5 },
  heroSize: { width: 2400, height: 1600 },
  logoUrl: null,
}

const CHOICE: PrintKitChoice = {
  style: 'immersive',
  paper: 'letter',
  size: 'large',
  output: 'print_shop',
  piece: 'counter_card',
  languages: ['en'],
  callToAction: 'rate',
  showPropertyName: true,
}

/** The notice's inputs for a choice and a photo of `width` × `height` px (none when null). */
function inputFor(
  choice: Partial<PrintKitChoice>,
  photo: Readonly<{ width: number; height: number }> | null,
) {
  const picked = { ...CHOICE, ...choice }
  return {
    choice: picked,
    look: { ...LOOK, heroSize: photo, heroUrl: photo === null ? null : LOOK.heroUrl },
    faces: printKitFaces(picked, { en: 'Reception' }, 'Portal'),
    tile: CODE_TILE[picked.size][picked.paper],
  }
}

const PORTRAIT = { width: 500, height: 1000 }
/** The smallest photo the upload hint calls sharp: 1000 px wide, and as short as the server allows. */
const SMALLEST_SHARP = { width: 1000, height: 500 }

describe('softPhotoNotice', () => {
  it('says the portrait photo the server lets in is small for print on Immersive Large', () => {
    expect(softPhotoNotice(inputFor({}, PORTRAIT))).toBe(SOFT_PHOTO_NOTICE)
  })

  it('reads in the words the owner wrote, naming the width the upload asks for', () => {
    expect(SOFT_PHOTO_NOTICE).toBe(
      'Your photo is small for print and may look soft. For a sharp print, upload a photo at least 1000 px wide in Photo and colours.',
    )
  })

  it.each(['letter', 'a4'] as const)(
    'stays quiet for the smallest photo the hint calls sharp on %s, at a print shop and on an office sheet',
    (paper: PrintKitPaper) => {
      for (const output of ['print_shop', 'office'] as const) {
        const input = inputFor({ paper, output }, SMALLEST_SHARP)
        expect(lowestPhotoDpi(input)).toBeGreaterThanOrEqual(BAND_PHOTO_DPI.warnBelow)
        expect(softPhotoNotice(input)).toBeNull()
      }
    },
  )

  it('measures the photo across the band and its bleed: 500 px over 4.25 in', () => {
    expect(lowestPhotoDpi(inputFor({}, PORTRAIT))).toBeCloseTo(500 / 4.25, 6)
  })

  it('takes the photo’s height when that is what runs short', () => {
    // 4 000 px across but 150 px tall: the band is 1.425 in tall with its bleed.
    expect(lowestPhotoDpi(inputFor({}, { width: 4000, height: 150 }))).toBeCloseTo(
      150 / (1.3 + 1 / 8),
      6,
    )
  })

  it('shows nothing on Paper, which has no photo', () => {
    expect(
      softPhotoNotice(inputFor({ style: 'paper', output: 'office' }, PORTRAIT)),
    ).toBeNull()
  })

  it('shows nothing for a property with no photo', () => {
    expect(softPhotoNotice(inputFor({}, null))).toBeNull()
  })

  it('shows nothing for the Letter-half tent, whose small window is not a photo area', () => {
    expect(
      softPhotoNotice(inputFor({ piece: 'table_tent', size: 'large' }, PORTRAIT)),
    ).toBeNull()
  })

  it.each(['table', 'mini'] as const)(
    'follows the same rule on the %s card, which prints a smaller band',
    (size) => {
      expect(
        softPhotoNotice(inputFor({ size, output: 'print_shop' }, SMALLEST_SHARP)),
      ).toBeNull()
      expect(softPhotoNotice(inputFor({ size }, { width: 300, height: 600 }))).toBe(
        SOFT_PHOTO_NOTICE,
      )
    },
  )

  it('follows the same rule on the small tent’s panel', () => {
    const tent = { piece: 'table_tent', size: 'table' } as const
    expect(softPhotoNotice(inputFor(tent, { width: 120, height: 400 }))).toBe(
      SOFT_PHOTO_NOTICE,
    )
    expect(softPhotoNotice(inputFor(tent, { width: 2400, height: 1600 }))).toBeNull()
  })
})
