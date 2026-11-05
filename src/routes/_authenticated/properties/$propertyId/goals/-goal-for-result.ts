// A notification identifies a monthly result, not a goal. Resolve it only among goals
// visible to this viewer.

type GoalWithResults = Readonly<{
  program: Readonly<{ id: string }>
  results: ReadonlyArray<Readonly<{ id: string }>>
}>

/** The goal whose monthly results include `resultId`, or null. */
export const goalForResult = (
  programs: ReadonlyArray<GoalWithResults>,
  resultId: string,
): string | null =>
  programs.find(({ results }) => results.some(({ id }) => id === resultId))?.program.id ??
  null
