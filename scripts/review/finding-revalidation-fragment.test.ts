import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_REVIEW_SHA,
  validateFindingRevalidationFragment,
} from './finding-revalidation-fragment'

const COMPARISON_SHA = '1'.repeat(40)
const PLAN = `
### ARC-03 — Composition
### SAFE-02 — Session recovery
`
const REGISTER = `${JSON.stringify([
  {
    id: 'ARCH-01',
    severity: 'High',
    sourceLine: 10,
    summary: 'Historical composition gap.',
    targetPackages: ['ARC-03'],
  },
  {
    id: 'SEC-01',
    severity: 'High',
    sourceLine: 11,
    summary: 'Outside this fragment.',
    targetPackages: ['SAFE-02'],
  },
  {
    id: 'AUTH-01',
    severity: 'High',
    sourceLine: 12,
    summary: 'Historical session gap.',
    targetPackages: ['SAFE-02'],
  },
])}\n`

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

const frozenArchitecture = 'legacy composition marker\n'
const frozenAuth = 'legacy session marker\n'
const currentArchitecture = 'current composition marker\n'
const currentAuthTest = 'current session invariant\n'

function fixture(): Record<string, unknown> {
  return {
    version: 1,
    fragmentId: 'arch-auth-data-dec-evt',
    frozenSha: ACCEPTED_REVIEW_SHA,
    comparisonSha: COMPARISON_SHA,
    sourceRegisterSha256: hash(REGISTER),
    assessedAt: '2026-08-26',
    families: ['ARCH', 'AUTH', 'DATA', 'DEC', 'EVT'],
    evidence: {
      frozen: {
        'frozen.arch': {
          kind: 'git_file',
          path: 'architecture.ts',
          sha256: hash(frozenArchitecture),
          contains: ['legacy composition marker'],
        },
        'frozen.auth': {
          kind: 'git_file',
          path: 'auth.ts',
          sha256: hash(frozenAuth),
          contains: ['legacy session marker'],
        },
      },
      current: {
        'current.arch': {
          kind: 'git_tree',
          path: 'src/contexts',
          sha256: hash(currentArchitecture),
          includes: ['current composition marker'],
        },
        'current.auth': {
          kind: 'git_file',
          path: 'auth.test.ts',
          sha256: hash(currentAuthTest),
          contains: ['current session invariant'],
        },
      },
    },
    findings: [
      {
        id: 'ARCH-01',
        frozenPosition: 1,
        frozenSeverity: 'High',
        frozenSourceLine: 10,
        frozenSummary: 'Historical composition gap.',
        disposition: 'confirmed',
        reachability: 'active',
        impact: 'The active composition still has a maintenance cost.',
        ownerPackage: 'ARC-03',
        targetPackages: ['ARC-03'],
        frozenEvidence: ['frozen.arch'],
        currentEvidence: ['current.arch'],
        closure: {
          kind: 'planned_in_package',
          package: 'ARC-03',
          expected: 'Add the missing boundary and regression coverage.',
        },
        note: 'Current source retains the historical shape.',
      },
      {
        id: 'AUTH-01',
        frozenPosition: 3,
        frozenSeverity: 'High',
        frozenSourceLine: 12,
        frozenSummary: 'Historical session gap.',
        disposition: 'closed',
        reachability: 'not_reachable',
        impact: 'Older sessions remained usable after password recovery.',
        ownerPackage: 'SAFE-02',
        targetPackages: ['SAFE-02'],
        frozenEvidence: ['frozen.auth'],
        currentEvidence: ['current.auth'],
        closure: {
          kind: 'verified_current',
          evidence: ['current.auth'],
          expected: 'The current regression test requires session revocation.',
        },
        note: 'The current regression closes the historical behavior.',
      },
    ],
  }
}

const readers = {
  readFileAt(revision: string, path: string) {
    if (revision === ACCEPTED_REVIEW_SHA && path === 'architecture.ts') {
      return Buffer.from(frozenArchitecture)
    }
    if (revision === ACCEPTED_REVIEW_SHA && path === 'auth.ts') {
      return Buffer.from(frozenAuth)
    }
    if (revision === COMPARISON_SHA && path === 'auth.test.ts') {
      return Buffer.from(currentAuthTest)
    }
    throw new Error(`unexpected file read ${revision}:${path}`)
  },
  listTreeAt(revision: string, path: string) {
    if (revision === COMPARISON_SHA && path === 'src/contexts') {
      return Buffer.from(currentArchitecture)
    }
    throw new Error(`unexpected tree read ${revision}:${path}`)
  },
  searchAt(revision: string, pattern: string, pathspecs: readonly string[]) {
    throw new Error(`unexpected search ${revision}:${pattern}:${pathspecs.join(',')}`)
  },
  isAncestor(ancestor: string, descendant: string) {
    return ancestor === ACCEPTED_REVIEW_SHA && descendant === COMPARISON_SHA
  },
}

