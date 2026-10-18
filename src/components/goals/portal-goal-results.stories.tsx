// The Portal goal results page (PLAN PG-18): Seaview Hotel on Dec 3, 2026.
// `Months`: the Monthly portal goal's months as sections, newest first, each
// result in plain words. `Ended`: the scans goal stopped on Sep 12, Reception's
// goal ended last year (the day prints its year) and a Spa goal ended before
// the day was kept, newest end first, each opening its goal. At 320, 390, 820
// and 1440 px and on the light theme. The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles, the heading outline and links.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PortalGoalResults } from './portal-goal-results'
import {
  MONTHLY_GOAL,
  RESULTS_NOW,
  SEAVIEW,
  SEAVIEW_GOALS,
  personName,
  resultsOf,
} from './portal-goal-results.stories.fixtures'

const meta: Meta<typeof PortalGoalResults> = {
  title: 'Goals/PortalGoalResults',
  component: PortalGoalResults,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    ...resultsOf(SEAVIEW_GOALS),
    now: RESULTS_NOW,
    personName,
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** The page's headings, in document order, as "h2 Monthly results". */
const outline = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )

export const Months: Story = {
  args: resultsOf([MONTHLY_GOAL]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly results',
      'h3 December 2026',
      'h3 November 2026',
      'h3 October 2026',
    ])
    await expect(
      canvas.getByText('Each month’s result for your portal goals.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Updating: the final figure is on its way.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Not met: 36 private ratings, the goal was 40.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Met: 41 private ratings, the goal was 40.'),
    ).toBeVisible()
    // No goal has ended: the page has no part for them.
    await expect(canvas.queryByRole('heading', { name: 'Ended portal goals' })).toBeNull()
  },
}

export const Ended: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly results',
      'h3 December 2026',
      'h3 November 2026',
      'h3 October 2026',
      'h3 September 2026',
      'h3 August 2026',
      'h2 Ended portal goals',
    ])
    // Where the Portal goals section's "Ended portal goals (3)" lands.
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Ended portal goals' }),
    ).toHaveAttribute('id', 'ended')
    const goals = within(canvas.getByRole('list', { name: 'Ended portal goals' }))
    await expect(
      goals.getAllByRole('listitem').map((item) => item.textContent ?? ''),
    ).toEqual([
      'Monthly portal goalScans · target 120 · Seaview HotelEnded on Sep 12',
      'Reception ratingsPrivate ratings · target 20 · ReceptionEnded on Nov 12, 2025',
      // Ended before the day a goal ends on was kept: no day to say.
      'Spa scansScans · target 60 · SpaEnded',
    ])
    await expect(goals.getByRole('link', { name: 'Reception ratings' })).toHaveAttribute(
      'href',
      '/properties/property-seaview/goals/goal-reception',
    )
  },
}

export const Phone320: Story = {
  ...Ended,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const Phone390: Story = {
  ...Ended,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const OnATablet: Story = {
  ...Ended,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const OnADesktop: Story = {
  ...Ended,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const Light: Story = {
  ...Ended,
  parameters: { theme: 'light' },
}
