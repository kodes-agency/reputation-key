// The number a goal's page gives the plan it shows.
//
// Every change to a goal writes a version, and the Program numbers them all.
// A version replaced before it began (reporting CONTEXT.md, invariant 2) keeps
// a window that ends where it starts: it never covered a month. Counting it
// made a goal edited twice before its start read "Version: 3" with no version
// ever in force.

/** The part of a Goal Program version that says which window it covers. */
type VersionWindow = Readonly<{
  id: string
  effectiveFrom: Date
  effectiveTo: Date | null
}>

/**
 * The place of the plan shown among the goal's plans that were in force. A
 * plan replaced before it began is not counted; the plan shown always is, so
 * a goal ended before it started still shows its first plan.
 */
export function goalVersionNumber(
  versions: readonly VersionWindow[],
  shown: Readonly<{ id: string }>,
): number {
  return versions.filter(
    (version) =>
      version.id === shown.id ||
      version.effectiveTo === null ||
      version.effectiveTo > version.effectiveFrom,
  ).length
}
