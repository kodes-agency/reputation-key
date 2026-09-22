import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { reviseGoalProgram } from '#/contexts/reporting/server/goal-programs'
import { GoalProgramRevisionDialog } from './goal-program-revision-dialog'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'
const VERSION_ID = '40000000-0000-4000-8000-000000000001'
const NEXT_VERSION_ID = '40000000-0000-4000-8000-000000000002'

const assignment = {
  id: '50000000-0000-4000-8000-000000000001',
  programId: PROGRAM_ID,
  programVersionId: VERSION_ID,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count' as const,
  subject: { kind: 'property' as const, propertyId: PROPERTY_ID },
  effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
  effectiveTo: null,
  createdBy: 'manager-1',
  createdAt: new Date('2026-02-20T08:00:00.000Z'),
}

type ReviseInput = Parameters<typeof reviseGoalProgram>[0]

// The Property's timezone was corrected from UTC to Europe/Sofia. March is
// still open under UTC and ends at 1 April 00:00 UTC, after Sofia's April has
// begun, so the revision starts with May: 1 May 00:00 in Sofia.
const reviseMock = fn(async (input: ReviseInput) => {
  const version = {
    id: NEXT_VERSION_ID,
    programId: PROGRAM_ID,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    version: 2,
    metricDefinitionId: 'metric-definition-1',
    metricDefinitionVersionId: 'metric-version-1',
    metric: input.data.metric,
    metricMinimumSample: 0,
    targetValue: input.data.targetValue,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
    effectiveTo: null,
    changeReason: input.data.reason,
    createdBy: 'manager-1',
    createdAt: new Date('2026-03-20T12:00:00.000Z'),
  }
  return {
    program: {
      id: PROGRAM_ID,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'Monthly ratings',
      description: null,
      status: 'active' as const,
      statusReason: null,
      currentVersion: 2,
      createdBy: 'manager-1',
      createdAt: new Date('2026-02-20T08:00:00.000Z'),
      updatedAt: new Date('2026-03-20T12:00:00.000Z'),
    },
    version,
    versions: [version],
    assignments: [assignment],
    results: [],
  }
})
const reviseGoalProgramFn = reviseMock as unknown as typeof reviseGoalProgram

const meta: Meta<typeof GoalProgramRevisionDialog> = {
  title: 'Goals/GoalProgramRevisionDialog',
  component: GoalProgramRevisionDialog,
  args: {
    reviseGoalProgramFn,
    property: { id: PROPERTY_ID, name: 'Riverside Hotel' },
    programId: PROGRAM_ID,
    metric: 'portal_rating_count',
    targetValue: 25,
    assignments: [assignment],
    groups: [],
    portals: [],
  },
}

export default meta
type Story = StoryObj<typeof meta>

/**
 * The dialog used to promise "the next complete month". After a timezone move
 * east the revision starts a month later, and the month in between is not
 * evaluated, so the dialog states the start date the server returned.
 */
export const StatesTheStartDate: Story = {
  play: async ({ canvasElement }) => {
    reviseMock.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Revise' }))
    const dialog = within(await within(document.body).findByRole('dialog'))

    // Retried: Radix animates the content in from opacity 0.
    await waitFor(() =>
      expect(
        dialog.getByText(/first full month in the Property's timezone/i),
      ).toBeVisible(),
    )
    expect(dialog.queryByText(/next complete month/i)).toBeNull()

    await userEvent.type(dialog.getByLabelText('Reason for the change'), 'Raise the bar')
    await userEvent.click(dialog.getByRole('button', { name: 'Schedule revision' }))

    await waitFor(() => expect(reviseMock).toHaveBeenCalledOnce())
    await expect(await dialog.findByRole('status')).toHaveTextContent(
      'This version starts May 1, 2026 (Europe/Sofia).',
    )
    expect(dialog.getByRole('button', { name: 'Schedule revision' })).toBeDisabled()
  },
}
