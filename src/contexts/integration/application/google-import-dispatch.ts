import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ReceiptStatus } from '#/shared/outbox'
import type {
  GoogleImportV2ItemJobData,
  GoogleImportV2QueuePort,
} from './ports/gbp-queue.port'
import type { GoogleImportV2Store } from './ports/google-import-v2-store.port'
import type { GooglePropertyImportItemJobId } from './google-import-v2-contract'
import { GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT } from './google-import-v2-contract'

export const GOOGLE_IMPORT_DISPATCH_CONSUMER =
  'integration.property-import-dispatch' as const

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

/**
 * BullMQ forbids ':' in custom job IDs. This canonical identifier is scoped
 * to the immutable connection lifecycle/source epoch and the accepted retry
 * revision, so ambiguous addBulk delivery converges without hiding new work.
 */
export function googlePropertyImportItemJobId(
  input: Readonly<{
    itemId: string
    lifecycleVersion: number
    sourceEpoch: number | null
    retryRevision: number
  }>,
): GooglePropertyImportItemJobId {
  if (!UUID_RE.test(input.itemId)) throw new Error('itemId must be a UUID')
  requireNonNegativeInteger(input.lifecycleVersion, 'lifecycleVersion')
  if (input.sourceEpoch !== null) {
    requireNonNegativeInteger(input.sourceEpoch, 'sourceEpoch')
  }
  requireNonNegativeInteger(input.retryRevision, 'retryRevision')
  const sourceEpoch = input.sourceEpoch ?? 'new'
  return `import-item-${input.itemId}-l${input.lifecycleVersion}-e${sourceEpoch}-r${input.retryRevision}`
}

type RequestedPayload = Readonly<{
  organizationId: string
  importJobId: string
}>

type DispatchReceiptWriter = Readonly<{
  insertReceipt: (
    eventId: string,
    consumerName: string,
    status: ReceiptStatus,
  ) => Promise<void>
}>
type GoogleImportDispatchEvent = Readonly<{
  eventId: string
  eventVersion: number
  payload: unknown
  organizationId: string
}>

function parseRequestedPayload(event: GoogleImportDispatchEvent): RequestedPayload {
  const payload = validateEventPayload(
    GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT,
    event.eventVersion,
    event.payload,
  ) as RequestedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('property import requested envelope attribution mismatch')
  }
  return payload
}

export function createGoogleImportDispatchHandler(
  deps: Readonly<{
    store: GoogleImportV2Store
    queue: GoogleImportV2QueuePort
    receipts: DispatchReceiptWriter
  }>,
) {
  return async (
    event: GoogleImportDispatchEvent,
  ): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> => {
    const payload = parseRequestedPayload(event)
    const items = await deps.store.listPendingDispatchItems(
      payload.organizationId,
      payload.importJobId,
    )
    if (items === null) {
      await deps.receipts.insertReceipt(
        event.eventId,
        GOOGLE_IMPORT_DISPATCH_CONSUMER,
        'obsolete',
      )
      return { status: 'obsolete' }
    }

    const jobs: GoogleImportV2ItemJobData[] = items.map((item) => ({
      jobId: googlePropertyImportItemJobId({
        itemId: item.itemId,
        lifecycleVersion: item.expectedConnectionLifecycleVersion,
        sourceEpoch: item.expectedSourceEpoch,
        retryRevision: item.retryRevision,
      }),
      organizationId: payload.organizationId,
      importJobId: payload.importJobId,
      itemId: item.itemId,
      retryRevision: item.retryRevision,
      routing: {
        subject: {
          kind: 'import_item',
          organizationId: payload.organizationId,
          itemId: item.itemId,
        },
        region: item.processingRegion,
        workloadClass: 'property.import',
        routingPolicyVersion: item.routingPolicyVersion,
      },
    }))

    await deps.queue.addImportItemJobs(jobs)
    await deps.receipts.insertReceipt(
      event.eventId,
      GOOGLE_IMPORT_DISPATCH_CONSUMER,
      'applied',
    )
    return { status: 'applied' }
  }
}
