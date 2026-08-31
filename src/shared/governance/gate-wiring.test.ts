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

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')

const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
}
const containerPolicy = JSON.parse(read('security/container-images.json')) as {
  images: ReadonlyArray<unknown>
}
const ciWorkflow = read('.github/workflows/ci.yml')
const prePush = read('.husky/pre-push')
const runBaseline = read('scripts/bqc/run-baseline.ts')
const playwrightConfig = read('playwright.config.ts')

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
    expect(lintCi).toMatch(/^pnpm lint\s+&&\s+\S/)
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

  it('runs the same coverage ratchet before merge and on main without a second unit run', () => {
    expect(packageJson.scripts['check:coverage']).toBe('node scripts/check-coverage.mjs')
    // check:coverage already runs the unit project. The workflow therefore
    // pairs it with integration directly on every event and never invokes the
    // duplicate umbrella `pnpm test` command.
    const testStep = /- name: Test\n(?<body>(?: {8}[^\n]*\n)+)/.exec(ciWorkflow)
    const body = testStep?.groups?.body
    expect(body).toBeDefined()
    expect(body).toContain('pnpm check:coverage')
    expect(body).toContain('pnpm test:integration')
    expect(body).not.toContain('github.event_name')
    expect(body).not.toMatch(/pnpm test\s*$/m)
    // And the standalone main-only coverage step is gone, not duplicated.
    expect(ciWorkflow).not.toContain('- name: Coverage gate')
  })

  it('lets a flake report itself on a PR and refuses one on the release path', () => {
    // retries: 1 means a flake no longer costs a 10-minute manual rerun to
    // classify; --fail-on-flaky-tests on pushes means it cannot reach main.
    expect(playwrightConfig).toMatch(/retries: isCi \? 1 : 0/)
    const flakyGate = '--fail-on-flaky-tests'
    expect(ciWorkflow).toContain(
      `--project=critical \${{ github.event_name == 'push' && '${flakyGate}'`,
    )
    expect(ciWorkflow).toContain(
      `--project=full \${{ github.event_name == 'push' && '${flakyGate}'`,
    )
  })

  it('caches the grype vulnerability DB for every image scan', () => {
    // The first scan otherwise spends ~50s downloading and loading the DB.
    const scans = ciWorkflow.match(/grype-version: v0\.116\.1\n\s+cache-db: true/g)
    expect(scans).toHaveLength(containerPolicy.images.length)
  })
})

describe('legal approval gate', () => {
  // LEG-01: `check:legal-registry` binds counsel approval to document bytes.
  // A validator nothing runs is not a gate, so the wiring is pinned in three
  // places — the script itself, the CI lint chain, and the pre-push hook —
  // and the producer script is pinned so it cannot be silently deleted.
  it('keeps the registry checker addressable under its exact command', () => {
    expect(packageJson.scripts['check:legal-registry']).toBe(
      'tsx scripts/review/legal-document-registry.ts',
    )
    expect(packageJson.scripts['release:create-legal-revision-set']).toBe(
      'tsx scripts/release/create-legal-revision-set.ts',
    )
  })

  it('runs the legal registry gate in the CI lint chain', () => {
    expect(packageJson.scripts['lint:ci']).toContain('check:legal-registry')
    // Still a strict superset of the fast local lint, so nothing added to
    // `lint` can escape CI and nothing added here can escape `lint:ci`.
    expect(packageJson.scripts['lint:ci']).toMatch(/^pnpm lint\s+&&\s+\S/)
  })

  it('runs the legal registry gate on pre-push when legal inputs change', () => {
    // Same conditional-artifact-gate pattern as the AI/Google attestations: a
    // normal push pays nothing, a push that edits a legal document or the
    // approval authority fails in seconds instead of later in CI.
    expect(prePush).toContain('*docs/legal/*')
    expect(prePush).toContain('*src/shared/governance/legal-*')
    expect(prePush).toContain('pnpm check:legal-registry')
  })

  it('reaches CI through the existing lint:ci step rather than a new workflow step', () => {
    expect(ciWorkflow).toContain('run: pnpm lint:ci')
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

describe('REL-01 Gate F producers', () => {
  // REL-01 required-clean-gates: "The exact executable gate list lives in CI
  // and the release manifest; this prose cannot silently replace a missing CI
  // job." A producer that is not addressable, not typechecked, and not bound
  // to the signed controller digest is prose.
  const RELEASE_PRODUCERS = {
    'release:freeze-candidate': 'scripts/release/freeze-release-candidate.ts',
    'release:deployed-journeys': 'scripts/release/run-deployed-critical-journeys.ts',
    'release:observe-canary': 'scripts/release/observe-canary-window.ts',
    'release:rehearse-recovery': 'scripts/release/rehearse-recovery.ts',
    'release:capture-readback': 'scripts/release/capture-promotion-readback.ts',
    'release:import-live-evidence': 'scripts/release/import-live-evidence.ts',
    'release:prepare-approval': 'scripts/release/prepare-gate-f-approval.ts',
  } as const

  it('declares every producer as an addressable script pointing at a real file', () => {
    for (const [script, file] of Object.entries(RELEASE_PRODUCERS)) {
      expect(packageJson.scripts[script]).toBe(`tsx ${file}`)
      expect(existsSync(resolve(ROOT, file))).toBe(true)
    }
  })

  it('keeps every producer inside the signed release-controller digest', () => {
    // A producer outside RELEASE_AUTHORITY_SOURCE_PATHS could be edited
    // without changing contract.releaseControllerSha256, so the signed
    // manifest would no longer describe the code that produced the evidence.
    const authority = read('scripts/release/release-authority-digest.ts')
    for (const file of Object.values(RELEASE_PRODUCERS)) {
      const covered = ['scripts/release', 'src/shared'].some(
        (path) => file.startsWith(`${path}/`) && authority.includes(`'${path}'`),
      )
      expect(covered).toBe(true)
    }
    // scripts/beta is deliberately NOT covered, so no producer may live there.
    expect(authority).not.toContain("'scripts/beta'")
    for (const file of Object.values(RELEASE_PRODUCERS)) {
      expect(file.startsWith('scripts/beta/')).toBe(false)
    }
  })

  it('runs every producer test in the unit project', () => {
    const vitestConfig = read('vitest.config.ts')
    expect(vitestConfig).toContain("'scripts/release/**/*.test.ts'")
    expect(vitestConfig).toContain("'src/**/*.test.ts'")
    // scripts/beta/**/*.test.ts is not in the include list, which is why no
    // producer test may be placed there.
    expect(vitestConfig).not.toContain("'scripts/beta/**/*.test.ts'")
    for (const file of Object.values(RELEASE_PRODUCERS)) {
      expect(existsSync(resolve(ROOT, file.replace(/\.ts$/u, '.test.ts')))).toBe(true)
    }
  })

  it('keeps the Gate F approval role map tracked and public-key only', () => {
    const roles = read('security/gate-f-approval-roles.json')
    expect(roles).not.toMatch(/PRIVATE KEY/u)
    expect(JSON.parse(roles)).toMatchObject({
      version: 'repkey-gate-f-approval-roles-1',
    })
  })

  it('no longer describes the deployed runner, canary observer and recovery orchestrator as missing', () => {
    const runbook = read('docs/operations/immutable-release-promotion.md')
    for (const producer of Object.keys(RELEASE_PRODUCERS)) {
      expect(runbook).toContain(producer)
    }
    expect(runbook).not.toMatch(/no safe deployed runner exists/iu)
    expect(runbook).not.toMatch(/there is no canary observer/iu)
    expect(runbook).not.toMatch(/no recovery orchestrator/iu)
  })
})
