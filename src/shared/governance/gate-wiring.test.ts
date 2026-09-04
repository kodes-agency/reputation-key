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
import { REQUIRED_CI_JOBS } from '../release/gate-policy'

const ROOT = resolve(import.meta.dirname, '../../..')

const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
}
const containerPolicy = JSON.parse(read('security/container-images.json')) as {
  images: ReadonlyArray<unknown>
}
const ciWorkflow = read('.github/workflows/ci.yml')
const releaseImagesWorkflow = read('.github/workflows/release-images.yml')
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
    // @proof BASELINE_GATE_INTERRUPTION#1
    expect(packageJson.scripts['check:changed-code']).toBe(
      'node scripts/check-changed-code.mjs',
    )
    expect(ciWorkflow).toContain('run: pnpm check:changed-code')
  })

  it('runs four unit shards plus the whole coverage ratchet and integration gate', () => {
    // @proof BASELINE_GATE_INTERRUPTION#2
    expect(packageJson.scripts['check:coverage']).toBe('node scripts/check-coverage.mjs')

    // The sharded unit run gives parallel, file-level feedback. The existing
    // coverage script still owns one complete run because its two-tier
    // floor/staleness ratchet consumes a whole-suite aggregate. Both paths are
    // unconditional on event type, and the protected `check` aggregate waits
    // for every matrix row plus the coverage and integration gates.
    const occurrences = (needle: string): number => ciWorkflow.split(needle).length - 1

    expect(ciWorkflow).toContain('shard: [1, 2, 3, 4]')
    expect(
      occurrences('pnpm exec vitest run --project=unit --shard=${{ matrix.shard }}/4'),
    ).toBe(1)
    expect(occurrences('pnpm check:coverage')).toBe(1)
    expect(occurrences('pnpm test:integration')).toBe(1)
    expect(ciWorkflow).toContain('test-unit-coverage:')
    expect(ciWorkflow).toContain(
      'needs: [static, test-unit, test-unit-coverage, test-integration, artifacts]',
    )
    expect(ciWorkflow).not.toMatch(/run: pnpm test\s*$/m)
    expect(occurrences('- name: Coverage gate')).toBe(1)

    // Event-conditionality is pinned by exact count rather than by slicing the
    // job that owns each command. The six legitimate sites are the gitleaks
    // log-opts branch, the three Playwright `--fail-on-flaky-tests` promotions,
    // and the two comparisons in beta-acceptance's `if:`.
    expect(occurrences('github.event_name')).toBe(6)
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

  it('rotates one explicit daily grype DB cache before every matrix scan', () => {
    const matrixStart = ciWorkflow.indexOf('\n  docker-images:')
    const matrixEnd = ciWorkflow.indexOf('\n  docker:', matrixStart)
    const matrixJob = ciWorkflow.slice(matrixStart, matrixEnd)
    const dateStep = matrixJob.indexOf('- name: Resolve Grype DB cache date')
    const cacheStep = matrixJob.indexOf('- name: Restore daily Grype vulnerability DB')
    const scanStep = matrixJob.indexOf('- name: Vulnerability scan matrix image (grype)')

    expect(matrixStart).toBeGreaterThanOrEqual(0)
    expect(matrixEnd).toBeGreaterThan(matrixStart)
    expect(matrixJob.match(/^ {10}- name:\s*\S+/gmu)).toHaveLength(
      containerPolicy.images.length,
    )
    expect(dateStep).toBeGreaterThanOrEqual(0)
    expect(cacheStep).toBeGreaterThan(dateStep)
    expect(scanStep).toBeGreaterThan(cacheStep)
    expect(matrixJob).toContain(
      'uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
    )
    expect(matrixJob).toContain('run: echo "utc=$(date -u +%F)" >> "$GITHUB_OUTPUT"')
    expect(matrixJob).toContain(
      'key: grype-db-v0.116.1-${{ steps.grype-db-date.outputs.utc }}',
    )
    expect(matrixJob).not.toContain('restore-keys:')
    expect(matrixJob).toContain('grype-version: v0.116.1')
    expect(matrixJob).toContain('config: .grype.yaml')
    expect(ciWorkflow).not.toContain('cache-db: true')
  })

  it('starts beta acceptance without serializing behind unrelated gates', () => {
    const betaStart = ciWorkflow.indexOf('\n  beta-acceptance:')
    const betaJob = ciWorkflow.slice(betaStart)

    expect(betaStart).toBeGreaterThanOrEqual(0)
    expect(betaJob).toContain('run: pnpm beta:smoke -- --release-sha=${{ github.sha }}')
    expect(betaJob).not.toMatch(/^ {4}needs:/mu)
  })
})

describe('legal approval gate', () => {
  // LEG-01: `check:legal-registry` binds counsel approval to document bytes.
  // A validator nothing runs is not a gate, so the addressable command and its
  // unconditional CI wiring are both pinned.
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

  it('reaches CI through the existing lint:ci step rather than a new workflow step', () => {
    expect(ciWorkflow).toContain('run: pnpm lint:ci')
  })
})

describe('release preflight gate manifest', () => {
  it('binds release preflight to the gate manifest', () => {
    expect(releaseImagesWorkflow).toContain(
      `for required_job in ${REQUIRED_CI_JOBS.ci.join(' ')}; do`,
    )
    const workflowJobs = [
      ['.github/workflows/fallow.yml', REQUIRED_CI_JOBS.fallow],
      ['.github/workflows/codeql.yml', REQUIRED_CI_JOBS.codeql],
      ['.github/workflows/simulation.yml', REQUIRED_CI_JOBS.simulation],
    ] as const
    for (const [workflowPath, jobs] of workflowJobs) {
      expect(releaseImagesWorkflow).toContain(
        `require_workflow_job "${workflowPath}" "${jobs.join(' ')}"`,
      )
    }
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
