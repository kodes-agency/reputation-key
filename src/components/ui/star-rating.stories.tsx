// The rating primitive, with no domain around it — so these stories are its
// whole specification: what each size draws, what `showValue` prints, and the
// part no screenshot can show, what a screen reader hears in each combination.
//
// The Storybook Vitest project compiles NO Tailwind, so nothing here may claim
// a pixel: `size-3` vs `size-[13px]` is inert in the runner. The play functions
// assert text, DOM order, and which class TOKENS each glyph carries — a
// structural fact about what the primitive emits, not a measurement of what a
// browser draws from it. That is the only way this runner can catch the
// regression review found: the default silently growing from `size-3` to
// `size-4` and turning amber under a caller that passes neither prop
// (`notification-row-meta.tsx:44`).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { StarRating } from './star-rating'

const meta: Meta<typeof StarRating> = {
  title: 'UI/Star Rating',
  component: StarRating,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { value: 4 },
}

export default meta
type Story = StoryObj<typeof StarRating>

const SCALE = [0, 1, 2, 3, 4, 5] as const

/** Every glyph's class tokens, in DOM order. */
function glyphClasses(canvasElement: HTMLElement): ReadonlyArray<ReadonlyArray<string>> {
  return [...canvasElement.querySelectorAll('svg[aria-hidden="true"]')].map((glyph) =>
    (glyph.getAttribute('class') ?? '').split(/\s+/),
  )
}

/**
 * The shipped defaults, byte for byte: 12 px glyphs, filled in the foreground
 * tone, the sentence hidden. Five stars are drawn, four are lit.
 *
 * This is what the notification meta strip renders — it passes no `size` and
 * no `tone` and prints no number — so the defaults are that caller's contract,
 * not a free choice for the next consumer.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('4 out of 5 stars')).toBeInTheDocument()
    // The glyphs are decoration; the SVGs must never reach the tree.
    const glyphs = glyphClasses(canvasElement)
    expect(glyphs).toHaveLength(5)
    for (const glyph of glyphs) {
      expect(glyph).toContain('size-3')
      expect(glyph).not.toContain('size-4')
    }
    for (const lit of glyphs.slice(0, 4)) {
      expect(lit).toEqual(expect.arrayContaining(['fill-current', 'text-foreground']))
      // `fill-current` is common to both tones; the gold is the ink.
      expect(lit).not.toContain('text-rating')
    }
    expect(glyphs[4]).toContain('text-muted-foreground/40')
  },
}

/** 13 px glyphs — the thread's fact scale (plan row 10). Same sentence. */
export const Small: Story = {
  args: { size: 'sm' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('4 out of 5 stars')).toBeInTheDocument()
    expect(glyphClasses(canvasElement)[0]).toContain('size-[13px]')
  },
}

/**
 * The rating amber, opted into. Only the LIT glyphs change tone; the empty
 * outline is the same in both tones, so the amber never reaches a glyph that
 * means "not earned".
 */
export const RatingTone: Story = {
  args: { tone: 'rating', showValue: true },
  play: async ({ canvasElement }) => {
    const glyphs = glyphClasses(canvasElement)
    for (const lit of glyphs.slice(0, 4)) {
      expect(lit).toEqual(expect.arrayContaining(['fill-current', 'text-rating']))
      expect(lit).not.toContain('text-foreground')
    }
    expect(glyphs[4]).toContain('text-muted-foreground/40')
    expect(glyphs[4]).not.toContain('text-rating')
    expect(glyphs[4]).not.toContain('fill-current')
  },
}

/**
 * The number on screen, and NOT a second time in the hidden span: the whole
 * text content is `4.0` + `out of 5 stars`, which a screen reader reads in DOM
 * order as one sentence. A hidden `4 out of 5 stars` here would make it say
 * the rating twice.
 */
export const WithValue: Story = {
  args: { showValue: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('4.0')).toBeInTheDocument()
    expect(canvas.getByText('out of 5 stars')).toBeInTheDocument()
    expect(canvasElement.textContent).toBe('4.0out of 5 stars')
  },
}

/** The guest node's own combination: 13 px amber stars followed by `5.0`. */
export const SmallWithValue: Story = {
  args: { size: 'sm', tone: 'rating', showValue: true, value: 5 },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe('5.0out of 5 stars')
  },
}

/**
 * A caller-written sentence replaces the default one. It applies only while the
 * number is hidden — `showValue` takes the sentence over, see `WithValue`.
 */
export const CustomLabel: Story = {
  args: { label: 'Rated 4 out of 5 stars' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Rated 4 out of 5 stars')).toBeInTheDocument()
  },
}

/**
 * Half a star rounds up to a lit glyph, but the printed number stays exact:
 * the glyph count is a clamp, the number is the value.
 */
export const HalfStar: Story = {
  args: { value: 4.5, showValue: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe('4.5out of 5 stars')
  },
}

/**
 * One glyph, and the denominator follows `max` — "out of 1 stars".
 *
 * This is exactly why the inbox list row does NOT use the primitive: its
 * `RowIdentity` (`inbox-list-row.tsx`) draws one star beside the rating as an
 * icon for "rating", not a score out of one. `max` cannot mean "draw one glyph"
 * without also meaning "out of one", so the row keeps its own `aria-hidden`
 * star and `STAR_FILLED_CLASS`.
 */
export const SingleGlyph: Story = {
  args: { value: 5, max: 1, showValue: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe('5.0out of 1 stars')
    expect(canvasElement.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  },
}

/**
 * The whole scale, both sizes, with and without the number. Column order:
 * 12 px foreground (the notification strip) · 13 px amber · 12 px + value ·
 * 13 px amber + value (the guest node).
 */
export const EveryValue: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-sm">
      {SCALE.map((value) => (
        <div key={value} className="flex items-center gap-6">
          <StarRating value={value} />
          <StarRating value={value} size="sm" tone="rating" />
          <StarRating value={value} showValue />
          <StarRating value={value} size="sm" tone="rating" showValue />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Two of the four columns hide the number, so each row's sentence appears
    // twice; the other two print the value and share the unit-only suffix.
    expect(canvas.getAllByText('0 out of 5 stars')).toHaveLength(2)
    expect(canvas.getAllByText('5 out of 5 stars')).toHaveLength(2)
    expect(canvas.getAllByText('out of 5 stars')).toHaveLength(SCALE.length * 2)
    expect(canvas.getAllByText('0.0')).toHaveLength(2)
  },
}
