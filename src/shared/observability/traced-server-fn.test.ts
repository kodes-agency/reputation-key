import type { ClientBase } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { DomainEvent } from '#/shared/events/events'
import { clearEventSchemas, registerEventSchema } from '#/shared/events/schema-registry'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { observeClient } from '#/shared/db/scope-observation.server'
import { getRequestContext } from './request-context'
import { tracedHandler } from './traced-server-fn'

const observabilityMocks = vi.hoisted(() => ({
  end: vi.fn(),
  info: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    child: () => ({ info: observabilityMocks.info }),
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  startRequestSpan: () => ({ end: observabilityMocks.end }),
}))

const EVENT_TYPE = 'test.server_command'

beforeEach(() => {
  clearEventSchemas()
  registerEventSchema({
    aggregate: { type: 'event', id: 'eventId' },
    type: EVENT_TYPE,
    version: 1,
    schema: z.object({ resourceId: z.string() }),
  })
  vi.clearAllMocks()
})

describe('tracedHandler command identity', () => {
  it('stamps a recorded durable fact with the server request id as commandId', async () => {
    const values = vi.fn(async (_row: unknown) => undefined)
    const tx = {
      insert: vi.fn(() => ({ values })),
    } as unknown as Tx
    const fact = {
      _tag: EVENT_TYPE,
      eventId: 'evt-server-command-1',
      resourceId: 'resource-1',
      organizationId: 'org-1',
      propertyId: null,
      correlationId: null,
    } as unknown as DomainEvent

    const handler = tracedHandler<undefined, string>(async () => {
      const requestId = getRequestContext()?.requestId
      if (!requestId) throw new Error('traced handler did not install request context')

      await insertOutboxRow(tx, fact)
      return requestId
    })

    const requestId = await handler({ data: undefined })

    expect(values).toHaveBeenCalledOnce()
    expect(values.mock.calls[0]?.[0]).toMatchObject({
      payload: { commandId: requestId },
    })
  })
})

describe('tracedHandler database timing', () => {
  it("logs the request's statement and transaction timing with its completion", async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const client = { query } as unknown as ClientBase
    observeClient(client)

    await tracedHandler<undefined, void>(
      async () => {
        await client.query('select 1')
        await client.query('begin')
        await client.query('select 2')
        await client.query('commit')
      },
      'GET',
      'getInbox',
    )({ data: undefined })

    expect(observabilityMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        dbStatements: 2,
        dbAutocommitStatements: 1,
        dbTransactions: 1,
        dbStatementMs: expect.any(Number),
        dbTransactionMs: expect.any(Number),
        dbScopeSettingMs: 0,
      }),
      'request complete',
    )
  })

  it('adds no database fields to a request that sent no statement', async () => {
    await tracedHandler<undefined, void>(async () => undefined)({ data: undefined })

    expect(observabilityMocks.info.mock.calls[0]?.[0]).toEqual({
      duration: expect.any(Number),
    })
  })
})
