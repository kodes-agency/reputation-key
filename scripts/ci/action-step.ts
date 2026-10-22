// Plumbing shared by the small scripts that GitHub Actions steps run with plain
// Node (sync-triage-board.ts, sentry-release-commits.ts): reading a required
// variable, and turning the step's outcome into log lines and an exit code.
// A failure prints as a workflow `::error::` so it shows on the run's summary,
// with the error's cause: Node's `fetch failed` says nothing without it.

/** A variable the step cannot run without; `hint` says how to provide it. */
export function requiredEnv(env: NodeJS.ProcessEnv, name: string, hint = ''): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is empty${hint}`)
  return value
}

/** The error's message, followed by its cause's when it has one. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return `${error.message}${cause}`
}

/** Runs the step, prints the lines it reports, and returns the exit code. */
export async function runActionStep(
  step: () => Promise<readonly string[]>,
): Promise<number> {
  try {
    for (const line of await step()) console.log(line)
    return 0
  } catch (error) {
    console.error(`::error::${describeFailure(error)}`)
    return 1
  }
}
