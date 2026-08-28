// LIF-01-T19 — the support-mediated permanent Property Erase state machine.
//
// POSTURE, first, because it is the thing most likely to be got wrong:
// `property.erase` is DISABLED in capability-fate.ts and is a member of
// BLOCKED_CAPABILITIES in beta-capabilities.ts. It STAYS blocked as a tenant
// capability. Nothing in this module is reachable from a route, a server
// function or a tenant capability check. The only entry point is an operator
// command carrying an INDEPENDENT support authorization reference.
//
// An AccountAdmin may REQUEST erasure. Requesting is not authorizing. The two
// authorities are deliberately different people with different evidence:
//
//   requester  -> the current AccountAdmin, identity-verified
//   authorizer -> a registered operator plus a support authorization reference
//                 that is not derived from the tenant session
//
// The irreversible boundary is `purge_pending -> purging`. Before it, the
// erasure can still be cancelled and the Property recovered. After it, the
// Property's rows are being destroyed and there is nothing to go back to.

import { createErrorFactory } from '#/shared/domain/errors'

/**
 * Erase failures carry their OWN tag, deliberately not `PropertyError`.
 *
 * `propertyErrorStatus` maps every `PropertyError` code to an HTTP status with
 * an exhaustive match. Reusing that union would mean every erase refusal has an
 * HTTP status waiting for it — an invitation to wire a route later. A separate
 * tag makes the absence of a tenant-facing path structural: there is nothing to
 * map, so nothing can be mapped by accident.
 */
export type PropertyEraseErrorCode =
  | 'invalid_transition'
  | 'irreversible_state'
  | 'property_not_archived'
  | 'requester_not_account_admin'
  | 'support_authorization_missing'
  | 'identity_verification_missing'
  | 'confirmation_mismatch'
  | 'stale_inventory_revision'
  | 'preview_missing'
  | 'authority_not_found'

export type PropertyEraseError = Readonly<{
  _tag: 'PropertyEraseError'
  code: PropertyEraseErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const propertyEraseError = createErrorFactory<
  PropertyEraseError['_tag'],
  PropertyEraseError['code']
>('PropertyEraseError')

export const isPropertyEraseError = (error: unknown): error is PropertyEraseError =>
  typeof error === 'object' &&
  error !== null &&
  (error as { _tag?: string })._tag === 'PropertyEraseError'

export type PropertyEraseState =
  | 'requested'
  | 'previewed'
  | 'confirmed'
  | 'purge_pending'
  | 'purging'
  | 'purged'
  | 'cancelled'

/**
 * Valid transitions.
 *
 * `previewed -> previewed` is allowed on purpose: re-running the preview after
 * the tenant's data changed produces a NEW inventory revision, and confirming
 * against a stale revision is refused. Re-previewing must therefore be cheap.
 */
const VALID_ERASE_TRANSITIONS: Readonly<
  Record<PropertyEraseState, readonly PropertyEraseState[]>
> = {
  requested: ['previewed', 'cancelled'],
  previewed: ['previewed', 'confirmed', 'cancelled'],
  confirmed: ['purge_pending', 'cancelled'],
  purge_pending: ['purging', 'cancelled'],
  purging: ['purged'],
  purged: [],
  cancelled: [],
}

/** The last state from which an erasure can still be called off. */
export const PROPERTY_ERASE_LAST_CANCELLABLE_STATE: PropertyEraseState = 'purge_pending'

/** States past the irreversible boundary. */
const IRREVERSIBLE_ERASE_STATES: ReadonlySet<PropertyEraseState> = new Set([
  'purging',
  'purged',
])

export function isPropertyEraseIrreversible(state: PropertyEraseState): boolean {
  return IRREVERSIBLE_ERASE_STATES.has(state)
}

export function isValidPropertyEraseTransition(
  from: PropertyEraseState,
  to: PropertyEraseState,
): boolean {
  return VALID_ERASE_TRANSITIONS[from].includes(to)
}

/**
 * Assert a transition.
 *
 * Cancellation past the boundary gets its own error code rather than the
 * generic invalid-transition one: an operator who tries to call off a running
 * purge needs to be told that the data is already gone, not that they picked a
 * bad state name.
 */
export function assertValidPropertyEraseTransition(
  from: PropertyEraseState,
  to: PropertyEraseState,
): void {
  if (to === 'cancelled' && isPropertyEraseIrreversible(from)) {
    throw propertyEraseError(
      'irreversible_state',
      `Property erase cannot be cancelled from "${from}" — purging is irreversible`,
      { state: from },
    )
  }
  if (!isValidPropertyEraseTransition(from, to)) {
    throw propertyEraseError(
      'invalid_transition',
      `Invalid property erase transition from "${from}" to "${to}"`,
      { from, to },
    )
  }
}

/**
 * The exact phrase an AccountAdmin must type to confirm.
 *
 * It names the Property, so a confirmation copied from one erasure cannot
 * authorize another.
 */
export function propertyEraseConfirmationPhrase(propertyId: string): string {
  return `ERASE PROPERTY ${propertyId}`
}

/**
 * Exact, case-sensitive match after trimming surrounding whitespace only.
 *
 * Case folding or fuzzy matching would defeat the point: the confirmation is a
 * deliberate friction step, not a checkbox.
 */
export function matchesPropertyEraseConfirmation(
  propertyId: string,
  typed: string,
): boolean {
  return typed.trim() === propertyEraseConfirmationPhrase(propertyId)
}

/**
 * The `properties.lifecycle_state` an erase state implies.
 *
 * Property Erase drives the lifecycle column that BETA-1 B1.5 declared and
 * nothing ever advanced. States before confirmation leave the Property in its
 * existing archived state — a request is not a lifecycle change.
 */
export function propertyLifecycleStateForErase(
  state: PropertyEraseState,
): 'archived' | 'purge_pending' | 'purging' | 'purged' {
  switch (state) {
    case 'purge_pending':
      return 'purge_pending'
    case 'purging':
      return 'purging'
    case 'purged':
      return 'purged'
    default:
      return 'archived'
  }
}
