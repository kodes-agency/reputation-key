/** The pending flag every `Action` carries — the only field this module reads. */
type PendingCommand = Readonly<{ isPending: boolean }>

/**
 * The six item commands that share one `commandRevision` fence.
 *
 * `InboxDetailState` satisfies this structurally, so the pane can pass itself
 * and a component holding only some of the Actions can assemble the set.
 */
export type InboxHeaderCommands = Readonly<{
  updateStatus: PendingCommand
  escalate: PendingCommand
  resolveEscalation: PendingCommand
  assign: PendingCommand
  markFeedbackHandled: PendingCommand
  correctFeedbackHandlingOutcome: PendingCommand
}>

/**
 * Any in-flight item command disables every other one. All six are fenced on
 * the same `commandRevision`, so a second command issued while one is in
 * flight ships a revision that is about to go stale: it takes the
 * conflict-retry path, and an out-of-order settle can write a stale item back
 * into the detail cache. One predicate, so no control can lock a narrower set
 * than its siblings.
 */
export function isHeaderCommandPending(commands: InboxHeaderCommands): boolean {
  return (
    commands.updateStatus.isPending ||
    commands.escalate.isPending ||
    commands.resolveEscalation.isPending ||
    commands.assign.isPending ||
    commands.markFeedbackHandled.isPending ||
    commands.correctFeedbackHandlingOutcome.isPending
  )
}
