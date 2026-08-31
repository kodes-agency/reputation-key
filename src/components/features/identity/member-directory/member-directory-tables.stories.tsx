import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
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

function MemberRows() {
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
      updateRoleAction={action()}
      removeMemberAction={action()}
    />
  )
}

function InvitationRows() {
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
      resendAction={action()}
      cancelAction={action()}
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

export const ReadOnlyMembers: Story = {
  render: () => <MemberRows />,
  play: ({ canvasElement }) => expectRectangularTable(canvasElement),
}

export const MixedInvitationStatuses: Story = {
  render: () => <InvitationRows />,
  play: ({ canvasElement }) => expectRectangularTable(canvasElement),
}
