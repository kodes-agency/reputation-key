import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId } from '#/shared/domain/ids'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { canForContext } from '#/shared/domain/permissions'
import { propertyError } from '../../domain/errors'
import { propertyArchived, propertyRestored } from '../../domain/events'
import {
  archiveRecoveryDeadline,
  assertValidTransition,
} from '../../domain/property-lifecycle'
import type { PropertyLifecycleCommandStore } from '../ports/property-lifecycle-command-store.port'
import type { PropertyLifecycleReadiness } from '../ports/property-lifecycle-readiness.port'
import type { PropertyRepository } from '../ports/property.repository'
import {
  PropertyGoogleBindingError,
  type PropertyGoogleBindingStore,
  type PropertyGoogleBindingSummary,
} from '../ports/property-google-binding.port'

const normalizeArchiveReason = (value: string): string => {
  const reason = value.trim()
  if (reason.length < 3 || reason.length > 500) {
    throw propertyError(
      'invalid_lifecycle_reason',
      'Archive reason must be between 3 and 500 characters',
    )
  }
  return reason
}

type LifecycleAccessDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffPublicApi: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
  clock: () => Date
}>

type LifecycleCommandDeps = LifecycleAccessDeps &
  Readonly<{ lifecycleStore: PropertyLifecycleCommandStore }>

const loadAccessibleProperty = async (
  deps: LifecycleAccessDeps,
  rawPropertyId: string,
  ctx: AuthContext,
  permission: 'property.archive' | 'property.restore' | 'property.disconnect',
) => {
  if (!canForContext(ctx, permission)) {
    throw propertyError('forbidden', 'this role cannot change Property lifecycle')
  }
  const pid = propertyId(rawPropertyId)
  const property = await deps.propertyRepo.findById(ctx.organizationId, pid)
  if (!property) throw propertyError('property_not_found', 'property not found')
  const accessible = await isPropertyAccessibleForPermission(
    (organizationId, userId, organizationWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(
        organizationId,
        userId,
        organizationWide,
      ),
    ctx,
    permission,
    pid,
  )
  if (!accessible) throw propertyError('forbidden', 'No access to this property')
  return property
}

export type ArchivePropertyInput = Readonly<{
  propertyId: string
  reason: string
}>

export const archiveProperty =
  (deps: LifecycleCommandDeps) =>
  async (input: ArchivePropertyInput, ctx: AuthContext) => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.archive',
    )
    if (property.lifecycleState === 'archived') return property
    if (property.lifecycleState !== 'active' && property.lifecycleState !== 'suspended') {
      assertValidTransition(property.lifecycleState, 'archived')
      throw propertyError(
        'invalid_transition',
        'Property is not in a state that can be archived',
      )
    }

    const occurredAt = deps.clock()
    const recoveryDeadline = archiveRecoveryDeadline(occurredAt)
    const reason = normalizeArchiveReason(input.reason)
    const nextSourceEpoch = property.sourceEpoch + 1
    return deps.lifecycleStore.transitionLifecycle({
      organizationId: property.organizationId,
      propertyId: property.id,
      from: property.lifecycleState,
      to: 'archived',
      expectedSourceEpoch: property.sourceEpoch,
      nextSourceEpoch,
      expectedProfileVersion: property.profileVersion,
      reason,
      recoveryDeadline,
      initiatedBy: ctx.userId,
      occurredAt,
      event: propertyArchived({
        organizationId: property.organizationId,
        propertyId: property.id,
        userId: ctx.userId,
        previousState: property.lifecycleState,
        sourceEpoch: nextSourceEpoch,
        recoveryDeadline,
        occurredAt,
      }),
    })
  }

export type ArchiveProperty = ReturnType<typeof archiveProperty>

export type RestorePropertyInput = Readonly<{ propertyId: string }>

type RestorePropertyDeps = LifecycleCommandDeps &
  Readonly<{ readiness: PropertyLifecycleReadiness }>

export type PropertyGoogleBindingReadiness = 'ready' | 'reconnect_required'

