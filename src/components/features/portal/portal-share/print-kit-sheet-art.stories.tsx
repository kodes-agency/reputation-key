// The redesigned Paper print, as the Whole sheet and One face previews will show
// it: each piece on each paper, from the same pages and measures the PDF draws.
// The sheet is shown at 25/48 of its size, as the board shows it, so Letter's
// 8.5 in is 425 px and the bar under each code, 2 in, is 100 px.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  printKitFaces,
  type PrintKitCallToAction,
  type PrintKitPaper,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
} from '#/shared/domain/portal-print-kit-sheets'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitFaceArt } from './print-kit-face-art'
import { PrintKitSheetArt } from './print-kit-sheet-art'
import { usePrintKitCode } from './use-print-kit-code'

/** A dark logo with a transparent edge, like the board's: a ring with a letter, and the name. */
const DARK_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220"><circle cx="110" cy="116" r="92" fill="none" stroke="currentColor" stroke-width="5" color="#1A1A1A"/><text x="110" y="160" font-family="Georgia" font-size="120" text-anchor="middle" fill="#1A1A1A">A</text><text x="250" y="150" font-family="Georgia" font-size="110" letter-spacing="14" fill="#1A1A1A">AVELA</text></svg>',
  )

type Sample = Readonly<{
  wordmark: string
  accent: string
  titles: Partial<Record<GuestLocale, string>>
  languages: readonly GuestLocale[]
  callToAction: PrintKitCallToAction
  logo?: string
}>

const AVELA_US: Sample = {
  wordmark: 'Avela',
  accent: '#EAD6A8',
  titles: { en: 'Pool & Terrace', es: 'Piscina y terraza' },
  languages: ['en', 'es'],
  callToAction: 'rate',
}
const AVELA_EU: Sample = {
  ...AVELA_US,
  titles: { en: 'Pool & Terrace', bg: 'Басейн и тераса' },
  languages: ['en', 'bg'],
}
const KADIFE: Sample = {
  wordmark: 'Kadife Barbers',
  accent: '#0F8B8D',
  titles: { en: 'Chair 3' },
  languages: ['en'],
  callToAction: 'tell',
}
const TRATTORIA: Sample = {
  wordmark: 'Trattoria Nonna',
  accent: '#C8102E',
  titles: { it: 'Sala', en: 'Dining room' },
  languages: ['it', 'en'],
  callToAction: 'rate',
}

const lookOf = (sample: Sample): PortalPrintKitView['look'] => ({
  wordmark: sample.wordmark,
  accentColour: sample.accent,
  fieldColour: '#16130E',
  heroUrl: null,
  heroFocal: null,
  logoUrl: sample.logo ?? null,
})

const facesOf = (sample: Sample, piece: PrintKitPiece) =>
  printKitFaces(
    { piece, languages: sample.languages, callToAction: sample.callToAction },
    sample.titles,
    'Portal',
  )

/** 25/48 of the real size: 96 CSS px to the inch on screen, scaled as the board scales it. */
const SCALE = 25 / 48
const PIXELS_PER_INCH = 96 * SCALE

type SheetArgs = Readonly<{
  sample: Sample
  piece: PrintKitPiece
  paper: PrintKitPaper
  page?: number
}>

function Sheet({ sample, piece, paper, page }: SheetArgs) {
  const codeUrl = usePrintKitCode(null)
  const width = (paper === 'letter' ? 8.5 : 210 / 25.4) * PIXELS_PER_INCH
  return (
    <main style={{ padding: 24, background: 'var(--muted)' }}>
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <div data-sheet style={{ width, boxShadow: '0 1px 3px rgb(0 0 0 / 0.2)' }}>
        <PrintKitSheetArt
          piece={piece}
          paper={paper}
          faces={facesOf(sample, piece)}
          look={lookOf(sample)}
          codeUrl={codeUrl}
          page={page}
        />
      </div>
    </main>
  )
}

const meta: Meta<typeof Sheet> = {
  title: 'Portal/PortalShare/Print kit sheet',
  component: Sheet,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Sheet>

/** The code blocks on the sheet: the bar is exactly as wide as the block. */
function codeBlocks(canvasElement: HTMLElement): DOMRect[] {
  return Array.from(canvasElement.querySelectorAll('[data-print-code]')).map((element) =>
    element.getBoundingClientRect(),
  )
}

async function expectBarsAtTwoInches(canvasElement: HTMLElement) {
  const blocks = codeBlocks(canvasElement)
  await expect(blocks.length).toBeGreaterThan(0)
  for (const rect of blocks) {
    await expect(rect.width).toBeCloseTo(2 * PIXELS_PER_INCH, 0)
  }
}

export const PaperCardsLetter: Story = {
  args: { sample: AVELA_US, piece: 'counter_card', paper: 'letter' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('img', {
        name: 'Letter · two 4 × 6 in counter cards · page 1 of 2, fronts',
      }),
    ).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-panel="card4x6"]')).toHaveLength(2)
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(3)
    await expect(canvas.getByText('Printed at Actual size?')).toBeVisible()
    await expectBarsAtTwoInches(canvasElement)
  },
}

