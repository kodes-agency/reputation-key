import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { idempotencyReceipts } from '#/shared/db/schema'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createTokenEncryptionAdapter } from '../adapters/token-encryption.adapter'
import { createGoogleOAuthExchangeRecoveryRepository } from './google-oauth-exchange-recovery.repository'

const NOW = new Date('2026-08-28T05:00:00.000Z')
const ORGANIZATION_ID = 'safe04-oauth-recovery-org'
const USER_ID = 'safe04-oauth-recovery-user'
const IDS = [
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000004',
  '64000000-0000-4000-8000-000000000005',
  '64000000-0000-4000-8000-000000000006',
  '64000000-0000-4000-8000-000000000007',
  '64000000-0000-4000-8000-000000000008',
] as const

const RESPONSE_TTL_MS = 10 * 60_000
const APPLY_LEASE_MS = 30_000

const facts = (id: string) => ({
  id,
  organizationId: ORGANIZATION_ID,
  initiatorUserId: USER_ID,
  connectionId: id.replace(/^64/u, '65'),
  connectionMode: 'new' as const,
  targetConnectionId: null,
  expectedLifecycleVersion: 0,
  expectedAccessVersion: 0,
  expectedCredentialGeneration: 0,
})

describe('PostgreSQL Google OAuth exchange recovery repository', () => {
  let lease: TestLease
  const db = getDb()
  const store = createGoogleOAuthExchangeRecoveryRepository(db)

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await db
      .delete(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${ORGANIZATION_ID}`,
        ),
      )
  })

  beforeEach(async () => {
    await db
      .delete(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${ORGANIZATION_ID}`,
        ),
      )
  })

  afterAll(async () => {
    await db
      .delete(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${ORGANIZATION_ID}`,
        ),
      )
    await lease?.release()
  })

  it('starts the one-use provider exchange exactly once and claims one preserved response at a time', async () => {
    const attempt = facts(IDS[0])
    await expect(store.begin({ ...attempt, now: NOW })).resolves.toMatchObject({
      ok: true,
    })

    const starts = await Promise.all([
      store.markProviderStarted({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: NOW,
      }),
      store.markProviderStarted({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: NOW,
      }),
    ])
    expect(starts.filter((result) => result.ok)).toHaveLength(1)
    expect(starts.filter((result) => !result.ok).map((result) => result.code)).toEqual([
      'already_started',
    ])

    const plaintext = JSON.stringify({
      accessToken: 'provider-access-plaintext',
      refreshToken: 'provider-refresh-plaintext',
      idToken: 'provider-id-plaintext',
    })
    const encryption = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: '11'.repeat(32) },
    })
    const encryptedResult = encryption.encrypt(plaintext)
    await expect(
      store.preserveSuccessfulResult({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        encryptedResult,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ ok: true })

    const [persisted] = await db
      .select({ payload: idempotencyReceipts.payload })
      .from(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          eq(idempotencyReceipts.key, attempt.id),
        ),
      )
      .limit(1)
    expect(persisted?.payload).toMatchObject({ encryptedResult })
    expect(JSON.stringify(persisted?.payload)).not.toContain('provider-access-plaintext')
    expect(JSON.stringify(persisted?.payload)).not.toContain('provider-refresh-plaintext')
    const claims = await Promise.all([
      store.claimPreservedResult({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: new Date(NOW.getTime() + 2_000),
      }),
      store.claimPreservedResult({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ])
    expect(claims.filter((result) => result.ok)).toHaveLength(1)
    expect(claims.filter((result) => !result.ok).map((result) => result.code)).toEqual([
      'in_progress',
    ])
  })

  it('reclaims an elapsed apply lease but never a live lease', async () => {
    const attempt = facts(IDS[1])
    await store.begin({ ...attempt, now: NOW })
    await store.markProviderStarted({
      id: attempt.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      now: NOW,
    })
    await store.preserveSuccessfulResult({
      id: attempt.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      encryptedResult: 'ciphertext-only',
      now: NOW,
    })
    await expect(
      store.claimPreservedResult({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      store.claimPreservedResult({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
        now: new Date(NOW.getTime() + 30_001),
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('terminalizes an unpreserved provider start as ambiguous and erases expired ciphertext', async () => {
    const ambiguous = facts(IDS[2])
    await store.begin({ ...ambiguous, now: NOW })
    await store.markProviderStarted({
      id: ambiguous.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      now: NOW,
    })
    await expect(
      store.expire({ now: new Date(NOW.getTime() + 10 * 60_000 + 1), limit: 100 }),
    ).resolves.toEqual({ expired: 1 })
    const [row] = await db
      .select({ payload: idempotencyReceipts.payload })
      .from(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          eq(idempotencyReceipts.key, ambiguous.id),
        ),
      )
      .limit(1)
    expect(row?.payload).toMatchObject({
      state: 'provider_outcome_ambiguous',
      encryptedResult: null,
      responseExpiresAt: null,
      applyLeaseExpiresAt: null,
    })
  })

  const scope = { organizationId: ORGANIZATION_ID, initiatorUserId: USER_ID }
  const readPayload = async (id: string) => {
    const [row] = await db
      .select({ payload: idempotencyReceipts.payload })
      .from(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          eq(idempotencyReceipts.key, id),
        ),
      )
      .limit(1)
    return row?.payload
  }
  const preserve = async (id: string, at: Date = NOW) => {
    await store.begin({ ...facts(id), now: at })
    await store.markProviderStarted({ id, ...scope, now: at })
    await store.preserveSuccessfulResult({
      id,
      ...scope,
      encryptedResult: 'ciphertext-only',
      now: at,
    })
  }

  it('claims a preserved response until the instant before its expiry and erases it at expiry', async () => {
    const attempt = facts(IDS[4])
    await preserve(attempt.id)

    await expect(
      store.claimPreservedResult({
        id: attempt.id,
        ...scope,
        now: new Date(NOW.getTime() + RESPONSE_TTL_MS - 1),
      }),
    ).resolves.toMatchObject({ ok: true })

    const expired = facts(IDS[5])
    await preserve(expired.id)
    await expect(
      store.claimPreservedResult({
        id: expired.id,
        ...scope,
        now: new Date(NOW.getTime() + RESPONSE_TTL_MS),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'expired' })
    await expect(readPayload(expired.id)).resolves.toMatchObject({
      state: 'expired',
      encryptedResult: null,
      responseExpiresAt: null,
      applyLeaseExpiresAt: null,
      outcomeCode: 'response_expired',
    })
    await expect(
      store.claimPreservedResult({
        id: expired.id,
        ...scope,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'expired' })
  })

  it('never lets an apply lease outlive the preserved response', async () => {
    const attempt = facts(IDS[6])
    await preserve(attempt.id)
    const claimedAt = new Date(NOW.getTime() + RESPONSE_TTL_MS - 5_000)

    await expect(
      store.claimPreservedResult({ id: attempt.id, ...scope, now: claimedAt }),
    ).resolves.toMatchObject({ ok: true })

    const payload = (await readPayload(attempt.id)) as {
      applyLeaseExpiresAt: string
      responseExpiresAt: string
    }
    expect(payload.applyLeaseExpiresAt).toBe(payload.responseExpiresAt)
    expect(APPLY_LEASE_MS).toBeGreaterThan(5_000)
    await expect(
      store.releaseClaim({
        id: attempt.id,
        ...scope,
        outcomeCode: 'apply_retry',
        now: new Date(NOW.getTime() + RESPONSE_TTL_MS),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_transition' })
  })

  it('refuses a foreign organization or user without touching the preserved response', async () => {
    const attempt = facts(IDS[7])
    await preserve(attempt.id)
    const foreign = [
      { organizationId: 'safe04-oauth-recovery-other-org', initiatorUserId: USER_ID },
      { organizationId: ORGANIZATION_ID, initiatorUserId: 'safe04-other-user' },
    ]

    for (const who of foreign) {
      await expect(
        store.claimPreservedResult({ id: attempt.id, ...who, now: NOW }),
      ).resolves.toMatchObject({ ok: false, code: 'scope_mismatch' })
      await expect(
        store.discardClaim({ id: attempt.id, ...who, outcomeCode: 'x', now: NOW }),
      ).resolves.toMatchObject({ ok: false })
    }
    await expect(readPayload(attempt.id)).resolves.toMatchObject({
      state: 'response_preserved',
      encryptedResult: 'ciphertext-only',
    })
    await expect(
      store.claimPreservedResult({ id: attempt.id, ...scope, now: NOW }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('sweeps an unclaimed preserved response only after its expiry', async () => {
    const attempt = facts(IDS[3])
    await preserve(attempt.id)

    await expect(
      store.expire({ now: new Date(NOW.getTime() + RESPONSE_TTL_MS - 1), limit: 100 }),
    ).resolves.toEqual({ expired: 0 })
    await expect(readPayload(attempt.id)).resolves.toMatchObject({
      state: 'response_preserved',
      encryptedResult: 'ciphertext-only',
    })

    await expect(
      store.expire({ now: new Date(NOW.getTime() + RESPONSE_TTL_MS + 1), limit: 100 }),
    ).resolves.toEqual({ expired: 1 })
    await expect(readPayload(attempt.id)).resolves.toMatchObject({
      encryptedResult: null,
      responseExpiresAt: null,
    })
  })

  it('loads only the exact scoped, content-free completed attempt for callback replay', async () => {
    const attempt = facts(IDS[3])
    await store.begin({ ...attempt, now: NOW })
    await store.markProviderStarted({
      id: attempt.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      now: NOW,
    })
    await store.preserveSuccessfulResult({
      id: attempt.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      encryptedResult: 'ciphertext-only',
      now: NOW,
    })
    await store.claimPreservedResult({
      id: attempt.id,
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      now: NOW,
    })
    await db
      .update(idempotencyReceipts)
      .set({
        payload: sql`${idempotencyReceipts.payload} || jsonb_build_object(
          'state', 'completed',
          'encryptedResult', NULL,
          'responseExpiresAt', NULL,
          'applyLeaseExpiresAt', NULL,
          'terminalAt', ${NOW.toISOString()}::timestamptz,
          'outcomeCode', 'connection_committed',
          'updatedAt', ${NOW.toISOString()}::timestamptz
        )`,
      })
      .where(
        and(
          eq(idempotencyReceipts.scope, 'google_oauth_exchange'),
          eq(idempotencyReceipts.key, attempt.id),
        ),
      )

    await expect(
      store.loadCompletedAttempt({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: USER_ID,
      }),
    ).resolves.toEqual(attempt)
    await expect(
      store.loadCompletedAttempt({
        id: attempt.id,
        organizationId: ORGANIZATION_ID,
        initiatorUserId: 'different-user',
      }),
    ).resolves.toBeNull()
  })
})
