// Property list page — the org's properties as clickable rows. Recoverable
// lifecycle controls live in each Property's settings so a row click remains
// unambiguous. Routing and permissions are provided by Storybook decorators.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PropertyListPage } from './property-list-page'

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