describe('isolated finding revalidation fragment', () => {
  it('accepts complete ordered evidence tied to both immutable revisions', () => {
    expect(
      validateFindingRevalidationFragment(fixture(), REGISTER, PLAN, readers),
    ).toEqual(['ARCH-01', 'AUTH-01'])
  })

  it('rejects omitted or reordered selected findings', () => {
    const omitted = fixture()
    omitted.findings = (structuredClone(omitted.findings) as unknown[]).slice(1)
    expect(() =>
      validateFindingRevalidationFragment(omitted, REGISTER, PLAN, readers),
    ).toThrow('every selected frozen finding once and in order')

    const reordered = fixture()
    reordered.findings = (structuredClone(reordered.findings) as unknown[]).reverse()
    expect(() =>
      validateFindingRevalidationFragment(reordered, REGISTER, PLAN, readers),
    ).toThrow('every selected frozen finding once and in order')
  })

  it('rejects a family list that does not match the fragment identifier', () => {
    const mismatched = fixture()
    mismatched.families = ['GATE', 'GOV', 'OPS']

    expect(() =>
      validateFindingRevalidationFragment(mismatched, REGISTER, PLAN, readers),
    ).toThrow('fragment families must match its governed fragment identifier')
  })

  it('rejects changed digests and source markers', () => {
    const changedDigest = fixture()
    const evidence = structuredClone(changedDigest.evidence) as {
      frozen: Record<string, { sha256: string }>
    }
    evidence.frozen['frozen.arch']!.sha256 = '0'.repeat(64)
    changedDigest.evidence = evidence
    expect(() =>
      validateFindingRevalidationFragment(changedDigest, REGISTER, PLAN, readers),
    ).toThrow('digest differs')

    const changedMarker = fixture()
    const markerEvidence = structuredClone(changedMarker.evidence) as {
      frozen: Record<string, { contains: string[] }>
    }
    markerEvidence.frozen['frozen.arch']!.contains = ['missing marker']
    changedMarker.evidence = markerEvidence
    expect(() =>
      validateFindingRevalidationFragment(changedMarker, REGISTER, PLAN, readers),
    ).toThrow('does not contain "missing marker"')
  })

  it('rejects register drift, unknown proof references, and unused proof rows', () => {
    const changedTarget = fixture()
    const findings = structuredClone(changedTarget.findings) as Array<{
      targetPackages: string[]
    }>
    findings[0]!.targetPackages = ['SAFE-02']
    changedTarget.findings = findings
    expect(() =>
      validateFindingRevalidationFragment(changedTarget, REGISTER, PLAN, readers),
    ).toThrow('target packages differ')

    const unknownProof = fixture()
    const proofFindings = structuredClone(unknownProof.findings) as Array<{
      currentEvidence: string[]
    }>
    proofFindings[0]!.currentEvidence = ['current.missing']
    unknownProof.findings = proofFindings
    expect(() =>
      validateFindingRevalidationFragment(unknownProof, REGISTER, PLAN, readers),
    ).toThrow('unknown current evidence')

    const unusedProof = fixture()
    const unusedEvidence = structuredClone(unusedProof.evidence) as {
      current: Record<string, unknown>
    }
    unusedEvidence.current['current.unused'] = {
      kind: 'git_file',
      path: 'unused.ts',
      sha256: hash('unused'),
      contains: ['unused'],
    }
    unusedProof.evidence = unusedEvidence
    expect(() =>
      validateFindingRevalidationFragment(unusedProof, REGISTER, PLAN, readers),
    ).toThrow('unused current evidence')
  })

  it('rejects closure semantics that overstate current evidence', () => {
    const plannedClosed = fixture()
    const findings = structuredClone(plannedClosed.findings) as Array<{
      closure: Record<string, unknown>
    }>
    findings[1]!.closure = {
      kind: 'planned_in_package',
      package: 'SAFE-02',
      expected: 'Future work is not a verified closure.',
    }
    plannedClosed.findings = findings
    expect(() =>
      validateFindingRevalidationFragment(plannedClosed, REGISTER, PLAN, readers),
    ).toThrow('closed finding requires verified current evidence')

    const wrongClosureProof = fixture()
    const closureFindings = structuredClone(wrongClosureProof.findings) as Array<{
      closure: { evidence?: string[] }
    }>
    closureFindings[1]!.closure.evidence = ['current.arch']
    wrongClosureProof.findings = closureFindings
    expect(() =>
      validateFindingRevalidationFragment(wrongClosureProof, REGISTER, PLAN, readers),
    ).toThrow('closure evidence is not current finding evidence')
  })

  it('rejects a comparison revision outside the frozen review lineage', () => {
    expect(() =>
      validateFindingRevalidationFragment(fixture(), REGISTER, PLAN, {
        ...readers,
        isAncestor: () => false,
      }),
    ).toThrow('comparison revision must descend from the frozen review SHA')
  })
})

describe('repository ARCH/AUTH/DATA/DEC/EVT fragment', () => {
  it('validates all 52 selected rows against immutable repository evidence', () => {
    const root = process.cwd()
    const fragment = JSON.parse(
      readFileSync(
        join(
          root,
          'docs/release-evidence/review/finding-revalidation-fragments/arch-auth-data-dec-evt-2026-08-26.json',
        ),
        'utf8',
      ),
    ) as unknown
    const register = readFileSync(
      join(
        root,
        'docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/local-darwin-arm64-node22.23.2/finding-register.json',
      ),
      'utf8',
    )
    const plan = readFileSync(
      join(root, 'docs/comprehensive-beta-implementation-program-2026-08-25.md'),
      'utf8',
    )

    expect(validateFindingRevalidationFragment(fragment, register, plan)).toHaveLength(52)
  })
})
