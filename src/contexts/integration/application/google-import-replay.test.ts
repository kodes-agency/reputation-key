import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  canonicalizeGoogleImportSemanticRequest,
  canonicalizeGoogleImportRetryRequest,
  canonicalizeGoogleImportWireRequest,
  createGoogleImportReplayDigests,
} from './google-import-replay'

const keys = createVersionedHmacKeyring(`v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`)

const wire = (candidateRef: string, name: string) => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  confirmation: 'apply' as const,
  items: [
    {
      candidateRef,
      action: 'create' as const,
      profile: {
        name,
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        confirmed: true as const,
      },
    },
  ],
})

const semantic = (locationId: string, name: string) => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  items: [
    {
      action: 'create' as const,
      connectionId: '00000000-0000-4000-8000-000000000002',
      accountId: 'account-1',
      locationId,
      existingPropertyId: null,
      expectedConnectionLifecycleVersion: 3,
      expectedConnectionAccessVersion: 4,
      expectedCredentialGeneration: 5,
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      profile: {
        name,
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        updateExistingProfile: true,
      },
    },
  ],
})

describe('Google import replay encoding', () => {
  it('is order-independent for item sets while preserving every wire field', () => {
    const first = wire(`v1.${'A'.repeat(43)}`, 'Alpha')
    const second = wire(`v1.${'B'.repeat(43)}`, 'Beta')
    const forward = { ...first, items: [first.items[0]!, second.items[0]!] }
    const reverse = { ...first, items: [second.items[0]!, first.items[0]!] }

    expect(canonicalizeGoogleImportWireRequest(forward)).toBe(
      canonicalizeGoogleImportWireRequest(reverse),
    )
    expect(canonicalizeGoogleImportWireRequest(forward)).not.toBe(
      canonicalizeGoogleImportWireRequest({
        ...forward,
        confirmation: 'preview' as never,
      }),
    )
  })

  it('separates wire identity from semantic identity', () => {
    const firstWire = wire(`v1.${'A'.repeat(43)}`, 'Alpha')
    const nextWire = wire(`v2.${'B'.repeat(43)}`, 'Alpha')
    const firstSemantic = semantic('location-1', 'Alpha')

    expect(canonicalizeGoogleImportWireRequest(firstWire)).not.toBe(
      canonicalizeGoogleImportWireRequest(nextWire),
    )
    expect(canonicalizeGoogleImportSemanticRequest(firstSemantic)).toBe(
      canonicalizeGoogleImportSemanticRequest({
        ...firstSemantic,
        items: [...firstSemantic.items],
      }),
    )
  })

  it('uses frozen length prefixes rather than delimiter-ambiguous concatenation', () => {
    const left = semantic('location\u0000one', 'two')
    const right = semantic('location', 'one\u0000two')
    expect(canonicalizeGoogleImportSemanticRequest(left)).not.toBe(
      canonicalizeGoogleImportSemanticRequest(right),
    )
  })

  it('domain-separates tenant, user, request, and digest kind', () => {
    const replay = createGoogleImportReplayDigests(keys)
    const input = wire(`v1.${'A'.repeat(43)}`, 'Alpha')
    const scope = {
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: input.requestId,
    }
    const first = replay.signWire(scope, input)

    expect(first.keyVersion).toBe('v2')
    expect(first.digest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(replay.verifyWire(scope, input, first)).toBe(true)
    expect(replay.verifyWire({ ...scope, organizationId: 'org-2' }, input, first)).toBe(
      false,
    )
    expect(replay.verifyWire({ ...scope, userId: 'user-2' }, input, first)).toBe(false)
    expect(replay.verifySemantic(scope, semantic('location-1', 'Alpha'), first)).toBe(
      false,
    )
  })

  it('domain-separates normalized retry requests and optimistic revisions', () => {
    const replay = createGoogleImportReplayDigests(keys)
    const input = {
      itemId: '00000000-0000-4000-8000-000000000003',
      retryRequestId: '00000000-0000-4000-8000-000000000004',
      expectedRetryRevision: 2,
    }
    const scope = {
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: input.retryRequestId,
    }
    const stored = replay.signRetry(scope, input)

    expect(canonicalizeGoogleImportRetryRequest(input)).not.toBe(
      canonicalizeGoogleImportRetryRequest({
        ...input,
        expectedRetryRevision: 3,
      }),
    )
    expect(replay.verifyRetry(scope, input, stored)).toBe(true)
    expect(
      replay.verifyRetry(
        scope,
        { ...input, retryRequestId: '00000000-0000-4000-8000-000000000005' },
        stored,
      ),
    ).toBe(false)
  })

  it('verifies retained stored versions and fails closed for missing versions', () => {
    const oldOnly = createGoogleImportReplayDigests(
      createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
    )
    const rotated = createGoogleImportReplayDigests(keys)
    const input = wire(`v1.${'A'.repeat(43)}`, 'Alpha')
    const scope = {
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: input.requestId,
    }
    const stored = oldOnly.signWire(scope, input)

    expect(rotated.verifyWire(scope, input, stored)).toBe(true)
    expect(rotated.verifyWire(scope, input, { ...stored, keyVersion: 'missing' })).toBe(
      false,
    )
  })
})
