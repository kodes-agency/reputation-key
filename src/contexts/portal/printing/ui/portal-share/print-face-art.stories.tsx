// The faces at their true size (design spec §2 to §8): the Counter
// card, the tent and the Small card, upright and wide, as the boards
// paper-*-{upright,wide}, imm-*-{upright,wide} and hard-* draw them, from the
// layout the PDF draws. The code is the preview's sample, a version 3 symbol
// like a short print address. The photo is drawn here, not a hotel's: a lit
// interior with a pale bed where the words go and a dark floor.
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  PRINT_ORIENTATIONS,
  PRINT_PIECES,
  type PrintFace,
  type PrintRegion,
} from '#/shared/domain/portal-print'
import { choosePrintTile, type PrintTile } from '#/shared/domain/portal-print-code'
import { printLiveArea } from '#/shared/domain/portal-print-measures'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintDrawnFaceArt } from './print-face-art'
import {
  BADGE_LOGO,
  DARK_LOGO,
  PHOTO,
  pointsToPixels,
  storyFrontBlocks,
} from './print-story-fixtures'
import { usePrintDrawnFace } from './use-print-drawn-face'
import { usePrintKitCode } from './use-print-kit-code'

type LookKind = 'paper' | 'immersive'

const lookOf = (args: Args): PortalPrintKitView['look'] => ({
  wordmark: 'Hotel Elegance',
  propertyName: 'Hotel Elegance',
  accentColour: args.accent,
  fieldColour: args.field,
  heroUrl: args.photo ? PHOTO : null,
  heroFocal: args.photo ? { x: 0.5, y: 0.4 } : null,
  heroSize: args.photo ? { width: 1620, height: 1080 } : null,
  logoUrl: args.logo === 'none' ? null : args.logo === 'badge' ? BADGE_LOGO : DARK_LOGO,
})

type Args = Readonly<{
  look: LookKind
  logo: 'badge' | 'dark' | 'none'
  photo: boolean
  field: string
  accent: string
  languages: readonly GuestLocale[]
  region: PrintRegion
}>

function Face({ face, args }: Readonly<{ face: PrintFace; args: Args }>) {
  const tile = choosePrintTile({ ...face, address: 'short', symbolModules: 29 })
  if (tile.isErr()) return null
  return <DrawnFace face={face} args={args} tile={tile.value} />
}

function DrawnFace({
  face,
  args,
  tile,
}: Readonly<{ face: PrintFace; args: Args; tile: PrintTile }>) {
  const code = usePrintKitCode(null)
  const look = lookOf(args)
  const blocks = storyFrontBlocks(
    args.languages,
    {
      en: 'Review us on Google',
      es: 'Reseñe en Google',
      de: 'Bewerten Sie uns auf Google',
    },
    'Reception',
  )
  const drawn = usePrintDrawnFace({ face, blocks, look, tile })
  const area = printLiveArea(face)
  return (
    <figure data-final-face={`${face.piece}-${face.orientation}`} style={{ margin: 0 }}>
      <div
        style={{
          width: pointsToPixels(area.widthPt),
          height: pointsToPixels(area.heightPt),
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.2)',
        }}
      >
        <PrintDrawnFaceArt
          drawn={drawn}
          look={look}
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
        overflowX: 'auto',
        padding: 24,
        background: 'var(--muted)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 24,
      }}
    >
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {PRINT_PIECES.flatMap((piece) =>
        PRINT_ORIENTATIONS.map((orientation) => (
          <Face
            key={`${piece}-${orientation}`}
            face={{ piece, orientation, look: args.look, region: args.region }}
            args={args}
          />
        )),
      )}
    </main>
  )
}

const meta: Meta<typeof Family> = {
  title: 'Portal/PortalShare/Print kit/Faces',
  component: Family,
  parameters: { layout: 'fullscreen' },
  args: {
    look: 'paper',
    logo: 'badge',
    photo: true,
    field: '#001E57',
    accent: '#A8C6FE',
    languages: ['en'],
    region: 'us',
  },
}
export default meta
type Story = StoryObj<typeof Family>

/** Every code block is its tile wide, plus Paper's outline on each side: 1.5, 1.4 and 1.25 in. */
async function expectTilesAt(canvasElement: HTMLElement, outlineIn = 0.7 / 25.4) {
  const blocks = Array.from(canvasElement.querySelectorAll('[data-print-code]'))
  await expect(blocks).toHaveLength(6)
  const widths = blocks.map((block) => block.getBoundingClientRect().width / 96)
  const tiles = [1.5, 1.5, 1.4, 1.4, 1.25, 1.25]
  for (const [index, width] of widths.entries()) {
    await expect(width).toBeCloseTo((tiles[index] ?? 0) + outlineIn, 1)
  }
}

/** What each drawn face holds: its look, the logo pictures (none without a logo) and the photo (Immersive only). */
function drawnFaces(canvasElement: HTMLElement) {
  const faces = Array.from(
    canvasElement.querySelectorAll<HTMLElement>('[data-final-face]'),
  )
  const imagesOf = (face: HTMLElement) =>
    Array.from(face.querySelectorAll('img')).filter(
      (image) => image.closest('[data-print-code]') === null,
    )
  return {
    faces,
    looks: faces.map((face) =>
      face.querySelector('[data-final-look]')?.getAttribute('data-final-look'),
    ),
    logos: faces.map((face) => imagesOf(face).filter((image) => image.src !== PHOTO)),
    photos: faces.map((face) => imagesOf(face).filter((image) => image.src === PHOTO)),
  }
}

