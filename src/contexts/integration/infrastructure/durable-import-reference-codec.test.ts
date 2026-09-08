// The durable codec must encode EVERY eligibility the classifier can produce.
//
// One candidate that fails `durableCandidatePayloadSchema` returns null from
// `buildCandidateEntry`, which nulls the whole page, which the publisher reports
// as `capacity_exceeded`, which the discovery use case maps to
// `temporarily_unavailable` — "Google Business Profile is temporarily
// unavailable" over a page Google served correctly. That is what a missing
// `verification_required` arm did to every Google account holding one
// unverified location, and no stub fixture could reproduce it because the
// sandbox reports Voice of Merchant on every location.
//
// The map below is keyed by the contract's own union, so adding a kind without
// teaching the codec fails to compile rather than failing in a merchant's
// browser.

import { describe, expect, it } from 'vitest'
import type { ImportCandidateEligibility } from '../application/google-import-v2-contract'
import { durableCandidatePayloadSchema } from './durable-import-reference-codec'

const ELIGIBILITY_SAMPLES: Readonly<
  Record<ImportCandidateEligibility['kind'], ImportCandidateEligibility>
> = {
  create: { kind: 'create' },
  relink: {
    kind: 'relink',
    propertyId: '11111111-1111-4111-8111-111111111111' as never,
    profile: {
      name: 'Seaside Inn',
      address: '1 Harbour Road',
      countryCode: 'BG',
      timezone: 'Europe/Sofia',
      profileVersion: 1,
    },
  },
  already_imported: {
    kind: 'already_imported',
    propertyId: '22222222-2222-4222-8222-222222222222' as never,
  },
  active_binding_conflict: { kind: 'active_binding_conflict' },
  verification_required: { kind: 'verification_required' },
  unavailable: { kind: 'unavailable' },
}

function payload(eligibility: ImportCandidateEligibility) {
  return {
    candidateId: 'AAAAAAAAAAAAAAAAAAAAAA',
    accountRef: 'v1.account-ref',
    accountId: '117637856120281336154',
    locationId: '13267145198765432100',
    accountDisplayName: 'Kodes Agency Clients',
    businessName: 'А+ чуждоезикова школа',
    address: 'ул. Пример 1, Пловдив',
    primaryCategory: 'Language school',
    countryCode: 'BG',
    googleReviewUri: null,
    eligibility,
    expectedSourceEpoch: null,
    expectedProfileVersion: null,
    affectedPropertyId: null,
  }
}

describe('durable candidate payload codec', () => {
  it.each(Object.keys(ELIGIBILITY_SAMPLES) as ImportCandidateEligibility['kind'][])(
    'encodes a candidate whose eligibility is %s',
    (kind) => {
      const result = durableCandidatePayloadSchema.safeParse(
        payload(ELIGIBILITY_SAMPLES[kind]),
      )

      expect(result.success).toBe(true)
    },
  )

  it('refuses an eligibility the contract does not define', () => {
    expect(
      durableCandidatePayloadSchema.safeParse(
        payload({ kind: 'not_a_kind' } as unknown as ImportCandidateEligibility),
      ).success,
    ).toBe(false)
  })
})
