// The final Paper faces at their true size (final design spec §2 to §5, §8): the
// Counter card, the tent and the Small card, upright and wide, as the boards
// paper-*-upright and paper-*-wide draw them, from the layout the PDF draws. The
// code is the preview's sample, a version 3 symbol like a short print address.
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { printKitFaces } from '#/shared/domain/portal-print-kit'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
  type PrintFinalRegion,
} from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { pointsToPixels } from './print-kit-code-block-layout'
import { PrintFinalFaceArt } from './print-final-face-art'
import { usePrintKitCode } from './use-print-kit-code'

/** A blue badge logo, like the board's Harborline. */
const BADGE_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><path d="M40 10h280l36 90-36 90H40L4 100z" fill="#1D4FC4" stroke="#0B2E8A" stroke-width="6"/><text x="180" y="118" font-family="Georgia" font-style="italic" font-size="64" text-anchor="middle" fill="#fff">Harbor</text></svg>',
  )

const lookOf = (logo: boolean, accent: string): PortalPrintKitView['look'] => ({
  wordmark: 'Hotel Elegance',
  propertyName: 'Hotel Elegance',
  accentColour: accent,
  fieldColour: '#232323',
  heroUrl: null,
  heroFocal: null,
  heroSize: null,
  logoUrl: logo ? BADGE_LOGO : null,
})

type Args = Readonly<{
  logo: boolean
  accent: string
  languages: readonly GuestLocale[]
  region: PrintFinalRegion
}>

function Face({ face, args }: Readonly<{ face: PrintFinalFace; args: Args }>) {
  const code = usePrintKitCode(null)
  const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
  const [front] = printKitFaces(
    { piece: 'counter_card', languages: args.languages, callToAction: 'rate' },
    {
      en: 'Review us on Google',
      es: 'Reseñe en Google',
      de: 'Bewerten Sie uns auf Google',
    },
    'Reception',
  )
  if (tile.isErr() || front === undefined) return null
  const area = printFinalLiveArea(face)
  return (
    <figure data-final-face={`${face.piece}-${face.orientation}`} style={{ margin: 0 }}>
      <div
        style={{
          width: pointsToPixels(area.widthPt),
          height: pointsToPixels(area.heightPt),
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.2)',
        }}
      >
        <PrintFinalFaceArt
          face={face}
          blocks={front.blocks}
          look={lookOf(args.logo, args.accent)}
          tile={tile.value}
          codeUrl={code.url}
          pt={pointsToPixels}
        />
      </div>
      <figcaption style={{ font: '12px system-ui', marginTop: 6 }}>
        {face.piece} · {face.orientation}
      </figcaption>
    </figure>
  )
}

function Family(args: Args) {
  return (
    <main
      style={{
        padding: 24,
        background: 'var(--muted)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 24,
      }}
    >
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {PRINT_FINAL_PIECES.flatMap((piece) =>
        PRINT_FINAL_ORIENTATIONS.map((orientation) => (
          <Face
            key={`${piece}-${orientation}`}
            face={{ piece, orientation, look: 'paper', region: args.region }}
            args={args}
          />
        )),
      )}
    </main>
  )
}

const meta: Meta<typeof Family> = {
  title: 'Portal/PortalShare/Print kit final/Paper faces',
  component: Family,
  parameters: { layout: 'fullscreen' },
  args: { logo: true, accent: '#A8C6FE', languages: ['en'], region: 'us' },
}
export default meta
type Story = StoryObj<typeof Family>

/** Every code block is its tile wide plus the outline on each side: 1.5, 1.4 and 1.25 in. */
async function expectTilesAt(canvasElement: HTMLElement) {
  const blocks = Array.from(canvasElement.querySelectorAll('[data-print-code]'))
  await expect(blocks).toHaveLength(6)
  const widths = blocks.map((block) => block.getBoundingClientRect().width / 96)
  const tiles = [1.5, 1.5, 1.4, 1.4, 1.25, 1.25]
  for (const [index, width] of widths.entries()) {
    await expect(width).toBeCloseTo((tiles[index] ?? 0) + 0.7 / 25.4, 1)
  }
}

/** The boards' Harborline: a badge logo, in English. */
export const Harborline: Story = {
  play: async ({ canvasElement }) => {
    await expectTilesAt(canvasElement)
  },
}

/** No logo: the wordmark in tracked capitals takes its place. */
export const NoLogo: Story = { args: { logo: false, accent: '#D58400' } }

/** Two languages: in full on the Counter card and the wide pieces, one small italic line on the upright tent and Small card. */
export const TwoLanguages: Story = {
  args: { languages: ['en', 'es'] },
  play: async ({ canvasElement }) => {
    const italic = Array.from(canvasElement.querySelectorAll('span[lang="es"]')).filter(
      (span) => span instanceof HTMLElement && span.style.fontStyle === 'italic',
    )
    await expect(italic).toHaveLength(2)
  },
}

/** Long copy: German. */
export const German: Story = { args: { languages: ['de'] } }

/** Europe: A6, A7 and 85 × 54 mm. */
export const Europe: Story = { args: { region: 'eu' } }
