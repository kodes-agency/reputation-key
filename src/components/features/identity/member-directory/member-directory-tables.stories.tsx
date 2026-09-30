import { useState } from 'react'
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

type MemberTableProps = Parameters<typeof MemberTable>[0]
type InvitationActions = Pick<
  Parameters<typeof InvitationTable>[0],
  'resendAction' | 'cancelAction'
>

const PROPERTIES = [
  { id: 'p1', name: 'Meridian Sofia' },
  { id: 'p2', name: 'Varna Beach' },
  { id: 'p3', name: 'Harbour Cafe Burgas' },
]

const ADMIN = {
  id: 'member-1',
  userId: 'user-1',
  name: 'Ivana Georgieva',
  email: 'ivana@example.com',
  role: 'AccountAdmin' as const,
  rawRole: 'owner',
}
const MANAGER = {
  id: 'member-2',
  userId: 'user-2',
  name: 'Maria Petrova',
  email: 'maria@example.com',
  role: 'PropertyManager' as const,
  rawRole: 'admin',
  properties: PROPERTIES,
}
const STRANDED_MANAGER = {
  ...MANAGER,
  id: 'member-3',
  userId: 'user-3',
  name: 'Nikolay Dimitrov',
  email: 'nikolay@example.com',
  properties: [],
}

function MemberRows({
  removeMemberAction = action(),
  showProperties = true,
  members = [ADMIN, MANAGER, STRANDED_MANAGER],
  currentUserId = ADMIN.userId,
  onChangeRole = () => undefined,
  onEditAccess = () => undefined,
}: Partial<MemberTableProps>) {
  return (
    <MemberTable
      members={members}
      currentUserId={currentUserId}
      showProperties={showProperties}
      onChangeRole={onChangeRole}
      onEditAccess={onEditAccess}
      removeMemberAction={removeMemberAction}
    />
  )
}

const NOW = new Date('2026-09-29T09:00:00Z')
const day = (days: number) => new Date(NOW.getTime() + days * 86_400_000)

const INVITATIONS: Parameters<typeof InvitationTable>[0]['invitations'] = [
  {
    id: 'invitation-1',
    email: 'georgi@example.com',
    role: 'PropertyManager',
    rawRole: 'admin',
    status: 'pending',
    createdAt: day(0),
    expiresAt: day(7),
    inviterName: 'Ivana Georgieva',
    properties: PROPERTIES,
  },
  {
    id: 'invitation-2',
    email: 'stefan@example.com',
    role: 'PropertyManager',
    rawRole: 'admin',
    status: 'expired',
    createdAt: day(-9),
    expiresAt: day(-2),
    inviterName: null,
    properties: [{ id: 'p2', name: 'Varna Beach' }],
  },
  {
    id: 'invitation-3',
    email: 'petar@example.com',
    role: 'AccountAdmin',
    rawRole: 'owner',
    status: 'pending',
    createdAt: day(-1),
    expiresAt: day(6),
    inviterName: 'Ivana Georgieva',
    properties: [],
  },
]

function InvitationRows({
  invitations = INVITATIONS,
  resendAction = action(),
  cancelAction = action(),
}: Partial<InvitationActions> & {
  invitations?: Parameters<typeof InvitationTable>[0]['invitations']
}) {
  return (
    <InvitationTable
      invitations={invitations}
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

/** A Property Manager reads the list: no Properties column, no actions. */
export const ReadOnlyMembers: Story = {
  render: () => (
    <MemberRows
      showProperties={false}
      members={[ADMIN, { ...MANAGER, properties: undefined }]}
    />
  ),
  play: ({ canvasElement }) => {
    expectRectangularTable(canvasElement)
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('columnheader', { name: 'Properties' })).toBeNull()
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** An Account Admin's view: who works which properties, and who works none. */
export const MembersWithProperties: Story = {
  decorators: [withRole('AccountAdmin')],
  render: () => <MemberRows />,
  play: ({ canvasElement }) => {
    expectRectangularTable(canvasElement)
    const canvas = within(canvasElement)
    expect(canvas.getByText('All properties')).toBeInTheDocument()
    expect(canvas.getByText('No properties')).toBeInTheDocument()
    expect(canvas.getByText('+1 more')).toBeInTheDocument()
    expect(canvas.getByText('(you)')).toBeInTheDocument()
  },
}

export const MembersWithPropertiesLight: Story = {
  ...MembersWithProperties,
  parameters: { theme: 'light' },
}

export const MixedInvitationStatuses: Story = {
  render: () => <InvitationRows />,
  play: ({ canvasElement }) => {
    expectRectangularTable(canvasElement)
    const canvas = within(canvasElement)
    expect(canvas.getByText('Expired')).toBeInTheDocument()
  },
}

export const MixedInvitationStatusesLight: Story = {
  ...MixedInvitationStatuses,
  decorators: [withRole('AccountAdmin')],
  parameters: { theme: 'light' },
}

/** Reports which member each row action was chosen for, as text the play reads. */
function ReportingRows() {
  const [edited, setEdited] = useState('')
  const [changed, setChanged] = useState('')
  return (
    <div>
      <MemberRows
        onChangeRole={(member) => setChanged(member.name)}
        onEditAccess={(member) => setEdited(member.name)}
      />
      <output data-testid="edited">{edited}</output>
      <output data-testid="role-changed">{changed}</output>
    </div>
  )
}

/** Change role and Edit access report the member; the route opens the panel. */
export const RowActionsReportTheMember: Story = {
  decorators: [withRole('AccountAdmin')],
  render: () => <ReportingRows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Edit access for Maria Petrova' }),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Change role for Maria Petrova' }),
    )
    expect(canvas.getByTestId('edited')).toHaveTextContent('Maria Petrova')
    expect(canvas.getByTestId('role-changed')).toHaveTextContent('Maria Petrova')
    // An Account Admin row offers no Edit access.
    expect(
      canvas.queryByRole('button', { name: 'Edit access for Ivana Georgieva' }),
    ).toBeNull()
  },
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
      invitations={INVITATIONS.slice(0, 1)}
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
  render: () => (
    <MemberRows members={[MANAGER]} removeMemberAction={refusedAction(memberRefusals)} />
  ),
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
