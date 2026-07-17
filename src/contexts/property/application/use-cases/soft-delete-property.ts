// Property context — hard-delete property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import type { SourceContentPurge } from '#/contexts/review/application/ports/source-content-purge.port'
import { canForContext } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { propertyError } from '../../domain/errors'
import { propertyDeleted } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

// fallow-ignore-next-line unused-type
export type DeletePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
  /** BQC-1.7: bounded lifecycle purge before the FK-cascading hard delete. */
  sourceContentPurge?: SourceContentPurge
  outboxRepo?: OutboxRepository
}>

// fallow-ignore-next-line unused-type
export type DeletePropertyInput = Readonly<{
  propertyId: string
}>

export const deleteProperty =
  (deps: DeletePropertyDeps) =>
  async (input: DeletePropertyInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize — only AccountAdmin can delete
    if (!canForContext(ctx, 'property.delete')) {
      throw propertyError('forbidden', 'only AccountAdmin can delete properties')
    }

    // 2. Validate referenced entity exists
    const propertyId = toPropertyId(input.propertyId)
    const existing = await deps.propertyRepo.findById(ctx.organizationId, propertyId)
    if (!existing) {
      throw propertyError('property_not_found', 'property not found in this organization')
    }

    // 3. BQC-1.7: bounded lifecycle purge first — reviews (+ replies via
    // per-batch FK cascade) and inbox rows are deleted in bounded, evidenced
    // batches instead of one unbounded cascade. gbp_cache dies with the
    // property row via its FK below.
    if (deps.sourceContentPurge) {
      await deps.sourceContentPurge.inboxForProperty(ctx.organizationId, propertyId)
      await deps.sourceContentPurge.forProperty(ctx.organizationId, propertyId)
    }

    // 4. Hard delete — cascades to gbp_cache (FK); reviews/replies/inbox rows
    // are already gone via the bounded purge above.
    await deps.propertyRepo.hardDelete(ctx.organizationId, propertyId)

    // 5. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      propertyDeleted({
        propertyId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type DeletePropertyUseCase = ReturnType<typeof deleteProperty>
