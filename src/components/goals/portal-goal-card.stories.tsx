// The Portal goals section of the Goals page and its Monthly portal goal card
// before a goal (PLAN PG-08): the two gates (no Portal, draft Portals only),
// the first weeks with each Portal's steps and the day the number is ready, a
// code nobody has scanned, a number ready but not offered yet, nothing counted,
// a recommendation that cannot be read, a goal (no card yet), a read on its way
// and one that failed; each before-goal arm at 320 and 1440 px too. The
// Storybook Vitest project compiles no Tailwind, so the plays assert words,
// roles and links.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PortalGoalSection } from './portal-goal-section'
import {
  CARD_DRAFTS_ONE,
  CARD_DRAFTS_TWO,
  CARD_GETTING_READY,
  CARD_GETTING_READY_SILENT,
  CARD_GOAL,
  CARD_NO_PORTAL,
  CARD_NOTHING,
  CARD_READY,
  CARD_REC_UNREADABLE,
  CARD_SCANS_ONLY,
  SEAVIEW,
} from './portal-goal.stories.fixtures'

const read = (data: PortalGoalCardView | undefined, failed = false) => ({
  data,
  failed,
  retrying: false,
  retry: fn(),
})

/** Stands in for the utilities layer, which this runner does not compile: a link in a sentence stays underlined (axe link-in-text-block). */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