export const PaperCardsLetterBacks: Story = {
  args: { sample: AVELA_US, piece: 'counter_card', paper: 'letter', page: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The backs lead with Spanish, and carry no ticks and no print check.
    await expect(canvas.getAllByText('Piscina y terraza')[0]).toHaveAttribute(
      'lang',
      'es',
    )
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(0)
    await expect(canvas.queryByText('Printed at Actual size?')).toBeNull()
  },
}

export const PaperCardsA4: Story = {
  args: { sample: AVELA_EU, piece: 'counter_card', paper: 'a4' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-panel="cardA6"]')).toHaveLength(4)
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(6)
  },
}

export const PaperTentLetter: Story = {
  args: {
    sample: { ...AVELA_US, logo: DARK_LOGO },
    piece: 'table_tent',
    paper: 'letter',
  },
  play: async ({ canvasElement }) => {
    const panels = canvasElement.querySelectorAll<HTMLElement>(
      '[data-panel="tentFaceLetter"]',
    )
    await expect(panels).toHaveLength(2)
    // The back face reads upright once folded: it is printed upside down.
    await expect(panels[0]?.style.transform).toBe('rotate(180deg)')
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(2)
    await expectBarsAtTwoInches(canvasElement)
  },
}

export const PaperTentA4: Story = {
  args: { sample: { ...AVELA_EU, logo: DARK_LOGO }, piece: 'table_tent', paper: 'a4' },
}

export const PaperTentWordmark: Story = {
  args: {
    sample: { ...AVELA_US, accent: '#2E5E8C' },
    piece: 'table_tent',
    paper: 'letter',
  },
}

export const PaperCardsLetterOneLanguage: Story = {
  args: { sample: KADIFE, piece: 'counter_card', paper: 'letter' },
}

export const PaperCardsLetterTrattoria: Story = {
  args: { sample: TRATTORIA, piece: 'counter_card', paper: 'letter' },
}

type FaceArgs = Readonly<{ sample: Sample; geometry: PanelGeometry }>

/** One face at its real size, as One face shows it: 96 CSS px to the inch. */
function Face({ sample, geometry }: FaceArgs) {
  const codeUrl = usePrintKitCode(null)
  const piece: PrintKitPiece = geometry.startsWith('card') ? 'counter_card' : 'table_tent'
  const [front] = facesOf(sample, piece)
  if (front === undefined) return null
  return (
    <main style={{ padding: 24, background: 'var(--muted)' }}>
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <div data-face style={{ width: (PANEL_SIZE_PT[geometry].widthPt * 96) / 72 }}>
        <PrintKitFaceArt
          style="paper"
          geometry={geometry}
          face={front}
          look={lookOf(sample)}
          codeUrl={codeUrl}
          label={`${sample.wordmark}, ${geometry}`}
        />
      </div>
    </main>
  )
}

export const OneFaceCard4x6: StoryObj<typeof Face> = {
  render: (args) => <Face {...args} />,
  args: { sample: AVELA_US, geometry: 'card4x6' },
  play: async ({ canvasElement }) => {
    const face = canvasElement.querySelector('[data-face]')?.getBoundingClientRect()
    await expect(face?.width).toBeCloseTo(4 * 96, 0)
    await expect(face?.height).toBeCloseTo(6 * 96, 0)
    await expect(within(canvasElement).getByText('Piscina y terraza')).toHaveAttribute(
      'lang',
      'es',
    )
  },
}

export const OneFaceCardA6: StoryObj<typeof Face> = {
  render: (args) => <Face {...args} />,
  args: { sample: AVELA_EU, geometry: 'cardA6' },
}

export const OneFaceTentLetter: StoryObj<typeof Face> = {
  render: (args) => <Face {...args} />,
  args: { sample: { ...AVELA_US, logo: DARK_LOGO }, geometry: 'tentFaceLetter' },
}

export const OneFaceTentA5: StoryObj<typeof Face> = {
  render: (args) => <Face {...args} />,
  args: { sample: { ...AVELA_EU, logo: DARK_LOGO }, geometry: 'tentFaceA5' },
}
