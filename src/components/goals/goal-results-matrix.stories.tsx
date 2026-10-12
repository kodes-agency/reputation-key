import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type {
  GoalResultsMatrix as GoalResultsMatrixModel,
  GoalResultsMatrixRow,
} from '#/contexts/reporting/application/public-api'
import { GoalResultsMatrix } from './goal-results-matrix'

const START = new Date('2026-07-01T04:00:00.000Z')
const END = new Date('2026-08-01T04:00:00.000Z')

function row(id: string, overrides: Partial<GoalResultsMatrixRow>): GoalResultsMatrixRow {
  return {
    resultId: id,
    programId: `program-${id}`,
    assignmentId: `assignment-${id}`,
    scope: 'property',
    subject: { kind: 'property', propertyId: 'property-1' },
    subjectName: 'Riverside Hotel',
    ungroupedPortal: false,
    metric: 'qualified_scans',
    availability: 'ready',
    outcome: 'not_met',
    evidence: { kind: 'count', value: 0, sampleCount: 0 },
    explanation: 'Not met: 0 verified qualified scans; target is at least 100.',
    dataThrough: END,
    resultStatus: 'closed',
    correction: null,
    targetProvenance: {
      programName: 'Monthly scans',
      programVersion: 2,
      metricDefinitionVersionId: '11111111-1111-4111-8111-111111111301',
      targetValue: 100,
      effectiveFrom: START,
      setAt: new Date('2026-06-18T15:00:00.000Z'),
    },
    monthTarget: null,
    ...overrides,
  }
}

const matrix: GoalResultsMatrixModel = {
  months: [
    {
      periodStart: START,
      periodEnd: END,
      propertyTimezone: 'America/New_York',
      rows: [
        row('ready', {}),
        row('updating', {
          scope: 'portal_group',
          subject: { kind: 'portal_group', portalGroupId: 'group-1' },
          subjectName: 'Front desk',
          metric: 'portal_rating_count',
          availability: 'updating',
          outcome: 'pending',
          evidence: { kind: 'count', value: 7, sampleCount: 7 },
          explanation: 'Updating: 7 is the last verified value; no outcome yet.',
          dataThrough: new Date('2026-07-20T04:00:00.000Z'),
        }),
        row('insufficient-data', {
          scope: 'portal',
          subject: { kind: 'portal', portalId: 'portal-1' },
          subjectName: 'Breakfast cards',
          ungroupedPortal: true,
          metric: 'portal_rating_average',
          availability: 'insufficient_data',
          outcome: 'pending',
          evidence: {
            kind: 'average',
            value: null,
            sampleCount: 6,
            minimumSample: 10,
          },
          explanation: 'Insufficient data: 6 of 10 required eligible ratings are ready.',
        }),
        row('temporarily-unavailable', {
          scope: 'portal',
          subject: { kind: 'portal', portalId: 'portal-2' },
          subjectName: 'Lobby NFC',
          metric: 'portal_rating_count',
          availability: 'temporarily_unavailable',
          outcome: 'pending',
          evidence: { kind: 'count', value: null, sampleCount: 0 },
          explanation:
            'Unavailable: this result cannot be decided from current evidence.',
          dataThrough: null,
        }),
      ],
    },
  ],
  unassignedPortals: [
    {
      portalId: 'portal-3',
      portalName: 'Restaurant receipt',
      groupName: null,
      message: 'No Goal Programs assigned',
    },
  ],
}

const meta: Meta<typeof GoalResultsMatrix> = {
  title: 'Goals/GoalResultsMatrix',
  component: GoalResultsMatrix,
  tags: ['autodocs'],
  args: { personName: (userId) => (userId === 'marco' ? 'Marco Rossi' : null) },
}
export default meta
type Story = StoryObj<typeof GoalResultsMatrix>

// The row of a goal set last year, read in this one: the day prints its year.
const setLastYear: GoalResultsMatrixModel = {
  months: [
    {
      periodStart: START,
      periodEnd: END,
      propertyTimezone: 'America/New_York',
      rows: [
        row('carried-over', {
          targetProvenance: {
            programName: 'Monthly scans',
            programVersion: 1,
            metricDefinitionVersionId: '11111111-1111-4111-8111-111111111301',
            targetValue: 100,
            effectiveFrom: new Date('2026-01-01T05:00:00.000Z'),
            setAt: new Date('2025-12-18T15:00:00.000Z'),
          },
        }),
      ],
    },
  ],
  unassignedPortals: [],
}

export const AllEvidenceStates: Story = {
  args: { matrix, now: new Date('2026-08-05T12:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Goal results matrix')).toBeVisible()
    for (const label of [
      'Ready',
      'Updating',
      'Insufficient data',
      'Temporarily unavailable',
    ]) {
      await expect(canvas.getByText(label)).toBeVisible()
    }
    await expect(canvas.getByText('Ungrouped portal')).toBeVisible()
    await expect(canvas.getByText('No Goal Programs assigned')).toBeVisible()
    await expect(canvas.getAllByText(/Program version 2 · Metric rules/)[0]).toBeVisible()
    // The target was set before the month it applies from, and the row says when.
    await expect(
      canvas.getAllByText(/Effective Jul 1, 2026 · set on Jun 18/)[0],
    ).toBeVisible()
    expect(canvas.queryByText(/rank|composite/i)).toBeNull()
  },
}

export const TargetSetInAnEarlierYear: Story = {
  args: { matrix: setLastYear, now: new Date('2026-08-05T12:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/Effective Jan 1, 2026 · set on Dec 18, 2025/),
    ).toBeVisible()
  },
}

// July was set at 150 in June. On the 20th of July its target was changed to
// 100, the number the row is judged against and prints.
const changedInJuly: GoalResultsMatrixModel = {
  months: [
    {
      periodStart: START,
      periodEnd: END,
      propertyTimezone: 'America/New_York',
      rows: [
        row('changed', {
          monthTarget: {
            changedAt: new Date('2026-07-20T15:00:00.000Z'),
            changedBy: 'marco',
            startTarget: 150,
            changeCount: 2,
          },
        }),
        row('unchanged', {
          scope: 'portal',
          subject: { kind: 'portal', portalId: 'portal-1' },
          subjectName: 'Breakfast cards',
        }),
      ],
    },
  ],
  unassignedPortals: [],
}

/**
 * A changed month names the person who changed it, the day, how many times it
 * changed and the target it started at, beside the target the row is judged
 * against. A month nobody changed carries no such line.
 */
export const AChangedMonthNamesWhoChangedIt: Story = {
  args: { matrix: changedInJuly, now: new Date('2026-08-05T12:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const changed = canvas.getByText(
      'Changed by Marco Rossi on Jul 20 (2 changes), started at 150',
    )

    await expect(changed).toBeVisible()
    // It sits in the row's own "Target source" cell, under the target it explains.
    expect(changed.closest('td')).toHaveTextContent(/Monthly scans · target 100/)
    expect(canvas.getAllByText(/^Changed /)).toHaveLength(1)
  },
}
