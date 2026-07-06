// Assign staff form stories.
// The form submits one mutation row per user × portal combination, with
// per-row try/catch so a partial batch still toasts success and calls
// onSuccess with the succeeded count. Mock Actions cover idle / pending /
// error / validation; the partial-success play drives a 2-row batch where
// the second row rejects.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import type { MemberOption, TeamOption } from '#/components/features/team/shared/types'
import type { PortalOption } from './portal-selector'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import { AssignStaffForm } from './assign-staff-form'

type AssignInput = { data: CreateStaffAssignmentInput }

function makeAction(
  impl: (input: AssignInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<AssignInput, unknown> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const members: ReadonlyArray<MemberOption> = [
  { userId: 'u1', name: 'Alice Tan', email: 'alice@example.com' },
  { userId: 'u2', name: 'Bob Ng', email: 'bob@example.com' },
]
const teams: ReadonlyArray<TeamOption> = []
const portals: ReadonlyArray<PortalOption> = [{ id: 'p1', name: 'Reviews Portal' }]

const meta: Meta<typeof AssignStaffForm> = {
  title: 'Staff/AssignStaffForm',
  component: AssignStaffForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof AssignStaffForm>

const baseArgs = {
  propertyId: 'prop-1',
  members,
  teams,
  portals,
  assignedUserIds: new Set<string>(),
}

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { ...baseArgs, mutation: resolvingAction },
}

// Pending mutation: submit button shows the spinner + is disabled.
export const Submitting: Story = {
  args: {
    ...baseArgs,
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
}

// Server-rejected assignment — top-level banner surfaces the message.
export const MutationError: Story = {
  args: {
    ...baseArgs,
    mutation: makeAction(
      async () => {
        throw new Error('You do not manage this property')
      },
      { error: new Error('You do not manage this property') },
    ),
  },
}

// Submit with no selections → both required-array fields show their message.
export const ValidationError: Story = {
  args: { ...baseArgs, mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /assign staff/i }))
    expect(
      await canvas.findByText(/select at least one staff member/i),
    ).toBeInTheDocument()
    expect(await canvas.findByText(/select at least one portal/i)).toBeInTheDocument()
  },
}

// 1 member × 1 portal = 1 row; mutation called once, onSuccess with count 1.
const successSpy = fn()
const successMutation = makeAction(async (input) => {
  successSpy(input)
  return { ok: true }
})
const onSuccess = fn()
export const Success: Story = {
  args: { ...baseArgs, mutation: successMutation, onSuccess },
  play: async ({ canvasElement }) => {
    successSpy.mockClear()
    onSuccess.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: /alice tan/i }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /reviews portal/i }))
    await userEvent.click(canvas.getByRole('button', { name: /assign staff/i }))
    await waitFor(() => {
      expect(successSpy).toHaveBeenCalledTimes(1)
    })
    expect(successSpy).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        propertyId: 'prop-1',
        teamId: undefined,
        portalId: 'p1',
      },
    })
    expect(onSuccess).toHaveBeenCalledWith(1)
  },
}

// 2 members × 1 portal = 2 rows; the 2nd row rejects → succeeded=1, failed=1.
// onSuccess still fires with the partial count.
const partialSpy = fn()
const partialMutation = makeAction(async (input) => {
  partialSpy(input)
  // Reject every even-numbered row to simulate a partial batch.
  if (partialSpy.mock.calls.length % 2 === 0) throw new Error('row failed')
  return { ok: true }
})
const partialOnSuccess = fn()
export const PartialSuccess: Story = {
  args: { ...baseArgs, mutation: partialMutation, onSuccess: partialOnSuccess },
  play: async ({ canvasElement }) => {
    partialSpy.mockClear()
    partialOnSuccess.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: /alice tan/i }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /bob ng/i }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /reviews portal/i }))
    await userEvent.click(canvas.getByRole('button', { name: /assign staff/i }))
    await waitFor(() => {
      expect(partialSpy).toHaveBeenCalledTimes(2)
    })
    // First row succeeded, second failed → onSuccess receives the count of 1.
    expect(partialOnSuccess).toHaveBeenCalledWith(1)
  },
}
