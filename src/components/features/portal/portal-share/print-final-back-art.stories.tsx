// The optional back page at its true size (final design spec §10.4), as the
// board back-side draws it: the Counter card upright and the Small card wide, in
// both looks. The logo, or the wordmark, and the property's name, in the middle of
// the live area 44 : 56, with no code; Immersive stands on the front's ground and
// washes with no photo, the logo on its cream plate where the front puts it there.
// The pictures are drawn here, not a hotel's.
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printKitFaces } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { pointsToPixels } from './print-kit-code-block-layout'
import { PrintFinalDrawnBackArt } from './print-final-back-art'
import { BADGE_LOGO, DARK_LOGO, PHOTO } from './print-final-story-fixtures'
import { usePrintFinalDrawnBack } from './use-print-final-drawn-back'
import { usePrintFinalDrawnFace } from './use-print-final-drawn-face'

const look = (
  over: Partial<PortalPrintKitView['look']> = {},
): PortalPrintKitView['look'] => ({
  wordmark: 'Hotel Elegance',
  propertyName: 'Harborline Inn Millbrook-Near The Arboretum',
  accentColour: '#A8C6FE',
  fieldColour: '#16224A',
  heroUrl: PHOTO,
  heroFocal: { x: 0.5, y: 0.4 },
  heroSize: { width: 1620, height: 1080 },
  logoUrl: BADGE_LOGO,
  ...over,
})

function Back({
  face,
  look: print,
}: Readonly<{ face: PrintFinalFace; look: PortalPrintKitView['look'] }>) {
  const tile = choosePrintFinalTile({
    ...face,
    address: 'short',
    symbolModules: 29,
  })._unsafeUnwrap()
  const [front] = printKitFaces(
    { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
    { en: 'Review us on Google' },
    'Reception',
  )
  const drawnFront = usePrintFinalDrawnFace({
    face,
    blocks: front?.blocks ?? [],
    look: print,
    tile,
  })
  const drawn = usePrintFinalDrawnBack({
    face,
    look: print,
    front: drawnFront,
    enabled: true,
  })
  const area = printFinalLiveArea(face)
  if (drawn === null) return null
  return (
    <figure data-final-card={`${face.piece}-${face.look}`} style={{ margin: 0 }}>
      <div
        style={{
          width: pointsToPixels(area.widthPt),
          height: pointsToPixels(area.heightPt),
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.2)',
        }}
      >
        <PrintFinalDrawnBackArt drawn={drawn} look={print} pt={pointsToPixels} />
      </div>
      <figcaption style={{ font: '12px system-ui', marginTop: 6 }}>
        {face.piece} back · {face.look}
      </figcaption>
    </figure>
  )
}

function Backs({
  papers,
  immersive,
}: Readonly<{
  papers: PortalPrintKitView['look']
  immersive: PortalPrintKitView['look']
}>) {
  return (
    <main
      style={{
        padding: 24,
        background: 'var(--muted)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: 24,
      }}
    >
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <Back
        face={{ piece: 'counter', orientation: 'upright', look: 'paper', region: 'us' }}
        look={papers}
      />
      <Back
        face={{
          piece: 'counter',
          orientation: 'upright',
          look: 'immersive',
          region: 'us',
        }}
        look={immersive}
      />
      <Back
        face={{ piece: 'small', orientation: 'wide', look: 'paper', region: 'us' }}
        look={papers}
      />
      <Back
        face={{ piece: 'small', orientation: 'wide', look: 'immersive', region: 'us' }}
        look={immersive}
      />
    </main>
  )
}

const meta: Meta<typeof Backs> = {
  title: 'Portal/PortalShare/Print kit final/Backs',
  component: Backs,
  parameters: { layout: 'fullscreen' },
  args: {
    papers: look(),
    immersive: look({
      logoUrl: DARK_LOGO,
      accentColour: '#D4E3FE',
      propertyName: 'Oakmere by Larkspur Hotel Millbrook Field Airport',
    }),
  },
}
export default meta
type Story = StoryObj<typeof Backs>

/** The board back-side: no code anywhere, two Paper backs on plain paper and two Immersive on the ground. */
export const BackSide: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-final-back]')).toHaveLength(4)
    await expect(canvasElement.querySelectorAll('[data-print-code]')).toHaveLength(0)
    await expect(
      canvasElement.querySelectorAll('[data-final-back="immersive"]'),
    ).toHaveLength(2)
  },
}

/** No logo: the wordmark sets in tracked capitals, and the name under it where it says something else. */
export const NoLogo: Story = {
  args: {
    papers: look({
      logoUrl: null,
      wordmark: 'Elegance',
      propertyName: 'Hotel Elegance Lisbon',
    }),
    immersive: look({
      logoUrl: null,
      wordmark: 'Hotel Elegance',
      propertyName: 'Hotel Elegance',
      accentColour: '#E3B873',
      fieldColour: '#2A1712',
    }),
  },
}
