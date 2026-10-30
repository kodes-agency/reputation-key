import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { guestVoiceScopes } from './guest-voice-v2-scopes'
import { POPULATION_QUERY_LIMIT } from './guest-voice-v2-population'

const INPUT = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
} as const

const GATE = {
  status: 'enabled',
  authorization: {
    authorizedSourceEpoch: 4,
    capabilityEpochs: { review_analysis: { epoch: 7 } },
  },
  profile: { profileVersion: 2, timezone: 'America/New_York' },
} as never

describe('guestVoiceScopes', () => {
  it('asks the analysis under the Property’s current epochs and profile', () => {
    expect(guestVoiceScopes(INPUT, GATE, '2026-10-30').facts).toEqual({
      organizationId: INPUT.organizationId,
      propertyId: INPUT.propertyId,
      sourceEpoch: 4,
      reviewAnalysisEpoch: 7,
      propertyProfileVersion: 2,
    })
  })

  it('asks Review for the same source epoch, in the Property’s own days', () => {
    expect(guestVoiceScopes(INPUT, GATE, '2026-10-30').population).toEqual({
      organizationId: INPUT.organizationId,
      propertyId: INPUT.propertyId,
      sourceEpoch: 4,
      timezone: 'America/New_York',
      calendarProfileVersion: 'property-calendar-v1',
      endLocalDate: '2026-10-30',
      limit: POPULATION_QUERY_LIMIT,
    })
  })
})
