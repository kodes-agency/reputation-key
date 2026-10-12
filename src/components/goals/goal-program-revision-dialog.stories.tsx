import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { reviseGoalProgram } from '#/contexts/reporting/server/goal-programs'
import { GoalProgramRevisionDialog } from './goal-program-revision-dialog'
import { openGoalProgramDialog } from './goal-program.stories.dialog'

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

// The goal the dialog is opened on: March is open under its first version.
const counting = {
  program: { status: 'active' as const },
  version: { id: VERSION_ID, effectiveFrom: new Date('2026-03-01T00:00:00.000Z') },
  results: [
    {
      programVersionId: VERSION_ID,
      status: 'open' as const,
      periodEnd: new Date('2026-04-01T00:00:00.000Z'),
    },
  ],
}

// The same goal with the month the clock is in open: a month is running.
const runningThisMonth = (() => {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    program: { status: 'active' as const },
    version: { id: VERSION_ID, effectiveFrom: start },
    results: [{ programVersionId: VERSION_ID, status: 'open' as const, periodEnd: end }],
  }
})()

// A goal set to start with Sofia's December, with no month opened yet.
const notStarted = {
  program: { status: 'scheduled' as const },
  version: { id: VERSION_ID, effectiveFrom: new Date('2026-11-30T22:00:00.000Z') },
  results: [],
}

// What the dialog says before saving is worked out from the clock, so the day
// is matched by shape. A goal that has not started keeps its own start month
// whatever the clock says; only its year shows once the clock is past it.
const APPLIES_FROM_A_MONTH_START = /^Applies from [A-Z][a-z][a-z] 1[,.]/
const APPLIES_FROM_DECEMBER = /^Applies from Dec 1(?:, 2026)?\.$/
const APPLIES_FROM_NEXT_MONTH_AND_NAMES_THIS_MONTHS_DIALOG =
  /^Applies from [A-Z][a-z][a-z] 1(?:, \d\d\d\d)?\. To change this month, use Change this month’s target\.$/

// The Property's timezone was corrected from UTC to Europe/Sofia. March is
// still open under UTC and ends at 1 April 00:00 UTC, after Sofia's April has
// begun, so the command answers a start of May: 1 May 00:00 in Sofia.
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
    changeReason: input.data.reason ?? 'revised',
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
    property: { id: PROPERTY_ID, name: 'Riverside Hotel', timezone: 'Europe/Sofia' },
    programId: PROGRAM_ID,
    currentVersion: 1,
    goal: counting,
    metric: 'portal_rating_count',
    targetValue: 25,
    assignments: [assignment],
    groups: [],
    portals: [],
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Opens the dialog and waits for the line that says when the change applies. */
const openRevise = (
  canvasElement: HTMLElement,
  appliesFrom = APPLIES_FROM_A_MONTH_START,
) => openGoalProgramDialog(canvasElement, 'Revise', appliesFrom)

/** Presses the dialog's primary action and hands back what the command was sent. */
async function schedule(dialog: Awaited<ReturnType<typeof openRevise>>) {
  await userEvent.click(dialog.getByRole('button', { name: 'Schedule revision' }))
  await waitFor(() => expect(reviseMock).toHaveBeenCalledOnce())
  return reviseMock.mock.calls[0]?.[0].data
}

/**
 * The dialog says the day the change applies from before it is saved, and the
 * receipt states the start the command answered. The two can differ: after a
 * timezone move east the change starts a month later than the next one. The
 * note is optional, and the dialog sends the version it was opened on, so a
 * goal that changed meanwhile refuses the save.
 */
