import { describe, expect, it } from 'vitest'
import {
  AI_ADVISORY_LOCK_SEED_V1,
  AI_ROW_LOCK_RANKS,
  assertAiRowLockOrder,
  createAiAdvisoryScope,
  encodeAiAdvisoryScopeKeyInput,
  sortAndDedupeAiAdvisoryKeys,
} from './ai-lock-order-v1'

const ORG = '00000000-0000-4000-8000-000000000001'
const PROPERTY = '00000000-0000-4000-8000-000000000002'
const RUN = '00000000-0000-4000-8000-000000000003'
const NATIVE_ORG = 'better-auth-org_01'

describe('ai-lock-order-v1', () => {
  it('pins the PostgreSQL seed and canonical PR2S advisory scopes', () => {
    expect(AI_ADVISORY_LOCK_SEED_V1).toBe(5_928_232_768_719_372_617n)
    expect(createAiAdvisoryScope('provider-source', [ORG, PROPERTY, 7])).toBe(
      `provider-source|${ORG}|${PROPERTY}|7`,
    )
    expect(createAiAdvisoryScope('provider-snapshot', [RUN])).toBe(
      `provider-snapshot|${RUN}`,
    )
    expect(
      encodeAiAdvisoryScopeKeyInput(
        createAiAdvisoryScope('provider-source', [ORG, PROPERTY, 7]),
      ),
    ).toBe(`ai-admission-scope-v1|91:provider-source|${ORG}|${PROPERTY}|7`)
  })

  it('accepts native organization identifiers for review advisory scopes', () => {
    expect(createAiAdvisoryScope('provider-source', [NATIVE_ORG, PROPERTY, 8])).toBe(
      `provider-source|${NATIVE_ORG}|${PROPERTY}|8`,
    )
    expect(createAiAdvisoryScope('property-event', [NATIVE_ORG, PROPERTY, 8, 3])).toBe(
      `property-event|${NATIVE_ORG}|${PROPERTY}|8|3`,
    )
  })

  it('sorts signed bigint keys and deduplicates hash collisions', () => {
    expect(sortAndDedupeAiAdvisoryKeys([9n, -2n, 9n, 0n, -9n])).toEqual([
      -9n,
      -2n,
      0n,
      9n,
    ])
  })

  it('accepts the complete PR2S mutable-row subsequence', () => {
    expect(() =>
      assertAiRowLockOrder([
        { rank: AI_ROW_LOCK_RANKS.propertySource, primaryKey: PROPERTY },
        { rank: AI_ROW_LOCK_RANKS.providerSubjectKeyVersion, primaryKey: '00000001' },
        { rank: AI_ROW_LOCK_RANKS.providerSnapshotRun, primaryKey: RUN },
        { rank: AI_ROW_LOCK_RANKS.providerSubject, primaryKey: 'locator-a' },
        {
          rank: AI_ROW_LOCK_RANKS.providerDeletionCandidateOrMember,
          primaryKey: 'candidate-a',
        },
        { rank: AI_ROW_LOCK_RANKS.reviewSourceHeadOrRow, primaryKey: 'head-a' },
        { rank: AI_ROW_LOCK_RANKS.reviewSourceHeadOrRow, primaryKey: 'review-a' },
      ]),
    ).not.toThrow()
  })

  it('rejects late, inverse, duplicate, and noncanonical acquisition', () => {
    expect(() =>
      assertAiRowLockOrder([
        { rank: AI_ROW_LOCK_RANKS.reviewSourceHeadOrRow, primaryKey: 'review-a' },
        { rank: AI_ROW_LOCK_RANKS.propertySource, primaryKey: PROPERTY },
      ]),
    ).toThrow(/descending/)
    expect(() =>
      assertAiRowLockOrder([
        { rank: AI_ROW_LOCK_RANKS.providerSubject, primaryKey: 'b' },
        { rank: AI_ROW_LOCK_RANKS.providerSubject, primaryKey: 'a' },
      ]),
    ).toThrow(/descending/)
    expect(() =>
      assertAiRowLockOrder([
        { rank: AI_ROW_LOCK_RANKS.providerSubject, primaryKey: 'a' },
        { rank: AI_ROW_LOCK_RANKS.providerSubject, primaryKey: 'a' },
      ]),
    ).toThrow(/duplicate/)
    expect(() => createAiAdvisoryScope('provider-source', [ORG, PROPERTY, '01'])).toThrow(
      /epoch/,
    )
    expect(() =>
      createAiAdvisoryScope('provider-source', [
        ORG,
        PROPERTY,
        Number.MAX_SAFE_INTEGER + 1,
      ]),
    ).toThrow(/epoch/)
    expect(() =>
      createAiAdvisoryScope('provider-source', [
        'ABCDEFAB-0000-4000-8000-000000000001',
        PROPERTY,
        1,
      ]),
    ).toThrow(/organization identifier/)
    expect(() =>
      createAiAdvisoryScope('property-event', ['unsafe|organization', PROPERTY, 1, 1]),
    ).toThrow(/organization identifier/)
  })
})
