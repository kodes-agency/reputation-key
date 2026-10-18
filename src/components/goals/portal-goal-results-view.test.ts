import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MONTHLY_GOAL,
  OLD_SPA_GOAL,
  RECEPTION_GOAL,
  RESULTS_NOW,
  SEAVIEW,
  SEAVIEW_GOALS,
  STOPPED_GOAL,
  portalGoalBundle,
  resultsOf,
  subjectName,
} from './portal-goal-results.stories.fixtures'
import {
  PORTAL_GOAL_RESULTS_TITLE,
  endedPortalGoals,
  hasPortalGoalResults,
} from './portal-goal-results-view'

const ended = (programs: Parameters<typeof endedPortalGoals>[0]) =>
  endedPortalGoals(programs, { now: RESULTS_NOW, subjectName })

describe('the ended portal goals', () => {
  it('lists only the goals that have ended, newest end first', () => {
    expect(ended(SEAVIEW_GOALS).map(({ programId }) => programId)).toEqual([
      STOPPED_GOAL.program.id,
      RECEPTION_GOAL.program.id,
      OLD_SPA_GOAL.program.id,
    ])
  })

  it('says the day a goal ended, and its year when it is not this year', () => {
    expect(ended(SEAVIEW_GOALS).map((goal) => goal.ended)).toEqual([
      'Ended on Sep 12',
      'Ended on Nov 12, 2025',
      // Ended before the day a goal ends on was kept: no day to say.
      'Ended',
    ])
  })

  it('names its measure, its number and whom it counted', () => {
    expect(ended(SEAVIEW_GOALS).map(({ name, summary }) => [name, summary])).toEqual([
      ['Monthly portal goal', 'Scans · target 120 · Seaview Hotel'],
      ['Reception ratings', 'Private ratings · target 20 · Reception'],
      ['Spa scans', 'Scans · target 60 · Spa'],
    ])
  })

  it('reads the day it ended in the goal’s own time zone', () => {
    const late = portalGoalBundle({
      id: 'goal-sofia',
      name: 'Monthly portal goal',
      metric: 'portal_rating_count',
      target: 40,
      subject: { kind: 'property', propertyId: 'property-seaview' },
      from: '2026-10',
      ended: { at: new Date('2026-11-12T22:30:00.000Z') },
    })
    const inSofia = {
      ...late,
      version: { ...late.version, propertyTimezone: 'Europe/Sofia' },
    }

    expect(ended([inSofia]).map((goal) => goal.ended)).toEqual(['Ended on Nov 13'])
  })
})

describe('whether the page has anything to show', () => {
  it('has nothing while no goal has a month and none has ended', () => {
    const scheduled = portalGoalBundle({
      id: 'goal-scheduled',
      name: 'Monthly portal goal',
      metric: 'portal_rating_count',
      target: 45,
      subject: { kind: 'property', propertyId: SEAVIEW.propertyId },
      from: '2026-12',
    })

    expect(hasPortalGoalResults(resultsOf([]))).toBe(false)
    expect(hasPortalGoalResults(resultsOf([scheduled]))).toBe(false)
  })

  it('has the months of a goal, the running one included', () => {
    expect(hasPortalGoalResults(resultsOf([MONTHLY_GOAL]))).toBe(true)
  })

  it('has a goal that ended before it counted a month', () => {
    const endedEarly = portalGoalBundle({
      id: 'goal-ended-early',
      name: 'Spa scans',
      metric: 'qualified_scans',
      target: 30,
      subject: { kind: 'portal', portalId: 'portal-spa' },
      from: '2026-12',
      ended: { at: new Date('2026-11-20T10:00:00.000Z') },
    })

    expect(resultsOf([endedEarly]).matrix.months).toEqual([])
    expect(hasPortalGoalResults(resultsOf([endedEarly]))).toBe(true)
  })
})

describe('the page title', () => {
  it('is the one its route names it by, for the tab and the fallbacks', () => {
    // The route spells its own: importing it here would put this module's
    // dependencies on the route row, in first paint (PLAN §3.3).
    const route = readFileSync(
      join(
        process.cwd(),
        'src/routes/_authenticated/properties/$propertyId/goals/portal-results.tsx',
      ),
      'utf8',
    )

    expect(route).toContain(`const TITLE = '${PORTAL_GOAL_RESULTS_TITLE}'`)
  })
})
