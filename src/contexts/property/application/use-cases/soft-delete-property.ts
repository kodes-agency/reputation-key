// Property context — hard-delete property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { can } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { propertyError } from '../../domain/errors'
import { propertyDeleted } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type DeletePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
}>

// fallow-ignore-next-line unused-type
export type DeletePropertyInput = Readonly<{
  propertyId: string
}>

export const deleteProperty =
  (deps: DeletePropertyDeps) =>
  async (input: DeletePropertyInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize — only AccountAdmin can delete
    if (!can(ctx.role, 'property.delete')) {
      throw propertyError('forbidden', 'only AccountAdmin can delete properties')
    }

    // 2. Validate referenced entity exists
    const propertyId = toPropertyId(input.propertyId)
    const existing = await deps.propertyRepo.findById(ctx.organizationId, propertyId)
    if (!existing) {
      throw propertyError('property_not_found', 'property not found in this organization')
    }

    // 3. Hard delete — cascades to reviews, replies, inbox items via FK
    await deps.propertyRepo.hardDelete(ctx.organizationId, propertyId)

    // 4. Emit event
    await deps.events.emit(
      propertyDeleted({
        eventId: crypto.randomUUID(),
        propertyId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type DeletePropertyUseCase = ReturnType<typeof deleteProperty>
