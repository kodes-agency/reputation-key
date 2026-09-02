import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { PropertyLifecycleCard } from './property-lifecycle-card'

const idleAction = <TInput,>(): Action<TInput> =>
  Object.assign(async (_input: TInput): Promise<unknown> => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

const archiveAction = () => idleAction<{ data: { propertyId: string; reason: string } }>()
const lifecycleAction = () => idleAction<{ data: { propertyId: string } }>()

const baseArgs = {
  responsibilityNeeded: false,
  actions: {
    archive: archiveAction(),
    remove: archiveAction(),
    restore: lifecycleAction(),
    disconnect: lifecycleAction(),
  },
  permissions: { archive: true, restore: true, disconnect: true },
} as const

const meta: Meta<typeof PropertyLifecycleCard> = {
  title: 'Property/PropertyLifecycleCard',
  component: PropertyLifecycleCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-4xl bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PropertyLifecycleCard>

export const Active: Story = {
  args: {
    ...baseArgs,
    property: {
      id: 'property-1',
      name: 'Harborline Suites',
      lifecycleState: 'active',
      lifecycleReason: null,
      purgeScheduledFor: null,
      googleBindingState: 'active',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Active')).toBeVisible()
    const archiveButton = canvas.getByRole('button', { name: 'Archive Property' })
    expect(archiveButton).toBeVisible()
    expect(canvas.queryByText(/delete property/i)).not.toBeInTheDocument()
    await userEvent.click(archiveButton)
    const dialog = within(canvasElement.ownerDocument.body)
    // The alert dialog mounts through Radix's entry animation, which starts at
    // opacity 0 — sampling the first frame reads as "not visible".
    const heading = await dialog.findByRole('heading', {
      name: /archive Harborline Suites/i,
    })
    await waitFor(() => expect(heading).toBeVisible())
    const confirm = dialog.getByRole('button', { name: 'Archive Property' })
    expect(confirm).toBeDisabled()
    await userEvent.type(
      dialog.getByLabelText('Archive note'),
      'Temporarily closed for refurbishment',
    )
    expect(confirm).toBeEnabled()
  },
}

export const ArchivedAndGoogleConnected: Story = {
  args: {
    ...baseArgs,
    property: {
      id: 'property-1',
      name: 'Harborline Suites',
      lifecycleState: 'archived',
      lifecycleReason: 'Temporarily closed for refurbishment',
      purgeScheduledFor: new Date('2026-09-27T12:00:00.000Z'),
      googleBindingState: 'active',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Archived')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Restore Property' })).toBeEnabled()
    expect(
      canvas.getByRole('button', {
        name: 'Disconnect this Property from Google',
      }),
    ).toBeVisible()
    expect(canvas.getByText(/before Sep 27, 2026/i)).toBeVisible()
  },
}

export const ArchivedNeedsResponsibleManager: Story = {
  args: {
    ...baseArgs,
    responsibilityNeeded: true,
    property: {
      id: 'property-1',
      name: 'Harborline Suites',
      lifecycleState: 'archived',
      lifecycleReason: 'Temporarily closed',
      purgeScheduledFor: new Date('2026-09-27T12:00:00.000Z'),
      googleBindingState: 'disconnected',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Restore Property' })).toBeDisabled()
    expect(canvas.getByText(/assign an eligible Responsible Manager/i)).toBeVisible()
    expect(canvas.getByText(/Google reconnection needed/i)).toBeVisible()
  },
}
