// The code block every print carries: a cream tile with the code, and under it a
// bar in the accent with a camera and the cue, in the lead language first. Both
// styles, one and two cue lines, the tweak's four accents and the longest cue,
// French, which gives the camera up its place beside a second line. Drawn from
// the measures and the plan the PDF reads, at their real size: 2 in is 192 px.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintKitStyle } from '#/shared/domain/portal-print-kit'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import {
  PRINT_KIT_PAPER,
  printKitStylePalette,
} from '#/shared/domain/portal-print-kit-palette'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitCodeBlock } from './print-kit-code-block'
import { usePrintKitCode } from './use-print-kit-code'

const ACCENTS = ['#EAD6A8', '#0F8B8D', '#C8102E', '#2E5E8C'] as const

type Specimen = Readonly<{
  style: PrintKitStyle
  accent: string
  locales: readonly GuestLocale[]
}>

/** One code block on the surface its style prints on: the paper, or the property's field. */
function Block({ style, accent, locales }: Specimen) {
  const codeUrl = usePrintKitCode(null)
  const palette = printKitStylePalette(accent, null, style)
  const surface = palette.style === 'paper' ? PRINT_KIT_PAPER : palette.field
  return (
    <div
      data-code-block={`${style} ${locales.join('+')} ${accent}`}
      style={{ background: surface, padding: 24, width: 'fit-content' }}
    >
      <PrintKitCodeBlock
        palette={palette}
        cues={cueLinesFor(locales)}
        codeUrl={codeUrl}
      />
    </div>
  )
}

function Specimens({ items }: Readonly<{ items: readonly Specimen[] }>) {
  return (
    <main className="flex flex-wrap gap-6 p-6">
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {items.map((item) => (
        <Block key={`${item.style}${item.locales.join()}${item.accent}`} {...item} />
      ))}
    </main>
  )
}

const meta: Meta<typeof Specimens> = {
  title: 'Portal/PortalShare/Print kit code block',
  component: Specimens,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Specimens>

/** The object, its tile and its bar, as measured on screen. */
function measure(canvasElement: HTMLElement, name: string) {
  const wrapper = canvasElement.querySelector(`[data-code-block="${name}"]`)
  const root = wrapper?.firstElementChild
  if (!(root instanceof HTMLElement)) throw new Error(`no code block ${name}`)
  const [code, bar] = Array.from(root.children).map((child) =>
    child.getBoundingClientRect(),
  )
  return { root, rect: root.getBoundingClientRect(), code, bar }
}

const PIXELS_PER_INCH = 96

export const PaperTwoLanguages: Story = {
  args: { items: [{ style: 'paper', accent: '#EAD6A8', locales: ['en', 'es'] }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Lead language first, each line in its own language.
    await expect(canvas.getByText('Scan with your camera')).toBeVisible()
    await expect(canvas.getByText('Escanee con la cámara')).toHaveAttribute('lang', 'es')
    const { root, rect, code, bar } = measure(canvasElement, 'paper en+es #EAD6A8')
    // The tile is 2 in square and the bar exactly as wide: the size check.
    await expect(code?.width).toBeCloseTo(2 * PIXELS_PER_INCH, 1)
    await expect(code?.height).toBeCloseTo(2 * PIXELS_PER_INCH, 1)
    await expect(bar?.width).toBeCloseTo(2 * PIXELS_PER_INCH, 1)
    await expect(bar?.height).toBeCloseTo(0.45 * PIXELS_PER_INCH, 1)
    await expect(rect.height).toBeCloseTo(2.45 * PIXELS_PER_INCH, 1)
    // Paper: an outline in the accent ink, outside the 2 in.
    await expect(getComputedStyle(root).boxShadow).toContain('rgb(118, 91, 29)')
  },
}

export const PaperOneLanguage: Story = {
  args: { items: [{ style: 'paper', accent: '#0F8B8D', locales: ['en'] }] },
  play: async ({ canvasElement }) => {
    const { rect, bar } = measure(canvasElement, 'paper en #0F8B8D')
    await expect(bar?.height).toBeCloseTo(0.4 * PIXELS_PER_INCH, 1)
    await expect(rect.height).toBeCloseTo(2.4 * PIXELS_PER_INCH, 1)
    await expect(within(canvasElement).getAllByText(/camera/i)).toHaveLength(1)
  },
}

export const ImmersiveTwoLanguages: Story = {
  args: { items: [{ style: 'immersive', accent: '#C8102E', locales: ['it', 'en'] }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Inquadri con la fotocamera')).toHaveAttribute(
      'lang',
      'it',
    )
    const { root, bar } = measure(canvasElement, 'immersive it+en #C8102E')
    await expect(bar?.height).toBeCloseTo(0.45 * PIXELS_PER_INCH, 1)
    // Immersive has no outline: cream on the field is about 16:1.
    await expect(getComputedStyle(root).boxShadow).toBe('none')
  },
}

export const ImmersiveOneLanguage: Story = {
  args: { items: [{ style: 'immersive', accent: '#2E5E8C', locales: ['bg'] }] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Сканирайте с камерата'),
    ).toHaveAttribute('lang', 'bg')
    const { bar } = measure(canvasElement, 'immersive bg #2E5E8C')
    await expect(bar?.height).toBeCloseTo(0.4 * PIXELS_PER_INCH, 1)
  },
}

export const FourAccents: Story = {
  args: {
    items: (['paper', 'immersive'] as const).flatMap((style) =>
      ACCENTS.map((accent) => ({ style, accent, locales: ['en', 'es'] as const })),
    ),
  },
  play: async ({ canvasElement }) => {
    // Eight blocks, every bar 2 in wide whatever its colour.
    const blocks = canvasElement.querySelectorAll('[data-code-block]')
    await expect(blocks).toHaveLength(8)
    for (const block of Array.from(blocks)) {
      const root = block.firstElementChild
      await expect(root?.getBoundingClientRect().width).toBeCloseTo(
        2 * PIXELS_PER_INCH,
        1,
      )
    }
  },
}

export const FrenchCue: Story = {
  args: {
    items: [
      { style: 'paper', accent: '#EAD6A8', locales: ['fr'] },
      { style: 'paper', accent: '#EAD6A8', locales: ['fr', 'en'] },
      { style: 'immersive', accent: '#0F8B8D', locales: ['fr', 'en'] },
    ],
  },
  play: async ({ canvasElement }) => {
    // Alone, the line is set at 9 pt and just fits beside the camera: a bar of 0.40 in.
    const alone = measure(canvasElement, 'paper fr #EAD6A8')
    await expect(alone.bar?.height).toBeCloseTo(0.4 * PIXELS_PER_INCH, 1)
    // With a second line it does not fit in 1.55 in, so the camera goes above the
    // lines and the bar grows by 0.08 in.
    for (const name of ['paper fr+en #EAD6A8', 'immersive fr+en #0F8B8D']) {
      const above = measure(canvasElement, name)
      await expect(above.bar?.height).toBeCloseTo(0.53 * PIXELS_PER_INCH, 1)
      const icon = above.root.querySelector('svg')?.getBoundingClientRect()
      const firstLine = above.root.querySelector('span')?.getBoundingClientRect()
      await expect(icon?.bottom).toBeLessThanOrEqual(firstLine?.top ?? 0)
    }
  },
}
