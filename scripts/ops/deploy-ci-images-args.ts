const USAGE =
  'pnpm ops deploy-ci-images [--sha <source-revision>] [--apply] | --verify-only --run <ci-run-id>'

export function parseDeployCiImagesArgs(argv: readonly string[]): {
  revision: string | undefined
  apply: boolean
  verifyRun: number | undefined
} {
  const switches = new Set<string>()
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (token === '--apply' || token === '--verify-only') {
      switches.add(token)
    } else if (token === '--sha' || token === '--run') {
      const value = argv[++index]
      if (!value || values.has(token)) throw new Error(`usage: ${USAGE}`)
      values.set(token, value)
    } else {
      throw new Error(`usage: ${USAGE}`)
    }
  }
  const apply = switches.has('--apply')
  const revision = values.get('--sha')
  const run = values.get('--run')
  const verifyOnly = switches.has('--verify-only')
  // Verifying never deploys, so it takes a run and neither a revision nor
  // --apply; a run id means nothing to a deploy.
  const validUsage = verifyOnly ? run !== undefined && !apply && !revision : !run
  if (!validUsage || (run !== undefined && !/^[1-9][0-9]*$/u.test(run))) {
    throw new Error(`usage: ${USAGE}`)
  }
  return { revision, apply, verifyRun: run === undefined ? undefined : Number(run) }
}
