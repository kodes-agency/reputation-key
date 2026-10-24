// fallow-ignore-file code-duplication
// The print at every size, as the Whole sheet and One face previews show it
// (round-3 spec-delta S1 to S6): each style and piece at Large, Table and Mini,
// Letter and A4, from the same pages, plans and tiles the PDF draws. The code is
// the sample's, which has a short print address's shape: Table and the small tent
// print it on 1.4 in (36 mm), Mini on 1.25 in (32 mm), Large on 1.75 in.
//
// A sheet is shown at 25/48 of its size, as the board shows it, so one inch is
// 50 px and the bar under each code is as many pixels as its tile has inches
// times 50.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  defaultPrintKitOutput,
  printKitFaces,
  type PrintKitCallToAction,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitSize,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { printKitSheetPages } from '#/shared/domain/portal-print-kit-formats'
import { OFFICE_CROP_COLOUR } from '#/shared/domain/portal-print-kit-sheet-parts'
import { PANEL_SIZE_PT, cardGeometryOf } from '#/shared/domain/portal-print-kit-sheets'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitFaceArt } from './print-kit-face-art'
import { PrintKitSheetArt } from './print-kit-sheet-art'
import { usePrintKitCode } from './use-print-kit-code'

/** A dark badge logo with a transparent edge: a ring with a letter, and the name. */
const DARK_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220"><circle cx="110" cy="116" r="92" fill="none" stroke="currentColor" stroke-width="5" color="#1A1A1A"/><text x="110" y="160" font-family="Georgia" font-size="120" text-anchor="middle" fill="#1A1A1A">A</text><text x="250" y="150" font-family="Georgia" font-size="110" letter-spacing="14" fill="#1A1A1A">AVELA</text></svg>',
  )

/** A photograph's stand-in, like the board's: a terrace and a pool under a dusk sky. */
const PHOTO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7a72"/><stop offset=".55" stop-color="#3b4a63"/><stop offset=".7" stop-color="#4a3a30"/><stop offset="1" stop-color="#2a201a"/></linearGradient></defs><rect width="1600" height="1067" fill="url(#s)"/><rect x="380" y="820" width="660" height="150" fill="#c9b99a"/><rect x="400" y="836" width="620" height="118" fill="#3aa4b4"/><rect x="760" y="836" width="160" height="118" fill="#a9c4a0"/></svg>',
  )

type Sample = Readonly<{
  wordmark: string
  propertyName: string
  accent: string
  field: string
  photo: boolean
  logo: boolean
  titles: Partial<Record<GuestLocale, string>>
  languages: readonly GuestLocale[]
  callToAction: PrintKitCallToAction
}>

/** A hotel with a logo, a photo and a long name: the board's Oakmere. */
const OAKMERE: Sample = {
  wordmark: 'Oakmere',
  propertyName: 'Oakmere by Larkspur Hotel Houston Hobby Airport',
  accent: '#D4E3FE',
  field: '#001E57',
  photo: true,
  logo: true,
  titles: { en: 'Reception', es: 'Recepción' },
  languages: ['en'],
  callToAction: 'rate',
}
const OAKMERE_TWO: Sample = { ...OAKMERE, languages: ['en', 'es'] }
/** A hotel with a wordmark and no photo or logo: the board's Elegance. */
const ELEGANCE: Sample = {
  wordmark: 'Hotel Elegance',
  propertyName: 'Hotel Elegance',
  accent: '#D58400',
  field: '#232323',
  photo: false,
  logo: false,
  titles: { en: 'Review us on Google', bg: 'Оценете ни в Google' },
  languages: ['en'],
  callToAction: 'rate',
}

const lookOf = (sample: Sample): PortalPrintKitView['look'] => ({
  wordmark: sample.wordmark,
  propertyName: sample.propertyName,
  accentColour: sample.accent,
  fieldColour: sample.field,
  heroUrl: sample.photo ? PHOTO : null,
  heroFocal: sample.photo ? { x: 0.5, y: 0.94 } : null,
  heroSize: sample.photo ? { width: 2400, height: 1600 } : null,
  logoUrl: sample.logo ? DARK_LOGO : null,
})

