import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { DomainEvent } from '#/shared/events/events'
import type { EventBus } from '#/shared/events/event-bus'
import { clearEventSchemas, registerEventSchema } from '#/shared/events/schema-registry'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
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
    type: EVENT_TYPE,
    version: 1,
    schema: z.object({ resourceId: z.string() }),
  })
  vi.clearAllMocks()
})

describe('tracedHandler command identity', () => {
  it('stamps an emitted durable fact with the server request id as commandId', async () => {
    const values = vi.fn(async (_row: unknown) => undefined)
    const tx = {
      insert: vi.fn(() => ({ values })),
    } as unknown as Tx
    const emit = vi.fn(async (_event: DomainEvent) => undefined)
    const events = { emit } as unknown as EventBus
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
      await emitAfterCommit(events, fact)
      return requestId
    })

    const requestId = await handler({ data: undefined })

    expect(values).toHaveBeenCalledOnce()
    expect(values.mock.calls[0]?.[0]).toMatchObject({
      payload: { commandId: requestId },
    })
    expect(emit).toHaveBeenCalledWith(fact)
  })
})
