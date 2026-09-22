// A goal notice's resource is the monthly result it reports, and its link is
// the Goals page with `?result=<id>` (notificationLink). The page opens the goal
// that result belongs to, among the goals this viewer can see.

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