const facesOf = (sample: Sample, piece: PrintKitPiece) =>
  printKitFaces(
    { piece, languages: sample.languages, callToAction: sample.callToAction },
    sample.titles,
    'Portal',
  )

/** 25/48 of the real size: 96 CSS px to the inch on screen, scaled as the board scales it. */
const PIXELS_PER_INCH = 96 * (25 / 48)

type SheetArgs = Readonly<{
  style: PrintKitStyle
  size: PrintKitSize
  piece: PrintKitPiece
  paper: PrintKitPaper
  output?: PrintKitOutput
  sample: Sample
  page?: number
  showPropertyName?: boolean
}>

function Sheet({
  style,
  size,
  piece,
  paper,
  output = defaultPrintKitOutput(style),
  sample,
  page,
  showPropertyName,
}: SheetArgs) {
  const codeUrl = usePrintKitCode(null).url
  const faces = facesOf(sample, piece)
  const tile = CODE_TILE[size][paper]
  const [first] = printKitSheetPages({
    piece,
    size,
    style,
    output,
    languageCount: sample.languages.length,
    paper,
    faceCount: faces.length,
    tilePt: tile.tilePt,
  })
  if (first === undefined) return null
  return (
    <main style={{ padding: 24, background: 'var(--muted)' }}>
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <div
        data-sheet
        style={{
          width: (first.widthPt / 72) * PIXELS_PER_INCH,
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.2)',
        }}
      >
        <PrintKitSheetArt
          style={style}
          piece={piece}
          size={size}
          output={output}
          paper={paper}
          faces={faces}
          look={lookOf(sample)}
          codeUrl={codeUrl}
          showPropertyName={showPropertyName}
          page={page}
        />
      </div>
    </main>
  )
}

const meta: Meta<typeof Sheet> = {
  title: 'Portal/PortalShare/Print kit sizes/Sheet',
  component: Sheet,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Sheet>

/** The code blocks on the sheet: the bar is exactly as wide as the block. */
const codeBlocks = (canvasElement: HTMLElement): DOMRect[] =>
  Array.from(canvasElement.querySelectorAll('[data-print-code]')).map((element) =>
    element.getBoundingClientRect(),
  )

/** Every code block as wide as its tile, in inches at the board's scale. */
async function expectBarsAt(canvasElement: HTMLElement, inches: number) {
  const blocks = codeBlocks(canvasElement)
  await expect(blocks.length).toBeGreaterThan(0)
  for (const rect of blocks) {
    await expect(rect.width).toBeCloseTo(inches * PIXELS_PER_INCH, 0)
  }
}

/** The same for a card turned a quarter: its block's width is what the page shows as height. */
async function expectTurnedBarsAt(canvasElement: HTMLElement, inches: number) {
  const blocks = codeBlocks(canvasElement)
  await expect(blocks.length).toBeGreaterThan(0)
  for (const rect of blocks) {
    await expect(rect.height).toBeCloseTo(inches * PIXELS_PER_INCH, 0)
  }
}

const panels = (canvasElement: HTMLElement, geometry: string) =>
  canvasElement.querySelectorAll<HTMLElement>(`[data-panel="${geometry}"]`)

// ---------------------------------------------------------------------------
// Paper: on the customer's own printer.

export const PaperTableCardsLetter: Story = {
  args: {
    style: 'paper',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('img', { name: 'Letter · four 3.5 × 5 in Table cards' }),
    ).toBeVisible()
    await expect(panels(canvasElement, 'cardTableLetter')).toHaveLength(4)
    // 3 cuts down and 3 across, each with a tick above and below or left and right.
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(12)
    await expect(canvasElement.querySelectorAll('[data-sheet-note]')).toHaveLength(1)
    await expectBarsAt(canvasElement, 1.4)
  },
}

export const PaperTableCardsLetterTwoLanguages: Story = {
  args: {
    style: 'paper',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE_TWO,
    page: 1,
  },
  play: async ({ canvasElement }) => {
    // The backs lead with Spanish, and carry no ticks and no note: the cuts are made from the fronts.
    await expect(canvasElement.querySelectorAll('[data-tick]')).toHaveLength(0)
    await expect(canvasElement.querySelectorAll('[data-sheet-note]')).toHaveLength(0)
    await expect(within(canvasElement).getAllByText(/^RECEPCIÓN · /u)[0]).toHaveAttribute(
      'lang',
      'es',
    )
  },
}

