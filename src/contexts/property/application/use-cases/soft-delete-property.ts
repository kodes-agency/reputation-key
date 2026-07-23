// Property context — hard-delete property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyCommandStore } from '../ports/property-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { propertyError } from '../../domain/errors'
import { propertyDeleted } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type DeletePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  commandStore: PropertyCommandStore
  clock: () => Date
  /** BQC-1.7: bounded lifecycle purge before the FK-cascading hard delete. */
  sourceContentPurge?: SourceContentPurge
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
    // property row via its FK below. The purge is the retention machinery and
    // stays OUTSIDE the delete transaction: purge → (delete + fact) is a
    // noted remaining non-atomicity (a crash between them leaves purged
    // content with a live property; re-running the delete converges).
    if (deps.sourceContentPurge) {
      await deps.sourceContentPurge.inboxForProperty(ctx.organizationId, propertyId)
      await deps.sourceContentPurge.forProperty(ctx.organizationId, propertyId)
    }

    // 4. Hard delete + fact — atomic via the command store (BQC-3.5);
    // cascades to gbp_cache (FK); reviews/replies/inbox rows are already
    // gone via the bounded purge above.
    await deps.commandStore.deleteProperty({
      organizationId: ctx.organizationId,
      propertyId,
      event: propertyDeleted({
        propertyId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    })
  }

// fallow-ignore-next-line unused-type
export type DeletePropertyUseCase = ReturnType<typeof deleteProperty>
