import { describe, expect, it } from 'vitest'
import { buildSimulationInvocation } from '../../../scripts/simulation-invocation'

describe('simulation operator invocation', () => {
  it('passes a database-derived organization id as one argv value without a shell', () => {
    const hostile = 'org-1; touch /tmp/repkey-should-not-exist'

    const invocation = buildSimulationInvocation(hostile)

    expect(invocation.file).toBe(process.execPath)
    expect(invocation.args.slice(-3)).toEqual([
      'scripts/seed.ts',
      `--org=${hostile}`,
      '--invariants',
    ])
    expect(invocation.options.shell).toBe(false)
  })
})
