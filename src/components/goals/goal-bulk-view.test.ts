import { describe, expect, it } from 'vitest'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import {
  goalBulkNothingLeft,
  goalBulkRows,
  goalBulkSubjects,
  goalBulkTooFew,
  type GoalBulkReport,
  type GoalBulkSubjectRow,
} from './goal-bulk-view'

const ZONE = 'Europe/Sofia'
const NOW = new Date('2026-10-11T09:00:00.000Z')
// 1 November in Sofia: where a goal ended in October stops holding its subject.
const NOVEMBER = new Date('2026-10-31T22:00:00.000Z')

const portal = (id: string, name: string, publicationState = 'published') => ({
  id,
  name,
  publicationState,
})
const LOBBY_QR = portal('lobby', 'Lobby QR')
const PORTALS = [LOBBY_QR, portal('bar', 'Bar QR')]
const GROUPS = [{ id: 'floor', name: 'First floor' }]
const SUBJECTS = goalBulkSubjects(GROUPS, PORTALS)
const LOBBY = 'portal:lobby'
const BAR = 'portal:bar'

const hold = (overrides: Partial<GoalSubjectHold> = {}): GoalSubjectHold => ({
  subject: { kind: 'portal', portalId: 'lobby' },
  programId: 'program-1',
  programName: 'Lobby ratings',
  targetValue: 400,
  heldUntil: null,
  goalEnded: false,
  ...overrides,
})

const rows = (
  input: Readonly<{
    holds?: readonly GoalSubjectHold[]
    report?: GoalBulkReport
    startsThisMonth?: boolean
    subjects?: readonly GoalBulkSubjectRow[]
  }> = {},
) =>
  goalBulkRows({
    subjects: input.subjects ?? SUBJECTS,
    holds: input.holds ?? [],
    report: input.report ?? {},
    startsThisMonth: input.startsThisMonth ?? true,
    timezone: ZONE,
    now: NOW,
  })
const rowOf = (key: string, all = rows()) => {
  const row = all.find((candidate) => candidate.key === key)
  if (!row) throw new Error(`No row for ${key}`)
  return row
}

describe('goalBulkSubjects', () => {
  it('has one row per Portal and per Portal Group, by name', () => {
    const subjects = goalBulkSubjects(
      [{ id: 'floor', name: 'first floor' }],
      [portal('r10', 'Room 10'), portal('r2', 'Room 2'), portal('bar', 'Bar QR')],
    )

    expect(subjects.map((row) => [row.name, row.kind])).toEqual([
      ['Bar QR', 'Portal'],
      ['first floor', 'Portal group'],
      ['Room 2', 'Portal'],
      ['Room 10', 'Portal'],
    ])
    expect(subjects[1]).toMatchObject({
      key: 'portal_group:floor',
      subject: { kind: 'portal_group', portalGroupId: 'floor' },
    })
  })

  it('leaves an archived Portal out', () => {
    const subjects = goalBulkSubjects(
      [],
      [portal('old', 'Old desk', 'archived'), portal('lobby', 'Lobby QR', 'draft')],
    )

    expect(subjects.map((row) => row.key)).toEqual([LOBBY])
  })
})

describe('goalBulkTooFew', () => {
  it('says nothing from two rows', () => {
    expect(goalBulkTooFew(goalBulkSubjects(GROUPS, [LOBBY_QR]))).toBeNull()
  })

  it('sends a Property with one Portal to the One goal tab', () => {
    expect(goalBulkTooFew(goalBulkSubjects([], [LOBBY_QR]))).toEqual({
      title: 'This property has one portal',
      description: 'Set its goal on the One goal tab.',
    })
    expect(goalBulkTooFew(goalBulkSubjects(GROUPS, []))?.title).toBe(
      'This property has one portal group',
    )
    expect(goalBulkTooFew([])?.title).toBe('This property has no portals yet')
  })
})

