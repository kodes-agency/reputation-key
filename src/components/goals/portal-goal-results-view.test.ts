import { describe, expect, it } from 'vitest'
import {
  OLD_SPA_GOAL,
  RECEPTION_GOAL,
  RESULTS_NOW,
  SEAVIEW_GOALS,
  STOPPED_GOAL,
  portalGoalBundle,
  subjectName,
} from './portal-goal-results.stories.fixtures'
import { endedPortalGoals } from './portal-goal-results-view'

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
