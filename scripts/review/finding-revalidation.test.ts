import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_REVIEW_BASELINE_SHA,
  validateFindingRevalidation,
} from './finding-revalidation'

const PLAN = `
### FND-01 — Freeze baseline
### SAFE-01 — Public edge safety
`

const REGISTER = `${JSON.stringify([
  { id: 'GATE-01', targetPackages: ['FND-01'] },
  { id: 'SEC-01', targetPackages: ['SAFE-01'] },
])}\n`

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function fixture(): Record<string, unknown> {
  return {
    version: 1,
    frozenSha: ACCEPTED_REVIEW_BASELINE_SHA,
    sourceRegisterSha256: digest(REGISTER),
    assessedAt: '2026-08-26',
    findings: [
      {
        id: 'GATE-01',
        disposition: 'reproduced',
        ownerPackage: 'FND-01',
        targetPackages: ['FND-01'],
        reachability: 'active',
        impact: 'Release evidence was incomplete.',
        frozenEvidence: [
          { kind: 'git_source', path: 'one.ts', contains: ['old behavior'] },
        ],
        closure: {
          kind: 'current_test',
          path: 'one.test.ts',
          contains: ['current invariant'],
          expected: 'The release invariant is checked.',
        },
        note: 'The historical result is retained without copying stale claims.',
      },
      {
        id: 'SEC-01',
        disposition: 'confirmed',
        ownerPackage: 'SAFE-01',
        targetPackages: ['SAFE-01'],
        reachability: 'controlled',
        impact: 'A controlled workflow lacked a validation step.',
        frozenEvidence: [
          { kind: 'git_source', path: 'two.ts', contains: ['legacy path'] },
        ],
        closure: {
          kind: 'planned_in_package',
          package: 'SAFE-01',
          expected: 'Add the missing validation and its regression test.',
        },
        note: 'The finding remains assigned to its implementation package.',
      },
    ],
  }
}

const readers = {
  readFrozenSource(path: string) {
    return path === 'one.ts' ? 'old behavior' : 'legacy path'
  },
  readCurrentFile(path: string) {
    return Buffer.from(path === 'one.test.ts' ? 'current invariant' : '')
  },
}

describe('frozen finding revalidation', () => {
  it('accepts a complete, assigned, evidence-linked register', () => {
    expect(validateFindingRevalidation(fixture(), REGISTER, PLAN, readers)).toEqual([
      'GATE-01',
      'SEC-01',
    ])
  })

  it('rejects omitted or reordered findings', () => {
    const input = fixture()
    input.findings = (structuredClone(input.findings) as unknown[]).slice(1)
    expect(() => validateFindingRevalidation(input, REGISTER, PLAN, readers)).toThrow(
      'every frozen finding exactly once and in order',
    )
  })

  it('rejects changed evidence and an unassigned closure package', () => {
    const changedEvidence = fixture()
    const findings = structuredClone(changedEvidence.findings) as Array<{
      frozenEvidence: Array<{ contains: string[] }>
    }>
    findings[0]!.frozenEvidence[0]!.contains = ['not present']
    changedEvidence.findings = findings
    expect(() =>
      validateFindingRevalidation(changedEvidence, REGISTER, PLAN, readers),
    ).toThrow('does not contain "not present"')

    const wrongPackage = fixture()
    const packageFindings = structuredClone(wrongPackage.findings) as Array<{
      closure: Record<string, unknown>
    }>
    packageFindings[1]!.closure = {
      kind: 'planned_in_package',
      package: 'FND-01',
      expected: 'Wrong assignment.',
    }
    wrongPackage.findings = packageFindings
    expect(() =>
      validateFindingRevalidation(wrongPackage, REGISTER, PLAN, readers),
    ).toThrow('closure package is not assigned')
  })
})
