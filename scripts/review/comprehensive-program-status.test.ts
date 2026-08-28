import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateComprehensiveProgramStatus } from './comprehensive-program-status'

const PLAN = `
### FND-01 — Freeze baseline
### SAFE-01 — Public edge safety
`

describe('comprehensive program status', () => {
  it('tracks implementation, repository verification, and external verification independently', () => {
    expect(
      validateComprehensiveProgramStatus('### FND-01 — Freeze baseline', {
        version: 2,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-27',
        packages: [
          {
            id: 'FND-01',
            summary: 'Repository implementation is complete; live proof remains blocked.',
            implementation: { status: 'complete', remaining: [] },
            repositoryVerification: {
              status: 'passed',
              remaining: [],
            },
            externalVerification: {
              status: 'blocked',
              remaining: ['Capture the live required-check configuration.'],
              blockers: ['Requires repository administration access.'],
            },
            codeEvidence: ['docs/evidence.json'],
            testEvidence: ['42/42 repository checks passed'],
          },
        ],
      }),
    ).toEqual(['FND-01'])
  })

  it('accepts exactly one status row for every package in plan order', () => {
    expect(
      validateComprehensiveProgramStatus(PLAN, {
        version: 2,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'FND-01',
            summary: 'Baseline evidence exists but package closure is not recorded.',
            implementation: {
              status: 'in_progress',
              remaining: ['Publish the package implementation record.'],
            },
            repositoryVerification: {
              status: 'in_progress',
              remaining: ['Run final repository gates.'],
            },
            externalVerification: {
              status: 'not_required',
              remaining: [],
              blockers: [],
            },
            codeEvidence: ['docs/release-evidence/review/baseline/README.md'],
            testEvidence: [],
          },
          {
            id: 'SAFE-01',
            summary: 'No current evidence has been assessed.',
            implementation: {
              status: 'not_started',
              remaining: ['Assess and implement the package.'],
            },
            repositoryVerification: {
              status: 'not_started',
              remaining: ['Verify the package after implementation.'],
            },
            externalVerification: {
              status: 'not_required',
              remaining: [],
              blockers: [],
            },
            codeEvidence: [],
            testEvidence: [],
          },
        ],
      }),
    ).toEqual(['FND-01', 'SAFE-01'])
  })

  it('refuses an evidence-complete claim without a package completion record', () => {
    expect(() =>
      validateComprehensiveProgramStatus('### FND-01 — Freeze baseline', {
        version: 2,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'FND-01',
            summary: 'Claimed complete without the required evidence record.',
            implementation: { status: 'complete', remaining: [] },
            repositoryVerification: { status: 'passed', remaining: [] },
            externalVerification: {
              status: 'not_required',
              remaining: [],
              blockers: [],
            },
            codeEvidence: ['docs/evidence.json'],
            testEvidence: ['tests/gates.log'],
          },
        ],
      }),
    ).toThrow('FND-01 cannot close without a completionRecord')
  })

  it('requires an explicit dependency for an externally blocked package', () => {
    expect(() =>
      validateComprehensiveProgramStatus('### LEG-01 — Counsel approval', {
        version: 2,
        baselineSha: '718fad1807b7422885584660bd3580f2a3a49113',
        assessedAt: '2026-08-26',
        packages: [
          {
            id: 'LEG-01',
            summary: 'Awaiting external approval.',
            implementation: {
              status: 'in_progress',
              remaining: ['Finish repository-owned notice preparation.'],
            },
            repositoryVerification: {
              status: 'not_started',
              remaining: ['Review the finished notice package.'],
            },
            externalVerification: {
              status: 'blocked',
              remaining: ['Obtain approval.'],
              blockers: [],
            },
            codeEvidence: [],
            testEvidence: [],
          },
        ],
      }),
    ).toThrow('LEG-01 blocked external verification must name its blockers')
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
