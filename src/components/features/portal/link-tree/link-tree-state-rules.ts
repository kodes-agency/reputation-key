// Portal context — pure state-derivation rules for the link tree hook.

/**
 * Which inline form produced the create/update error currently on screen.
 *
 * `useActionMutation` exposes no `reset()`, and one mutation object is shared by
 * every inline-form instance — so a failure while adding a link to category A
 * used to render under category B's empty inputs. Remembering the originating
 * form (and clearing it whenever a form opens, cancels or succeeds) scopes the
 * error to the instance that caused it.
 */
export type ErrorScope =
  | 'create-category'
  | 'create-link'
  | 'update-category'
  | 'update-link'

/**
 * An error reaches an inline form only while that form is the one that fired the
 * shared mutation; every other form reads `null`.
 *
 * Generic in the error type so the hook's returned `*Error` fields keep the
 * mutation's own error type rather than widening to `unknown`.
 */
export function scopedError<TError>(
  activeScope: ErrorScope | null,
  scope: ErrorScope,
  error: TError,
): TError | null {
  return activeScope === scope ? error : null
}
