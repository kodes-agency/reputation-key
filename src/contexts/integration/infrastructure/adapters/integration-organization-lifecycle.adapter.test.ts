// LIF-01-T12/T13/T14 — Integration lifecycle contributor decision logic.
//
// The shared receipt store already proves authority binding, locking and
// receipt replay. What is proved here is what this context decides: which
// connections reach the provider, that a provider failure still converges,
// that readiness never mutates, and that every receipt it emits is content-free.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { GoogleOrganizationClosureProviderPort } from '../../application/ports/google-organization-closure.port'
import {
  createIntegrationOrganizationLifecycleContributor,
  IntegrationPurgeReadinessBlockedError,
} from './integration-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-integration-lifecycle'
const LINEAGE = '2b1f4d0a-9c8e-4b7a-9d6c-5e4f3a2b1c0d'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/** The store's own guard: an evidence reference must carry no tenant text. */
const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

const request = {
  organizationId: ORGANIZATION_ID,
  closureLineageId: LINEAGE,
  lifecycleRevision: 3,
  recoverableUntil: RECOVERABLE_UNTIL,
  occurredAt: OCCURRED_AT,
} as const

type ExecutedStatement = Readonly<{ text: string }>

function statementText(statement: unknown): string {
  return JSON.stringify((statement as { queryChunks?: unknown[] }).queryChunks ?? [])
}

/**
 * Minimal Drizzle-shaped fake, modelled on the shared store's own unit fake.
 * `execute` is routed by a matcher over the rendered SQL fragments so each test
 * states only the rows its phase should see.
 */
function createFakeDb(options: {
  rowsFor: (text: string) => Record<string, unknown>[]
  executed: ExecutedStatement[]
  receipts?: Record<string, unknown>[]
  authorityState?: string
}) {
  const receipts = options.receipts ?? []
  const authorityRow = {
    state: options.authorityState ?? 'closure_requested',
    revision: request.lifecycleRevision,
    closureLineageId: LINEAGE,
    recoverableUntil: RECOVERABLE_UNTIL,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (statement: unknown) => {
        const text = statementText(statement)
        options.executed.push({ text })
        return { rows: options.rowsFor(text) }
      }),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const rows =
              table === organizationLifecycleAuthority ? [authorityRow] : receipts
            const limit = () => {
              const promise = Promise.resolve(rows) as Promise<unknown[]> & {
                for?: () => Promise<unknown[]>
              }
              promise.for = () => Promise.resolve(rows)
              return promise
            }
            return { limit: vi.fn(limit) }
          }),
        })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn(async (row: Record<string, unknown>) => {
          if (table === contextOrganizationLifecycleReceipts) receipts.push(row)
        }),
      })),
    }
    return fn(tx as unknown as Tx)
  })
  return { db: { transaction } as unknown as Database, receipts }
}

function createProvider(
  overrides: Partial<GoogleOrganizationClosureProviderPort> = {},
): GoogleOrganizationClosureProviderPort {
  return {
    stopNotificationSubscriptions: vi.fn(async () => 'stopped' as const),
    revokeCredentials: vi.fn(async () => 'confirmed_revoked' as const),
    ...overrides,
  }
}

const noRows = () => []

