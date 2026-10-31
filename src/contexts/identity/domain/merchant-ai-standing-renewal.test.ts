import { describe, expect, it } from 'vitest'
import {
  STANDING_RENEWAL_REASON,
  standingRenewalActor,
  standingRenewalKeepsSavedDrafts,
  standingRenewalKey,
  standingRenewalPropertySkip,
  standingRenewalTargetSkip,
} from './merchant-ai-standing-renewal'

const owners = [
  { userId: 'new', joinedAt: new Date('2026-10-01') },
  { userId: 'old', joinedAt: new Date('2026-09-01') },
]
const active = {
  deleted: false,
  lifecycleState: 'active',
  googleBindingState: 'active',
  sourceEpoch: 2,
  authorizedSourceEpoch: 2,
}

describe('standing renewal decisions', () => {
  it('leaves a newer worker’s notice alone during a rolling deployment', () => {
    expect(
      standingRenewalTargetSkip(
        'merchant-ai-notice-2026-11-01.v1',
        'merchant-ai-notice-2026-10-30.v1',
      ),
    ).toBe('newer_notice')
    expect(
      standingRenewalTargetSkip(
        'merchant-ai-notice-2026-09-15.v1',
        'merchant-ai-notice-2026-10-30.v1',
      ),
    ).toBeNull()
  })
  it('prefers the latest evidence actor only while they remain a live owner', () => {
    expect(standingRenewalActor('new', owners)).toBe('new')
    expect(standingRenewalActor('removed-or-demoted', owners)).toBe('old')
    expect(standingRenewalActor(null, owners)).toBe('old')
    expect(standingRenewalActor('new', [])).toBeNull()
  })
  it('breaks membership-tenure ties deterministically, regardless of query order', () => {
    const joinedAt = new Date('2026-01-01')
    expect(
      standingRenewalActor(null, [
        { userId: 'b', joinedAt },
        { userId: 'a', joinedAt },
      ]),
    ).toBe('a')
  })
  it('uses a bounded, deterministic key for exactly one Property and target notice pair', () => {
    const notice = { noticeVersion: 'notice-v2', noticeDigest: 'a'.repeat(64) }
    const key = standingRenewalKey('property-1', notice)
    expect(key).toBe(standingRenewalKey('property-1', notice))
    expect(key.length).toBeLessThanOrEqual(128)
    expect(key).not.toBe(standingRenewalKey('property-2', notice))
    expect(key).not.toBe(
      standingRenewalKey('property-1', { ...notice, noticeVersion: 'notice-v3' }),
    )
    expect(key).not.toBe(
      standingRenewalKey('property-1', { ...notice, noticeDigest: 'b'.repeat(64) }),
    )
  })
  it.each([
    [{ deleted: true }, 'property_not_manageable'],
    [{ lifecycleState: 'archived' }, 'property_not_manageable'],
    [{ googleBindingState: 'unbound' }, 'google_unbound'],
    [{ googleBindingState: 'inactive' }, 'google_unbound'],
    [{ sourceEpoch: 3 }, 'source_changed'],
  ])('skips ineligible current facts %j', (changes, reason) => {
    expect(standingRenewalPropertySkip({ ...active, ...changes })).toBe(reason)
  })
  it('admits a live bound Property without changing its source', () => {
    expect(standingRenewalPropertySkip(active)).toBeNull()
  })
})

describe('saved AI drafts across a renewal', () => {
  const previous = {
    capabilityEpochs: { review_analysis: 1, reply_drafting: 2, property_trends: 1 },
    capabilityRuntimeProfileVersions: { reply_drafting: 'reply-drafting-runtime-v1' },
    providerDeploymentProfileVersion: 'private-beta-global-v2' as const,
  }
  const unchanged = {
    capabilityEpochs: previous.capabilityEpochs,
    runtimeProfiles: previous.capabilityRuntimeProfileVersions,
    providerDeploymentProfileVersion: previous.providerDeploymentProfileVersion,
  }

  it('keeps them when a standing renewal moves no drafting input', () => {
    expect(
      standingRenewalKeepsSavedDrafts(STANDING_RENEWAL_REASON, previous, unchanged),
    ).toBe(true)
  })
  it('keeps them when only another capability’s epoch moves', () => {
    expect(
      standingRenewalKeepsSavedDrafts(STANDING_RENEWAL_REASON, previous, {
        ...unchanged,
        capabilityEpochs: { ...previous.capabilityEpochs, review_analysis: 2 },
      }),
    ).toBe(true)
  })
  it('keeps them when drafting is off before and after', () => {
    expect(
      standingRenewalKeepsSavedDrafts(
        STANDING_RENEWAL_REASON,
        { ...previous, capabilityRuntimeProfileVersions: {} },
        { ...unchanged, runtimeProfiles: {} },
      ),
    ).toBe(true)
  })
  it.each([
    ['a change a merchant made', 'merchant_enabled', previous, unchanged],
    ['the first grant', STANDING_RENEWAL_REASON, null, unchanged],
    [
      'a moved drafting epoch',
      STANDING_RENEWAL_REASON,
      previous,
      {
        ...unchanged,
        capabilityEpochs: { ...previous.capabilityEpochs, reply_drafting: 3 },
      },
    ],
    [
      'another drafting runtime',
      STANDING_RENEWAL_REASON,
      previous,
      { ...unchanged, runtimeProfiles: { reply_drafting: 'reply-drafting-runtime-v2' } },
    ],
    [
      'another provider deployment',
      STANDING_RENEWAL_REASON,
      previous,
      { ...unchanged, providerDeploymentProfileVersion: 'private-beta-global-v1' },
    ],
  ])('withdraws them for %s', (_name, reasonCode, before, after) => {
    expect(standingRenewalKeepsSavedDrafts(reasonCode, before, after)).toBe(false)
  })
})
