// Every sidecar environment contract requires a concrete 40-hex `RELEASE_SHA`
// (services/*/environment.ts). The signed promotion controller writes that
// variable per service; a Railway GitHub-triggered build does not, but it
// injects the built revision as `RAILWAY_GIT_COMMIT_SHA` at build and run time.
//
// Adopt it exactly once, at process start, and only when no controller-owned
// `RELEASE_SHA` exists — the same precedence the application uses
// (`getReleaseSha`: RELEASE_SHA ?? RAILWAY_GIT_COMMIT_SHA). A value that is not
// a git revision is left alone so the environment contract keeps refusing it.

const GIT_REVISION = /^[0-9a-f]{40}$/u

export function adoptGitRevisionAsReleaseSha(
  env: Record<string, string | undefined>,
): void {
  if (env.RELEASE_SHA) return
  const revision = env.RAILWAY_GIT_COMMIT_SHA
  if (revision !== undefined && GIT_REVISION.test(revision)) {
    env.RELEASE_SHA = revision
  }
}
