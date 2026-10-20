// The other Portal goals as compact rows under the Monthly portal goal's card
// (PLAN PG-21): each named for whom it counts and what, linked to its own
// page, with this month so far while it runs, and for a count with one subject
// whose pace the rule judged the shared pace pill ("On pace", "Below pace").
// The Goals page lists the first
// five, then "See all on the goal page"; while the months are first read each
// running row keeps the room its line will take; a month that cannot be read
// says so once, above the rows; the goals not ended only, on both of the Google
// section's views (the ended ones are on the Portal goal results page). At
// 320, 390, 820 and 1440 px and on the light theme. The Storybook Vitest
// project compiles no Tailwind, so the plays assert words, roles and links.
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type {
  GoalListProgress,
  GoalMetric,
  GoalSubject,
} from '#/contexts/reporting/application/public-api'
import { PortalGoalExtras } from './-portal-goal-extras'

/** A goal as the Goals list reads it. */
type ListedGoal = ComponentProps<typeof PortalGoalExtras>['goals'][number]

const PROPERTY_ID = 'p1'
const NOV_1 = new Date('2026-10-31T22:00:00.000Z')
const OCT_23 = new Date('2026-10-23T09:00:00.000Z')

const NAMES: Readonly<Record<string, string>> = {
  'portal:reception': 'Reception',
  'portal:restaurant': 'Restaurant',
  'portal:spa': 'Spa',
  'portal:bar': 'Bar',
  'portal:pool': 'Pool',
  'portal_group:rooms': 'Rooms',
}

const subjectName = (subject: GoalSubject): string =>
  subject.kind === 'property'
    ? 'Seaview Hotel'
    : (NAMES[
        subject.kind === 'portal'
          ? `portal:${subject.portalId}`
          : `portal_group:${subject.portalGroupId}`
      ] ?? 'Portal')

/** A goal of the Property, as the Goals list reads it: one subject, from November. */
function goal(
  id: string,
  subject: GoalSubject,
  metric: GoalMetric = 'portal_rating_count',
  status: ListedGoal['program']['status'] = 'active',
): ListedGoal {
  const version = {
    id: `${id}-v1`,
    programId: id,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric,
    metricMinimumSample: metric === 'portal_rating_average' ? 10 : 0,
    targetValue: metric === 'portal_rating_average' ? 4.5 : 20,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: NOV_1,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: OCT_23,
  }
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: id,
      description: null,
      status,
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: OCT_23,
      updatedAt: OCT_23,
    },
    version,
    versions: [version],
    assignments: [
      {
        id: `${id}-a1`,
        programId: id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        metric,
        subject,
        effectiveFrom: NOV_1,
        effectiveTo: null,
        createdBy: 'elena',
        createdAt: OCT_23,
      },
    ],
    results: [],
  }
}

const portal = (portalId: string): GoalSubject => ({ kind: 'portal', portalId })

/** Six other goals: five Portals' and the Rooms group's, and the Property's average. */
const SIX = [
  goal('reception', portal('reception')),
  goal('rooms', { kind: 'portal_group', portalGroupId: 'rooms' }, 'qualified_scans'),
  goal('restaurant', portal('restaurant')),
  goal('average', { kind: 'property', propertyId: PROPERTY_ID }, 'portal_rating_average'),
  goal('spa', portal('spa')),
  goal('bar', portal('bar')),
]

/** Reception: 13 of 20 so far, 9 days left, below pace. */
const RECEPTION_LIVE: GoalListProgress = {
  programId: 'reception',
  metric: 'portal_rating_count',
  subjectCount: 1,
  daysLeft: 8,
  month: { reading: { kind: 'live', value: 13, sampleCount: 13 }, targetValue: 20 },
  belowPace: 1,
}

/** Restaurant: 18 of 20, keeping up. */
const RESTAURANT_LIVE: GoalListProgress = {
  ...RECEPTION_LIVE,
  programId: 'restaurant',
  month: { reading: { kind: 'live', value: 18, sampleCount: 18 }, targetValue: 20 },
  belowPace: 0,
}

