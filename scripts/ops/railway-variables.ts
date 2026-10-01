// The variables of a deployed Railway service, as a map. Shared by the ops
// checks that need a few of them (Google OAuth, storage CORS).

import type { CommandRunner } from './deploy-ci-images'

export function readRailwayVariables(
  runner: CommandRunner,
  targetArgs: readonly string[],
  required: readonly string[],
): ReadonlyMap<string, string> {
  const args = ['variable', 'list', ...targetArgs, '--kv']
  const result = runner('railway', args)
  if (result.status !== 0) {
    // stderr only: stdout of a variable listing holds secrets.
    throw new Error(
      `railway ${args.join(' ')} failed: ${result.stderr.trim() || 'no diagnostic output'}`,
    )
  }
  const values = new Map<string, string>()
  for (const line of result.stdout.split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0)
      values.set(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  const missing = required.filter((name) => !values.get(name))
  if (missing.length > 0) {
    throw new Error(`the web service is missing ${missing.join(', ')}`)
  }
  return values
}
