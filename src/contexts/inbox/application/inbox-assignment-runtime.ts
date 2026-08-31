// Inbox context — assignment lifecycle runtime.
//
// ARC-03-T12: replaces the root's `inbox.internal.commandStore` reach-through
// for member offboarding and eligibility reconciliation. Assignment is
// operational metadata, never an authority: the command store re-proves each
// requirement inside its own write transaction, so exposing exactly these two
// operations gives the seam everything it needs and nothing else.

import type { InboxCommandStore } from './ports/inbox-command-store.port'

export type InboxAssignmentRuntime = Readonly<{
  releaseAssignmentsForUser: InboxCommandStore['releaseAssignmentsForUser']
  releaseIneligibleAssignmentsForUser: InboxCommandStore['releaseIneligibleAssignmentsForUser']
}>

export function createInboxAssignmentRuntime(
  commandStore: InboxCommandStore,
): InboxAssignmentRuntime {
  return Object.freeze({
    releaseAssignmentsForUser: (input) => commandStore.releaseAssignmentsForUser(input),
    releaseIneligibleAssignmentsForUser: (input) =>
      commandStore.releaseIneligibleAssignmentsForUser(input),
  })
}
