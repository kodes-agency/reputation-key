// The rail primitive, with no domain around it (plan v2.1 row 9). These stories
// are its specification: one rail that mixes both indicator weights, a
// one-line event, a 200 px message and a last node, at the desktop pane's 720 px
// and the phone sheet's 390 px.
//
// What a play here CAN prove is structure: every node emits exactly one
// indicator and one connector, both `aria-hidden`; the weights come out in the
// order they were asked for (`data-size`); the rail adds no list, listitem or
// any other role, so the caller's `<article>`s and their names are the whole
// accessibility tree; and the last item's connector still carries the
// `:last-child` rule that hides it — a structural fact about what the primitive
// emits, in the register `star-rating.stories.tsx` uses, and the only guard
// this runner can give against that rule being dropped.
//
// What it CANNOT prove is any of the geometry — the 32 px column, the 24 px
// disc inset in it, the 12 px gap, the connector stretching to a tall message,
// the last connector actually being `display: none`. `vitest.config.ts`'s
// storybook project compiles no Tailwind, so every utility is inert under the
// gate. Those numbers were measured in Chromium against `pnpm storybook` (see
// the PR description); no play below asserts a pixel.
//
// The last item deliberately RENDERS a `TimelineConnector`, exactly like the
// three above it: a caller maps entries without special-casing the tail, and
// the primitive is what keeps the rail from dangling past the final node.
import type { Meta, StoryObj } from '@storybook/react'
import { CircleCheck, UserPlus } from 'lucide-react'
import { expect, within } from 'storybook/test'
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from './timeline'

// ─── widths ──────────────────────────────────────────────────────────────────

/** The desktop pane's share of a 1440 px split, and the canvas width. */
const PANE_WIDTH_PX = 720
/** The staff phone the sheet is designed at (row 20). */
const PHONE_WIDTH_PX = 390
/** The pane scroller's own padding (`inbox-detail-content.tsx`, `p-5`). */
const PANE_PADDING_PX = 20
/**
 * The tall node's height. Fixed by an inline style rather than by how much prose
 * wraps, so the measured connector length has one expected value at both
 * widths: this, plus the item's padding, minus the 32 px indicator slot.
 */
const TALL_MESSAGE_PX = 200

/**
 * The 390 px twin's parameters. `paneWidth` is read by the meta decorator;
 * `viewport` is what a real browser needs for `max-md:` to apply in
 * `pnpm storybook` (the primitive uses none today, but a caller's content may).
 */
const PHONE = {
  paneWidth: PHONE_WIDTH_PX,
  viewport: { defaultViewport: 'mobileStaff' },
} as const

// ─── the rail ────────────────────────────────────────────────────────────────

/**
 * Node 0 is a person on a 32 px disc, node 1 a system event on a 24 px disc,
 * node 2 a 200 px message on a 32 px disc (with a message's `pb-4` overriding
 * the event rhythm), node 3 a closing event — the last item.
 *
 * The initials stand in for an avatar and are aria-hidden with the disc; the
 * article's name carries the person, as the thread's guest node does.
 */
function MixedRail() {
  return (
    <Timeline>
      <TimelineItem className="pb-4">
        <TimelineIndicator>MP</TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <article
            aria-label="Guest review from Maria Petrova"
            className="flex flex-col gap-1"
          >
            <p className="flex min-h-8 items-center gap-2 text-[13px]">
              <span className="font-medium text-foreground">Maria Petrova</span>
              <span className="text-muted-foreground">12 Jan 2026</span>
            </p>
            <p className="text-[15px] leading-relaxed text-foreground">
              The room was quiet and the staff remembered our names.
            </p>
          </article>
        </TimelineContent>
      </TimelineItem>

      <TimelineItem>
        <TimelineIndicator size="sm">
          <UserPlus />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <p className="flex min-h-8 items-center text-[13px] text-muted-foreground">
            Georgi Ivanov assigned this to Maria Petrova · 20h ago
          </p>
        </TimelineContent>
      </TimelineItem>

      <TimelineItem className="pb-4">
        <TimelineIndicator>GI</TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <article
            aria-label="Internal note from Georgi Ivanov, not visible to the guest"
            className="rounded-lg border bg-surface px-3 py-2.5 text-sm text-foreground"
            style={{ minHeight: TALL_MESSAGE_PX, boxSizing: 'border-box' }}
          >
            Called the guest back; they would like a late checkout next time.
          </article>
        </TimelineContent>
      </TimelineItem>

      <TimelineItem>
        <TimelineIndicator size="sm">
          <CircleCheck />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <p className="flex min-h-8 items-center text-[13px] text-muted-foreground">
            Maria Petrova closed this · 2h ago
          </p>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  )
}

const meta: Meta<typeof Timeline> = {
  title: 'UI/Timeline',
  component: Timeline,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', paneWidth: PANE_WIDTH_PX },
  decorators: [
    // The width is the story's own, as an inline style: an arbitrary Tailwind
    // width would be inert in the Vitest project and, built from a variable,
    // would never be generated by `pnpm storybook` either (the same reasoning
    // as `inbox-case-toolbar.stories.tsx`). The padding stands in for the
    // pane's scroller, so the rail does not touch the frame edge.
    (Story, { parameters }) => (
      <div
        className="bg-background text-foreground"
        style={{
          width:
            typeof parameters.paneWidth === 'number'
              ? parameters.paneWidth
              : PANE_WIDTH_PX,
          padding: PANE_PADDING_PX,
          boxSizing: 'border-box',
        }}
      >
        <Story />
      </div>
    ),
  ],
  render: () => <MixedRail />,
}

