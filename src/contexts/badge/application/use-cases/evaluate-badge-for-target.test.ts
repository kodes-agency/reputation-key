// Badge context — evaluate badge for target tests
// Tests: idempotency, threshold criteria met/not-met, disabled badge, streak badge.

import { describe, it, expect, vi } from 'vitest'
import {
  evaluateBadgeDefinitionForTarget,
  type EvaluateBadgeForTargetDeps,
} from './evaluate-badge-for-target'
import type { BadgeRepository } from '../ports/badge.repository'
import type {
  BadgeAward,
  BadgeDefinition,
  BadgeEvaluationTarget,
} from '../../domain/types'
import type {
  MetricPublicApi,
  MetricReadingsAggregate,
} from '#/contexts/metric/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  propertyId,
  portalId,
  badgeId,
  type PortalId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')
const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000020')
const PORTAL = portalId('00000000-0000-4000-8000-000000000010')

function makeThresholdDefinition(overrides?: Partial<BadgeDefinition>): BadgeDefinition {
  return {
    id: badgeId('00000000-0000-4000-8000-000000000001'),
    key: 'first_review',
    name: 'First Review',
    description: 'Earned on first review',
    icon: 'award',
    targetScope: 'portal',
    criteriaVersion: 1,
    criteria: {
      type: 'threshold',
      metricKey: 'portal.feedback',
      operator: '>=',
      threshold: 1,
    },
    enabled: true,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

function makePortalTarget(): BadgeEvaluationTarget {
  return {
    organizationId: ORG,
    targetType: 'portal',
    portalId: PORTAL,
    propertyId: PROP,
  } as BadgeEvaluationTarget
}

function getPortalId(target: BadgeEvaluationTarget): PortalId | null {
  if (target.targetType === 'portal') return target.portalId
  return null
}

function createFakeDeps(overrides?: {
  metricSum?: number
  existingAward?: BadgeAward | null
  timezone?: string
  dailyCounts?: ReadonlyMap<string, number>
}): EvaluateBadgeForTargetDeps {
  const aggregate: MetricReadingsAggregate = {
    sum: overrides?.metricSum ?? 0,
    count: overrides?.metricSum ? 1 : 0,
    max: overrides?.metricSum ?? 0,
  }

  const badgeRepo = {
    seedDefinitions: vi.fn(async (defs: readonly unknown[]) => defs),
    findDefinitionByKey: vi.fn(async () => null),
    listEnabledDefinitionsForOrg: vi.fn(async () => []),
    findDefinition: vi.fn(async () => null),
    listOrgIdsWithBadges: vi.fn(async () => []),
    setOrganizationEnablement: vi.fn(async () => ({})),
    isOrgDefinitionEnabled: vi.fn(async () => true),
    findAwardByUniqueKey: vi.fn(async () => overrides?.existingAward ?? null),
    insertAward: vi.fn(async (award: BadgeAward) => award),
    listTargetAwards: vi.fn(async () => []),
    listStaffAwards: vi.fn(async () => []),
    listPropertiesForOrg: vi.fn(async () => []),
    listPortalTargets: vi.fn(async () => []),
    listGroupTargets: vi.fn(async () => []),
    findGroupForPortal: vi.fn(async () => null),
    findPropertyTimezone: vi.fn(async () => overrides?.timezone ?? 'UTC'),
    queryDailyCounts: vi.fn(async () => overrides?.dailyCounts ?? new Map()),
  } as unknown as BadgeRepository

  const metricApi = {
    queryAggregate: vi.fn(async () => aggregate),
  } as unknown as MetricPublicApi

  const events = {
    on: vi.fn(),
    emit: vi.fn(async () => undefined),
    off: vi.fn(),
  } as unknown as EventBus

  return { badgeRepo, metricApi, events, clock: () => FIXED_TIME }
}

describe('evaluateBadgeDefinitionForTarget', () => {
  it('awards when threshold criteria is met', async () => {
    const definition = makeThresholdDefinition()
    const target = makePortalTarget()
    const deps = createFakeDeps({ metricSum: 5 })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(true)
    if (result.awarded) {
      expect(result.award.badgeDefinitionId).toBe(definition.id)
      expect(result.award.targetType).toBe('portal')
      expect(result.award.portalId).toBe(PORTAL)
      expect(deps.badgeRepo.insertAward).toHaveBeenCalledOnce()
      expect(deps.events.emit).toHaveBeenCalledOnce()
    }
  })

  it('does not award when threshold criteria is not met', async () => {
    const definition = makeThresholdDefinition({
      criteria: {
        type: 'threshold',
        metricKey: 'portal.feedback',
        operator: '>=',
        threshold: 10,
      },
    })
    const target = makePortalTarget()
    const deps = createFakeDeps({ metricSum: 3 })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(false)
    if (!result.awarded) {
      expect(result.reason).toBe('criteria_not_met')
    }
    expect(deps.badgeRepo.insertAward).not.toHaveBeenCalled()
  })

  it('returns already_awarded when award exists (idempotency)', async () => {
    const definition = makeThresholdDefinition()
    const target = makePortalTarget()
    const existingAward: BadgeAward = {
      id: badgeId('existing'),
      badgeDefinitionId: definition.id,
      criteriaVersion: 1,
      targetType: 'portal',
      targetId: PORTAL,
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORTAL,
      portalGroupId: null,
      awardedAt: FIXED_TIME,
      uniqueKey: 'first_review:1:portal:existing',
      createdAt: FIXED_TIME,
    }
    const deps = createFakeDeps({ metricSum: 5, existingAward })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(false)
    if (!result.awarded) {
      expect(result.reason).toBe('already_awarded')
    }
    expect(deps.badgeRepo.insertAward).not.toHaveBeenCalled()
  })

  it('returns disabled when definition is not enabled', async () => {
    const definition = makeThresholdDefinition({ enabled: false })
    const target = makePortalTarget()
    const deps = createFakeDeps({ metricSum: 5 })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(false)
    if (!result.awarded) {
      expect(result.reason).toBe('disabled')
    }
    expect(deps.badgeRepo.insertAward).not.toHaveBeenCalled()
  })

  it('evaluates streak criteria from daily counts', async () => {
    const definition = makeThresholdDefinition({
      key: 'scan_streak_7',
      criteria: {
        type: 'streak',
        metricKey: 'portal.scan',
        operator: '>=',
        threshold: 1,
        streakDays: 7,
        dailyThreshold: 1,
      },
    })
    const target = makePortalTarget()

    // streakMet now uses deps.clock() (FIXED_TIME) — generate keys from that
    const dailyCounts = new Map<string, number>()
    for (let i = 0; i < 7; i++) {
      const d = new Date(FIXED_TIME)
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(d)
        .replaceAll('-', '_')
      dailyCounts.set(key, 2)
    }

    const deps = createFakeDeps({ dailyCounts })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(true)
    expect(deps.badgeRepo.queryDailyCounts).toHaveBeenCalledOnce()
  })

  it('does not award streak when consecutive days broken', async () => {
    const definition = makeThresholdDefinition({
      key: 'scan_streak_7',
      criteria: {
        type: 'streak',
        metricKey: 'portal.scan',
        operator: '>=',
        threshold: 1,
        streakDays: 7,
        dailyThreshold: 1,
      },
    })
    const target = makePortalTarget()

    // Only 5 consecutive days from FIXED_TIME backwards
    const dailyCounts = new Map<string, number>()
    for (let i = 0; i < 5; i++) {
      const d = new Date(FIXED_TIME)
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(d)
        .replaceAll('-', '_')
      dailyCounts.set(key, 2)
    }

    const deps = createFakeDeps({ dailyCounts })

    const result = await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(result.awarded).toBe(false)
    if (!result.awarded) {
      expect(result.reason).toBe('criteria_not_met')
    }
  })

  it('constructs correct unique key for idempotency', async () => {
    const definition = makeThresholdDefinition()
    const target = makePortalTarget()
    const deps = createFakeDeps({ metricSum: 5 })

    await evaluateBadgeDefinitionForTarget(definition, target, deps)

    expect(deps.badgeRepo.findAwardByUniqueKey).toHaveBeenCalledWith(
      `first_review:1:portal:${PORTAL}`,
    )
  })

  it('portal target has correct portalId', () => {
    const target = makePortalTarget()
    expect(getPortalId(target)).toBe(PORTAL)
  })
})
