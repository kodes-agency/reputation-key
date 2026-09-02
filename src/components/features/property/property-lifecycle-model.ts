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

type LifecycleControls = Readonly<{
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
  statusLabel: LIFECYCLE_LABELS[input.lifecycleState],
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
