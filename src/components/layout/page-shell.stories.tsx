// FullBleedFrame: the page gutter, for a padded body inside a full-bleed surface.
//
// `<main>` is the only element that pads a page. A full-bleed route (Inbox,
// Property Reviews, the portal workspace) drops that padding to own its scroll,
// and a body inside it that reads like an ordinary page wears this frame. The
// stories draw the full-bleed surface as a bordered, fixed-height box with no
// padding of its own. The plays measure the gutter and scroll with the app's CSS.
import { playInThemes } from '../../../.storybook/play-in-themes'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { FullBleedFrame, PageShell } from './page-shell'

const meta: Meta<typeof FullBleedFrame> = {
  title: 'Patterns/Full-bleed frame',
  component: FullBleedFrame,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div
        data-testid="surface"
        className="h-72 overflow-hidden border-y bg-background text-foreground"
      >
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof FullBleedFrame>

function Body({ rows = 3 }: Readonly<{ rows?: number }>) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Loading portal details</h2>
      {Array.from({ length: rows }, (_, index) => (
        <p key={index} className="text-sm text-muted-foreground">
          A full-bleed surface pads nothing, so this body brings the page gutter back.
        </p>
      ))}
    </div>
  )
}

function expectGutter(frame: HTMLElement) {
  const style = getComputedStyle(frame)
  const desktop = window.innerWidth >= 768
  expect([style.paddingLeft, style.paddingRight]).toEqual(
    desktop ? ['24px', '24px'] : ['16px', '16px'],
  )
  expect([style.paddingTop, style.paddingBottom]).toEqual(
    desktop ? ['32px', '32px'] : ['20px', '20px'],
  )
}

// The default: the same 16 / 24 px gutter `<main>` gives an ordinary page.
export const Default: Story = {
  args: { children: <Body /> },
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByRole('heading', { level: 2 }).parentElement!
      .parentElement!
    expectGutter(frame)
    expect(getComputedStyle(frame).overflowY).toBe('visible')
    expect(frame).not.toHaveAttribute('tabindex')
  },
}

// A body taller than its surface scrolls inside the frame, not the surface.
export const Scrolling: Story = {
  args: { scroll: true, children: <Body rows={12} /> },
  play: playInThemes(async ({ canvasElement }) => {
    const frame = within(canvasElement).getByRole('heading', { level: 2 }).parentElement!
      .parentElement!
    expectGutter(frame)
    expect(frame.clientHeight).toBe(
      within(canvasElement).getByTestId('surface').clientHeight,
    )
    expect(frame.scrollHeight).toBeGreaterThan(frame.clientHeight)
    frame.scrollTop = 40
    expect(frame.scrollTop).toBe(40)
    frame.scrollTop = 0
    // Nothing inside takes focus, so the frame does: otherwise a keyboard cannot scroll it.
    expect(frame).toHaveAttribute('tabindex', '0')
    frame.focus()
    expect(frame).toHaveFocus()
  }),
}

// A width limit sits beside the gutter on the same box (the workspace tab
// bodies) or inside it, in a PageShell (the fallbacks).
export const WithWidthLimit: Story = {
  args: {
    className: 'mx-auto w-full max-w-5xl',
    children: <Body />,
  },
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByRole('heading', { level: 2 }).parentElement!
      .parentElement!
    expectGutter(frame)
    const surface = within(canvasElement).getByTestId('surface').getBoundingClientRect()
    const box = frame.getBoundingClientRect()
    expect(box.width).toBeCloseTo(Math.min(surface.width, 1024), 0)
    expect(box.left - surface.left).toBeCloseTo(surface.right - box.right, 0)
  },
}

export const InsideAPageShell: Story = {
  args: {
    scroll: true,
    children: (
      <PageShell>
        <Body />
      </PageShell>
    ),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('heading', { level: 2 })).toBeVisible()
  },
}

// A labelled region, as the Share tab draws its column.
export const LabelledSection: Story = {
  args: { as: 'section', 'aria-label': 'Share', children: <Body /> },
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Share' })
    expect(region.tagName).toBe('SECTION')
    expectGutter(region)
  },
}
