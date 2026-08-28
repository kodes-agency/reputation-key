import { z } from 'zod/v4'
import type {
  ConsumerEvent,
  ConsumerRegistry,
  ConsumerResult,
  OutboxRepository,
} from '#/shared/outbox'
import type { ProcessIssuedPortalImageInput } from './jobs/process-image.job'

export const PORTAL_HERO_IMAGE_PROCESSING_CONSUMER = 'portal.process-issued-hero-image'

const processingRequestSchema = z.object({
  uploadId: z.uuid(),
  portalId: z.uuid(),
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  sourceETag: z.string().regex(/^[A-Za-z0-9"'-]{1,200}$/),
})

export type RegisterPortalConsumersInput = Readonly<{
  processIssuedPortalImage: (
    input: ProcessIssuedPortalImageInput,
  ) => Promise<'processed' | 'stale'>
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

export async function handlePortalHeroImageProcessingRequested(
  dependencies: RegisterPortalConsumersInput,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = processingRequestSchema.parse(event.payload)
  if (
    event.eventType !== 'portal.hero_image.processing_requested' ||
    event.organizationId !== payload.organizationId ||
    event.propertyId !== payload.propertyId ||
    event.sourceAggregateId !== payload.uploadId
  ) {
    throw new Error('Portal upload processing event attribution mismatch')
  }

  const outcome = await dependencies.processIssuedPortalImage(payload)
  const status = outcome === 'processed' ? 'applied' : 'obsolete'
  await dependencies.receipts.insertReceipt(
    event.eventId,
    PORTAL_HERO_IMAGE_PROCESSING_CONSUMER,
    status,
  )
  return { status }
}

export function registerPortalConsumers(
  registry: ConsumerRegistry,
  dependencies: RegisterPortalConsumersInput,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'portal.hero_image.processing_requested',
    consumerName: 'portal.process-issued-hero-image',
    module: 'portal.outbox-consumers',
    handler: (event) => handlePortalHeroImageProcessingRequested(dependencies, event),
  })
}
