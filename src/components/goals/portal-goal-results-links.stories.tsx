// The Portal goals section's foot on the Goals page (PLAN PG-18, copy deck R-3
// and R-4), Seaview Hotel on Dec 3, 2026: once a month has closed and goals
// have ended, both ways to the Portal goal results page; with every month
// still counting and nothing ended, none. In the section they come last, under
// the running card and the way to add a goal. At 320, 390, 820 and 1440 px and
// on the light theme. The Storybook Vitest project compiles no Tailwind, so the
// plays assert words, roles, links and their order.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { PortalGoalResultsLinks } from './portal-goal-results-links'
import {
  SEAVIEW,
  SEAVIEW_GOALS,
  portalGoalBundle,
} from './portal-goal-results.stories.fixtures'
import { CARD_RUNNING } from './portal-goal-running.stories.fixtures'
import { PortalGoalSection } from './portal-goal-section'

const meta: Meta<typeof PortalGoalResultsLinks> = {
  title: 'Goals/PortalGoalResultsLinks',
  component: PortalGoalResultsLinks,
  parameters: { layout: 'padded' },
  args: { propertyId: SEAVIEW.propertyId, programs: SEAVIEW_GOALS },
}

export default meta
type Story = StoryObj<typeof meta>

export const MonthClosedAndGoalsEnded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Found, not got: in a compiled Storybook the story's router draws it after
    // the play starts.
    await expect(
      await canvas.findByRole('link', { name: 'All monthly results' }),
    ).toHaveAttribute('href', '/properties/property-seaview/goals/portal-results')
    await expect(
      canvas.getByRole('link', { name: 'Ended portal goals (3)' }),
    ).toHaveAttribute('href', '/properties/property-seaview/goals/portal-results#ended')
  },
}

/** December set and still counting, nothing ended: no way there yet. */
export const NothingClosedYet: Story = {
  args: {
    programs: [
      portalGoalBundle({
        id: 'goal-december',
        name: 'Monthly portal goal',
        metric: 'portal_rating_count',
        target: 45,
        subject: { kind: 'property', propertyId: SEAVIEW.propertyId },
        from: '2026-12',
        months: [{ yearMonth: '2026-12', open: true }],
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('link')).toEqual([])
  },
}

export const Phone320: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const Phone390: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const OnATablet: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const OnADesktop: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const Light: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { theme: 'light' },
}

/**
 * The foot as the Goals page draws it: last in the Portal goals section, under
 * the running card and the way to add a goal (`footer`: the door that opens
 * "Add a portal goal" in place, PG-20), as wide as the page draws the section.
 */
export const InThePortalGoalsSection: Story = {
  render: (args) => (
    <div className="max-w-5xl">
      <PortalGoalSection
        propertyId={args.propertyId}
        card={{ data: CARD_RUNNING, failed: false, retrying: false, retry: fn() }}
        canCreatePortal
        commands={{ setMonthlyPortalGoalFn: fn(), onSet: fn() }}
        footer={
          <Button
            type="button"
            variant="link"
            size="inline"
            className="self-start text-sm"
          >
            Add a portal goal
          </Button>
        }
        results={<PortalGoalResultsLinks {...args} />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const section = within(
      await within(canvasElement).findByRole('region', { name: 'Portal goals' }),
    )
    await expect(
      section
        .getAllByRole('link')
        .map((link) => link.textContent ?? '')
        .slice(-2),
    ).toEqual(['All monthly results', 'Ended portal goals (3)'])
    // The way to add a goal comes first, the results last.
    const add = section.getByRole('button', { name: 'Add a portal goal' })
    await expect(
      add.compareDocumentPosition(
        section.getByRole('link', { name: 'All monthly results' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await expect(
      section.getByRole('link', { name: 'Ended portal goals (3)' }),
    ).toHaveAttribute('href', '/properties/property-seaview/goals/portal-results#ended')
  },
}

export const InThePortalGoalsSectionOnAPhone: Story = {
  ...InThePortalGoalsSection,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const InThePortalGoalsSectionOnADesktop: Story = {
  ...InThePortalGoalsSection,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}
