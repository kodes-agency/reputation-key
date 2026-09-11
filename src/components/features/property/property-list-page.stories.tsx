// Properties — the org's properties as clickable rows, now carrying the
// comparison figures the deleted fleet dashboard existed for (redesign row 3).
// Recoverable lifecycle controls live in each Property's settings so a row
// click remains unambiguous. Routing and permissions come from decorators.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { SetupChecklist } from '#/contexts/reporting/application/public-api'
import { PropertyListPage, type PropertyComparison } from './property-list-page'

const meta: Meta<typeof PropertyListPage> = {
  title: 'Property/PropertyListPage',
  component: PropertyListPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PropertyListPage>

const properties = [
  {
    id: 'prop-1',
    name: 'Harborline Suites',
    slug: 'harborline',
    timezone: 'America/Los_Angeles',
    lifecycleState: 'active',
  },
  {
    id: 'prop-2',
    name: 'Globex HQ',
    slug: 'globex-hq',
    timezone: 'America/New_York',
    lifecycleState: 'active',
  },
  {
    id: 'prop-3',
    name: 'Initech Campus',
    slug: 'initech',
    timezone: 'Europe/London',
    lifecycleState: 'active',
  },
]

const removedProperty = {
  id: 'prop-4',
  name: 'Lakeside Annex',
  slug: 'lakeside-annex',
  timezone: 'Europe/Sofia',
  lifecycleState: 'archived',
}

const comparison: ReadonlyMap<string, PropertyComparison> = new Map([
  ['prop-1', { avgRating: 4.3, reviewCount: 412, totalAttention: 7 }],
  ['prop-2', { avgRating: 3.1, reviewCount: 26, totalAttention: 0 }],
  // No ratings yet: a week-one property in a fleet of established ones.
  ['prop-3', { avgRating: null, reviewCount: 0, totalAttention: 0 }],
])

const incompleteChecklist = {
  state: 'incomplete',
  steps: [
    {
      key: 'google_connection',
      status: 'complete',
      firstCompletedAt: new Date('2026-06-01T00:00:00Z'),
      action: null,
    },
    {
      key: 'initial_review_sync',
      status: 'complete',
      firstCompletedAt: new Date('2026-06-02T00:00:00Z'),
      action: null,
    },
    {
      key: 'published_portal',
      status: 'incomplete',
      firstCompletedAt: null,
      action: { kind: 'manage_portals', propertyId: 'prop-1' },
    },
    {
      key: 'responsible_managers',
      status: 'incomplete',
      firstCompletedAt: null,
      action: { kind: 'assign_managers', propertyId: 'prop-1' },
    },
  ],
} as unknown as SetupChecklist

const completeChecklist = {
  state: 'complete',
  steps: incompleteChecklist.steps.map((step) => ({
    ...step,
    status: 'complete',
    firstCompletedAt: new Date('2026-06-03T00:00:00Z'),
    action: null,
  })),
} as unknown as SetupChecklist

export const Default: Story = {
  args: { properties },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Each property row renders its name + slug badge.
    for (const p of properties) {
      expect(canvas.getByText(p.name)).toBeVisible()
      expect(canvas.getByText(p.slug)).toBeVisible()
      expect(
        canvas.getByRole('link', {
          name: (accessibleName) => accessibleName.includes(p.name),
        }),
      ).toHaveAttribute('href', `/properties/${p.id}`)
    }
    expect(canvas.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  },
}

/**
 * What the fleet dashboard existed for, on the page that already listed the
 * same properties: rating, recent reviews, and attention, side by side.
 */
export const WithComparisonFigures: Story = {
  args: { properties, comparison },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('4.3 ★')).toBeVisible()
    expect(canvas.getByText('3.1 ★')).toBeVisible()
    // A property with no ratings says so rather than showing a dash (row 12).
    expect(canvas.getByText('No ratings')).toBeVisible()
    expect(canvas.queryByText('—')).toBeNull()
    expect(
      canvas.getByText('Ratings and review counts are all-time.', { exact: false }),
    ).toBeVisible()
    // No provenance badges: the fleet rows used to carry three per property,
    // with tooltips exposing definition ids and ISO watermarks (row 8).
    expect(canvas.queryByText(/Definition|Watermark|Data through/)).toBeNull()
  },
}

export const FleetReadUnavailable: Story = {
  args: { properties },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The figures are an enrichment: without them this is still the list a
    // manager came for, not a broken page.
    expect(canvas.getByText('Harborline Suites')).toBeVisible()
    expect(canvas.queryByText(/Ratings and review counts/)).toBeNull()
  },
}

export const SetupIncomplete: Story = {
  args: { properties, comparison, checklist: incompleteChecklist },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Setup: 2 of 4 done')).toBeVisible()
    expect(canvas.getByText('Next: Publish a guest portal.')).toBeVisible()
    // One line with one action — not the four-step panel that used to sit
    // above the fold on every visit.
    expect(canvas.queryByText(/Leave and return at any time/)).toBeNull()
  },
}

export const SetupComplete: Story = {
  args: { properties, comparison, checklist: completeChecklist },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A finished checklist has nothing to say, so it says nothing.
    expect(canvas.queryByText(/^Setup:/)).toBeNull()
  },
}

export const Compact390: Story = {
  args: { properties, comparison, checklist: incompleteChecklist },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

// Single property — minimum useful fleet.
export const SingleProperty: Story = {
  args: {
    properties: [properties[0]],
  },
}

// Empty state — first-run CTA copy.
export const Empty: Story = {
  args: { properties: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no properties yet/i)).toBeVisible()
    expect(canvas.getByText(/add your first property to get started/i)).toBeVisible()
  },
}

// A removed Property leaves the working list but stays reachable for restore.
export const WithRemovedProperty: Story = {
  args: { properties: [...properties, removedProperty] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/removed properties \(1\)/i)).toBeVisible()
    expect(
      canvas.getByRole('link', {
        name: (accessibleName) => accessibleName.includes(removedProperty.name),
      }),
    ).toHaveAttribute('href', `/properties/${removedProperty.id}`)
  },
}

// Every Property removed — the first-run CTA would be wrong here.
export const AllRemoved: Story = {
  args: { properties: [removedProperty] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no active properties/i)).toBeVisible()
    expect(canvas.queryByText(/add your first property/i)).not.toBeInTheDocument()
  },
}
