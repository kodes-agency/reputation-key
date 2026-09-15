// Dispatch evidence against real PostgreSQL. The adapter answers one question —
// could any request for this exact reply/cycle/attempt have reached Google? —
// from `authorization_execution_permits`, the row the egress gateway must start
// before it may call fetch.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, replyId, type OrganizationId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { REPLY_DISPATCH_EVIDENCE_WINDOW_MS } from '../application/ports/reply-publication-dispatch-evidence.port'
import { createReplyPublicationDispatchEvidence } from './reply-publication-dispatch-evidence'

const ORG = organizationId('org-rpl-dispatch-evidence-a')
const OTHER_ORG = organizationId('org-rpl-dispatch-evidence-b')
const REPLY = replyId('a7000000-0000-4000-8000-000000000020')
const CYCLE = 2
const ATTEMPT = 1
const NOW = new Date('2026-09-14T12:00:00.000Z')
const OLD_ATTEMPT_START = new Date(NOW.getTime() - REPLY_DISPATCH_EVIDENCE_WINDOW_MS)

type PermitState = 'admitted' | 'started' | 'completed' | 'fenced'

let lease: TestLease
let pool: Pool

async function insertReplyPermit(
  input: Readonly<{
    organization?: OrganizationId
    state?: PermitState
    routeKey?: string
    vector?: Readonly<Record<string, unknown>>
  }> = {},
): Promise<void> {
  const state = input.state ?? 'completed'
  const admittedAt = new Date(OLD_ATTEMPT_START.getTime() + 1_000)
  const startedAt = state === 'admitted' || state === 'fenced' ? null : admittedAt
  await pool.query(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, property_id, connection_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at, started_at,
       operation_deadline_at, completed_at, fenced_at
     ) VALUES (
       $1, 'property.publish_reply', $2, $3, $4, 'reviews.reply', $5, 'test-v1',
       'test-quota', $6::jsonb, $7, $8, $9, $10, $11, $12, $13
     )`,
    [
      randomUUID(),
      input.organization ?? ORG,
      randomUUID(),
      randomUUID(),
      input.routeKey ?? 'reviews.reply',
      JSON.stringify({
        principalKind: 'system',
        replyId: REPLY,
        publicationCycle: CYCLE,
        publicationAttemptNumber: ATTEMPT,
        ...input.vector,
      }),
      state,
      admittedAt,
      new Date(admittedAt.getTime() + 10_000),
      startedAt,
      startedAt === null ? null : new Date(admittedAt.getTime() + 30_000),
      state === 'completed' ? new Date(admittedAt.getTime() + 2_000) : null,
      state === 'fenced' ? new Date(admittedAt.getTime() + 11_000) : null,
    ],
  )
}

const evidenceFor = (
  overrides: Partial<{ attemptStartedAt: Date; organizationId: OrganizationId }> = {},
) =>
  createReplyPublicationDispatchEvidence(getDb()).findDispatchEvidence({
    organizationId: overrides.organizationId ?? ORG,
    replyId: REPLY,
    publicationCycle: CYCLE,
    attemptNumber: ATTEMPT,
    attemptStartedAt: overrides.attemptStartedAt ?? OLD_ATTEMPT_START,
    now: NOW,
  })

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  pool = lease.pool
})

beforeEach(async () => {
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = ANY($1)',
    [[ORG, OTHER_ORG]],
  )
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = ANY($1)',
    [[ORG, OTHER_ORG]],
  )
  await lease.release()
})

describe('reply publication dispatch evidence (PostgreSQL)', () => {
  it('reports never_dispatched when an old attempt has no reviews.reply permit', async () => {
    await expect(evidenceFor()).resolves.toBe('never_dispatched')
  })

  it.each<PermitState>(['admitted', 'started', 'completed', 'fenced'])(
    'reports possibly_dispatched when a %s permit exists for the exact attempt',
    async (state) => {
      await insertReplyPermit({ state })

      await expect(evidenceFor()).resolves.toBe('possibly_dispatched')
    },
  )

  it('ignores a permit for another attempt number or another cycle of the same reply', async () => {
    await insertReplyPermit({ vector: { publicationAttemptNumber: ATTEMPT + 1 } })
    await insertReplyPermit({ vector: { publicationCycle: CYCLE - 1 } })

    await expect(evidenceFor()).resolves.toBe('never_dispatched')
  })

  it('ignores a permit that is not a reviews.reply request', async () => {
    await insertReplyPermit({ routeKey: 'reviews.get' })

    await expect(evidenceFor()).resolves.toBe('never_dispatched')
  })

  it("ignores another tenant's permit", async () => {
    await insertReplyPermit({ organization: OTHER_ORG })

    await expect(evidenceFor()).resolves.toBe('never_dispatched')
    await expect(evidenceFor({ organizationId: OTHER_ORG })).resolves.toBe(
      'possibly_dispatched',
    )
  })

  it('reports too_recent inside the window, before any permit lookup can decide', async () => {
    const youngStart = new Date(NOW.getTime() - REPLY_DISPATCH_EVIDENCE_WINDOW_MS + 1)

    await expect(evidenceFor({ attemptStartedAt: youngStart })).resolves.toBe(
      'too_recent',
    )
    await insertReplyPermit({ state: 'started' })
    await expect(evidenceFor({ attemptStartedAt: youngStart })).resolves.toBe(
      'too_recent',
    )
  })

  // A restore can drop a permit written after the restore point for an attempt
  // that was already `sending` then, so no attempt that started before the
  // recovery fence completed can be proven never dispatched.
  it('reports possibly_dispatched for an attempt that started before a recovery fence', async () => {
    const restored = await pool.connect()
    try {
      await restored.query('BEGIN')
      await restored.query(
        `INSERT INTO recovery_runs (
           id, generation, source_release_sha, source_manifest_sha256,
           restore_point_at, operator_id, correlation_id, counts, completed_at,
           created_at
         )
         SELECT $1, COALESCE(MAX(generation), 0) + 1, $2, $3, $4,
                'dispatch-evidence@example.invalid', 'dispatch-evidence-restore',
                '{}'::jsonb, $5, $5
           FROM recovery_runs`,
        [randomUUID(), 'c'.repeat(40), 'd'.repeat(64), OLD_ATTEMPT_START, NOW],
      )
      const inTransaction = (attemptStartedAt: Date) =>
        createReplyPublicationDispatchEvidence(
          drizzle(restored) as unknown as Database,
        ).findDispatchEvidence({
          organizationId: ORG,
          replyId: REPLY,
          publicationCycle: CYCLE,
          attemptNumber: ATTEMPT,
          attemptStartedAt,
          now: new Date(NOW.getTime() + 2 * REPLY_DISPATCH_EVIDENCE_WINDOW_MS),
        })

      await expect(inTransaction(OLD_ATTEMPT_START)).resolves.toBe('possibly_dispatched')
      await expect(inTransaction(new Date(NOW.getTime() + 1))).resolves.toBe(
        'never_dispatched',
      )
    } finally {
      await restored.query('ROLLBACK')
      restored.release()
    }
  })

  it('treats an attempt that started exactly one window ago as judgeable', async () => {
    await expect(evidenceFor({ attemptStartedAt: OLD_ATTEMPT_START })).resolves.toBe(
      'never_dispatched',
    )
  })
})
