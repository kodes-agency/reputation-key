// Presentation model for the Property lifecycle card — which controls a given
// lifecycle state offers, and how the recovery deadline reads. Kept apart from
// the card so the state rules can be tested without rendering.
//
// The lifecycle vocabulary is redeclared here rather than imported from the
// Property domain, matching the component boundary the rest of this folder keeps.

export type PropertyLifecycleState =
  | 'active'
  | 'suspended'
  | 'archived'
  | 'disconnecting'
  | 'purge_pending'
  | 'purging'
  | 'purged'

export type GoogleBindingState =
  'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'

export type LifecycleControls = Readonly<{
  showArchive: boolean
  showRemove: boolean
  showRestore: boolean
  showDisconnect: boolean
  restoreDisabled: boolean
  statusLabel: string
}>

const LIFECYCLE_LABELS: Readonly<Record<PropertyLifecycleState, string>> = {
  active: 'Active',
  suspended: 'Paused',
  archived: 'Archived',
  disconnecting: 'Disconnecting',
  purge_pending: 'Support review',
  purging: 'Unavailable',
  purged: 'Unavailable',
}

export const getPropertyLifecycleControls = (input: {
  lifecycleState: PropertyLifecycleState
  googleBindingState: GoogleBindingState
  responsibilityNeeded: boolean
}): LifecycleControls => ({
  showArchive: input.lifecycleState === 'active' || input.lifecycleState === 'suspended',
  // Removal archives and then disconnects, so it is offered wherever Archive is.
  showRemove: input.lifecycleState === 'active' || input.lifecycleState === 'suspended',
  showRestore: input.lifecycleState === 'archived',
  showDisconnect:
    input.lifecycleState === 'archived' && input.googleBindingState === 'active',
  restoreDisabled: input.responsibilityNeeded,
  statusLabel: propertyLifecycleLabel(input.lifecycleState),
})

export const formatPropertyRecoveryDeadline = (
  value: Date | string | null,
): string | null => {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export const propertyLifecycleLabel = (state: PropertyLifecycleState): string =>
  LIFECYCLE_LABELS[state]

export type PropertyRestoreWindow =
  | Readonly<{ kind: 'self_service'; deadline: string }>
  | Readonly<{ kind: 'support' }>
  | Readonly<{ kind: 'none' }>

/**
 * Whether a removed Property can still be restored from the product. Only an
 * archived Property can; `purgeScheduledFor` is the end of its self-service
 * window, not a deletion date — after it, or without it, support restores.
 */
export const propertyRestoreWindow = (
  property: Readonly<{
    lifecycleState: PropertyLifecycleState
    purgeScheduledFor: Date | string | null
  }>,
  now: Date,
): PropertyRestoreWindow => {
  if (property.lifecycleState !== 'archived') return { kind: 'none' }
  const { purgeScheduledFor } = property
  const deadline = formatPropertyRecoveryDeadline(purgeScheduledFor)
  if (purgeScheduledFor === null || deadline === null) return { kind: 'support' }
  if (new Date(purgeScheduledFor).getTime() <= now.getTime()) return { kind: 'support' }
  return { kind: 'self_service', deadline }
}

export type LifecyclePermissions = Readonly<{
  archive: boolean
  restore: boolean
  disconnect: boolean
}>

export type LifecycleActionState = Readonly<{ show: boolean; disabled: boolean }>

export type LifecycleActionStates = Readonly<{
  archive: LifecycleActionState
  remove: LifecycleActionState
  restore: LifecycleActionState
  disconnect: LifecycleActionState
}>

/**
 * Whether each lifecycle control is offered, and whether it is usable. Kept
 * here rather than inline in the card so every "can I press this?" rule is
 * decided in one tested place instead of across four JSX expressions.
 */
export const getPropertyLifecycleActionStates = (
  input: Readonly<{
    controls: LifecycleControls
    permissions: LifecyclePermissions
    pending: boolean
  }>,
): LifecycleActionStates => {
  const { controls, permissions, pending } = input
  return {
    archive: {
      show: controls.showArchive,
      disabled: !permissions.archive || pending,
    },
    // Removal archives and disconnects, so it needs both permissions.
    remove: {
      show: controls.showRemove,
      disabled: !permissions.archive || !permissions.disconnect || pending,
    },
    restore: {
      show: controls.showRestore,
      disabled: !permissions.restore || pending || controls.restoreDisabled,
    },
    disconnect: {
      show: controls.showDisconnect,
      disabled: !permissions.disconnect || pending,
    },
  }
}
