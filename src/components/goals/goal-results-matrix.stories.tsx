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
    metric: 'qualified_scans',
    availability: 'ready',
    outcome: 'not_met',
    evidence: { kind: 'count', value: 0, sampleCount: 0 },
    explanation: 'Not met: 0 scans, the goal was 100.',
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
          explanation: 'Updating: the final figure is on its way.',
          dataThrough: new Date('2026-07-20T04:00:00.000Z'),
        }),
        row('insufficient-data', {
          scope: 'portal',
          subject: { kind: 'portal', portalId: 'portal-1' },
          subjectName: 'Breakfast cards',
          metric: 'portal_rating_average',
          availability: 'insufficient_data',
          outcome: 'pending',
          evidence: {
            kind: 'average',
            value: null,
            sampleCount: 6,
            minimumSample: 10,
          },
          explanation: 'More ratings needed: 6 of 10.',
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
}

export const AllEvidenceStates: Story = {
  args: { matrix, now: new Date('2026-08-05T12:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Monthly results' }),
    ).toBeVisible()
    await expect(
      canvas.getByText('Each month’s result for your portal goals.'),
    ).toBeVisible()
    for (const label of [
      'Ready',
      'Updating',
      'Insufficient data',
      'Temporarily unavailable',
    ]) {
      await expect(canvas.getByText(label)).toBeVisible()
    }
    // The evidence in plain words, and the column that holds the number.
    await expect(canvas.getByText('0 scans')).toBeVisible()
    await expect(canvas.getByText('7 private ratings')).toBeVisible()
    await expect(canvas.getByText('6 of 10 ratings so far')).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Number' })).toBeVisible()
    // No internals: no rules version, no list of portals without a goal.
    expect(canvas.queryByText(/Metric rules/)).toBeNull()
    expect(canvas.queryByText(/Program version/)).toBeNull()
    expect(canvas.queryByText('No Goal Programs assigned')).toBeNull()
    expect(canvas.queryByText(/Ungrouped portal|Target source/)).toBeNull()
    // The target was set before the month it applies from, and the row says when.
    await expect(
      canvas.getAllByText(/Effective Jul 1, 2026 · set on Jun 18/)[0],
    ).toBeVisible()
    expect(canvas.queryByText(/rank|composite/i)).toBeNull()
  },
}

/** The same month on the light surface; axe checks both themes. */
export const AllEvidenceStatesLight: Story = {
  ...AllEvidenceStates,
  parameters: { theme: 'light' },
}

/** The same month at each width the page is read at; the words stay the same. */
export const AllEvidenceStatesNarrowPhone: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const AllEvidenceStatesPhone: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const AllEvidenceStatesTablet: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const AllEvidenceStatesDesktop: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

// One is singular, and a large count is grouped, in the evidence and the number.
const oneAndThousands: GoalResultsMatrixModel = {
  months: [
    {
      periodStart: START,
      periodEnd: END,
      propertyTimezone: 'America/New_York',
      rows: [
        row('one-rating', {
          metric: 'portal_rating_count',
          outcome: 'met',
          evidence: { kind: 'count', value: 1, sampleCount: 1 },
          explanation: 'Met: 1 private rating, the goal was 1.',
          targetProvenance: {
            programName: 'Monthly ratings',
            programVersion: 1,
            metricDefinitionVersionId: '11111111-1111-4111-8111-111111111302',
            targetValue: 1,
            effectiveFrom: START,
            setAt: new Date('2026-06-18T15:00:00.000Z'),
          },
        }),
        row('thousands', {
          subjectName: 'Front desk QR',
          scope: 'portal',
          subject: { kind: 'portal', portalId: 'portal-1' },
          outcome: 'met',
          evidence: { kind: 'count', value: 1234, sampleCount: 1234 },
          explanation: 'Met: 1,234 scans, the goal was 1,200.',
          targetProvenance: {
            programName: 'Front desk scans',
            programVersion: 1,
            metricDefinitionVersionId: '11111111-1111-4111-8111-111111111301',
            targetValue: 1200,
            effectiveFrom: START,
            setAt: new Date('2026-06-18T15:00:00.000Z'),
          },
        }),
      ],
    },
  ],
}

export const OneAndThousands: Story = {
  args: { matrix: oneAndThousands, now: new Date('2026-08-05T12:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 private rating')).toBeVisible()
    await expect(canvas.getByText('1,234 scans')).toBeVisible()
    await expect(canvas.getByText(/Front desk scans · target 1,200/)).toBeVisible()
    expect(canvas.queryByText(/\b1 private ratings\b|1234/u)).toBeNull()
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
    // It sits in the row's own "Number" cell, under the target it explains.
    expect(changed.closest('td')).toHaveTextContent(/Monthly scans · target 100/)
    expect(canvas.getAllByText(/^Changed /)).toHaveLength(1)
  },
}
