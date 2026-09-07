import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  organizationLifecycleAuthority,
  organizationLifecycleEvents,
} from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { GoogleOrganizationClosureProviderPort } from '../../application/ports/google-organization-closure.port'
import { createIntegrationOrganizationLifecycleContributor } from './integration-organization-lifecycle.adapter'

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
          if (table === organizationLifecycleEvents) receipts.push(row)
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

describe('Integration Organization lifecycle contributor', () => {
  describe('prepareClosing', () => {
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
  })
})
