import { describe, expect, it } from 'vitest'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import {
  goalBulkFirstFailed,
  goalBulkMayHaveSaved,
  goalBulkRefusal,
  goalBulkReportOf,
  goalBulkSubmission,
  goalBulkSummary,
} from './goal-bulk-save'
import {
  goalBulkRows,
  goalBulkSubjects,
  type GoalBulkReport,
  type GoalBulkSubjectRow,
} from './goal-bulk-view'

const portal = (id: string, name: string) => ({ id, name, publicationState: 'published' })
const SUBJECTS = goalBulkSubjects(
  [{ id: 'floor', name: 'First floor' }],
  [portal('lobby', 'Lobby QR'), portal('bar', 'Bar QR')],
)
const LOBBY = 'portal:lobby'
const BAR = 'portal:bar'

const LOBBY_HOLD: GoalSubjectHold = {
  subject: { kind: 'portal', portalId: 'lobby' },
  programId: 'program-1',
  programName: 'Lobby ratings',
  targetValue: 400,
  heldUntil: null,
}

const rows = (
  input: Readonly<{
    holds?: readonly GoalSubjectHold[]
    report?: GoalBulkReport
    subjects?: readonly GoalBulkSubjectRow[]
  }> = {},
) =>
  goalBulkRows({
    subjects: input.subjects ?? SUBJECTS,
    holds: input.holds ?? [],
    report: input.report ?? {},
    startsThisMonth: true,
    timezone: 'Europe/Sofia',
    now: new Date('2026-10-11T09:00:00.000Z'),
  })
const rowOf = (key: string, all = rows()) => {
  const row = all.find((candidate) => candidate.key === key)
  if (!row) throw new Error(`No row for ${key}`)
  return row
}

describe('goalBulkSubmission', () => {
  const targets = (values: Readonly<Record<string, number>>) => values

  it('sends every open row that has a number, in the order of the table', () => {
    const submission = goalBulkSubmission(
      rows(),
      targets({ [LOBBY]: 40, [BAR]: 12, 'portal_group:floor': Number.NaN }),
      'portal_rating_count',
    )

    expect(submission).toEqual({
      ok: true,
      items: [
        { subject: { kind: 'portal', portalId: 'bar' }, targetValue: 12 },
        { subject: { kind: 'portal', portalId: 'lobby' }, targetValue: 40 },
      ],
    })
  })

  it('never sends a row whose subject already has a goal', () => {
    const submission = goalBulkSubmission(
      rows({ holds: [LOBBY_HOLD] }),
      targets({ [LOBBY]: 40, [BAR]: 12 }),
      'portal_rating_count',
    )

    expect(submission).toMatchObject({
      ok: true,
      items: [{ subject: { kind: 'portal', portalId: 'bar' } }],
    })
  })

  it('never sends a row whose Portal is no longer available', () => {
    const submission = goalBulkSubmission(
      rows({ report: { [LOBBY]: { code: 'invalid_subject' } } }),
      targets({ [LOBBY]: 40, [BAR]: 12 }),
      'portal_rating_count',
    )

    expect(submission).toEqual({
      ok: true,
      items: [{ subject: { kind: 'portal', portalId: 'bar' }, targetValue: 12 }],
    })
  })

  // A number field holds no value for text it cannot read ("4,5" where the
  // browser wants "4.5"), so such a row looks empty to the table. The field
  // itself knows better, and the table hands over the rows it says so about.
  it('a number the field cannot read is said on its row, not skipped as empty', () => {
    expect(
      goalBulkSubmission(rows(), targets({ [BAR]: 4.5 }), 'portal_rating_average', [
        LOBBY,
      ]),
    ).toEqual({
      ok: false,
      report: {
        [LOBBY]: { code: 'invalid_target', fault: 'Enter a valid monthly target' },
      },
      message: null,
    })
  })

  it('sends nothing while a number does not suit the measure', () => {
    expect(
      goalBulkSubmission(
        rows(),
        targets({ [LOBBY]: 7, [BAR]: 4.5 }),
        'portal_rating_average',
      ),
    ).toEqual({
      ok: false,
      report: {
        [LOBBY]: { code: 'invalid_target', fault: 'Use a rating target from 1 to 5' },
      },
      message: null,
    })
  })

  it('the average measure shows the 1 to 5 message on the row, which stays open', () => {
    const refused = goalBulkSubmission(
      rows(),
      targets({ [LOBBY]: 7 }),
      'portal_rating_average',
    )
    const report = refused.ok ? {} : refused.report

    expect(rowOf(LOBBY, rows({ report }))).toMatchObject({
      goal: null,
      status: null,
      fault: 'Use a rating target from 1 to 5',
      failed: true,
    })
    expect(rowOf(BAR, rows({ report })).failed).toBe(false)
  })

  it('asks for at least one number', () => {
    expect(goalBulkSubmission(rows(), targets({}), 'portal_rating_count')).toEqual({
      ok: false,
      report: {},
      message: 'Enter a target for at least one portal.',
    })
  })

  it('takes 50 rows in one save', () => {
    const many = goalBulkSubjects(
      [],
      Array.from({ length: 51 }, (_, index) => portal(`p${index}`, `Portal ${index}`)),
    )
    const filled = Object.fromEntries(many.map((row) => [row.key, 5]))

    expect(
      goalBulkSubmission(rows({ subjects: many }), filled, 'portal_rating_count'),
    ).toEqual({
      ok: false,
      report: {},
      message: 'Set goals for up to 50 portals at a time.',
    })
  })
})

