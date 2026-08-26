import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateComprehensiveProgramStatus } from './comprehensive-program-status'

const PLAN = `
### FND-01 — Freeze baseline
### SAFE-01 — Public edge safety
`

describe('comprehensive program status', () => {
  it('accepts exactly one status row for every package in plan order', () => {
    expect(
      validateComprehensiveProgramStatus(PLAN, {
        version: 1,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'FND-01',
            status: 'partial',
            summary: 'Baseline evidence exists but package closure is not recorded.',
            codeEvidence: ['docs/release-evidence/review/baseline/README.md'],
            testEvidence: [],
            remaining: ['Publish the package completion record.'],
            externalBlockers: [],
          },
          {
            id: 'SAFE-01',
            status: 'not_started',
            summary: 'No current evidence has been assessed.',
            codeEvidence: [],
            testEvidence: [],
            remaining: ['Assess the package against current HEAD.'],
            externalBlockers: [],
          },
        ],
      }),
    ).toEqual(['FND-01', 'SAFE-01'])
  })

  it('refuses an evidence-complete claim without a package completion record', () => {
    expect(() =>
      validateComprehensiveProgramStatus('### FND-01 — Freeze baseline', {
        version: 1,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'FND-01',
            status: 'evidence_complete',
            summary: 'Claimed complete without the required evidence record.',
            codeEvidence: ['docs/evidence.json'],
            testEvidence: ['tests/gates.log'],
            remaining: [],
            externalBlockers: [],
          },
        ],
      }),
    ).toThrow('FND-01 cannot be evidence_complete without a completionRecord')
  })

  it('requires an explicit dependency for an externally blocked package', () => {
    expect(() =>
      validateComprehensiveProgramStatus('### LEG-01 — Counsel approval', {
        version: 1,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'LEG-01',
            status: 'blocked_external',
            summary: 'Awaiting external approval.',
            codeEvidence: [],
            testEvidence: [],
            remaining: ['Obtain approval.'],
            externalBlockers: [],
          },
        ],
      }),
    ).toThrow('LEG-01 blocked_external status must name its externalBlockers')
  })

  it('validates the checked-in 42-package assessment against the accepted plan', () => {
    const plan = readFileSync(
      resolve('docs/comprehensive-beta-implementation-program-2026-08-25.md'),
      'utf8',
    )
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          'docs/release-evidence/review/comprehensive-program-status-2026-08-26.json',
        ),
        'utf8',
      ),
    ) as unknown

    expect(validateComprehensiveProgramStatus(plan, ledger)).toHaveLength(42)
  })
})
