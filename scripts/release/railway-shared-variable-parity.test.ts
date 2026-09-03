import { describe, expect, it } from 'vitest'
import {
  compareSharedVariableParity,
  formatSharedVariableParityReport,
} from './railway-shared-variable-parity'

describe('Railway application shared-variable parity', () => {
  it('reports matching set and unset variables in declaration order', () => {
    const results = compareSharedVariableParity(
      ['SET_KEY', 'UNSET_KEY'],
      [
        { service: 'web', variables: { SET_KEY: 'same-secret' } },
        { service: 'worker', variables: { SET_KEY: 'same-secret' } },
      ],
    )

    expect(results).toEqual([
      { name: 'SET_KEY', status: 'match', availability: 'set' },
      { name: 'UNSET_KEY', status: 'match', availability: 'unset' },
    ])
  })

  it('reports divergent and missing values as opaque service-specific groups', () => {
    const results = compareSharedVariableParity(
      ['DIVERGED', 'MISSING'],
      [
        {
          service: 'web',
          variables: { DIVERGED: 'web-secret', MISSING: 'present-secret' },
        },
        { service: 'worker', variables: { DIVERGED: 'worker-secret' } },
      ],
    )
    const report = formatSharedVariableParityReport(
      'google-closed-beta',
      ['web', 'worker'],
      results,
    )

    expect(results).toEqual([
      {
        name: 'DIVERGED',
        status: 'mismatch',
        observations: [
          { service: 'web', valueGroup: 'value#1' },
          { service: 'worker', valueGroup: 'value#2' },
        ],
      },
      {
        name: 'MISSING',
        status: 'mismatch',
        observations: [
          { service: 'web', valueGroup: 'value#1' },
          { service: 'worker', valueGroup: '<unset>' },
        ],
      },
    ])
    expect(report).toContain('FAIL DIVERGED: web=value#1, worker=value#2')
    expect(report).toContain('FAIL MISSING: web=value#1, worker=<unset>')
    expect(report).not.toContain('web-secret')
    expect(report).not.toContain('worker-secret')
    expect(report).not.toContain('present-secret')
  })
})
