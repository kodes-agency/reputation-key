// Atomic inbox command store.
//
// One PostgreSQL transaction per command commits the inbox state mutation,
// outbox facts, and any consumer receipt together.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back the state mutation, the
//   outbox rows, AND the receipt together: no state/outbox/receipt split is
//   ever observable.
// - A committed outbox row is the durable fact consumed by the relay.
// - createItem is idempotent on the (sourceType, sourceId, organizationId)
//   unique anchor: a conflicting concurrent insert re-selects the existing
//   row and records NO fact; the projection path and rebuild depend on this.
// - A guarded applyOnce transition that matches no row (lost TOCTOU race)
//   records the receipt but NO fact; redelivery converges, rebuild heals.

import type { Database } from '#/shared/db'
import type { InboxCommandStore } from '#/contexts/inbox/application/ports/inbox-command-store.port'
import type { InboxCommandAuthority } from '#/contexts/inbox/infrastructure/inbox-command-authority'
import { createCommandRuntime } from './command-runtime.server'
import { createAssignmentCommands } from './assignment-commands.server'
import { createNoteCommands } from './note-commands.server'
import { createSourceCommands } from './source-commands.server'
import { createStatusCommands } from './status-commands.server'

export type {
  InboxCommandAuthority,
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from '#/contexts/inbox/infrastructure/inbox-command-authority'

export const createAtomicInboxCommandStore = (
  db: Database,
  authorizeCommand: InboxCommandAuthority,
  clock: () => Date,
): InboxCommandStore => {
  const runtime = createCommandRuntime(db, authorizeCommand, clock)
  return {
    ...createAssignmentCommands(runtime),
    ...createStatusCommands(runtime),
    ...createNoteCommands(runtime),
    ...createSourceCommands(runtime),
  }
}
