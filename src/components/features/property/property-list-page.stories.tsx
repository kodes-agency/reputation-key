// Property list page — the org's properties as clickable rows. Destructive
// Property lifecycle controls are deliberately absent during LIF-01
// containment. Routing and permissions are provided by Storybook decorators.
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
  },
  { id: 'prop-2', name: 'Globex HQ', slug: 'globex-hq', timezone: 'America/New_York' },
  { id: 'prop-3', name: 'Initech Campus', slug: 'initech', timezone: 'Europe/London' },
]

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