describe('goalBulkRows', () => {
  it('a row with no goal and no report waits for its number', () => {
    expect(rowOf(BAR)).toMatchObject({
      name: 'Bar QR',
      goal: null,
      open: true,
      status: null,
      note: null,
      fault: null,
      failed: false,
    })
  })

  it('a subject in a live goal shows that goal, its target and how to free it', () => {
    const row = rowOf(LOBBY, rows({ holds: [hold()], startsThisMonth: false }))

    expect(row.goal).toEqual({ id: 'program-1', name: 'Lobby ratings', targetValue: 400 })
    expect(row.open).toBe(false)
    expect(row.status).toEqual({ label: 'Already has a goal', tone: 'neutral' })
    expect(row.note).toBe(
      'Lobby QR is part of Lobby ratings. Remove it from that goal’s subjects first.',
    )
    expect(row.failed).toBe(false)
  })

  it('a subject whose goal ends with the month says when it is free', () => {
    const row = rowOf(
      LOBBY,
      rows({ holds: [hold({ heldUntil: NOVEMBER, goalEnded: true })] }),
    )

    expect(row.goal?.targetValue).toBe(400)
    expect(row.note).toBe(
      'Lobby QR has a goal for this measure that ends Oct 31. Start the new goal next month.',
    )
  })

  it('a subject taken out of a goal that goes on is pointed at this month’s target too', () => {
    // The goal still runs for its other subjects, so its month can take a change.
    const row = rowOf(LOBBY, rows({ holds: [hold({ heldUntil: NOVEMBER })] }))

    expect(row.note).toBe(
      'Lobby QR has a goal for this measure that ends Oct 31. Start the new goal next month, or change this month’s target.',
    )
  })

  it('a row saved a moment ago says so, and does not read as a conflict', () => {
    const report: GoalBulkReport = {
      [LOBBY]: { code: 'created', programId: 'program-9', targetValue: 40 },
    }
    const known = hold({
      programId: 'program-9',
      programName: 'Lobby QR · Private ratings',
    })

    expect(rowOf(LOBBY, rows({ report, holds: [known] }))).toMatchObject({
      goal: { id: 'program-9', name: 'Lobby QR · Private ratings', targetValue: 40 },
      open: false,
      status: { label: 'Goal saved', tone: 'positive' },
      note: null,
      failed: false,
    })
    // Before the goals have been read again its name is not known yet.
    expect(rowOf(LOBBY, rows({ report })).goal).toEqual({
      id: 'program-9',
      name: null,
      targetValue: 40,
    })
  })

  it('a row the save refused says why and stays open', () => {
    const report: GoalBulkReport = {
      [LOBBY]: { code: 'metric_unavailable' },
      [BAR]: { code: 'failed' },
      'portal_group:floor': {
        code: 'invalid_target',
        fault: 'Use a positive whole number',
      },
    }
    const all = rows({ report })

    expect(rowOf(LOBBY, all)).toMatchObject({
      goal: null,
      open: true,
      status: { label: 'Measure not available', tone: 'warn' },
      failed: true,
    })
    expect(rowOf(BAR, all).status).toEqual({
      label: 'Not saved, try again',
      tone: 'negative',
    })
    expect(rowOf('portal_group:floor', all)).toMatchObject({
      status: null,
      fault: 'Use a positive whole number',
      failed: true,
    })
  })

  it('names every refusal a row can get', () => {
    const label = (
      code: 'subject_has_goal' | 'invalid_subject' | 'start_month_changed',
    ) => rowOf(LOBBY, rows({ report: { [LOBBY]: { code } } })).status?.label

    expect(label('subject_has_goal')).toBe('Already has a goal')
    expect(label('invalid_subject')).toBe('No longer available')
    expect(label('start_month_changed')).toBe('Not saved, try again')
  })

  // The Portal was archived, or left the Property, while the table was open.
  // No number can give it a goal, so the row closes and is never sent again.
  it('a row whose Portal is no longer available takes no number any more', () => {
    const row = rowOf(LOBBY, rows({ report: { [LOBBY]: { code: 'invalid_subject' } } }))

    expect(row).toMatchObject({
      goal: null,
      open: false,
      status: { label: 'No longer available', tone: 'warn' },
      failed: true,
    })
  })

  it('a refused row whose goal is now known is occupied, and still counts as failed', () => {
    const row = rowOf(
      LOBBY,
      rows({ report: { [LOBBY]: { code: 'subject_has_goal' } }, holds: [hold()] }),
    )

    expect(row).toMatchObject({
      goal: { id: 'program-1' },
      status: { label: 'Already has a goal', tone: 'warn' },
      failed: true,
    })
  })
})

describe('goalBulkNothingLeft', () => {
  const floor = hold({
    subject: { kind: 'portal_group', portalGroupId: 'floor' },
    programId: 'program-3',
  })
  const bar = hold({
    subject: { kind: 'portal', portalId: 'bar' },
    programId: 'program-2',
  })

  it('says nothing while a row takes a number', () => {
    expect(goalBulkNothingLeft(rows())).toBeNull()
    expect(goalBulkNothingLeft(rows({ holds: [hold(), bar] }))).toBeNull()
  })

  it('says that every row has its goal, where a Save button would have nothing to send', () => {
    expect(goalBulkNothingLeft(rows({ holds: [hold(), bar, floor] }))).toBe(
      'Every portal and group has a goal for this measure.',
    )
  })

  it('does not claim a goal for a Portal that is gone', () => {
    const report: GoalBulkReport = { [LOBBY]: { code: 'invalid_subject' } }

    expect(goalBulkNothingLeft(rows({ holds: [bar, floor], report }))).toBe(
      'Nothing is left to set for this measure.',
    )
  })
})
