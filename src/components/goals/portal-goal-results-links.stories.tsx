// The Portal goals section's foot on the Goals page (PLAN PG-18, copy deck R-3
// and R-4), Seaview Hotel on Dec 3, 2026: once a month has closed and goals
// have ended, both ways to the Portal goal results page; with every month
// still counting and nothing ended, none. At 320 px and on the light theme. The
// Storybook Vitest project compiles no Tailwind, so the plays assert words,
// roles and links.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PortalGoalResultsLinks } from './portal-goal-results-links'
import {
  SEAVIEW,
  SEAVIEW_GOALS,
  portalGoalBundle,
} from './portal-goal-results.stories.fixtures'

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
    await expect(
      canvas.getByRole('link', { name: 'All monthly results' }),
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

export const Light: Story = {
  ...MonthClosedAndGoalsEnded,
  parameters: { theme: 'light' },
}
