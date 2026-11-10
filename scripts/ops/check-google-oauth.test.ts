import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function runCheck(args: ReadonlyArray<string>) {
  return spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/ops/check-google-oauth.ts', ...args],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 60_000,
    },
  )
}

describe('check-google-oauth --help', () => {
  it('prints usage and exits 0 without an environment or a Google call', () => {
    const result = runCheck(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('usage: pnpm ops check-google-oauth\n')
    expect(result.stderr).toBe('')
  })

  it('prints usage when --help follows other arguments', () => {
    const result = runCheck(['extra', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('usage: pnpm ops check-google-oauth\n')
  })
})
