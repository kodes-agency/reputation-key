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
] as const

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