/** All six faces are drawn in one look, and the code sits in its tile on each. */
async function expectFamily(
  canvasElement: HTMLElement,
  look: LookKind,
  { logo, photo }: Readonly<{ logo: boolean; photo: boolean }>,
) {
  const drawn = drawnFaces(canvasElement)
  await expect(drawn.faces).toHaveLength(6)
  await expect(drawn.looks).toEqual(Array(6).fill(look))
  for (const images of drawn.logos) await expect(images.length > 0).toBe(logo)
  for (const images of drawn.photos) await expect(images.length > 0).toBe(photo)
  await expectTilesAt(canvasElement, look === 'paper' ? undefined : 0)
}

/** A language's wording is set, in capitals as the faces draw it (wrapped over lines when long), on at least the four faces that carry the call to action. */
async function expectWording(canvasElement: HTMLElement, lang: string, text: string) {
  const squash = (value: string) => value.replace(/\s+/g, '').toLowerCase()
  const carrying = drawnFaces(canvasElement).faces.filter((face) =>
    squash(
      Array.from(face.querySelectorAll(`span[lang="${lang}"]`))
        .map((span) => span.textContent ?? '')
        .join(''),
    ).includes(squash(text)),
  )
  await expect(carrying.length).toBeGreaterThanOrEqual(4)
}

/** The boards' Harborline: a badge logo, in English. */
export const Harborline: Story = {
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'paper', { logo: true, photo: false })
  },
}

/** No logo: the wordmark in tracked capitals takes its place. */
export const NoLogo: Story = {
  args: { logo: 'none', accent: '#D58400' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'paper', { logo: false, photo: false })
    for (const face of drawnFaces(canvasElement).faces)
      await expect(face.textContent?.toUpperCase()).toContain('ELEGANCE')
  },
}

/** Two languages: in full on the Counter card and the wide pieces, one small italic line on the upright tent and Small card. */
export const TwoLanguages: Story = {
  args: { languages: ['en', 'es'] },
  play: async ({ canvasElement }) => {
    const italic = Array.from(canvasElement.querySelectorAll('span[lang="es"]')).filter(
      (span) => span instanceof HTMLElement && span.style.fontStyle === 'italic',
    )
    await expect(italic).toHaveLength(2)
    await expectWording(canvasElement, 'es', 'Valore su visita')
  },
}

/** Long copy: German. */
export const German: Story = {
  args: { languages: ['de'] },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'paper', { logo: true, photo: false })
    await expectWording(canvasElement, 'de', 'Bewerten Sie uns auf Google')
  },
}

/** Europe: A6, A7 and 85 × 54 mm. */
export const Europe: Story = {
  args: { region: 'eu' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'paper', { logo: true, photo: false })
    const drawn = drawnFaces(canvasElement)
    const faceWidths = drawn.faces.map(
      (face) => face.querySelector('[data-final-look]')?.getBoundingClientRect().width,
    )
    const expected = PRINT_PIECES.flatMap((piece) =>
      PRINT_ORIENTATIONS.map((orientation) =>
        pointsToPixels(
          printLiveArea({ piece, orientation, look: 'paper', region: 'eu' }).widthPt,
        ),
      ),
    )
    for (const [index, width] of faceWidths.entries())
      await expect(width).toBeCloseTo(parseFloat(expected[index] ?? '0'), 0)
  },
}

/** Immersive, the board's Hotel Elegance: no logo, a light interior photo; the scrims deepen until every line reads. */
export const ImmersiveElegance: Story = {
  args: { look: 'immersive', logo: 'none', field: '#2A1712', accent: '#E3B873' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: false, photo: true })
  },
}

/** Immersive with a dark logo: it sits on the cream plate. */
export const ImmersiveDarkLogo: Story = {
  args: { look: 'immersive', logo: 'dark', accent: '#D4E3FE' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: true, photo: true })
  },
}

/** Immersive with a blue badge: a mid-tone logo, so it gets the plate too. */
export const ImmersiveBadge: Story = {
  args: { look: 'immersive', logo: 'badge' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: true, photo: true })
  },
}

/** Immersive with no photo: the guest page's washes, grain, and the arch on upright pieces. */
export const ImmersiveNoPhoto: Story = {
  args: { look: 'immersive', logo: 'dark', photo: false, accent: '#D4E3FE' },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: true, photo: false })
  },
}

/** Immersive in English and Spanish. */
export const ImmersiveTwoLanguages: Story = {
  args: { look: 'immersive', logo: 'dark', accent: '#D4E3FE', languages: ['en', 'es'] },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: true, photo: true })
    await expectWording(canvasElement, 'es', 'Valore su visita')
  },
}

/** Immersive long copy: German. */
export const ImmersiveGerman: Story = {
  args: { look: 'immersive', logo: 'dark', accent: '#D4E3FE', languages: ['de'] },
  play: async ({ canvasElement }) => {
    await expectFamily(canvasElement, 'immersive', { logo: true, photo: true })
    await expectWording(canvasElement, 'de', 'Bewerten Sie uns auf Google')
  },
}