export const restoreProperty =
  (deps: RestorePropertyDeps) =>
  async (input: RestorePropertyInput, ctx: AuthContext) => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.restore',
    )
    const googleBindingReadiness: PropertyGoogleBindingReadiness =
      property.googleBindingState === 'active' ? 'ready' : 'reconnect_required'
    if (property.lifecycleState === 'active') {
      return { property, googleBindingReadiness } as const
    }
    if (property.lifecycleState !== 'archived') {
      assertValidTransition(property.lifecycleState, 'active')
      throw propertyError(
        'invalid_transition',
        'Only an archived Property can be restored through self-service recovery',
        { from: property.lifecycleState, to: 'active' },
      )
    }

    const occurredAt = deps.clock()
    if (
      property.purgeScheduledFor === null ||
      occurredAt.getTime() >= property.purgeScheduledFor.getTime()
    ) {
      throw propertyError(
        'property_recovery_expired',
        'The self-service Property recovery window has ended',
      )
    }
    if (
      !(await deps.readiness.hasEligibleResponsibleManager(
        property.organizationId,
        property.id,
      ))
    ) {
      throw propertyError(
        'property_restore_not_ready',
        'Assign an eligible Responsible Manager before restoring this Property',
        { reason: 'responsible_manager_required' },
      )
    }

    const nextSourceEpoch = property.sourceEpoch + 1
    const restored = await deps.lifecycleStore.transitionLifecycle({
      organizationId: property.organizationId,
      propertyId: property.id,
      from: property.lifecycleState,
      to: 'active',
      expectedSourceEpoch: property.sourceEpoch,
      nextSourceEpoch,
      expectedProfileVersion: property.profileVersion,
      reason: null,
      recoveryDeadline: null,
      initiatedBy: ctx.userId,
      occurredAt,
      event: propertyRestored({
        organizationId: property.organizationId,
        propertyId: property.id,
        userId: ctx.userId,
        previousState: property.lifecycleState,
        sourceEpoch: nextSourceEpoch,
        googleBindingReadiness,
        occurredAt,
      }),
    })
    return { property: restored, googleBindingReadiness } as const
  }

export type RestoreProperty = ReturnType<typeof restoreProperty>

export type DisconnectPropertyGoogleBindingInput = Readonly<{ propertyId: string }>

type DisconnectPropertyGoogleBindingDeps = LifecycleAccessDeps &
  Readonly<{
    bindingStore: Pick<PropertyGoogleBindingStore, 'disconnect' | 'readSummary'>
  }>

const translateBindingDisconnectError = (error: unknown): never => {
  if (!(error instanceof PropertyGoogleBindingError)) throw error
  if (error.code === 'property_not_found' || error.code === 'property_deleted') {
    throw propertyError('property_not_found', 'property not found')
  }
  if (error.code === 'stale_binding' || error.code === 'stale_profile') {
    throw propertyError('stale_property', 'property changed during Google disconnect')
  }
  throw propertyError(
    'google_binding_not_disconnectable',
    'The Property Google binding cannot be disconnected in its current state',
  )
}

export const disconnectPropertyGoogleBinding =
  (deps: DisconnectPropertyGoogleBindingDeps) =>
  async (
    input: DisconnectPropertyGoogleBindingInput,
    ctx: AuthContext,
  ): Promise<PropertyGoogleBindingSummary> => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.disconnect',
    )
    if (property.lifecycleState !== 'archived') {
      throw propertyError(
        'invalid_transition',
        'Archive the Property before disconnecting its Google binding',
        { from: property.lifecycleState, to: 'disconnected' },
      )
    }
    if (
      property.googleBindingState === 'disconnected' ||
      property.googleBindingState === 'unbound'
    ) {
      const summary = await deps.bindingStore.readSummary(
        property.organizationId,
        property.id,
      )
      if (!summary) throw propertyError('property_not_found', 'property not found')
      return summary
    }
    if (property.googleBindingState !== 'active') {
      throw propertyError(
        'google_binding_not_disconnectable',
        'The Property Google binding cannot be disconnected in its current state',
      )
    }
    try {
      return await deps.bindingStore.disconnect({
        organizationId: property.organizationId,
        propertyId: property.id,
        expectedSourceEpoch: property.sourceEpoch,
        expectedProfileVersion: property.profileVersion,
        now: deps.clock(),
      })
    } catch (error) {
      return translateBindingDisconnectError(error)
    }
  }

export type DisconnectPropertyGoogleBinding = ReturnType<
  typeof disconnectPropertyGoogleBinding
>
