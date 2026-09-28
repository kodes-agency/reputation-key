import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { withRole } from '../../../../../.storybook/AuthedRouterDecorator'
import { InvitationTable } from './invitation-table'
import { MemberTable } from './member-table'

const action = <TInput,>(): Action<TInput> =>
  Object.assign(async (_input: TInput) => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  }) as Action<TInput>

/**
 * A command the server refuses. A plain function, not `fn()`: the spy attaches
 * its own handler to every promise it returns to record the outcome, which
 * would mark the rejection handled and hide exactly what the stories look for.
 */
const refusedAction = <TInput,>(refusals: Error[]): Action<TInput> =>
  Object.assign(
    async (_input: TInput) => {
      const refusal = new Error('refused')
      refusals.push(refusal)
      throw refusal
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as Action<TInput>

type MemberActions = Pick<
  Parameters<typeof MemberTable>[0],
  'updateRoleAction' | 'removeMemberAction'
>
type InvitationActions = Pick<
  Parameters<typeof InvitationTable>[0],
  'resendAction' | 'cancelAction'
>

function MemberRows({
  updateRoleAction = action(),
  removeMemberAction = action(),
}: Partial<MemberActions>) {
  return (
    <MemberTable
      members={[
        {
          id: 'member-1',
          userId: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'AccountAdmin',
          rawRole: 'owner',
        },
      ]}
      currentUserId="manager-1"
      updateRoleAction={updateRoleAction}
      removeMemberAction={removeMemberAction}
    />
  )
}

function InvitationRows({
  resendAction = action(),
  cancelAction = action(),
}: Partial<InvitationActions>) {
  return (
    <InvitationTable
      invitations={[
        {
          id: 'invitation-1',
          email: 'pending@example.com',
          role: 'PropertyManager',
          rawRole: 'admin',
          status: 'pending',
        },
        {
          id: 'invitation-2',
          email: 'accepted@example.com',
          role: 'PropertyManager',
          rawRole: 'admin',
          status: 'accepted',
        },
      ]}
      resendAction={resendAction}
      cancelAction={cancelAction}
    />
  )
}

const meta = {
  title: 'Identity/MemberDirectory/Tables',
  decorators: [withRole('PropertyManager')],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function expectRectangularTable(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const table = canvas.getByRole('table')
  const rows = within(table).getAllByRole('row')
  const columnCount = within(rows[0]!).getAllByRole('columnheader').length
  for (const row of rows.slice(1)) {
    expect(within(row).getAllByRole('cell')).toHaveLength(columnCount)
  }
}

/**
 * The unhandled rejections raised while `act` runs. `unhandledrejection` is
 * dispatched from a task queued after the microtask checkpoint, so two task
 * turns are waited out before reading.
 */
async function unhandledRejectionsDuring(act: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const record = (event: PromiseRejectionEvent) => {
    event.preventDefault()
    unhandled.push(event.reason)
  }
  window.addEventListener('unhandledrejection', record)
  try {
    await act()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    window.removeEventListener('unhandledrejection', record)
  }
  return unhandled
}

export const ReadOnlyMembers: Story = {
  render: () => <MemberRows />,
  play: ({ canvasElement }) => expectRectangularTable(canvasElement),
}

export const MixedInvitationStatuses: Story = {
  render: () => <InvitationRows />,
  play: ({ canvasElement }) => expectRectangularTable(canvasElement),
}

/**
 * A refused resend or cancellation is reported by the route's toast
 * (useActionMutation's errorMessage), so the table only settles the promise:
 * an unsettled one surfaced as an unhandled rejection.
 */
const invitationRefusals: Error[] = []

export const RefusedInvitationCommands: Story = {
  decorators: [withRole('AccountAdmin')],
  render: () => (
    <InvitationRows
      resendAction={refusedAction(invitationRefusals)}
      cancelAction={refusedAction(invitationRefusals)}
    />
  ),
  play: async ({ canvasElement }) => {
    invitationRefusals.length = 0
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    const unhandled = await unhandledRejectionsDuring(async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Resend' }))
      await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
      await userEvent.click(
        await page.findByRole('button', { name: 'Cancel invitation' }),
      )
    })
    expect(invitationRefusals).toHaveLength(2)
    expect(unhandled).toEqual([])
  },
}

/** The same for a refused member removal. */
const memberRefusals: Error[] = []

export const RefusedMemberRemoval: Story = {
  decorators: [withRole('AccountAdmin')],
  render: () => <MemberRows removeMemberAction={refusedAction(memberRefusals)} />,
  play: async ({ canvasElement }) => {
    memberRefusals.length = 0
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    const unhandled = await unhandledRejectionsDuring(async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Remove' }))
      await userEvent.click(await page.findByRole('button', { name: 'Remove member' }))
    })
    expect(memberRefusals).toHaveLength(1)
    expect(unhandled).toEqual([])
  },
}
