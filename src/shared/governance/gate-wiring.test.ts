// Gate wiring contract — the guard against silently un-wiring a CI gate.
//
// Why this file exists: on 2026-08-22 the closed-beta velocity change split
// `lint` (fast: eslint + filenames + component boundaries) from `lint:ci`
// (+ test-quality + the three byte-attested Google/AI artifact gates), deleted
// the coverage gate and the changed-code budget, and shortened the pre-push
// hook. Two of those moves were wrong in ways nothing would have caught:
//
//   * `bqc:run-baseline` kept invoking the FAST `lint`, so the release baseline
//     would have silently stopped running the artifact attestations;
//   * the changed-code budget cost 2s and was the only thing requiring a
//     colocated test for a new production file — deleting it bought nothing.
//
// These assertions pin the wiring, not the implementations: every gate must
// have a named home, and the fast local chain must be a SUBSET of the CI chain.
// A deliberate future change edits this file with the reasoning; an accidental
// one fails here instead of six weeks later in a coverage audit.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')

const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
}
const ciWorkflow = read('.github/workflows/ci.yml')
const prePush = read('.husky/pre-push')
const runBaseline = read('scripts/bqc/run-baseline.ts')

/** The gates that must never be droppable from the CI lint chain. */
const ARTIFACT_GATES = [
  'check:google-provider-fixtures',
  'check:ai-contract-attestations',
  'check:ai-governance-artifacts',
] as const

describe('lint chain', () => {
  it('makes lint:ci a strict superset of lint', () => {
    const { lint, 'lint:ci': lintCi } = packageJson.scripts
    expect(lint).toBeTruthy()
    // Composition, not duplication: lint:ci runs `pnpm lint` and then adds.
    // Anything added to `lint` is therefore automatically covered in CI.
    expect(lintCi).toMatch(/^pnpm lint\b/)
    expect(lintCi.length).toBeGreaterThan((lint as string).length)
  })

  it('keeps the byte-attested artifact gates in lint:ci', () => {
    for (const gate of ARTIFACT_GATES) {
      expect(packageJson.scripts['lint:ci']).toContain(gate)
    }
  })

  it('runs lint:ci — not the fast lint — in the CI check job', () => {
    expect(ciWorkflow).toContain('run: pnpm lint:ci')
    expect(ciWorkflow).not.toMatch(/run: pnpm lint\s*$/m)
  })

  it('runs lint:ci — not the fast lint — in the release baseline', () => {
    // scripts/bqc/run-baseline.ts is the full-battery release evidence run; its
    // gate list does not separately invoke the artifact attestations, so the
    // fast lint would silently drop three gates from the baseline.
    expect(runBaseline).toContain("command: 'pnpm lint:ci'")
    expect(runBaseline).not.toContain("command: 'pnpm lint'")
  })
})

describe('coverage and changed-code gates', () => {
  it('runs the changed-code budget on every check run', () => {
    expect(packageJson.scripts['check:changed-code']).toBe(
      'node scripts/check-changed-code.mjs',
    )
    expect(ciWorkflow).toContain('run: pnpm check:changed-code')
  })

  it('runs the coverage gate on main pushes only', () => {
    expect(packageJson.scripts['check:coverage']).toBe('node scripts/check-coverage.mjs')
    // The gate itself is not the cost — re-running the unit suite under v8
    // coverage on every PR was. It must stay wired, and stay off the PR path.
    const coverageStep = /- name: Coverage gate[^\n]*\n(?<body>(?: {8}[^\n]*\n)+)/.exec(
      ciWorkflow,
    )
    expect(coverageStep?.groups?.body).toBeDefined()
    expect(coverageStep?.groups?.body).toContain(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    )
    expect(coverageStep?.groups?.body).toContain('run: pnpm check:coverage')
  })
})

describe('local hooks', () => {
  it('typechecks on pre-push, including the release scripts project', () => {
    expect(prePush).toContain('pnpm typecheck')
    expect(packageJson.scripts.typecheck).toContain('tsconfig.scripts.json')
  })

  it('runs the artifact gates on pre-push only when their inputs change', () => {
    // Conditional, so a normal push pays ~0 for them and a push that touches
    // hash-pinned inputs fails in seconds instead of ~7 minutes later in CI.
    expect(prePush).toContain('git diff --name-only origin/main...HEAD')
    for (const gate of ARTIFACT_GATES) expect(prePush).toContain(gate)
  })
})
