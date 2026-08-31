export const normalizeResponsibleManagerIds = (ids: readonly string[]) =>
  [...new Set(ids)].sort()

export const sameResponsibleManagerIds = (
  left: readonly string[],
  right: readonly string[],
) => left.length === right.length && left.every((id, index) => id === right[index])

/** Adopt server refreshes only while the local form is still clean. */
export const reconcileResponsibleManagerSelection = (
  current: readonly string[],
  previousServer: readonly string[],
  nextServer: readonly string[],
): string[] =>
  sameResponsibleManagerIds(current, previousServer)
    ? normalizeResponsibleManagerIds(nextServer)
    : [...current]
