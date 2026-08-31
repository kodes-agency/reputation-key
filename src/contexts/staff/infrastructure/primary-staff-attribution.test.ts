import { describe, expect, it } from 'vitest'
import {
  PrimaryStaffAttributionCorruptionError,
  decidePrimaryStaffAttribution,
} from './primary-staff-attribution'

const OBSERVED_AT = new Date('2026-08-27T12:00:00.000Z')

const row = (overrides: Record<string, unknown> = {}) => ({
  portalResponsibilityId: 'aa000000-0000-4000-8000-000000000001',
  organizationId: 'org-a',
  propertyId: 'aa000000-0000-4000-8000-000000000002',
  portalId: 'aa000000-0000-4000-8000-000000000003',
  staffParticipationId: 'aa000000-0000-4000-8000-000000000004',
  staffParticipantId: 'aa000000-0000-4000-8000-000000000005',
  responsibilityEffectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  responsibilityEffectiveTo: null,
  participationStartedAt: new Date('2026-07-01T00:00:00.000Z'),
  participationEndedAt: null,
  participantCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
  participantArchivedAt: null,
  retainedPortalId: 'aa000000-0000-4000-8000-000000000003',
  ...overrides,
})

describe('primary Staff attribution decision', () => {
  it('returns none when no primary interval contains the observation', () => {
    expect(decidePrimaryStaffAttribution([], OBSERVED_AT)).toBeNull()
  })

  it('returns the one identifier-only responsibility interval', () => {
    expect(decidePrimaryStaffAttribution([row()], OBSERVED_AT)).toEqual({
      staffParticipantId: 'aa000000-0000-4000-8000-000000000005',
      staffParticipationId: 'aa000000-0000-4000-8000-000000000004',
      portalResponsibilityId: 'aa000000-0000-4000-8000-000000000001',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: null,
    })
  })

  it('fails closed when retained primary intervals overlap', () => {
    expect(() =>
      decidePrimaryStaffAttribution(
        [
          row(),
          row({
            portalResponsibilityId: 'aa000000-0000-4000-8000-000000000006',
            staffParticipationId: 'aa000000-0000-4000-8000-000000000007',
            staffParticipantId: 'aa000000-0000-4000-8000-000000000008',
          }),
        ],
        OBSERVED_AT,
      ),
    ).toThrow(PrimaryStaffAttributionCorruptionError)
  })

  it('fails closed when the responsibility outlives its participation', () => {
    expect(() =>
      decidePrimaryStaffAttribution(
        [row({ participationEndedAt: new Date('2026-08-20T00:00:00.000Z') })],
        OBSERVED_AT,
      ),
    ).toThrow(PrimaryStaffAttributionCorruptionError)
  })
})
