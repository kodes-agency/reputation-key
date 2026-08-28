import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { PropertyArchived, PropertyRestored } from '../../domain/events'
import type { PropertyLifecycleState } from '../../domain/property-lifecycle'
import type { Property } from '../../domain/types'

type PropertyLifecycleTransitionBase = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  expectedSourceEpoch: number
  nextSourceEpoch: number
  expectedProfileVersion: number
  initiatedBy: UserId
  occurredAt: Date
}>

export type PropertyLifecycleTransitionCommand = PropertyLifecycleTransitionBase &
  (
    | Readonly<{
        from: Extract<PropertyLifecycleState, 'active' | 'suspended'>
        to: 'archived'
        reason: string
        recoveryDeadline: Date
        event: PropertyArchived
      }>
    | Readonly<{
        from: Extract<PropertyLifecycleState, 'archived'>
        to: 'active'
        reason: null
        recoveryDeadline: null
        event: PropertyRestored
      }>
  )

/**
 * Atomic Property lifecycle state + authority-epoch + durable fact boundary.
 * It never deletes a Property or any dependent data.
 */
export type PropertyLifecycleCommandStore = Readonly<{
  transitionLifecycle: (command: PropertyLifecycleTransitionCommand) => Promise<Property>
}>
