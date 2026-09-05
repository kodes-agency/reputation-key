import { describe, expect, it } from 'vitest'
import type { CapabilityRefusalReport } from '../../src/shared/governance/capability-refusal'
import { renderCapabilityRefusalReport } from './report-capability-refusal'

const REPORT: CapabilityRefusalReport = {
  capability: 'property.import_gbp_v2',
  allowed: false,
  decidedBy: 'google_execution_control',
  code: 'capability_killed',
  fate: {
    fate: 'controlled_beta',
    authority: 'Google discovery/import is active only through the governed import saga.',
    activation:
      'Requires persisted Organization and, where applicable, Property policy plus readiness gates.',
  },
  chain: [
    { authority: 'catalogue', outcome: 'pass', code: null, facts: [] },
    {
      authority: 'google_execution_control',
      outcome: 'refused',
      code: 'capability_killed',
      facts: [
        { name: 'denied', expected: 'false', observed: 'true' },
        { name: 'deniedAt', observed: '2026-09-02T10:00:00.000Z' },
      ],
    },
  ],
  permitOutcomes: [
    {
      state: 'fenced',
      correlationId: 'authorization_changed',
      count: 4,
      lastAt: '2026-09-02T10:01:00.000Z',
    },
  ],
}

describe('capability refusal operator report', () => {
  it('leads with the answer and renders both sides of comparisons before permit outcomes', () => {
    expect(renderCapabilityRefusalReport(REPORT)).toBe(
      [
        'REFUSED property.import_gbp_v2',
        '  deciding authority: google_execution_control',
        '  code: capability_killed',
        '  fate: controlled_beta',
        '  fate authority: Google discovery/import is active only through the governed import saga.',
        '  activation: Requires persisted Organization and, where applicable, Property policy plus readiness gates.',
        '  chain:',
        '    - catalogue: pass',
        '    - google_execution_control: refused (code=capability_killed)',
        '      denied: expected false, observed true',
        '      deniedAt: observed 2026-09-02T10:00:00.000Z',
        '  permit outcomes:',
        '    - state=fenced; correlationId=authorization_changed; count=4; lastAt=2026-09-02T10:01:00.000Z',
      ].join('\n'),
    )
  })

  it('rejects a refusal that has no observed facts', () => {
    expect(() =>
      renderCapabilityRefusalReport({
        ...REPORT,
        chain: [
          {
            authority: 'google_execution_control',
            outcome: 'refused',
            code: 'capability_killed',
            facts: [],
          },
        ],
      }),
    ).toThrow('missing facts for google_execution_control')
  })
})