export const PaperTableCardsA4: Story = {
  args: {
    style: 'paper',
    size: 'table',
    piece: 'counter_card',
    paper: 'a4',
    sample: { ...ELEGANCE, languages: ['en', 'bg'] },
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'cardTableA4')).toHaveLength(4)
    // The A4 tile is 36 mm: 1.417 in.
    await expectBarsAt(canvasElement, 36 / 25.4)
  },
}

export const PaperMiniCardsLetter: Story = {
  args: {
    style: 'paper',
    size: 'mini',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    const minis = panels(canvasElement, 'cardMiniLetter')
    // Ten to a sheet, each portrait card turned a quarter in its landscape cell.
    await expect(minis).toHaveLength(10)
    await expect(minis[0]?.style.transform).toBe('rotate(-90deg)')
    await expectTurnedBarsAt(canvasElement, 1.25)
  },
}

export const PaperMiniCardsA4: Story = {
  args: {
    style: 'paper',
    size: 'mini',
    piece: 'counter_card',
    paper: 'a4',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'cardMiniA4')).toHaveLength(10)
    await expectTurnedBarsAt(canvasElement, 32 / 25.4)
  },
}

export const PaperSmallTentLetter: Story = {
  args: {
    style: 'paper',
    size: 'table',
    piece: 'table_tent',
    paper: 'letter',
    sample: OAKMERE_TWO,
  },
  play: async ({ canvasElement }) => {
    const faces = panels(canvasElement, 'tentSmallLetter')
    // Two tents side by side, each its back face upside down above the fold.
    await expect(faces).toHaveLength(4)
    await expect(faces[0]?.style.transform).toBe('rotate(180deg)')
    await expect(canvasElement.querySelectorAll('[data-sheet-note]')).toHaveLength(1)
    await expectBarsAt(canvasElement, 1.4)
  },
}

export const PaperSmallTentA4: Story = {
  args: {
    style: 'paper',
    size: 'table',
    piece: 'table_tent',
    paper: 'a4',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'tentSmallA4')).toHaveLength(4)
  },
}

// ---------------------------------------------------------------------------
// Immersive for a print shop: one piece to a page, with bleed and crop marks.

export const ImmersiveTableCardPrintShop: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    output: 'print_shop',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('img', {
        name: '3.5 × 5 in Table card for a print shop, with bleed and crop marks · page 1 of 1, front',
      }),
    ).toBeVisible()
    await expect(canvasElement.querySelectorAll('img[data-print-band]')).toHaveLength(1)
    await expect(canvasElement.querySelectorAll('[data-crop-mark]')).toHaveLength(8)
    await expect(
      within(canvasElement).getByText(
        'Oakmere · Reception · table card · trim 3.5 × 5 in · bleed 1/8 in',
      ),
    ).toBeVisible()
    await expectBarsAt(canvasElement, 1.4)
  },
}

export const ImmersiveMiniCardPrintShop: Story = {
  args: {
    style: 'immersive',
    size: 'mini',
    piece: 'counter_card',
    paper: 'letter',
    output: 'print_shop',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    // No photo: the band holds the monogram.
    await expect(within(canvasElement).getByText('H')).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-crop-mark]')).toHaveLength(8)
    await expectBarsAt(canvasElement, 1.25)
  },
}

export const ImmersiveSmallTentPrintShop: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'table_tent',
    paper: 'letter',
    output: 'print_shop',
    sample: OAKMERE_TWO,
  },
  play: async ({ canvasElement }) => {
    const faces = panels(canvasElement, 'tentSmallLetter')
    await expect(faces).toHaveLength(2)
    await expect(faces[0]?.style.transform).toBe('rotate(180deg)')
    // The photo panel stays with two languages: one language a face.
    await expect(canvasElement.querySelectorAll('img[data-print-band]')).toHaveLength(2)
    await expect(canvasElement.querySelectorAll('[data-fold-mark]')).toHaveLength(2)
    // The Letter-half tent's ridge is not the small tent's.
    await expect(canvasElement.querySelectorAll('[data-print-ridge]')).toHaveLength(0)
    await expectBarsAt(canvasElement, 1.4)
  },
}