export const SaysWhenTheChangeApplies: Story = {
  play: async ({ canvasElement }) => {
    reviseMock.mockClear()
    const dialog = await openRevise(canvasElement)
    expect(dialog.queryByText(/first full month/i)).toBeNull()
    // The month this goal has open ended long ago: there is no "this month".
    expect(dialog.queryByText(/Change this month’s target/)).toBeNull()

    const sent = await schedule(dialog)

    expect(sent).toMatchObject({
      propertyId: PROPERTY_ID,
      programId: PROGRAM_ID,
      expectedVersion: 1,
    })
    expect(sent?.reason).toBeUndefined()
    await expect(await dialog.findByRole('status')).toHaveTextContent(
      /^Change saved\. Applies from May 1(?:, 2026)? \(Europe\/Sofia\)\.$/,
    )
    expect(dialog.getByRole('button', { name: 'Schedule revision' })).toBeDisabled()
  },
}

/**
 * A revision never touches the month that is running. While one is, the dialog
 * says which day the revision applies from and names the dialog that changes
 * this month's target.
 */
export const SaysWhereThisMonthIsChanged: Story = {
  args: { goal: runningThisMonth },
  play: async ({ canvasElement }) => {
    await openRevise(canvasElement, APPLIES_FROM_NEXT_MONTH_AND_NAMES_THIS_MONTHS_DIALOG)
  },
}

/**
 * A goal that has not started can be revised, and keeps the month it was set to
 * start in: the change applies from that month, not from the next one.
 */
export const AGoalThatHasNotStartedKeepsItsStartMonth: Story = {
  args: { goal: notStarted },
  play: async ({ canvasElement }) => {
    await openRevise(canvasElement, APPLIES_FROM_DECEMBER)
  },
}

/** The note is one optional field, marked as the shared fields mark it, and it is sent as written. */
export const NoteIsOptional: Story = {
  play: async ({ canvasElement }) => {
    reviseMock.mockClear()
    const dialog = await openRevise(canvasElement)
    expect(dialog.queryByLabelText(/reason/i)).toBeNull()

    await userEvent.type(
      dialog.getByRole('textbox', { name: 'Note Optional' }),
      'Raise the bar',
    )
    const sent = await schedule(dialog)

    expect(sent?.reason).toBe('Raise the bar')
  },
}

/** A refusal reads as a sentence above the actions, never as the command's code. */
export const SaysARefusalInWords: Story = {
  play: async ({ canvasElement }) => {
    reviseMock.mockClear()
    reviseMock.mockRejectedValueOnce(
      new ServerFunctionError(
        'GoalProgramError',
        'revision_conflict',
        'revision_conflict',
        409,
      ),
    )
    const dialog = await openRevise(canvasElement)

    await schedule(dialog)

    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This goal changed while you were working on it. Reload the page and try again.',
    )
    expect(dialog.queryByText(/revision_conflict/)).toBeNull()
  },
}

/**
 * The metric is the shared Select (a combobox of three named metrics), not a browser
 * <select>, and the chosen one is what the revision sends.
 */
export const MetricIsTheSharedSelect: Story = {
  play: async ({ canvasElement }) => {
    reviseMock.mockClear()
    const dialog = await openRevise(canvasElement)
    const metric = dialog.getByRole('combobox', { name: 'Metric' })
    expect(metric).toHaveTextContent('Private rating count')

    await userEvent.click(metric)
    const options = await within(document.body).findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Qualified scans',
      'Private rating count',
      'Private rating average',
    ])
    await userEvent.click(
      within(document.body).getByRole('option', { name: 'Private rating average' }),
    )
    expect(metric).toHaveTextContent('Private rating average')

    // An average is out of five stars, so the target comes down with it.
    const target = dialog.getByLabelText('Monthly target')
    await userEvent.clear(target)
    await userEvent.type(target, '4')
    const sent = await schedule(dialog)

    expect(sent?.metric).toBe('portal_rating_average')
  },
}

/**
 * The checkboxes for what the goal covers are one group with a name, so the rule under
 * it ("Select at least one") reads as help for them and not for the Note field above.
 */
export const SubjectsAreANamedGroup: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openRevise(canvasElement)
    const subjects = dialog.getByRole('group', { name: 'Subjects' })
    expect(subjects).toHaveTextContent(/Select at least one/)
    expect(
      within(subjects).getByRole('checkbox', { name: /Riverside Hotel/ }),
    ).toBeChecked()
  },
}
