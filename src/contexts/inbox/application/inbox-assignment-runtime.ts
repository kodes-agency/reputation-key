// Inbox context — assignment lifecycle runtime.
//
// The one operation eligibility reconciliation needs from the command store.
// Assignment is operational metadata, never an authority: the command store re-proves each
// requirement inside its own write transaction, so exposing exactly this
// operation gives the seam everything it needs and nothing else.

import type { InboxCommandStore } from './ports/inbox-command-store.port'

export type InboxAssignmentRuntime = Readonly<{
  releaseIneligibleAssignmentsForUser: InboxCommandStore['releaseIneligibleAssignmentsForUser']
}>

export function createInboxAssignmentRuntime(
  commandStore: InboxCommandStore,
): InboxAssignmentRuntime {
  return Object.freeze({
    releaseIneligibleAssignmentsForUser: (input, tx) =>
      commandStore.releaseIneligibleAssignmentsForUser(input, tx),
  })
}
