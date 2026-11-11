import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const OWN_ARGUMENT_COMMANDS: ReadonlyArray<readonly [name: string, file: string]> = [
  ['ai-control', 'ai-execution-control'],
  ['bootstrap-owner', 'bootstrap-owner'],
  ['disconnect-connection', 'disconnect-connection'],
  ['inspect', 'inspect-decision'],
  ['purge', 'enqueue-purge'],
  ['quarantine', 'quarantine-redrive'],
  ['queue', 'queue-quarantine'],
  ['reconcile-publication', 'reconcile-publication'],
  ['refresh', 'enqueue-refresh'],
]

function runHelp(file: string) {
  return spawnSync('pnpm', ['exec', 'tsx', `scripts/ops/${file}.ts`, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    input: '',
    timeout: 60_000,
  })
}

describe('--help on commands that check their own arguments', () => {
  it.each(OWN_ARGUMENT_COMMANDS)(
    '%s prints usage and exits 0 without any settings',
    (name, file) => {
      const result = runHelp(file)

      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(new RegExp(`^usage: .*pnpm ops ${name}\\b`))
      expect(result.stderr).toBe('')
    },
  )
})
