// Which Property lifecycle states still belong in the operator's workspace.
//
// Removing a Property is recoverable: Archive holds it for 30 days, so a removed
// Property is withheld from the working lists rather than destroyed. It stays
// listed under "Removed" — where Restore brings it back — because a Property
// that simply vanishes with no trace is indistinguishable from one lost to a bug.
//
// Components redeclare the lifecycle vocabulary rather than importing the
// Property domain, matching property-lifecycle-card.tsx.

const WORKSPACE_STATES: ReadonlySet<string> = new Set(['active', 'suspended'])

/** Terminal state that retains only evidence records — nothing left to list. */
const PURGED_STATE = 'purged'

export function isWorkspaceProperty(lifecycleState: string): boolean {
  return WORKSPACE_STATES.has(lifecycleState)
}

export type PartitionedProperties<T> = Readonly<{
  workspace: readonly T[]
  removed: readonly T[]
}>

export function partitionWorkspaceProperties<
  T extends Readonly<{ lifecycleState: string }>,
>(properties: readonly T[]): PartitionedProperties<T> {
  const workspace: T[] = []
  const removed: T[] = []
  for (const property of properties) {
    if (isWorkspaceProperty(property.lifecycleState)) workspace.push(property)
    else if (property.lifecycleState !== PURGED_STATE) removed.push(property)
  }
  return Object.freeze({
    workspace: Object.freeze(workspace),
    removed: Object.freeze(removed),
  })
}
