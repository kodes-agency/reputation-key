import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { userId } from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience.server'
import {
  buildAudienceDeps,
  decide,
  goalCompletionAudience,
  goalCompletionFacts,
  goalRevisionAudience,
  goalRevisionFacts,
  HEALTH_SINCE,
  ORG,
  PORTAL,
  PROPERTY,
  RECIPIENT,
} from './notification-audience.test-fixtures'

let held: HeldTransaction
beforeAll(async () => {
  held = await holdTransaction()
})
afterAll(async () => {
  await held?.rollBack()
})

const buildDeps = () => buildAudienceDeps(held.db)

describe('notification audience authorization', () => {
  it('revalidates exact current Portal Health and responsibility at delivery', async () => {
    const deps = buildDeps()
    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      status: 'degraded',
      reason: 'google_destination_unavailable',
      effectiveFrom: new Date(HEALTH_SINCE),
    })
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'portal_health' as const,
      portalId: PORTAL,
      status: 'degraded' as const,
      reason: 'google_destination_unavailable' as const,
      effectiveFrom: HEALTH_SINCE,
    }

    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      status: 'healthy',
      reason: 'operational',
      effectiveFrom: new Date('2026-08-27T09:00:00.000Z'),
    })
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  // Every same-status reconcile (an unrelated property.updated, say) re-stamps
  // the open interval's source version. That is not a new Health state, so a
  // notice queued for the interval still stands; a later interval that merely
  // repeats the status and reason is a different notice.
  it('keys Portal Health delivery to the interval the fact opened', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'portal_health' as const,
      portalId: PORTAL,
      status: 'unavailable' as const,
      reason: 'publication_snapshot_unavailable' as const,
      effectiveFrom: HEALTH_SINCE,
    }
    const current = (effectiveFrom: string) => ({
      propertyId: PROPERTY,
      status: 'unavailable' as const,
      reason: 'publication_snapshot_unavailable' as const,
      effectiveFrom: new Date(effectiveFrom),
    })

    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue(
      current(HEALTH_SINCE),
    )
    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue(
      current('2026-08-27T11:00:00.000Z'),
    )
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  it('revalidates the exact current Goal result revision and responsibility', async () => {
    const deps = buildDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      goalRevisionFacts(),
    )
    deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
    const audience = goalRevisionAudience()

    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      null,
    )
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  it('delivers a superseded Goal correction while the current head holds its outcome', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
    const audience = goalRevisionAudience({ revisionId: 'revision-1', revision: 1 })

    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      goalRevisionFacts({ achieved: false }),
    )
    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      goalRevisionFacts({ achieved: true }),
    )
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  it('delivers a Goal completion only while the month is still achieved', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      goalCompletionFacts(),
    )
    const audience = goalCompletionAudience()

    expect(parseNotificationAudience(audience)).toEqual(audience)
    await expect(decide(deps, { audience })).resolves.toBe(true)
    expect(
      deps.monthlyResultFacts.findMonthlyResultNotificationFacts,
    ).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
    })

    // The lookup answers null once the current head is no longer achieved.
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(null)
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  // The recheck agrees with the fan-out: a Portal-goal notice, whatever its
  // subject, belongs to the Property's responsible managers (PROPOSAL §4.5,
  // approved under P-8). The Portal's own manager is not asked.
  it("rechecks a portal goal notice against the Property's responsible managers", async () => {
    const deps = buildDeps()
    const PORTAL_MANAGER = userId('portal-manager-1')
    deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
    deps.responsibleManagers.findForPortal.mockResolvedValue([PORTAL_MANAGER])
    const subject = { kind: 'portal' as const, portalId: PORTAL }
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      goalCompletionFacts({ programName: 'Reception scans', subject }),
    )
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      goalRevisionFacts({ programName: 'Reception scans', subject }),
    )

    for (const audience of [goalCompletionAudience(), goalRevisionAudience()]) {
      await expect(decide(deps, { audience })).resolves.toBe(true)
      await expect(decide(deps, { userId: PORTAL_MANAGER, audience })).resolves.toBe(
        false,
      )
    }
    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })
})
