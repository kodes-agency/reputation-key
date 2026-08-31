import { describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createGoogleImportDispatchHandler,
  googlePropertyImportItemJobId,
} from './google-import-dispatch'
import type {
  GoogleImportV2DispatchItem,
  GoogleImportV2Store,
} from './ports/google-import-v2-store.port'
import type { GoogleImportV2QueuePort } from './ports/gbp-queue.port'

registerAllEventSchemas()

const EVENT: ConsumerEvent = {
  eventId: '10000000-0000-4000-8000-000000000001',
  eventType: 'integration.property_import.requested',
  eventVersion: 1,
  payload: {
    organizationId: 'org-1',
    importJobId: '10000000-0000-4000-8000-000000000002',
  },
  organizationId: 'org-1',
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: '10000000-0000-4000-8000-000000000002',
  recordedAt: '2026-08-12T12:00:00.000Z',
}

const ITEM: GoogleImportV2DispatchItem = {
  itemId: '10000000-0000-4000-8000-000000000003',
  expectedConnectionLifecycleVersion: 7,
  expectedSourceEpoch: null,
  retryRevision: 0,
  processingRegion: 'us',
  routingPolicyVersion: 4,
}

function setup(items: readonly GoogleImportV2DispatchItem[] | null = [ITEM]) {
  const listPendingDispatchItems = vi.fn(async () => items)
  const addImportItemJobs = vi.fn(async () => {})
  const insertReceipt = vi.fn(async () => {})
  const handler = createGoogleImportDispatchHandler({
    store: { listPendingDispatchItems } as unknown as GoogleImportV2Store,
    queue: { addImportItemJobs } satisfies GoogleImportV2QueuePort,
    receipts: { insertReceipt },
  })
  return { handler, listPendingDispatchItems, addImportItemJobs, insertReceipt }
}

describe('google import v2 durable dispatch', () => {
  it('builds deterministic BullMQ-safe revision-scoped item job IDs', () => {
    expect(
      googlePropertyImportItemJobId({
        itemId: ITEM.itemId,
        lifecycleVersion: ITEM.expectedConnectionLifecycleVersion,
        sourceEpoch: ITEM.expectedSourceEpoch,
        retryRevision: ITEM.retryRevision,
      }),
    ).toBe('import-item-10000000-0000-4000-8000-000000000003-l7-enew-r0')

    expect(
      googlePropertyImportItemJobId({
        itemId: ITEM.itemId,
        lifecycleVersion: 8,
        sourceEpoch: 12,
        retryRevision: 3,
      }),
    ).toBe('import-item-10000000-0000-4000-8000-000000000003-l8-e12-r3')
  })

  it('loads only tenant-parent pending items, dispatches content-free jobs, then records receipt', async () => {
    const fixture = setup()

    await expect(fixture.handler(EVENT)).resolves.toEqual({ status: 'applied' })

    expect(fixture.listPendingDispatchItems).toHaveBeenCalledWith(
      'org-1',
      '10000000-0000-4000-8000-000000000002',
    )
    expect(fixture.addImportItemJobs).toHaveBeenCalledWith([
      {
        jobId: 'import-item-10000000-0000-4000-8000-000000000003-l7-enew-r0',
        organizationId: 'org-1',
        importJobId: '10000000-0000-4000-8000-000000000002',
        itemId: '10000000-0000-4000-8000-000000000003',
        retryRevision: 0,
        routing: {
          subject: {
            kind: 'import_item',
            organizationId: 'org-1',
            itemId: '10000000-0000-4000-8000-000000000003',
          },
          cell: 'us',
          region: 'us',
          workloadClass: 'property.import',
          routingPolicyVersion: 4,
        },
      },
    ])
    expect(fixture.insertReceipt).toHaveBeenCalledWith(
      EVENT.eventId,
      'integration.property-import-dispatch',
      'applied',
    )
    expect(fixture.addImportItemJobs.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.insertReceipt.mock.invocationCallOrder[0]!,
    )
  })

  it('retries a dropped dispatch response with the exact same deterministic job IDs', async () => {
    const fixture = setup()
    fixture.addImportItemJobs
      .mockRejectedValueOnce(new Error('response dropped'))
      .mockResolvedValueOnce(undefined)

    await expect(fixture.handler(EVENT)).rejects.toThrow('response dropped')
    expect(fixture.insertReceipt).not.toHaveBeenCalled()

    await expect(fixture.handler(EVENT)).resolves.toEqual({ status: 'applied' })
    expect(fixture.addImportItemJobs).toHaveBeenCalledTimes(2)
    expect(fixture.addImportItemJobs.mock.calls[1]).toEqual(
      fixture.addImportItemJobs.mock.calls[0],
    )
  })

  it('records an obsolete receipt when the source parent no longer exists', async () => {
    const fixture = setup(null)

    await expect(fixture.handler(EVENT)).resolves.toEqual({ status: 'obsolete' })
    expect(fixture.addImportItemJobs).not.toHaveBeenCalled()
    expect(fixture.insertReceipt).toHaveBeenCalledWith(
      EVENT.eventId,
      'integration.property-import-dispatch',
      'obsolete',
    )
  })

  it('fails closed on envelope attribution mismatch before reads or side effects', async () => {
    const fixture = setup()
    const event = {
      ...EVENT,
      organizationId: 'org-other',
    }

    await expect(fixture.handler(event)).rejects.toThrow(
      'property import requested envelope attribution mismatch',
    )
    expect(fixture.listPendingDispatchItems).not.toHaveBeenCalled()
    expect(fixture.addImportItemJobs).not.toHaveBeenCalled()
    expect(fixture.insertReceipt).not.toHaveBeenCalled()
  })
})