describe('Integration Organization lifecycle contributor', () => {
  describe('prepareClosing', () => {
    it('answers no_data affirmatively when the Organization never connected Google', async () => {
      const executed: ExecutedStatement[] = []
      const provider = createProvider()
      const { db, receipts } = createFakeDb({
        executed,
        rowsFor: (text) =>
          text.includes('AS connections')
            ? [{ connections: 0, imports: 0, legacy: 0 }]
            : [],
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider,
      }).prepareClosing(request)

      expect(result.outcome).toBe('no_data')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      expect(provider.stopNotificationSubscriptions).not.toHaveBeenCalled()
      expect(provider.revokeCredentials).not.toHaveBeenCalled()
      expect(receipts).toHaveLength(1)
      // Nothing was written: only the advisory lock and the footprint probe ran.
      expect(executed.filter((statement) => /UPDATE/u.test(statement.text))).toEqual([])
    })

    it('revokes only credentialed connections and fences the rest locally', async () => {
      const executed: ExecutedStatement[] = []
      const provider = createProvider()
      const { db } = createFakeDb({
        executed,
        rowsFor: (text) => {
          if (text.includes('AS connections')) {
            return [{ connections: 2, imports: 1, legacy: 0 }]
          }
          if (text.includes('FOR UPDATE')) {
            return [
              {
                id: 'connection-live',
                encrypted_refresh_token: 'cipher',
                credential_use_state: 'active',
              },
              {
                id: 'connection-retired',
                encrypted_refresh_token: 'redacted',
                credential_use_state: 'none',
              },
            ]
          }
          if (text.includes('UPDATE google_connections'))
            return [{ id: 'connection-live' }]
          if (text.includes('UPDATE gbp_import_requests')) return [{ id: 'import-1' }]
          return []
        },
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider,
      }).prepareClosing(request)

      expect(result.outcome).toBe('complete')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      // The already-retired connection holds no grant, so nothing is re-sent.
      expect(provider.stopNotificationSubscriptions).toHaveBeenCalledTimes(1)
      expect(provider.revokeCredentials).toHaveBeenCalledTimes(1)
      expect(provider.revokeCredentials).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        connectionId: 'connection-live',
        encryptedRefreshToken: 'cipher',
        occurredAt: OCCURRED_AT,
      })
      // Unsubscribe must precede revoke: the token is still valid at that point.
      const revokeOrder = (
        provider.stopNotificationSubscriptions as ReturnType<typeof vi.fn>
      ).mock.invocationCallOrder[0]!
      const stopOrder = (provider.revokeCredentials as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!
      expect(revokeOrder).toBeLessThan(stopOrder)
    })

    it('converges instead of throwing when the provider fails mid-revocation', async () => {
      const executed: ExecutedStatement[] = []
      const provider = createProvider({
        stopNotificationSubscriptions: vi.fn(async () => {
          throw new Error('pubsub unreachable')
        }),
        revokeCredentials: vi.fn(async () => {
          throw new Error('google unreachable')
        }),
      })
      const { db } = createFakeDb({
        executed,
        rowsFor: (text) => {
          if (text.includes('AS connections')) {
            return [{ connections: 1, imports: 0, legacy: 0 }]
          }
          if (text.includes('FOR UPDATE')) {
            return [
              {
                id: 'connection-live',
                encrypted_refresh_token: 'cipher',
                credential_use_state: 'active',
              },
            ]
          }
          if (text.includes('UPDATE google_connections'))
            return [{ id: 'connection-live' }]
          return []
        },
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider,
      }).prepareClosing(request)

      // The local fence still landed; an ambiguous revoke is recorded as zero
      // confirmed revocations rather than aborting the phase.
      expect(result.outcome).toBe('complete')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      expect(
        executed.some((statement) =>
          statement.text.includes('UPDATE google_connections'),
        ),
      ).toBe(true)
    })

    it('replays a recorded receipt without a second provider call', async () => {
      const executed: ExecutedStatement[] = []
      const provider = createProvider()
      const { db } = createFakeDb({
        executed,
        rowsFor: noRows,
        receipts: [
          {
            requestFingerprint: undefined,
            outcome: 'complete',
            evidenceRef: `integration:closing:${LINEAGE}:r3:n1:n1:n1:n0`,
          },
        ],
      })

      // A stored receipt whose fingerprint does not match this request is a
      // different request wearing the same key, and must not inherit it.
      await expect(
        createIntegrationOrganizationLifecycleContributor({
          db,
          provider,
        }).prepareClosing(request),
      ).rejects.toThrow('lifecycle contribution authority changed')
      expect(provider.revokeCredentials).not.toHaveBeenCalled()
    })
  })

  describe('verifyPurgeReadiness', () => {
    it('refuses with blocker codes and counts only, and mutates nothing', async () => {
      const executed: ExecutedStatement[] = []
      const { db, receipts } = createFakeDb({
        executed,
        authorityState: 'closing',
        rowsFor: (text) =>
          text.includes('AS connections')
            ? [{ connections: 1, imports: 0, legacy: 0 }]
            : [
                {
                  live_connections: 1,
                  in_flight_import_items: 2,
                  pending_revoke_attempts: 0,
                  pending_exchange_attempts: 0,
                  pending_source_operations: 0,
                  live_broker_grants: 0,
                  live_discovery_handles: 0,
                },
              ],
      })

      const failure = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider: createProvider(),
      })
        .verifyPurgeReadiness(request)
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(IntegrationPurgeReadinessBlockedError)
      expect((failure as IntegrationPurgeReadinessBlockedError).blockers).toEqual([
        { code: 'live_connections', count: 1 },
        { code: 'in_flight_import_items', count: 2 },
      ])
      expect((failure as Error).message).not.toContain(ORGANIZATION_ID)
      // A refusal writes no receipt: the coordinator must re-ask next pass.
      expect(receipts).toEqual([])
      expect(
        executed.filter((statement) => /UPDATE|DELETE|INSERT/u.test(statement.text)),
      ).toEqual([])
    })

    it('reports complete and reads only when every provider effect has drained', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'closing',
        rowsFor: (text) =>
          text.includes('AS connections')
            ? [{ connections: 2, imports: 3, legacy: 0 }]
            : [
                {
                  live_connections: 0,
                  in_flight_import_items: 0,
                  pending_revoke_attempts: 0,
                  pending_exchange_attempts: 0,
                  pending_source_operations: 0,
                  live_broker_grants: 0,
                  live_discovery_handles: 0,
                },
              ],
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider: createProvider(),
      }).verifyPurgeReadiness(request)

      expect(result.outcome).toBe('complete')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      expect(
        executed.filter((statement) => /UPDATE|DELETE|INSERT/u.test(statement.text)),
      ).toEqual([])
    })
  })

  describe('purge', () => {
    it('deletes rows only, never drops a table or a compatibility mirror', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'purging',
        rowsFor: (text) =>
          text.includes('AS connections')
            ? [{ connections: 1, imports: 0, legacy: 2 }]
            : [],
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider: createProvider(),
      }).purge(request)

      expect(result.outcome).toBe('complete')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      const statements = executed.map((statement) => statement.text).join('\n')
      expect(statements).not.toMatch(/DROP |TRUNCATE/u)
      // The legacy mirrors are emptied for this tenant, never removed.
      for (const mirror of [
        'gbp_cache',
        'gbp_import_jobs',
        'gbp_import_legacy_history',
      ]) {
        expect(statements).toContain(mirror)
      }
      // Retained evidence is scrubbed in place rather than deleted.
      expect(statements).toContain('UPDATE google_disconnect_revoke_attempts')
    })

    it('answers no_data for an Organization Integration never held', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'purging',
        rowsFor: (text) =>
          text.includes('AS connections')
            ? [{ connections: 0, imports: 0, legacy: 0 }]
            : [],
      })

      const result = await createIntegrationOrganizationLifecycleContributor({
        db,
        provider: createProvider(),
      }).purge(request)

      expect(result).toEqual({
        outcome: 'no_data',
        evidenceRef: `integration:purge:${LINEAGE}:r3:n0:n0`,
      })
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
    })
  })

  it('binds every phase to its own authority state', () => {
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db: createFakeDb({ executed: [], rowsFor: noRows }).db,
      provider: createProvider(),
    })
    expect(contributor.context).toBe('integration')
  })
})
