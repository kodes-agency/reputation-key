// Shared domain — how an operator-run action names its actor.
//
// A command run by a named operator (pnpm ops ...) records its actor as
// `ops:<handle>`. The prefix can never collide with a user identifier, so every
// reader that sees an actor id can tell a person from an operator by the id
// alone: the portal context writes it, the activity history files it as an
// operator, and the history readers show it under a fixed label.

export const OPERATOR_ACTOR_PREFIX = 'ops:'

export const isOperatorActorId = (id: string): boolean =>
  id.startsWith(OPERATOR_ACTOR_PREFIX)

/** The operator's handle, or null when the id is a user's (or has no handle). */
export const operatorHandleOf = (id: string): string | null => {
  if (!isOperatorActorId(id)) return null
  const handle = id.slice(OPERATOR_ACTOR_PREFIX.length)
  return handle.length > 0 ? handle : null
}