export default meta
type Story = StoryObj<typeof Timeline>

/** Every element carrying `data-slot=<slot>` inside `root`, in DOM order. */
function slots(root: Element, slot: string): ReadonlyArray<HTMLElement> {
  return [...root.querySelectorAll<HTMLElement>(`[data-slot="${slot}"]`)]
}

/** The class tokens an element carries. */
function classTokens(element: Element): ReadonlyArray<string> {
  return (element.getAttribute('class') ?? '').split(/\s+/)
}

const playMixedRail: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const [rail] = slots(canvasElement, 'timeline')
  const items = slots(canvasElement, 'timeline-item')

  // One rail, four nodes, each the rail's own child — the `:last-child` rule
  // only means "the last node" while nothing else sits beside the items.
  expect(rail).toBeDefined()
  expect(items).toHaveLength(4)
  for (const item of items) expect(item.parentElement).toBe(rail)

  // Each node draws exactly one indicator and one connector, and both are
  // out of the accessibility tree.
  for (const item of items) {
    const indicators = slots(item, 'timeline-indicator')
    const connectors = slots(item, 'timeline-connector')
    expect(indicators).toHaveLength(1)
    expect(connectors).toHaveLength(1)
    expect(indicators[0]).toHaveAttribute('aria-hidden', 'true')
    expect(connectors[0]).toHaveAttribute('aria-hidden', 'true')
  }

  // The weights, in the order the rail asked for them: person, event,
  // message, event. `data-size` is emitted even for the default, so a caller
  // (or a Playwright probe) never has to infer the weight from class names.
  expect(
    slots(canvasElement, 'timeline-indicator').map((node) => node.dataset.size),
  ).toEqual(['default', 'sm', 'default', 'sm'])

  // The disc's initials are decoration: they are in the DOM, inside the hidden
  // indicator, and the person reaches the tree through the article's name.
  expect(canvas.getByText('MP').closest('[aria-hidden="true"]')).not.toBeNull()
  expect(
    canvas.getByRole('article', { name: 'Guest review from Maria Petrova' }),
  ).toBeVisible()
  expect(
    canvas.getByRole('article', {
      name: 'Internal note from Georgi Ivanov, not visible to the guest',
    }),
  ).toBeVisible()

  // No list semantics are imposed: the articles are the structure.
  expect(canvas.queryAllByRole('list')).toHaveLength(0)
  expect(canvas.queryAllByRole('listitem')).toHaveLength(0)
  expect(canvas.getAllByRole('article')).toHaveLength(2)

  // The tail rule, as emitted tokens (inert here; measured in a real browser).
  // Every connector carries it — the rule decides, not the caller — and the
  // items carry the padding that spaces the rail, zeroed on the last.
  for (const connector of slots(canvasElement, 'timeline-connector')) {
    expect(classTokens(connector)).toContain('group-last/timeline-item:hidden')
  }
  for (const item of items) {
    expect(classTokens(item)).toEqual(
      expect.arrayContaining(['group/timeline-item', 'relative', 'last:pb-0']),
    )
  }
  // The rail's two ends move by the 24 px disc's 4 px inset, from this item's
  // own weight and the NEXT item's — the rule that keeps the line touching
  // every disc. Measured in Chromium against `pnpm storybook`: without it a
  // 4 px break opened above and below every event disc. Both selectors must
  // name the indicator slot as a DIRECT child: a bare `[data-size=sm]` would
  // also match a `Button size="sm"` inside the content, which carries the same
  // attribute. Emitted tokens only; the geometry is the browser's to prove.
  for (const item of items) {
    expect(classTokens(item)).toEqual(
      expect.arrayContaining([
        '[&:has(>[data-slot=timeline-indicator][data-size=sm])>[data-slot=timeline-connector]]:top-7',
        '[&:has(+[data-slot=timeline-item]>[data-slot=timeline-indicator][data-size=sm])>[data-slot=timeline-connector]]:-bottom-1',
      ]),
    )
  }
  // A message's `pb-4` replaced the event rhythm rather than joining it.
  expect(classTokens(items[2])).toContain('pb-4')
  expect(classTokens(items[2])).not.toContain('pb-3')
  expect(classTokens(items[1])).toContain('pb-3')
}

/** The mixed rail in the 720 px desktop pane. */
export const Mixed: Story = {
  play: playMixedRail,
}

/**
 * The same rail in the 390 px phone sheet. With Tailwind inert the DOM is
 * identical at both widths, which is the claim worth making: nothing is removed
 * at 390 — the column stays 32 px and only the content column narrows.
 */
export const MixedPhone: Story = {
  parameters: PHONE,
  play: playMixedRail,
}

/**
 * Light theme at 720. Axe's colour-contrast rule runs on this variant too; the
 * rail itself is decoration and exempt, the event text is not.
 */
export const MixedLight: Story = {
  parameters: { theme: 'light' },
  play: playMixedRail,
}
