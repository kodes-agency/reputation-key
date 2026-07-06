// Property list page — the org's properties as clickable rows, each with a
// delete affordance. Pure prop-driven: `properties` (plain rows) + a delete
// `Action`. Routing (useNavigate) + permissions (usePermissions) are provided
// globally by the Storybook decorators (memory router + permission table).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PropertyListPage } from './property-list-page'
import type { Action } from '#/components/hooks/use-action'
import type { PropertyListPageProps } from './property-list-page'

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

// Build an Action-shaped mock: a callable with the reactive `.isPending` /
// `.error` / `.isSuccess` / `.data` surface the component reads.
function mockAction<TInput, TOutput>(
  impl: (input: TInput) => TOutput | Promise<TOutput>,
  state: Partial<{
    isPending: boolean
    error: unknown
    isSuccess: boolean
    data: TOutput
  }> = {},
): Action<TInput, TOutput> {
  const run = async (input: TInput) => impl(input)
  return Object.assign(run, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
    ...state,
  }) as Action<TInput, TOutput>
}

const deleteAction: PropertyListPageProps['deleteAction'] = mockAction(
  async (_input: { data: { propertyId: string } }) => ({
    deleted: true,
    propertyId: _input.data.propertyId,
  }),
)

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
  args: { properties, deleteAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Each property row renders its name + slug badge.
    for (const p of properties) {
      expect(canvas.getByText(p.name)).toBeVisible()
      expect(canvas.getByText(p.slug)).toBeVisible()
    }
  },
}

// Single property — minimum useful fleet.
export const SingleProperty: Story = {
  args: {
    properties: [properties[0]],
    deleteAction,
  },
}

// Empty state — first-run CTA copy.
export const Empty: Story = {
  args: { properties: [], deleteAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no properties yet/i)).toBeVisible()
    expect(canvas.getByText(/add your first property to get started/i)).toBeVisible()
  },
}