// ---------------------------------------------------------------------------
// Immersive on the customer's own printer: office sheets whose cards bleed for a cutter.

export const ImmersiveTableCardsOfficeLetter: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    output: 'office',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('img', {
        name: 'Letter · four 3.5 × 5 in Table cards, one bleed around them',
      }),
    ).toBeVisible()
    await expect(panels(canvasElement, 'cardTableLetter')).toHaveLength(4)
    // Plain black crop marks (below), a note up the left margin, and no print shop's slug.
    await expect(canvasElement.querySelectorAll('[data-sheet-note]')).toHaveLength(1)
    await expect(canvasElement.querySelector('[data-crop-mark]')).toBeNull()
    await expectBarsAt(canvasElement, 1.4)
  },
}

export const ImmersiveTableCardsOfficeTwoLanguages: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    output: 'office',
    sample: OAKMERE_TWO,
  },
  play: async ({ canvasElement }) => {
    // The top row prints the front and the bottom row the back, on one sheet.
    await expect(panels(canvasElement, 'cardTableLetter')).toHaveLength(4)
    await expect(within(canvasElement).getAllByText(/^RECEPCIÓN · /u).length).toBe(2)
  },
}

export const ImmersiveTableCardsOfficeA4: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'a4',
    output: 'office',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'cardTableA4')).toHaveLength(4)
  },
}

export const ImmersiveLargeCardsOfficeLetter: Story = {
  args: {
    style: 'immersive',
    size: 'large',
    piece: 'counter_card',
    paper: 'letter',
    output: 'office',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('img', {
        name: 'Letter landscape · two 4 × 6 in cards, each with its own bleed',
      }),
    ).toBeVisible()
    await expect(panels(canvasElement, 'card4x6')).toHaveLength(2)
    await expectBarsAt(canvasElement, 1.75)
  },
}

export const ImmersiveLargeCardsOfficeA4: Story = {
  args: {
    style: 'immersive',
    size: 'large',
    piece: 'counter_card',
    paper: 'a4',
    output: 'office',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'cardA6')).toHaveLength(2)
  },
}

/** The Letter-half tent is the Large piece the small tent leaves alone: its sheet, ridge and 2 in tile are as before. */
export const LetterHalfTentIsUnchanged: Story = {
  args: {
    style: 'immersive',
    size: 'large',
    piece: 'table_tent',
    paper: 'letter',
    sample: { ...OAKMERE, languages: ['en'] },
  },
  play: async ({ canvasElement }) => {
    await expect(panels(canvasElement, 'tentPanel4x6')).toHaveLength(2)
    await expect(canvasElement.querySelectorAll('[data-print-ridge]')).toHaveLength(1)
  },
}

// ---------------------------------------------------------------------------
// One face at its real size, as One face shows it: 96 CSS px to the inch.

type FaceArgs = Readonly<{
  style: PrintKitStyle
  size: PrintKitSize
  piece: PrintKitPiece
  paper: PrintKitPaper
  sample: Sample
  showPropertyName?: boolean
}>

function Face({ style, size, piece, paper, sample, showPropertyName }: FaceArgs) {
  const codeUrl = usePrintKitCode(null).url
  const geometry =
    piece === 'table_tent'
      ? paper === 'letter'
        ? 'tentSmallLetter'
        : 'tentSmallA4'
      : cardGeometryOf(size, paper)
  const [front] = facesOf(sample, piece)
  if (front === undefined) return null
  return (
    <main style={{ padding: 24, background: 'var(--muted)' }}>
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <div data-face style={{ width: (PANEL_SIZE_PT[geometry].widthPt * 96) / 72 }}>
        <PrintKitFaceArt
          style={style}
          geometry={geometry}
          face={front}
          look={lookOf(sample)}
          codeUrl={codeUrl}
          tile={CODE_TILE[size][paper]}
          showPropertyName={showPropertyName}
          label={`${sample.wordmark}, ${style} ${size} ${piece}`}
        />
      </div>
    </main>
  )
}

