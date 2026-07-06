// Badge context — row mapper unit tests
// Covers the criteriaJson zod narrowing and targetScope literal assertion added
// to replace bare `as` casts at the DB→domain boundary.

import { describe, it, expect } from 'vitest'
import { badgeDefinitionFromRow, badgeAwardWithTargetFromRow } from './badge.mapper'
import { badgeDefinitions, badgeAwards } from '#/shared/db/schema/badge.schema'

type DefinitionRow = typeof badgeDefinitions.$inferSelect
type AwardRow = typeof badgeAwards.$inferSelect

const VALID_CRITERIA = {
  type: 'threshold',
  metricKey: 'portal.scan',
  operator: '>=',
  threshold: 100,
  aggregation: 'sum',
  period: 'this_month',
}

function makeDefinitionRow(
  overrides: Partial<DefinitionRow> & {
    criteriaJson?: unknown
    targetScope?: string
  } = {},
): DefinitionRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: '100_scans',
    name: '100 Scans',
    description: 'Earned at 100 scans',
    icon: 'scan',
    targetScope: 'portal',
    criteriaVersion: 1,
    criteriaJson: VALID_CRITERIA,
    enabled: true,
    createdAt: new Date('2026-06-15T12:00:00Z'),
    updatedAt: new Date('2026-06-15T12:00:00Z'),
    ...overrides,
  } as unknown as DefinitionRow
}

describe('badgeDefinitionFromRow — criteria narrowing', () => {
  it('maps a well-formed criteriaJson into BadgeCriteria', () => {
    const def = badgeDefinitionFromRow(makeDefinitionRow())
    expect(def.criteria.type).toBe('threshold')
    expect(def.criteria.metricKey).toBe('portal.scan')
    expect(def.criteria.threshold).toBe(100)
    expect(def.targetScope).toBe('portal')
  })

  it('preserves optional streak fields when present', () => {
    const def = badgeDefinitionFromRow(
      makeDefinitionRow({
        criteriaJson: {
          type: 'streak',
          metricKey: 'portal.scan',
          operator: '>=',
          threshold: 1,
          streakDays: 7,
          dailyThreshold: 1,
        },
      }),
    )
    expect(def.criteria.type).toBe('streak')
    expect(def.criteria.streakDays).toBe(7)
    expect(def.criteria.dailyThreshold).toBe(1)
  })

  it('throws when criteriaJson is missing a required field (threshold)', () => {
    expect(() =>
      badgeDefinitionFromRow(
        makeDefinitionRow({
          criteriaJson: { type: 'threshold', metricKey: 'portal.scan', operator: '>=' },
        }),
      ),
    ).toThrowError(/Invalid badge.criteriaJson/)
  })

  it('throws when criteriaJson has an unknown type literal', () => {
    expect(() =>
      badgeDefinitionFromRow(
        makeDefinitionRow({
          criteriaJson: {
            type: 'bogus',
            metricKey: 'portal.scan',
            operator: '>=',
            threshold: 1,
          },
        }),
      ),
    ).toThrowError(/Invalid badge.criteriaJson/)
  })

  it('throws when criteriaJson has an unknown metricKey', () => {
    expect(() =>
      badgeDefinitionFromRow(
        makeDefinitionRow({
          criteriaJson: {
            type: 'threshold',
            metricKey: 'not.a.metric',
            operator: '>=',
            threshold: 1,
          },
        }),
      ),
    ).toThrowError(/Invalid badge.criteriaJson/)
  })

  it('throws when targetScope is not a valid literal', () => {
    expect(() =>
      badgeDefinitionFromRow(makeDefinitionRow({ targetScope: 'team' })),
    ).toThrowError(/Invalid badge.targetScope/)
  })
})

describe('badgeAwardWithTargetFromRow — criteria narrowing', () => {
  function makeAwardRow(overrides: Partial<AwardRow> = {}): AwardRow {
    return {
      id: '00000000-0000-4000-8000-000000000002',
      badgeDefinitionId: '00000000-0000-4000-8000-000000000001',
      criteriaVersion: 1,
      targetType: 'portal',
      targetId: '00000000-0000-4000-8000-000000000010',
      organizationId: 'org-1',
      propertyId: '00000000-0000-4000-8000-000000000020',
      portalId: '00000000-0000-4000-8000-000000000010',
      portalGroupId: null,
      awardedAt: new Date('2026-06-15T12:00:00Z'),
      uniqueKey: '100_scans:1:portal:00000000-0000-4000-8000-000000000010',
      createdAt: new Date('2026-06-15T12:00:00Z'),
      ...overrides,
    } as unknown as AwardRow
  }

  it('maps a well-formed definition criteria on the joined row', () => {
    const row = badgeAwardWithTargetFromRow({
      award: makeAwardRow(),
      definitionKey: '100_scans',
      definitionName: '100 Scans',
      definitionIcon: 'scan',
      definitionDescription: null,
      definitionCriteria: VALID_CRITERIA,
      definitionTargetScope: 'portal',
      definitionCriteriaVersion: 1,
      definitionEnabled: true,
      definitionCreatedAt: new Date('2026-06-15T12:00:00Z'),
      definitionUpdatedAt: new Date('2026-06-15T12:00:00Z'),
      targetLabel: 'Main Portal',
    })
    expect(row.definition.criteria.threshold).toBe(100)
    expect(row.definition.targetScope).toBe('portal')
  })

  it('throws when the joined definition criteria is malformed', () => {
    expect(() =>
      badgeAwardWithTargetFromRow({
        award: makeAwardRow(),
        definitionKey: '100_scans',
        definitionName: '100 Scans',
        definitionIcon: 'scan',
        definitionDescription: null,
        definitionCriteria: { type: 'threshold' },
        definitionTargetScope: 'portal',
        definitionCriteriaVersion: 1,
        definitionEnabled: true,
        definitionCreatedAt: new Date('2026-06-15T12:00:00Z'),
        definitionUpdatedAt: new Date('2026-06-15T12:00:00Z'),
        targetLabel: null,
      }),
    ).toThrowError(/Invalid badge.criteriaJson/)
  })
})
