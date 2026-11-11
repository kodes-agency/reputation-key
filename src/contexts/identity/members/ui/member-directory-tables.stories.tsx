import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { withRole } from '../../../../../.storybook/AuthedRouterDecorator'
import { mockAction } from '../../../../../.storybook/mocks/mock-action'
import { unhandledRejectionsDuring } from '../../../../../.storybook/play-helpers'
import { InvitationTable } from './invitation-table'
import { MemberTable } from './member-table'

/**
 * A command the server refuses. A plain function, not `fn()`: the spy attaches
 * its own handler to every promise it returns to record the outcome, which
 * would mark the rejection handled and hide exactly what the stories look for.
 */
const refusedAction = <TInput,>(refusals: Error[]): Action<TInput> =>
  mockAction<TInput>(async () => {
    const refusal = new Error('refused')
    refusals.push(refusal)
    throw refusal
  })

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
  removeMemberAction = mockAction(),
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
  resendAction = mockAction(),
  cancelAction = mockAction(),
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
 * The rejections `act` left unhandled, with the story's table and the document
 * (where the confirmation dialogs portal to) to act on.
 */
const unhandledRejectionsWhile = (
  canvasElement: HTMLElement,
  act: (views: {
    canvas: ReturnType<typeof within>
    page: ReturnType<typeof within>
  }) => Promise<void>,
) =>
  unhandledRejectionsDuring(() =>
    act({
      canvas: within(canvasElement),
      page: within(canvasElement.ownerDocument.body),
    }),
  )

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
    const page = within(canvasElement.ownerDocument.body)
    const menu = canvas.getByRole('button', { name: 'More actions for Maria Petrova' })
    await userEvent.click(menu)
    await userEvent.click(await page.findByRole('menuitem', { name: 'Edit access…' }))
    await userEvent.click(menu)
    await userEvent.click(await page.findByRole('menuitem', { name: 'Change role…' }))
    expect(canvas.getByTestId('edited')).toHaveTextContent('Maria Petrova')
    expect(canvas.getByTestId('role-changed')).toHaveTextContent('Maria Petrova')
    // The signed-in Account Admin's own row has no menu.
    expect(
      canvas.queryByRole('button', { name: 'More actions for Ivana Georgieva' }),
    ).toBeNull()
  },
}

/**
 * A refused resend is reported by the route's toast, so the table only settles
 * the promise: an unsettled one surfaced as an unhandled rejection. A refused
 * cancellation is said by its confirmation, which stays open with the refusal.
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
    const unhandled = await unhandledRejectionsWhile(
      canvasElement,
      async ({ canvas, page }) => {
        // Both commands are items of the invitation's one menu.
        const menu = canvas.getByRole('button', {
          name: 'More actions for georgi@example.com',
        })
        await userEvent.click(menu)
        await userEvent.click(
          await page.findByRole('menuitem', { name: 'Resend invitation' }),
        )
        await userEvent.click(menu)
        await userEvent.click(
          await page.findByRole('menuitem', { name: 'Cancel invitation…' }),
        )
        await userEvent.click(
          await page.findByRole('button', { name: 'Cancel invitation' }),
        )
        await page.findByText('Unable to complete this action')
      },
    )
    const page = within(canvasElement.ownerDocument.body)
    expect(invitationRefusals).toHaveLength(2)
    expect(unhandled).toEqual([])
    expect(page.getByRole('alertdialog')).toBeVisible()
  },
}

/** A refused member removal stays in its confirmation, said once. */
const memberRefusals: Error[] = []

export const RefusedMemberRemoval: Story = {
  decorators: [withRole('AccountAdmin')],
  render: () => (
    <MemberRows members={[MANAGER]} removeMemberAction={refusedAction(memberRefusals)} />
  ),
  play: async ({ canvasElement }) => {
    memberRefusals.length = 0
    const unhandled = await unhandledRejectionsWhile(
      canvasElement,
      async ({ canvas, page }) => {
        await userEvent.click(
          canvas.getByRole('button', { name: 'More actions for Maria Petrova' }),
        )
        await userEvent.click(
          await page.findByRole('menuitem', { name: 'Remove member…' }),
        )
        await userEvent.click(await page.findByRole('button', { name: 'Remove member' }))
        await page.findByText('Unable to complete this action')
      },
    )
    const page = within(canvasElement.ownerDocument.body)
    expect(memberRefusals).toHaveLength(1)
    expect(unhandled).toEqual([])
    expect(page.getAllByRole('alert')).toHaveLength(1)
  },
}
