// "Target changes" when a change of subjects sits between the versions.
//
// A change of subjects writes a version too, with the measure and target of
// the one before it, and one that lands on a plan still waiting for its month
// replaces that plan, which keeps an empty window. Neither is a change of the
// target: the line stays with whoever set the target, and a month change whose
// version was replaced this way still applies to the months after.
import { describe, expect, it } from 'vitest'
import {
  DECEMBER,
  FIXTURE_ZONE,
  NOVEMBER,
  OCTOBER,
  goalBundle,
  monthRow,
  personName,
  targetChange,
  version,
} from './goal-month-target.stories.fixtures'
import { buildGoalTargetChanges } from './goal-target-changes-view'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-28T09:00:00.000Z')
const OCT_12 = at('2026-10-12T08:00:00.000Z')
const OCT_20 = at('2026-10-20T08:00:00.000Z')
const frame = { timezone: FIXTURE_ZONE, now: NOW, personName }

type Goal = ReturnType<typeof goalBundle>
type VersionPatch = Parameters<typeof version>[2]
const said = (goal: Goal) =>
  buildGoalTargetChanges(goal, frame).map(({ text, detail }) => [text, detail] as const)

// October runs under the first version, at 400, until a later one starts.
const inForce = (until: Date = NOVEMBER.start) => version('v1', 1, { effectiveTo: until })

// On the 25th Elena added a Portal to the goal: a version of her own, with
// the target of the one before it and her note on the subjects.
const subjectsChanged = (patch: VersionPatch = {}) =>
  version('v3', 3, {
    effectiveFrom: NOVEMBER.start,
    changeReason: 'Pool bar joins',
    createdBy: 'elena',
    createdAt: at('2026-10-25T08:00:00.000Z'),
    ...patch,
  })

// On the 12th Marco scheduled 500 from November, with a note.
const scheduledByMarco = (patch: VersionPatch = {}) =>
  version('v2', 2, {
    targetValue: 500,
    effectiveFrom: NOVEMBER.start,
    changeReason: 'Busy season ahead',
    createdBy: 'marco',
    createdAt: OCT_12,
    ...patch,
  })

// On the 20th Marco changed October to 300 and set 300 from November too.
// `after` is the version that then replaced his, before November began.
const octoberChangedWithFollowing = (
  outcome: 'applied' | 'replaced_scheduled_change',
  first: ReturnType<typeof version>,
  after: ReturnType<typeof version>,
) =>
  goalBundle({
    versions: [
      first,
      version('v2', 2, {
        targetValue: 300,
        effectiveFrom: NOVEMBER.start,
        // Replaced before November began: the window ends where it starts.
        effectiveTo: NOVEMBER.start,
        changeReason: 'target_changed',
        createdBy: 'marco',
        createdAt: OCT_20,
      }),
      after,
    ],
    results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
    targetChanges: [
      targetChange('lobby', 400, 300, OCT_20, {
        followingOutcome: outcome,
        followingVersionId: 'v2',
      }),
    ],
  })

describe('buildGoalTargetChanges, around a change of subjects', () => {
  it('credits a scheduled change to whoever set the target, not to a later change of subjects', () => {
    const goal = goalBundle({
      versions: [
        inForce(),
        // Replaced by Elena's version before November began.
        scheduledByMarco({ effectiveTo: NOVEMBER.start }),
        subjectsChanged({ targetValue: 500 }),
      ],
      results: [monthRow('lobby', 'v1')],
    })

    expect(buildGoalTargetChanges(goal, frame)).toEqual([
      {
        id: 'version:v2',
        text: 'Marco Rossi changed the target from 400 to 500',
        detail: 'Applies from Nov 1.',
        // The note on the target, not the one on the change of subjects.
        note: 'Busy season ahead',
        dateLabel: 'Oct 12',
        occurredAt: OCT_12.toISOString(),
      },
    ])
  })

  it('still says a month change applies to the months after when a change of subjects replaced its version', () => {
    const goal = octoberChangedWithFollowing(
      'applied',
      inForce(),
      subjectsChanged({ targetValue: 300 }),
    )

    // One line: November does run at 300, and Elena changed no target.
    expect(said(goal)).toEqual([
      [
        'Marco Rossi changed October’s target from 400 to 300',
        'Also applies from Nov 1.',
      ],
    ])
  })

  it('dates the months after from the day the version that carries the target starts', () => {
    const goal = octoberChangedWithFollowing(
      'replaced_scheduled_change',
      inForce(DECEMBER.start),
      subjectsChanged({ targetValue: 300, effectiveFrom: DECEMBER.start }),
    )

    expect(said(goal)).toEqual([
      [
        'Marco Rossi changed October’s target from 400 to 300',
        'Also applies from Dec 1, in place of the change that was scheduled.',
      ],
    ])
  })

  it('says the months after never took effect when another target replaced them', () => {
    const goal = octoberChangedWithFollowing(
      'applied',
      inForce(),
      // Not a change of subjects: Elena set 350 from November instead.
      subjectsChanged({ targetValue: 350, changeReason: 'revised' }),
    )

    expect(said(goal)).toEqual([
      ['Elena Petrova changed the target from 400 to 350', 'Applies from Nov 1.'],
      [
        'Marco Rossi changed October’s target from 400 to 300',
        'Was also set from Nov 1, but that never took effect.',
      ],
    ])
  })

  it('keeps a change of subjects out when it follows a target change that is in force', () => {
    const goal = goalBundle({
      versions: [
        inForce(),
        scheduledByMarco({ effectiveTo: DECEMBER.start }),
        subjectsChanged({ targetValue: 500, effectiveFrom: DECEMBER.start }),
      ],
    })

    expect(said(goal)).toEqual([
      ['Marco Rossi changed the target from 400 to 500', 'Applies from Nov 1.'],
    ])
  })
})