/** A face alone is drawn at its real size. */
async function expectFaceAt(
  canvasElement: HTMLElement,
  widthIn: number,
  heightIn: number,
) {
  const face = canvasElement.querySelector('[data-face]')?.getBoundingClientRect()
  await expect(face?.width).toBeCloseTo(widthIn * 96, 0)
  await expect(face?.height).toBeCloseTo(heightIn * 96, 0)
}

type FaceStory = StoryObj<typeof Face>

export const OneFaceTableCardImmersive: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE_TWO,
  },
  play: async ({ canvasElement }) => {
    await expectFaceAt(canvasElement, 3.5, 5)
    const band = canvasElement.querySelector('[data-print-band]')?.getBoundingClientRect()
    // Two languages: the band keeps to its 0.95 in minimum, as the board draws it (D10).
    await expect(band?.height ?? 0).toBeGreaterThanOrEqual(0.95 * 96 - 0.5)
    await expect(
      canvasElement
        .querySelector<HTMLElement>('[data-print-code]')
        ?.getBoundingClientRect().width,
    ).toBeCloseTo(1.4 * 96, 0)
  },
}

export const OneFaceTableCardPaper: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'paper',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => expectFaceAt(canvasElement, 3.5, 5),
}

export const OneFaceTableCardA4: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'a4',
    sample: { ...ELEGANCE, languages: ['en', 'bg'] },
  },
  play: async ({ canvasElement }) => expectFaceAt(canvasElement, 90 / 25.4, 130 / 25.4),
}

export const OneFaceTableCardWithoutTheName: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE,
    showPropertyName: false,
  },
  play: async ({ canvasElement }) => {
    // The name line is the one with the property's own words.
    await expect(within(canvasElement).queryByText(/Larkspur/iu)).toBeNull()
  },
}

export const OneFaceMiniCardImmersive: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'mini',
    piece: 'counter_card',
    paper: 'letter',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expectFaceAt(canvasElement, 2, 3.5)
    // A Mini card drops the name and the eyebrow: the logo and the call to action carry it.
    await expect(within(canvasElement).queryByText(/Larkspur/iu)).toBeNull()
    await expect(within(canvasElement).queryByText(/^RECEPTION/u)).toBeNull()
  },
}

export const OneFaceMiniCardPaper: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'paper',
    size: 'mini',
    piece: 'counter_card',
    paper: 'a4',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => expectFaceAt(canvasElement, 55 / 25.4, 85 / 25.4),
}

export const OneFaceSmallTentImmersive: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'table_tent',
    paper: 'letter',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expectFaceAt(canvasElement, 5, 3.5)
    await expect(canvasElement.querySelectorAll('img[data-print-band]')).toHaveLength(1)
    const panel = canvasElement
      .querySelector('[data-print-band]')
      ?.getBoundingClientRect()
    // The photo panel is 1.2 in wide, full height.
    await expect(panel?.width).toBeCloseTo(1.2 * 96, 0)
    await expect(panel?.height).toBeCloseTo(3.5 * 96, 0)
  },
}

export const OneFaceSmallTentImmersiveMonogram: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'table_tent',
    paper: 'a4',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    await expectFaceAt(canvasElement, 130 / 25.4, 90 / 25.4)
    await expect(within(canvasElement).getByText('H')).toBeVisible()
  },
}

export const OneFaceSmallTentPaper: FaceStory = {
  render: (args) => <Face {...args} />,
  args: {
    style: 'paper',
    size: 'table',
    piece: 'table_tent',
    paper: 'letter',
    sample: OAKMERE,
  },
  play: async ({ canvasElement }) => {
    await expectFaceAt(canvasElement, 5, 3.5)
    await expect(canvasElement.querySelector('[data-print-band]')).toBeNull()
  },
}

// The office crop marks are the boards' plain black, one colour on any printer.
export const OfficeCropMarksArePlainBlack: Story = {
  args: {
    style: 'immersive',
    size: 'table',
    piece: 'counter_card',
    paper: 'letter',
    output: 'office',
    sample: ELEGANCE,
  },
  play: async ({ canvasElement }) => {
    const tick = canvasElement.querySelector<HTMLElement>('[data-tick]')
    const probe = document.createElement('span')
    probe.style.color = OFFICE_CROP_COLOUR
    document.body.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    await expect(tick && getComputedStyle(tick).backgroundColor).toBe(expected)
  },
}
