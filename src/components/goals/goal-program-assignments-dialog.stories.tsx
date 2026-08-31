import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { changeGoalProgramAssignments } from '#/contexts/goal/server/goal-programs'
import { GoalProgramAssignmentsDialog } from './goal-program-assignments-dialog'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'
const EXISTING_PORTAL_ID = '30000000-0000-4000-8000-000000000001'
const NEW_PORTAL_ID = '30000000-0000-4000-8000-000000000002'
const VERSION_ID = '40000000-0000-4000-8000-000000000001'

type ChangeInput = Parameters<typeof changeGoalProgramAssignments>[0]

const changeAssignmentsMock = fn(async (input: ChangeInput) => ({
  programId: input.data.programId,
  previousVersion: input.data.expectedVersion,
  currentVersion: input.data.expectedVersion + 1,
  effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
  selectedAt: new Date('2026-08-27T08:00:00.000Z'),
  selectedCurrentPortalCount: 2,
  outcomes: [
    {
      operation: 'add' as const,
      source: 'explicit' as const,
      subject: { kind: 'portal' as const, portalId: NEW_PORTAL_ID },
      outcome: 'added' as const,
    },
    {
      operation: 'add' as const,
      source: 'all_current_portals' as const,
      subject: { kind: 'portal' as const, portalId: EXISTING_PORTAL_ID },
      outcome: 'already_assigned' as const,
    },
    {
      operation: 'add' as const,
      source: 'all_current_portals' as const,
      subject: { kind: 'portal' as const, portalId: NEW_PORTAL_ID },
      outcome: 'duplicate' as const,
    },
  ],
}))
const changeAssignmentsFn =
  changeAssignmentsMock as unknown as typeof changeGoalProgramAssignments

const meta: Meta<typeof GoalProgramAssignmentsDialog> = {
  title: 'Goals/GoalProgramAssignmentsDialog',
  component: GoalProgramAssignmentsDialog,
  args: {
    changeAssignmentsFn,
    property: { id: PROPERTY_ID, name: 'Riverside Hotel' },
    programId: PROGRAM_ID,
    currentVersion: 3,
    assignments: [
      {
        id: '50000000-0000-4000-8000-000000000001',
        programId: PROGRAM_ID,
        programVersionId: VERSION_ID,
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        metric: 'qualified_scans',
        subject: { kind: 'portal', portalId: EXISTING_PORTAL_ID },
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        effectiveTo: null,
        createdBy: 'manager-1',
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
      },
    ],
    groups: [],
    portals: [
      { id: EXISTING_PORTAL_ID, name: 'Front desk QR' },
      { id: NEW_PORTAL_ID, name: 'Lobby QR' },
    ],
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const PointInTimeBulkChange: Story = {
  play: async ({ canvasElement }) => {
    changeAssignmentsMock.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Manage assignments' }))
    const dialog = within(await within(document.body).findByRole('dialog'))

    // Retried, not asserted once. The dialog has only just been found, and
    // Radix animates its content in from opacity: 0 — so a getByText resolved
    // on the very next tick finds the node while it is still invisible, and a
    // bare toBeVisible() fails intermittently on exactly that span.
    await waitFor(() =>
      expect(
        dialog.getByText(/takes a one-time snapshot when you submit/i),
      ).toBeVisible(),
    )
    await userEvent.click(dialog.getByRole('checkbox', { name: /Lobby QR/i }))
    await userEvent.click(
      dialog.getByRole('checkbox', { name: /Select all current portals/i }),
    )
    await userEvent.type(
      dialog.getByLabelText('Reason for the change'),
      'Include every Portal operating today',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Review and schedule' }))

    await waitFor(() =>
      expect(changeAssignmentsMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          propertyId: PROPERTY_ID,
          programId: PROGRAM_ID,
          expectedVersion: 3,
          add: [{ kind: 'portal', portalId: NEW_PORTAL_ID }],
          remove: [],
          selectAllCurrentPortals: true,
        }),
      }),
    )
    await expect(await dialog.findByText('Lobby QR — will be added')).toBeVisible()
    await expect(dialog.getByText(/Scheduled from/)).toBeVisible()
  },
}
