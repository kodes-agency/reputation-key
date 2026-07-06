// Goal create form — name, entity scope, metric key + aggregation, goal type,
// target, and conditional period/rolling/recurrence fields. Validation runs
// client-side via the shared `createGoalSchema` (Zod) on submit.
//
// The form is prop-driven: `mutation` is an Action<{ data: CreateGoalInput }>
// (callable + isPending/error surface) — mocked here without server/RPC.
// Routing (useNavigate) is provided globally by the Storybook memory router.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GoalCreateForm } from './goal-create-form'
import type { PortalOption } from './goal-entity-types'
import type { CreateGoalInput } from '#/contexts/goal/application/dto/goal.dto'
import type { Action } from '#/components/hooks/use-action'

const meta: Meta<typeof GoalCreateForm> = {
  title: 'Property/GoalCreateForm',
  component: GoalCreateForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    // The form's Cancel button navigates via useNavigate; the global memory
    // router handles the no-op. Width keeps the multi-field form readable.
    chromatic: { disable: true },
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof GoalCreateForm>

// Build an Action-shaped mock: a callable with the reactive `.isPending` /
// `.error` / `.isSuccess` / `.data` surface the form reads off `mutation`.
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

const portals: readonly PortalOption[] = [
  { id: 'portal-1', name: 'Main Lobby Portal' },
  { id: 'portal-2', name: 'Spa Portal' },
]
const portalGroups: readonly PortalOption[] = [{ id: 'pg-1', name: 'All Portals' }]

const onSubmit = fn()

export const Default: Story = {
  args: {
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    mutation: mockAction(async (input: { data: CreateGoalInput }) => {
      onSubmit(input)
      return { success: true }
    }),
    portals,
    portalGroups,
  },
}

// Submit empty → client-side Zod validation fails per field.
export const ValidationError: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /create goal/i }))
    // Validation runs client-side (Zod) on submit; the field errors render
    // after a React state update, so wait for them to commit.
    await waitFor(() => {
      // Name is required (Zod `.min(1, 'Goal name is required')`) → its field
      // error renders inline. (targetValue/metricKey also fail validation,
      // but their messages for `undefined` input are zod type-errors, not the
      // field-specific custom text — so assert the deterministic name error.)
      expect(canvas.getByText(/goal name is required/i)).toBeVisible()
    })
  },
}

// Mutation pending — submit button shows "Creating..." and is disabled.
export const Submitting: Story = {
  args: {
    ...Default.args,
    mutation: mockAction(
      async (input: { data: CreateGoalInput }) => {
        onSubmit(input)
        return { success: true }
      },
      { isPending: true },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /creating/i })).toBeDisabled()
  },
}

// Mutation rejected — the form surfaces a generic destructive error message.
export const MutationError: Story = {
  args: {
    ...Default.args,
    mutation: mockAction(
      async (_input: { data: CreateGoalInput }) => {
        throw new Error('server rejected')
      },
      { error: new Error('server rejected') },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/failed to create goal/i)).toBeVisible()
  },
}
