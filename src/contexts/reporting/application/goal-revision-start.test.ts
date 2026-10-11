import { describe, expect, it } from 'vitest'
import type { GoalProgramStatus } from '../domain/goal-program'
import type { GoalMonthlyResult } from './ports/goal-program.repository'
import { nextRevisionStart } from './goal-revision-start'

const MARCH = new Date('2026-03-01T00:00:00.000Z')
const APRIL = new Date('2026-04-01T00:00:00.000Z')
const MAY = new Date('2026-05-01T00:00:00.000Z')
const JUNE = new Date('2026-06-01T00:00:00.000Z')
// Sofia is three hours ahead of UTC in summer: its May begins on 30 April UTC.
const SOFIA_MAY = new Date('2026-04-30T21:00:00.000Z')
const SOFIA_JUNE = new Date('2026-05-31T21:00:00.000Z')

type MonthRow = Pick<GoalMonthlyResult, 'programVersionId' | 'status' | 'periodEnd'>

const month = (
  versionId: string,
  periodEnd: Date,
  status: MonthRow['status'] = 'open',
): MonthRow => ({ programVersionId: versionId, status, periodEnd })

const goal = (
  status: GoalProgramStatus,
  headStartsAt: Date,
  results: readonly MonthRow[] = [],
) => ({
  program: { status },
  version: { id: 'head', effectiveFrom: headStartsAt },
  results,
})

describe('nextRevisionStart', () => {
  describe('a head in force', () => {
    it('starts the change at the month after the one still open', () => {
      const running = goal('active', MARCH, [month('head', APRIL)])

      expect(
        nextRevisionStart(running, new Date('2026-03-15T12:00:00.000Z'), 'UTC'),
      ).toEqual({ head: 'in_force', period: { start: APRIL, end: MAY } })
    })

    it('never redefines a month on its first instant', () => {
      // Paused with March closed: nothing is open, and the request lands on
      // the first instant of April.
      const paused = goal('paused', MARCH, [month('head', APRIL, 'closed')])

      expect(nextRevisionStart(paused, APRIL, 'UTC').period.start).toEqual(MAY)
    })

    it('waits for a month that still has to reconcile, even with no month open', () => {
      // Paused in March; April never opened. March is still reconciling on 1 April.
      const paused = goal('paused', MARCH, [month('head', APRIL, 'reconciling')])

      expect(
        nextRevisionStart(paused, new Date('2026-04-01T00:10:00.000Z'), 'UTC'),
      ).toEqual({ head: 'in_force', period: { start: MAY, end: JUNE } })
    })

    it('starts one local month later when the Property moved east', () => {
      const running = goal('active', MARCH, [month('head', APRIL)])

      // Sofia's April begins before UTC March ends, so the first Sofia month
      // that starts at or after it is May.
      expect(
        nextRevisionStart(running, new Date('2026-03-20T12:00:00.000Z'), 'Europe/Sofia'),
      ).toEqual({ head: 'in_force', period: { start: SOFIA_MAY, end: SOFIA_JUNE } })
    })
  })

  describe('a goal that has not started', () => {
    it('keeps the start month it was given', () => {
      const scheduled = goal('scheduled', APRIL)

      expect(
        nextRevisionStart(scheduled, new Date('2026-03-15T12:00:00.000Z'), 'UTC'),
      ).toEqual({ head: 'never_started', period: { start: APRIL, end: MAY } })
    })

    it('keeps a start that has already passed while the goal waits to be activated', () => {
      const overdue = goal('scheduled', APRIL)

      expect(
        nextRevisionStart(overdue, new Date('2026-04-01T00:30:00.000Z'), 'UTC'),
      ).toEqual({ head: 'never_started', period: { start: APRIL, end: MAY } })
    })

    it('moves to a real local month start when the Property changed time zone', () => {
      const scheduled = goal('scheduled', APRIL)

      // 1 April 00:00 UTC is 03:00 on 1 April in Sofia: that month has begun,
      // so the first full Sofia month is May.
      expect(
        nextRevisionStart(
          scheduled,
          new Date('2026-03-15T12:00:00.000Z'),
          'Europe/Sofia',
        ),
      ).toEqual({ head: 'never_started', period: { start: SOFIA_MAY, end: SOFIA_JUNE } })
    })
  })

  describe('a change still waiting for its month', () => {
    it('replaces it from the same month while the month before is still open', () => {
      const pending = goal('active', APRIL, [month('earlier', APRIL)])

      expect(
        nextRevisionStart(pending, new Date('2026-03-20T12:00:00.000Z'), 'UTC'),
      ).toEqual({ head: 'pending', period: { start: APRIL, end: MAY } })
    })

    it('never starts before the pending change itself was due', () => {
      // The pending change waits for May; nothing is open any more.
      const pending = goal('paused', MAY, [month('earlier', APRIL, 'closed')])

      expect(
        nextRevisionStart(pending, new Date('2026-04-10T12:00:00.000Z'), 'UTC'),
      ).toEqual({ head: 'pending', period: { start: MAY, end: JUNE } })
    })

    it('starts after today when the pending change was due while the goal was paused', () => {
      const pending = goal('paused', APRIL, [month('earlier', APRIL, 'closed')])

      expect(
        nextRevisionStart(pending, new Date('2026-04-15T12:00:00.000Z'), 'UTC'),
      ).toEqual({ head: 'pending', period: { start: MAY, end: JUNE } })
    })

    it('moves to a real local month start when the Property changed time zone', () => {
      const pending = goal('active', APRIL, [month('earlier', APRIL)])

      expect(
        nextRevisionStart(pending, new Date('2026-03-20T12:00:00.000Z'), 'Europe/Sofia'),
      ).toEqual({ head: 'pending', period: { start: SOFIA_MAY, end: SOFIA_JUNE } })
    })
  })
})