describe('what a save leaves behind', () => {
  const lobby = { kind: 'portal', portalId: 'lobby' } as const
  const bar = { kind: 'portal', portalId: 'bar' } as const

  it('keeps the goal and the number of a saved row, and the reason of a refused one', () => {
    const report = goalBulkReportOf(
      [
        { subject: lobby, code: 'created', programId: 'program-2' },
        { subject: bar, code: 'invalid_target' },
        { subject: { kind: 'portal_group', portalGroupId: 'floor' }, code: 'failed' },
      ],
      { metric: 'portal_rating_count', targets: { [LOBBY]: 40, [BAR]: 0 } },
    )

    expect(report).toEqual({
      [LOBBY]: { code: 'created', programId: 'program-2', targetValue: 40 },
      [BAR]: { code: 'invalid_target', fault: 'Use a positive whole number' },
      'portal_group:floor': { code: 'failed' },
    })
  })

  it('the focus goes to the first row, in the order of the table, that got no goal', () => {
    const report: GoalBulkReport = {
      [LOBBY]: { code: 'failed' },
      [BAR]: { code: 'created', programId: 'program-2', targetValue: 12 },
      'portal_group:floor': { code: 'subject_has_goal' },
    }

    // Bar QR, First floor, Lobby QR: the group is the first that was refused.
    expect(goalBulkFirstFailed(report, SUBJECTS)).toBe('portal_group:floor')
    expect(
      goalBulkFirstFailed(
        { [BAR]: { code: 'created', programId: 'program-2', targetValue: 12 } },
        SUBJECTS,
      ),
    ).toBeNull()
    expect(goalBulkFirstFailed({}, SUBJECTS)).toBeNull()
  })

  it('says how many goals were saved and how many were not', () => {
    const saved = { subject: lobby, code: 'created', programId: 'program-2' } as const
    const refused = { subject: bar, code: 'subject_has_goal' } as const

    expect(goalBulkSummary([saved])).toBe('1 goal saved.')
    expect(goalBulkSummary([saved, saved, refused])).toBe('2 goals saved. 1 not saved.')
    expect(goalBulkSummary([refused, refused])).toBe('No goals saved. 2 not saved.')
  })
})

describe('a save refused as a whole', () => {
  const refusal = (code: string, status: number) =>
    new ServerFunctionError('GoalProgramError', code, code, status)

  it('says a sentence for every code the command refuses with, never the code', () => {
    for (const [code, status] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['start_month_changed', 409],
      ['invalid_subject', 400],
      ['duplicate_subject', 400],
      ['assignment_limit_exceeded', 400],
    ] as const) {
      const said = actionErrorMessage(goalBulkRefusal(refusal(code, status)))

      expect(said).not.toContain('_')
      expect(said).toMatch(/^[A-Z].*\.$/u)
    }
  })

  it('speaks of the property and of the table, where the goal sentences would not fit', () => {
    expect(goalBulkRefusal(refusal('not_found', 404))).toBe(
      'This property can’t be found.',
    )
    expect(goalBulkRefusal(refusal('assignment_limit_exceeded', 400))).toBe(
      'Set goals for up to 50 portals at a time.',
    )
    expect(actionErrorMessage(goalBulkRefusal(refusal('start_month_changed', 409)))).toBe(
      'The month has changed. Check the start and save again.',
    )
  })

  it('hands a failure that is not a refusal on as it is', () => {
    const fault = new Error('socket hang up')

    expect(goalBulkRefusal(fault)).toBe(fault)
  })

  it('wrote nothing when the command refused it, and may have when it failed', () => {
    expect(goalBulkMayHaveSaved(refusal('start_month_changed', 409))).toBe(false)
    expect(goalBulkMayHaveSaved(refusal('not_found', 404))).toBe(false)
    // A fault or a lost connection can follow rows that were already written.
    expect(
      goalBulkMayHaveSaved(
        new ServerFunctionError('InternalError', 'boom', 'internal_error', 500),
      ),
    ).toBe(true)
    expect(goalBulkMayHaveSaved(new Error('Failed to fetch'))).toBe(true)
  })
})
