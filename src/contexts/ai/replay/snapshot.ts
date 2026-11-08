type RevisionSnapshot = Readonly<{ count: number; digest: string }>

/** A changed population invalidates approval of the previous snapshot. */
export function planReplaySnapshot(
  stored: RevisionSnapshot,
  current: RevisionSnapshot,
  safetyCeiling: number,
):
  | Readonly<{ status: 'unchanged' }>
  | Readonly<{ status: 'refresh'; assistedApprovalRequired: boolean }> {
  if (stored.count === current.count && stored.digest === current.digest) {
    return { status: 'unchanged' }
  }
  return {
    status: 'refresh',
    assistedApprovalRequired: current.count > safetyCeiling,
  }
}
