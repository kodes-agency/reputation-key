import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections, idempotencyReceipts } from '#/shared/db/schema'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
} from '../domain/events'
import { createAtomicIntegrationCommandStore } from './integration-command-store'
import { createGoogleDisconnectRevokeRepository } from './repositories/google-disconnect-revoke.repository'

vi.mock('#/shared/outbox/commit', () => ({ insertOutboxRow: vi.fn() }))

const ORG = organizationId('disconnect-category-org')
const CONNECTION = googleConnectionId('10000000-0000-4000-8000-000000000001')
const ACTOR = userId('disconnect-category-actor')
const NOW = new Date('2026-11-06T10:00:00Z')
const EVENT = integrationGoogleAccountDisconnected({
  organizationId: ORG,
  connectionId: CONNECTION,
  userId: ACTOR,
  occurredAt: NOW,
})

function harness() {
  let connection: Record<string, unknown> = {
    id: CONNECTION,
    organizationId: ORG,
    status: 'active',
    credentialUseState: 'active',
    scopes: ['scope'],
    connectedBy: ACTOR,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    cleanupMaterialDeadlineAt: null,
  }
  let hints: {
    organizationId: string
    connectionId: string
    category: string | null
    readAt: Date | null
  }[] = [
    { organizationId: ORG, connectionId: CONNECTION, category: 'Hotel', readAt: NOW },
    {
      organizationId: ORG,
      connectionId: 'other-connection',
      category: 'Day spa',
      readAt: NOW,
    },
    {
      organizationId: 'other-org',
      connectionId: CONNECTION,
      category: 'Restaurant',
      readAt: NOW,
    },
  ]
  let attempt: Record<string, unknown> = {
    id: '20000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    connectionId: CONNECTION,
    initiatorUserId: ACTOR,
    cleanupWorkPermitId: null,
    state: 'active',
    expectedLifecycleVersion: 1,
    expectedAccessVersion: 1,
    expectedCredentialGeneration: 1,
    credentialBinding: null,
    cleanupDeadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
    activatedAt: NOW.toISOString(),
    dispatchingAt: null,
    terminalAt: null,
    outcomeCode: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
  const tx = {
    select: () => {
      let table: unknown
      const chain = {
        from: (value: unknown) => {
          table = value
          return chain
        },
        where: () => chain,
        for: () => chain,
        limit: async () =>
          table === idempotencyReceipts ? [{ payload: attempt }] : [{ ...connection }],
      }
      return chain
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table === googleConnections) {
              connection = { ...connection, ...values }
              return [{ ...connection }]
            }
            attempt = values.payload as Record<string, unknown>
            return [{ key: attempt.id }]
          },
        }),
      }),
    }),
    execute: async (statement: SQL) => {
      const { sql, params } = new PgDialect().sqlToQuery(statement)
      if (!/UPDATE properties/i.test(sql)) throw new Error('unexpected query')
      const organizationParameter = /organization_id\s*=\s*\$(\d+)/i.exec(sql)?.[1]
      const connectionParameter = /google_connection_id\s*=\s*\$(\d+)/i.exec(sql)?.[1]
      hints = hints.map((hint) => {
        if (
          organizationParameter &&
          hint.organizationId !== params[Number(organizationParameter) - 1]
        )
          return hint
        if (
          connectionParameter &&
          hint.connectionId !== params[Number(connectionParameter) - 1]
        )
          return hint
        return {
          ...hint,
          category: /google_primary_category\s*=\s*NULL/i.test(sql)
            ? null
            : hint.category,
          readAt: /google_primary_category_updated_at\s*=\s*NULL/i.test(sql)
            ? null
            : hint.readAt,
        }
      })
      return { rows: [] }
    },
  }
  const db = {
    transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
      const before = {
        connection: { ...connection },
        hints: hints.map((hint) => ({ ...hint })),
        attempt: { ...attempt },
      }
      try {
        return await work(tx)
      } catch (error) {
        connection = before.connection
        hints = before.hints
        attempt = before.attempt
        throw error
      }
    },
  } as unknown as Database
  const store = createAtomicIntegrationCommandStore(db, () => NOW)
  const revoke = createGoogleDisconnectRevokeRepository(db)
  return {
    tx,
    hints: () => hints,
    connection: () => connection,
    disconnect: (cleanupOnly?: Readonly<{ lifecycleVersion: number }>) =>
      store.disconnectGoogleAccount({
        organizationId: ORG,
        connectionId: CONNECTION,
        cleanupOnly,
        event: EVENT,
      }),
    settle: () =>
      revoke.settle({
        attemptId: String(attempt.id),
        organizationId: ORG,
        connectionId: CONNECTION,
        initiatorUserId: ACTOR,
        outcome: 'confirmed_not_sent',
        outcomeCode: 'not_sent',
        now: NOW,
        event: EVENT,
      }),
    reauthorize: () =>
      store.requireReauthorization({
        organizationId: ORG,
        connectionId: CONNECTION,
        expected: { lifecycleVersion: 1, credentialGeneration: 1 },
        event: integrationGoogleAccountReauthorizationRequired({
          organizationId: ORG,
          connectionId: CONNECTION,
          cause: 'provider_revoked',
          occurredAt: NOW,
        }),
      }),
  }
}

beforeEach(() => vi.resetAllMocks())

describe('Google account disconnect category retention', () => {
  it('refuses cleanup from an earlier disconnected generation before any mutation', async () => {
    const subject = harness()
    const before = subject.hints()
    await expect(subject.disconnect({ lifecycleVersion: 0 })).rejects.toMatchObject({
      code: 'invalid_transition',
    })
    expect(subject.connection().status).toBe('active')
    expect(subject.hints()).toEqual(before)
    expect(insertOutboxRow).not.toHaveBeenCalled()
  })

  it.each(['disconnect', 'settle'] as const)(
    '%s clears only hints bound to that tenant and connection with its fact',
    async (operation) => {
      const subject = harness()
      await subject[operation]()
      expect(subject.connection().status).toBe('disconnected')
      expect(subject.hints()).toEqual([
        { organizationId: ORG, connectionId: CONNECTION, category: null, readAt: null },
        {
          organizationId: ORG,
          connectionId: 'other-connection',
          category: 'Day spa',
          readAt: NOW,
        },
        {
          organizationId: 'other-org',
          connectionId: CONNECTION,
          category: 'Restaurant',
          readAt: NOW,
        },
      ])
      expect(vi.mocked(insertOutboxRow).mock.calls[0]?.[0]).toBe(subject.tx)
    },
  )

  it.each(['disconnect', 'settle'] as const)(
    '%s rolls category cleanup back when its fact cannot commit',
    async (operation) => {
      const subject = harness()
      const before = subject.hints()
      vi.mocked(insertOutboxRow).mockRejectedValueOnce(new Error('outbox unavailable'))
      await expect(subject[operation]()).rejects.toThrow('outbox unavailable')
      expect(subject.connection().status).toBe('active')
      expect(subject.hints()).toEqual(before)
    },
  )

  it('keeps category hints when the account merely requires reauthorization', async () => {
    const subject = harness()
    const before = subject.hints()
    await subject.reauthorize()
    expect(subject.connection().status).toBe('reauth_required')
    expect(subject.hints()).toEqual(before)
  })
})
