import { describe, expect, it } from 'vitest'
import { appendAwardFact, reconcileAwardCorrection } from './governed-award'

const awardedAt = new Date('2026-08-09T10:00:00.000Z')

function award() {
  return appendAwardFact({
    id: 'award-1',
    organizationId: 'org-1',
    propertyId: 'property-1',
    portalGroupId: 'group-1',
    definitionVersionId: 'badge-version-1',
    metricDefinitionVersionId: 'metric-version-1',
    sourceSnapshotId: 'snapshot-1',
    sourceWatermark: awardedAt,
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    timezone: 'America/Los_Angeles',
    sampleCount: 10,
    exposureCount: 10,
    completeness: 1,
    eligibilityReason: 'eligible',
    definitionSnapshot: {
      name: 'Configuration complete',
      icon: 'award',
      criteria: 'At least 90 percent complete',
      rule: 'latest >= 90',
      metricVersion: 'metric-version-1',
    },
    sourceFactId: 'fact-1',
    awardedAt,
  })
}

describe('governed group awards', () => {
  it('snapshots positive portal-group evidence without an individual recipient', () => {
    const result = award()
    expect(result).toMatchObject({
      portalGroupId: 'group-1',
      status: 'active',
      employmentDecisionEligible: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/user|staff|employee|recipient/i)
  })

  it('appends an invalidation fact for a correction instead of deleting the award', () => {
    const original = award()
    const correction = reconcileAwardCorrection(original, {
      correctionReference: 'correction-1',
      reason: 'Corrected reading is below the badge threshold',
      occurredAt: new Date('2026-08-09T11:00:00.000Z'),
    })
    expect(original.status).toBe('active')
    expect(correction).toMatchObject({
      awardId: 'award-1',
      status: 'invalidated',
      correctionReference: 'correction-1',
    })
  })

  it('is idempotent for the same correction reference', () => {
    const original = award()
    const first = reconcileAwardCorrection(original, {
      correctionReference: 'correction-1',
      reason: 'Corrected reading is below the badge threshold',
      occurredAt: new Date('2026-08-09T11:00:00.000Z'),
    })
    expect(
      reconcileAwardCorrection(original, {
        correctionReference: first.correctionReference,
        reason: first.reason,
        occurredAt: first.occurredAt,
      }),
    ).toEqual(first)
  })
})
