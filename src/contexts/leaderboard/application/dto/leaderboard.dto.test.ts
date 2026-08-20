import { describe, expect, it } from 'vitest'
import { activateRecognitionSchema, getRecognitionBoardSchema } from './leaderboard.dto'

const propertyId = '11111111-1111-4111-8111-111111111111'
const metricDefinitionVersionId = '22222222-2222-4222-8222-222222222222'
const portalGroupId = '33333333-3333-4333-8333-333333333333'

describe('recognition server DTOs', () => {
  it.each([
    { metricKey: 'portal.rating' },
    { metricKey: 'portal.feedback' },
    { metricKey: 'portal.scan' },
    { metricKey: 'portal.review_link_click' },
    { scope: 'individual' },
  ])('rejects caller-controlled ranking input $metricKey$scope', (extra) => {
    expect(getRecognitionBoardSchema.safeParse({ propertyId, ...extra }).success).toBe(
      false,
    )
  })

  it('accepts only a property and optional portal-group filter for board reads', () => {
    expect(getRecognitionBoardSchema.parse({ propertyId, portalGroupId })).toEqual({
      propertyId,
      portalGroupId,
    })
  })

  it('requires a governed metric version, group selection, and positive thresholds', () => {
    const result = activateRecognitionSchema.safeParse({
      propertyId,
      policyVersion: 'beta-local-1',
      jurisdiction: 'US-CA',
      noticeStatus: 'completed',
      consultationStatus: 'not_required',
      audience: 'property_managers_and_scoped_staff',
      selectedPortalGroupIds: [portalGroupId],
      metricDefinitionVersionId,
      aggregation: 'ratio',
      periodKind: 'monthly',
      minimumExposure: 5,
      minimumSample: 5,
      freshnessSeconds: 3_600,
      minimumCompleteness: 0.9,
    })
    expect(result.success).toBe(true)
  })
})
