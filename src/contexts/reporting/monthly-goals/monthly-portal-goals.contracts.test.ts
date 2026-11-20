import { describe, expect, it } from 'vitest'
import {
  addPortalGoalSchema,
  addPortalGoalsSchema,
  changeMonthlyPortalGoalNowSchema,
  deferMonthlyPortalGoalPromptSchema,
  keepMonthlyPortalGoalSchema,
  monthlyPortalGoalLineSchema,
  monthlyPortalGoalPropertySchema,
  portalGoalSinglePageSchema,
  reviseMonthlyPortalGoalSchema,
  stopMonthlyPortalGoalSchema,
} from './monthly-portal-goals.contracts'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const PORTAL_ID = '00000000-0000-4000-8000-000000000003'
const PROGRAM_ID = '00000000-0000-4000-8000-000000000004'
const input = { propertyId: PROPERTY_ID }
const goal = { propertyId: PROPERTY_ID, programId: PROGRAM_ID }
const ofTheGoal = goal
const one = {
  propertyId: PROPERTY_ID,
  subject: { kind: 'portal' as const, portalId: PORTAL_ID },
  metric: 'portal_rating_count' as const,
  targetValue: 22,
  startMonth: '2026-12',
  targetSource: 'recommended' as const,
}
const each = {
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count' as const,
  startMonth: '2026-12',
  items: [{ portalId: PORTAL_ID, targetValue: 22, targetSource: 'recommended' as const }],
}
const now = {
  ...goal,
  month: '2026-11',
  targetValue: 45,
  expectedTarget: 40,
  expectedVersion: 1,
  expectedFollowingMonth: '2026-12',
  targetSource: 'own',
} as const
const fromNext = {
  ...goal,
  metric: 'qualified_scans',
  targetValue: 55,
  expectedVersion: 1,
  startMonth: '2026-12',
  note: 'Winter',
  targetSource: 'recommended',
} as const
const keep = { ...goal, month: '2026-12' } as const
const notNow = { propertyId: PROPERTY_ID, month: '2026-11' } as const
const line = { propertyId: PROPERTY_ID, portalId: PORTAL_ID } as const

describe('Monthly portal goal input', () => {
  it('reads one Property by its id', () => {
    expect(monthlyPortalGoalPropertySchema.safeParse(input).success).toBe(true)
    expect(monthlyPortalGoalPropertySchema.safeParse({ propertyId: 'p1' }).success).toBe(
      false,
    )
  })

  it('takes a portal, a group or the average, and no more than 100 portals at once', () => {
    expect(addPortalGoalSchema.safeParse(one).success).toBe(true)
    expect(
      addPortalGoalSchema.safeParse({
        ...one,
        subject: { kind: 'property' },
        metric: 'portal_rating_average',
        targetValue: 4.5,
      }).success,
    ).toBe(true)
    expect(
      addPortalGoalSchema.safeParse({ ...one, subject: { kind: 'staff', staffId: 'x' } })
        .success,
    ).toBe(false)
    expect(
      addPortalGoalsSchema.safeParse({
        ...each,
        items: Array.from({ length: 101 }, () => each.items[0]),
      }).success,
    ).toBe(false)
    expect(
      addPortalGoalsSchema.safeParse({ ...each, metric: 'portal_rating_average' })
        .success,
    ).toBe(false)
  })

  it('takes what the sheet showed, and refuses what it never sends', () => {
    expect(changeMonthlyPortalGoalNowSchema.safeParse(now).success).toBe(true)
    expect(reviseMonthlyPortalGoalSchema.safeParse(fromNext).success).toBe(true)
    expect(stopMonthlyPortalGoalSchema.safeParse(goal).success).toBe(true)
    // The average's level, in tenths, now or from its next month; a
    // count's whole number is the engine's to require, by what the goal measures.
    expect(
      changeMonthlyPortalGoalNowSchema.safeParse({ ...now, targetValue: 4.6 }).success,
    ).toBe(true)
    expect(
      reviseMonthlyPortalGoalSchema.safeParse({
        ...fromNext,
        metric: 'portal_rating_average',
        targetValue: 4.6,
      }).success,
    ).toBe(true)
    for (const refused of [
      { ...now, month: '2026-13' },
      { ...now, targetValue: 0 },
      { ...now, expectedVersion: 0 },
      { ...now, note: 'x'.repeat(501) },
    ]) {
      expect(changeMonthlyPortalGoalNowSchema.safeParse(refused).success).toBe(false)
    }
    for (const refused of [
      { ...fromNext, metric: 'google_rating' },
      { ...fromNext, targetValue: 0.5 },
      { ...fromNext, targetSource: 'suggested' },
      // The month it starts with is what the sheet showed, always sent.
      { ...fromNext, startMonth: undefined },
      { ...fromNext, startMonth: '2026-12-01' },
    ]) {
      expect(reviseMonthlyPortalGoalSchema.safeParse(refused).success).toBe(false)
    }
    expect(
      stopMonthlyPortalGoalSchema.safeParse({ ...goal, programId: 'p1' }).success,
    ).toBe(false)
  })

  it('takes the goal and the month the check-in asked about', () => {
    expect(keepMonthlyPortalGoalSchema.safeParse(keep).success).toBe(true)
    for (const refused of [
      { ...keep, month: '2026-13' },
      { ...keep, month: undefined },
      { ...keep, programId: 'monthly' },
    ]) {
      expect(keepMonthlyPortalGoalSchema.safeParse(refused).success).toBe(false)
    }
  })

  it('takes a Property and a month, and a Property and a Portal', () => {
    expect(deferMonthlyPortalGoalPromptSchema.safeParse(notNow).success).toBe(true)
    expect(monthlyPortalGoalLineSchema.safeParse(line).success).toBe(true)
    for (const refused of [
      { ...notNow, month: '2026-13' },
      { ...notNow, month: undefined },
      { ...notNow, propertyId: 'seaview' },
    ]) {
      expect(deferMonthlyPortalGoalPromptSchema.safeParse(refused).success).toBe(false)
    }
    for (const refused of [
      { ...line, portalId: 'reception' },
      { propertyId: PROPERTY_ID },
    ]) {
      expect(monthlyPortalGoalLineSchema.safeParse(refused).success).toBe(false)
    }
  })

  it('reads one goal of one Property by their ids', () => {
    expect(portalGoalSinglePageSchema.safeParse(ofTheGoal).success).toBe(true)
    expect(
      portalGoalSinglePageSchema.safeParse({ ...ofTheGoal, programId: 'monthly' })
        .success,
    ).toBe(false)
    expect(
      portalGoalSinglePageSchema.safeParse({ propertyId: PROPERTY_ID }).success,
    ).toBe(false)
  })
})
