import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ZONE,
  NOVEMBER,
  OCTOBER,
  SEPTEMBER,
  goalBundle,
  monthRow,
  personName,
  targetChange,
  version,
} from './goal-month-target.stories.fixtures'
import { buildGoalTargetChanges } from './goal-target-changes-view'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const OCT_20 = at('2026-10-20T08:00:00.000Z')
const frame = { timezone: FIXTURE_ZONE, now: NOW, personName }

type Goal = ReturnType<typeof goalBundle>
const entriesOf = (goal: Goal, names = personName) =>
  buildGoalTargetChanges(goal, { ...frame, personName: names })
const said = (goal: Goal) =>
  entriesOf(goal).map(({ text, detail }) => [text, detail] as const)

/** October at 400, changed to 300 on the 20th; `change` says what else the change did. */
const changedOctober = (
  change: Parameters<typeof targetChange>[4] = {},
  versions: readonly ReturnType<typeof version>[] = [version('v1', 1)],
) =>
  goalBundle({
    versions,
    results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
    targetChanges: [targetChange('lobby', 400, 300, OCT_20, change)],
  })

/** The version a month change wrote for the months after: 300 from November. */
const followingVersion = (patch: Parameters<typeof version>[2] = {}) =>
  version('v2', 2, {
    targetValue: 300,
    effectiveFrom: NOVEMBER.start,
    changeReason: 'target_changed',
    createdBy: 'marco',
    createdAt: OCT_20,
    ...patch,
  })