/** Spa: 3 of 20 and the rule does not judge it yet (the first days, or too few expected). */
const SPA_LIVE: GoalListProgress = {
  ...RECEPTION_LIVE,
  programId: 'spa',
  month: { reading: { kind: 'live', value: 3, sampleCount: 3 }, targetValue: 20 },
  belowPace: null,
}

/** The Property's average: its figure against the target, and no pace to judge. */
const AVERAGE_LIVE: GoalListProgress = {
  programId: 'average',
  metric: 'portal_rating_average',
  subjectCount: 1,
  daysLeft: 8,
  month: { reading: { kind: 'live', value: 4.62, sampleCount: 31 }, targetValue: 4.5 },
  belowPace: null,
}

const LIVE = {
  byProgram: new Map([
    ['reception', RECEPTION_LIVE],
    ['restaurant', RESTAURANT_LIVE],
    ['spa', SPA_LIVE],
    ['average', AVERAGE_LIVE],
  ]),
  loading: false,
  failed: false,
}

const meta: Meta<typeof PortalGoalExtras> = {
  title: 'Goals/PortalGoalExtras',
  component: PortalGoalExtras,
  parameters: { layout: 'padded', viewport: { defaultViewport: 'desktopManager' } },
  args: {
    propertyId: PROPERTY_ID,
    goals: SIX,
    monthlyGoalId: null,
    live: LIVE,
    subjectName,
    limit: 5,
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Each row's link, by its name. */
const rowNames = (canvasElement: HTMLElement): string[] =>
  within(within(canvasElement).getByRole('list'))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '')

/** Six goals: the first five, named for whom and what, then the way to see them all. */
export const FirstFiveThenSeeAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 3, name: 'More portal goals' }),
    ).toBeVisible()
    await expect(rowNames(canvasElement)).toEqual([
      'Reception · Private ratings',
      'Rooms (group) · Scans',
      'Restaurant · Private ratings',
      'Average private rating',
      'Spa · Private ratings',
    ])
    await expect(
      canvas.getByRole('link', { name: 'Reception · Private ratings' }),
    ).toHaveAttribute('href', '/properties/p1/goals/reception')
    await expect(canvas.getByText('13 of 20 so far · 9 days left')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'See all on the goal page' }),
    ).toHaveAttribute('href', '/properties/p1/goals/portals')
  },
}

/**
 * Each running count wears its own pace, in the same pill as the card: Reception
 * is behind, Restaurant keeps up, Spa is not judged yet and the average has no
 * pace to judge, so those two have none; Rooms has no figure read and no line.
 * The pill is not part of the row's link.
 */
export const PacePillsOnTheRows: Story = {
  play: async ({ canvasElement }) => {
    const rows = within(within(canvasElement).getByRole('list')).getAllByRole('listitem')
    const pills = rows.map(
      (row) =>
        within(row).queryByText(/^(Getting started|On pace|Below pace)$/u)?.textContent ??
        null,
    )
    await expect(pills).toEqual(['Below pace', null, 'On pace', null, null])
    await expect(rowNames(canvasElement)).not.toContainEqual(
      expect.stringMatching(/pace/u),
    )
  },
}

/** While the months are first read, the running rows keep their room; five, no See all. */
export const MonthsBeingRead: Story = {
  args: {
    goals: SIX.slice(0, 5),
    live: { byProgram: new Map(), loading: true, failed: false },
  },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(rowNames(canvasElement)).toHaveLength(5)
    await expect(
      canvas.queryByRole('link', { name: 'See all on the goal page' }),
    ).toBeNull()
  },
}

/** A month that cannot be read is said once, above the rows. */
export const MonthsUnreadable: Story = {
  args: { live: { byProgram: new Map(), loading: false, failed: true } },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('This month’s figures can’t be read right now.'),
    ).toBeVisible()
    await expect(rowNames(canvasElement)).toHaveLength(5)
  },
}

export const FirstFiveLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expect(rowNames(canvasElement)).toHaveLength(5)
  },
}
