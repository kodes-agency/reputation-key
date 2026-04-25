// Property context — soft-delete property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { can } from '#/shared/domain/permissions'
import { propertyError } from '../../domain/errors'
import { propertyDeleted } from '../../domain/events'

export type SoftDeletePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
}>

export type SoftDeletePropertyInput = Readonly<{
  propertyId: string
}>

export const softDeleteProperty =
  (deps: SoftDeletePropertyDeps) =>
  async (input: SoftDeletePropertyInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize — only AccountAdmin can delete
    if (!can(ctx.role, 'property.delete')) {
      throw propertyError('forbidden', 'only AccountAdmin can delete properties')
    }

    // 2. Validate referenced entity exists
    const propertyId = input.propertyId as PropertyId
    const existing = await deps.propertyRepo.findById(ctx.organizationId, propertyId)
    if (!existing) {
      throw propertyError('property_not_found', 'property not found in this organization')
    }

    // 5. Persist (soft delete)
    await deps.propertyRepo.softDelete(ctx.organizationId, propertyId)

    // 6. Emit event
    deps.events.emit(
      propertyDeleted({
        propertyId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

export type SoftDeleteProperty = ReturnType<typeof softDeleteProperty>