describe('buildGoalTargetChanges', () => {
  it('says nothing for a goal whose target was never changed', () => {
    const goal = goalBundle({
      versions: [version('v1', 1)],
      results: [monthRow('lobby', 'v1')],
    })

    expect(entriesOf(goal)).toEqual([])
  })

  it('lists a month change with who, when, old and new value and the note', () => {
    const goal = changedOctober({ note: 'The pool bar is closed.' })

    expect(entriesOf(goal)).toEqual([
      {
        id: `month:command-${OCT_20.getTime()}`,
        text: 'Marco Rossi changed October’s target from 400 to 300',
        detail: 'Only October changed.',
        note: 'The pool bar is closed.',
        dateLabel: 'Oct 20',
        occurredAt: OCT_20.toISOString(),
      },
    ])
  })

  it('folds the version a month change wrote into that change, and lists it once', () => {
    const goal = changedOctober(
      { followingOutcome: 'applied', followingVersionId: 'v2' },
      [version('v1', 1, { effectiveTo: NOVEMBER.start }), followingVersion()],
    )

    expect(said(goal)).toEqual([
      [
        'Marco Rossi changed October’s target from 400 to 300',
        'Also applies from Nov 1.',
      ],
    ])
  })

  it('lists a revision that changed the target for the months from its start', () => {
    const goal = goalBundle({
      versions: [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        version('v2', 2, {
          targetValue: 500,
          effectiveFrom: NOVEMBER.start,
          changeReason: 'Busy season ahead',
          createdAt: at('2026-10-12T08:00:00.000Z'),
        }),
      ],
      results: [monthRow('lobby', 'v1')],
    })

    expect(entriesOf(goal)).toEqual([
      {
        id: 'version:v2',
        text: 'Elena Petrova changed the target from 400 to 500',
        detail: 'Applies from Nov 1.',
        note: 'Busy season ahead',
        dateLabel: 'Oct 12',
        occurredAt: '2026-10-12T08:00:00.000Z',
      },
    ])
  })

  it.each(['created', 'revised', 'subjects_changed', 'target_changed'])(
    'prints no note for a version that recorded only what kind of change it was (%s)',
    (changeReason) => {
      const goal = goalBundle({
        versions: [
          version('v1', 1, { effectiveTo: NOVEMBER.start }),
          version('v2', 2, {
            targetValue: 500,
            effectiveFrom: NOVEMBER.start,
            changeReason,
          }),
        ],
      })

      expect(entriesOf(goal).map((entry) => entry.note)).toEqual([null])
    },
  )

  it('leaves out a change of subjects alone: the target did not move', () => {
    const goal = goalBundle({
      versions: [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        version('v2', 2, {
          effectiveFrom: NOVEMBER.start,
          changeReason: 'subjects_changed',
        }),
      ],
    })

    expect(entriesOf(goal)).toEqual([])
  })

  it('leaves out a plan replaced before it began, and reads the next change against the plan before it', () => {
    // 500 from November was scheduled on the 12th and replaced by 450 on the
    // 14th: 500 never applied to a month, so the change reads 400 to 450.
    const goal = goalBundle({
      versions: [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        version('v2', 2, {
          targetValue: 500,
          effectiveFrom: NOVEMBER.start,
          effectiveTo: NOVEMBER.start,
          createdAt: at('2026-10-12T08:00:00.000Z'),
        }),
        version('v3', 3, {
          targetValue: 450,
          effectiveFrom: NOVEMBER.start,
          createdAt: at('2026-10-14T08:00:00.000Z'),
        }),
      ],
      results: [monthRow('lobby', 'v1')],
    })

    expect(said(goal)).toEqual([
      ['Elena Petrova changed the target from 400 to 450', 'Applies from Nov 1.'],
    ])
  })

  it('says so when the months after a month change were replaced before they began', () => {
    // The change of the 20th also set 300 from November. On the 21st a
    // revision set 350 from November instead: the log still says "applied",
    // and the version it names kept an empty window.
    const goal = changedOctober(
      { followingOutcome: 'applied', followingVersionId: 'v2' },
      [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        followingVersion({ effectiveTo: NOVEMBER.start }),
        version('v3', 3, {
          targetValue: 350,
          effectiveFrom: NOVEMBER.start,
          changeReason: 'revised',
          createdAt: at('2026-10-21T08:00:00.000Z'),
        }),
      ],
    )

    expect(said(goal)).toEqual([
      ['Elena Petrova changed the target from 400 to 350', 'Applies from Nov 1.'],
      [
        'Marco Rossi changed October’s target from 400 to 300',
        'Was also set from Nov 1, but that never took effect.',
      ],
    ])
  })

  it.each([
    [
      { followingOutcome: 'applied', followingVersionId: null },
      'The months after already had this target.',
    ],
    [
      { followingOutcome: 'replaced_scheduled_change', followingVersionId: 'v2' },
      'Also applies from Nov 1, in place of the change that was scheduled.',
    ],
    [
      { followingOutcome: 'kept_scheduled_change' },
      'The months after kept the change already scheduled for them.',
    ],
    [
      { followingOutcome: 'not_applied', followingReason: 'subject_unavailable' },
      'The months after were not changed: a subject of the goal was no longer available.',
    ],
    [
      { followingOutcome: 'not_applied', followingReason: 'metric_unavailable' },
      'The months after were not changed: the measure was not available.',
    ],
  ] as const)('says what became of the months after (%o)', (outcome, detail) => {
    const goal = changedOctober(outcome, [
      version('v1', 1, { effectiveTo: NOVEMBER.start }),
      followingVersion(),
    ])

    const [entry] = entriesOf(goal).filter((candidate) =>
      candidate.id.startsWith('month:'),
    )

    expect(entry?.detail).toBe(detail)
  })

  it('lists one change for a goal with several subjects, not one per subject', () => {
    const goal = goalBundle({
      versions: [version('v1', 1)],
      results: [
        monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 }),
        monthRow('pool', 'v1', OCTOBER, { targetValue: 300 }),
      ],
      targetChanges: [
        targetChange('lobby', 400, 300, OCT_20),
        targetChange('pool', 400, 300, OCT_20),
      ],
    })

    expect(entriesOf(goal)).toHaveLength(1)
  })

  it('lists the newest change first', () => {
    const goal = goalBundle({
      versions: [
        version('v0', 1, {
          targetValue: 350,
          effectiveFrom: SEPTEMBER.start,
          effectiveTo: OCTOBER.start,
          createdAt: at('2026-08-20T08:00:00.000Z'),
        }),
        version('v1', 2, { createdAt: at('2026-09-20T08:00:00.000Z') }),
      ],
      results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 380 })],
      targetChanges: [
        targetChange('lobby', 400, 300, at('2026-10-05T08:00:00.000Z')),
        targetChange('lobby', 300, 380, OCT_20),
      ],
    })

    expect(entriesOf(goal).map((entry) => entry.text)).toEqual([
      'Marco Rossi changed October’s target from 300 to 380',
      'Marco Rossi changed October’s target from 400 to 300',
      'Elena Petrova changed the target from 350 to 400',
    ])
  })

  it('says a change of measure as one, with the new target', () => {
    const goal = goalBundle({
      versions: [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        version('v2', 2, {
          metric: 'portal_rating_average',
          metricMinimumSample: 10,
          targetValue: 4.5,
          effectiveFrom: NOVEMBER.start,
        }),
      ],
    })

    expect(said(goal)).toEqual([
      [
        'Elena Petrova changed the measure to Private rating average, with a target of 4.5',
        'Applies from Nov 1.',
      ],
    ])
  })

  it('calls someone the directory no longer lists a former member', () => {
    const [entry] = entriesOf(changedOctober(), () => 'a former member')

    expect(entry?.text).toBe('A former member changed October’s target from 400 to 300')
  })

  it('names nobody while the directory has not been read', () => {
    const goal = changedOctober({}, [
      version('v1', 1, { effectiveTo: NOVEMBER.start }),
      version('v2', 2, { targetValue: 500, effectiveFrom: NOVEMBER.start }),
    ])

    expect(entriesOf(goal, () => null).map((entry) => entry.text)).toEqual([
      'October’s target was changed from 400 to 300',
      'The target was changed from 400 to 500',
    ])
  })

  it('prints the year of a change made in an earlier year', () => {
    const lastOctober = {
      start: at('2025-10-01T00:00:00.000Z'),
      end: at('2025-11-01T00:00:00.000Z'),
    }
    const goal = goalBundle({
      versions: [version('v1', 1, { effectiveFrom: lastOctober.start })],
      results: [
        monthRow('lobby', 'v1', lastOctober, { status: 'closed', targetValue: 300 }),
      ],
      targetChanges: [targetChange('lobby', 400, 300, at('2025-10-20T08:00:00.000Z'))],
    })

    expect(entriesOf(goal).map((entry) => entry.dateLabel)).toEqual(['Oct 20, 2025'])
  })
})