const meta: Meta<typeof PortalGoalSection> = {
  title: 'Goals/PortalGoalCard',
  component: PortalGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    card: read(CARD_GETTING_READY),
    canCreatePortal: true,
  },
  // As wide as the Goals page draws the section.
  render: (args) => (
    <div className="max-w-5xl">
      <style>{UTILITY_LAYER}</style>
      <PortalGoalSection {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

const PORTALS = `/properties/${SEAVIEW.propertyId}/portals`
const RATINGS_LINE = 'How many private ratings your portals bring in each month.'
const GATE_FACT =
  'Counts the private ratings your portals bring in each month. It starts once a portal is live.'

/** The section's title, then the card's, one level under it. */
async function expectTitles(canvas: Canvas) {
  await expect(
    canvas.getByRole('heading', { level: 2, name: 'Portal goals' }),
  ).toBeVisible()
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
}

/** Each row's name, in the order the list draws them. */
function readinessNames(canvas: Canvas): string[] {
  const list = canvas.getByRole('list', { name: 'Portal readiness' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.firstElementChild?.textContent ?? '')
}

export const NoPortal: Story = {
  args: { card: read(CARD_NO_PORTAL) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectTitles(canvas)
    await expect(canvas.getByText(GATE_FACT)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Create a portal' })).toHaveAttribute(
      'href',
      '/properties/p1/portals/new',
    )
    // The gate says what the goal counts itself: no section line above it.
    await expect(canvas.queryByText(RATINGS_LINE)).toBeNull()
  },
}

export const NoPortalOnANarrowPhone: Story = {
  ...NoPortal,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const NoPortalOnADesktop: Story = {
  ...NoPortal,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

/** Without portal.create the gate is a fact, with no door. */
export const NoPortalWithoutPortalCreate: Story = {
  args: { card: read(CARD_NO_PORTAL), canCreatePortal: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(GATE_FACT)).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Create a portal' })).toBeNull()
  },
}

export const DraftsOnly: Story = {
  args: { card: read(CARD_DRAFTS_ONE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(GATE_FACT)).toBeVisible()
    await expect(canvas.getByText('You have 1 draft portal: Spa.')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open Spa' })).toHaveAttribute(
      'href',
      `${PORTALS}/portal-spa`,
    )
  },
}

export const DraftsOnlyOnANarrowPhone: Story = {
  ...DraftsOnly,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const DraftsOnlyOnADesktop: Story = {
  ...DraftsOnly,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const DraftsTwo: Story = {
  args: { card: read(CARD_DRAFTS_TWO) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('You have 2 draft portals: Spa and Bar.')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open portals' })).toHaveAttribute(
      'href',
      PORTALS,
    )
  },
}

async function expectGettingReady(canvas: Canvas) {
  await expectTitles(canvas)
  await expect(canvas.getByText(RATINGS_LINE)).toBeVisible()
  await expect(canvas.getByText('Getting your portals ready')).toBeVisible()
  // Name order, never by count.
  await expect(readinessNames(canvas)).toEqual(['Reception', 'Restaurant', 'Spa'])
  await expect(
    canvas.getByText('So far in October: 8 private ratings · 47 scans'),
  ).toBeVisible()
  await expect(
    canvas.getByText('Your recommended number is ready on Oct 23, after 2 weeks live.'),
  ).toBeVisible()
  // No number is offered yet, and no way to the old form.
  await expect(canvas.queryByRole('button')).toBeNull()
}

export const GettingReady: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectGettingReady(canvas)
    // Each step says whether it is done, in words.
    const spa = within(canvas.getAllByRole('listitem')[2]!)
    await expect(spa.getByText('Live')).toHaveTextContent('Live (done)')
    await expect(spa.getByText('First scan')).toHaveTextContent('First scan (not yet)')
    // A code made a week ago says nothing yet.
    await expect(canvas.queryByText(/No scan in the/)).toBeNull()
  },
}

export const GettingReadySilent: Story = {
  args: { card: read(CARD_GETTING_READY_SILENT) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'No scan in the 17 days since its code was made. Is it where guests can see it?',
        { exact: false },
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open Spa' })).toHaveAttribute(
      'href',
      `${PORTALS}/portal-spa?tab=share`,
    )
  },
}

export const GettingReadyOnAPhone: Story = {
  ...GettingReadySilent,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const GettingReadyOnANarrowPhone: Story = {
  ...GettingReadySilent,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const GettingReadyOnATablet: Story = {
  ...GettingReady,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const GettingReadyOnADesktop: Story = {
  ...GettingReady,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const GettingReadyLight: Story = {
  ...GettingReadySilent,
  parameters: { theme: 'light' },
}

export const NothingCounted: Story = {
  args: { card: read(CARD_NOTHING) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectTitles(canvas)
    await expect(canvas.getByText(RATINGS_LINE)).toBeVisible()
    await expect(
      canvas.getByText(
        'No scans in the last 2 weeks. Check that each code is where guests can see it.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open portals' })).toHaveAttribute(
      'href',
      PORTALS,
    )
  },
}

export const NothingCountedOnANarrowPhone: Story = {
  ...NothingCounted,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const NothingCountedOnADesktop: Story = {
  ...NothingCounted,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const RecommendationUnreadable: Story = {
  args: { card: read(CARD_REC_UNREADABLE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectTitles(canvas)
    await expect(
      canvas.getByText('Your recommended number can’t be read right now.'),
    ).toBeVisible()
  },
}

export const RecommendationUnreadableOnANarrowPhone: Story = {
  ...RecommendationUnreadable,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const RecommendationUnreadableOnADesktop: Story = {
  ...RecommendationUnreadable,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

/** Until the card can offer it, a ready number draws the steps and the month so far: no heading, no ready day, no number. */
async function expectReadyBeforeItsOffer(
  canvas: Canvas,
  sectionLine: string,
  soFar: string,
) {
  await expectTitles(canvas)
  await expect(canvas.getByText(sectionLine)).toBeVisible()
  await expect(readinessNames(canvas)).toEqual(['Reception', 'Restaurant'])
  await expect(canvas.getByText(soFar)).toBeVisible()
  await expect(canvas.queryByText('Getting your portals ready')).toBeNull()
  await expect(canvas.queryByText(/Your recommended number is ready/u)).toBeNull()
  await expect(canvas.queryByRole('button')).toBeNull()
}

export const ScansOnlyBeforeItsOffer: Story = {
  args: { card: read(CARD_SCANS_ONLY) },
  play: async ({ canvasElement }) => {
    await expectReadyBeforeItsOffer(
      within(canvasElement),
      'How many scans your portals get each month.',
      'So far in October: 0 private ratings · 23 scans',
    )
  },
}

export const ReadyBeforeItsOffer: Story = {
  args: { card: read(CARD_READY) },
  play: async ({ canvasElement }) => {
    await expectReadyBeforeItsOffer(
      within(canvasElement),
      RATINGS_LINE,
      'So far in October: 12 private ratings · 47 scans',
    )
  },
}

/** With a goal the card draws nothing yet: the goal is listed with the other Portal goals. */
export const WithAGoal: Story = {
  args: { card: read(CARD_GOAL) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Portal goals' }),
    ).toBeVisible()
    await expect(canvasElement.querySelector('[data-slot="portal-goal-card"]')).toBeNull()
    await expect(canvas.queryByRole('heading', { level: 3 })).toBeNull()
    await expect(canvas.queryByText(RATINGS_LINE)).toBeNull()
  },
}

/** A read on its way keeps the card's room, and says nothing it does not know yet. */
export const Loading: Story = {
  args: { card: read(undefined) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Portal goals' }),
    ).toBeVisible()
    const pending = canvasElement.querySelector<HTMLElement>(
      '[data-slot="portal-goal-pending"]',
    )
    await expect(pending).not.toBeNull()
    await expect(pending?.style.minHeight).not.toBe('')
    await expect(canvas.queryByText(RATINGS_LINE)).toBeNull()
  },
}

export const ReadError: Story = {
  args: { card: read(undefined, true) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The monthly portal goal can’t be read right now.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.card?.retry).toHaveBeenCalledOnce()
  },
}

/** The History view draws no card, and says when it has no ended goal to list. */
export const HistoryWithNoEndedGoal: Story = {
  args: { card: null, empty: 'No goal history' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Portal goals' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('heading', { level: 3 })).toBeNull()
    await expect(canvas.getByText('No goal history')).toBeVisible()
  },
}
