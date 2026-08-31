import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDeployedJourneyEvidence,
  runDeployedCriticalJourneysCli,
  type DeployedJourneyRunOutcome,
} from './run-deployed-critical-journeys'
import { releaseEvidenceSha256 } from '../../src/shared/release/candidate-bound-evidence'
import {
  DEPLOYED_CRITICAL_JOURNEY_SPEC,
  parseDeployedCriticalJourneyEvidence,
} from '../../src/shared/release/deployed-critical-journey-evidence'
import { DEPLOYED_PRODUCTION_ORIGIN } from '../../e2e/deployed/deployed-target'

const MANIFEST = '{"version":"repkey-promotion-manifest-1"}\n'
const MANIFEST_SHA256 = releaseEvidenceSha256(MANIFEST)
const RELEASE_SHA = 'a'.repeat(40)
const SYNTHETIC_ORGANIZATION = '11111111-1111-4111-8111-111111111111'

const PERMITTED_TEST_IDS = [
  'deployed-liveness-probe answers without authentication',
  'deployed-readiness-probe reports a ready cell',
  'deployed-private-metrics-stay-dark without an operator token',
] as const

function authorization(
  overrides: Readonly<{ approvedAt?: string; expiresAt?: string }> = {},
): string {
  return `${JSON.stringify({
    version: 'repkey-deployed-journey-authorization-1',
    syntheticOrganizationId: SYNTHETIC_ORGANIZATION,
    approvedBy: 'operating-owner:beta-oncall',
    approvedAt: overrides.approvedAt ?? '2026-08-27T12:00:00.000Z',
    expiresAt: overrides.expiresAt ?? '2026-08-29T12:00:00.000Z',
    permittedTestIds: [...PERMITTED_TEST_IDS],
  })}\n`
}

function playwrightReport(statuses: readonly string[]): string {
  return `${JSON.stringify({
    suites: [
      {
        title: DEPLOYED_CRITICAL_JOURNEY_SPEC,
        specs: PERMITTED_TEST_IDS.map((title, index) => ({
          title,
          tests: [
            {
              results: [{ status: statuses[index] ?? 'passed', duration: 120 + index }],
            },
          ],
        })),
      },
    ],
  })}\n`
}

function cleanupReport(orphaned = 0): string {
  return `${JSON.stringify({
    syntheticOrganizationId: SYNTHETIC_ORGANIZATION,
    createdResources: [],
    deletedResources: [],
    orphanedSyntheticResources: orphaned,
    mutatingRequests: 0,
  })}\n`
}

function networkReport(unexpected = 0): string {
  return `${JSON.stringify({
    observedRequestCount: 12,
    permittedOrigins: [DEPLOYED_PRODUCTION_ORIGIN],
    unexpectedExternalRequests: unexpected,
    unexpectedOrigins: [],
  })}\n`
}

type Workspace = Readonly<{ dir: string; args: readonly string[]; calls: string[] }>

function workspace(
  overrides: Readonly<{
    authorization?: string
    output?: string
  }> = {},
): Workspace {
  const dir = mkdtempSync(join(tmpdir(), 'repkey-deployed-'))
  writeFileSync(join(dir, 'manifest.json'), MANIFEST)
  writeFileSync(
    join(dir, 'authorization.json'),
    overrides.authorization ?? authorization(),
  )
  const flags: Record<string, string> = {
    '--app-origin': DEPLOYED_PRODUCTION_ORIGIN,
    '--release-sha': RELEASE_SHA,
    '--release-manifest': join(dir, 'manifest.json'),
    '--release-manifest-sha256': MANIFEST_SHA256,
    '--project-id': 'project-id',
    '--environment-id': 'environment-id',
    '--authorization': join(dir, 'authorization.json'),
    '--output': overrides.output ?? join(dir, 'deployed-journeys.json'),
    '--dependency-dir': dir,
  }
  return {
    dir,
    calls: [],
    args: Object.entries(flags).map(([flag, value]) => `${flag}=${value}`),
  }
}

function deps(
  space: Workspace,
  overrides: Readonly<{
    statuses?: readonly string[]
    orphaned?: number
    unexpected?: number
    now?: string
    startedAt?: string
  }> = {},
) {
  const written: string[] = []
  return {
    io: {
      out: (line: string) => written.push(line),
      err: (line: string) => written.push(line),
    },
    env: { OPS_METRICS_TOKEN: 'unused' } as NodeJS.ProcessEnv,
    now: () => overrides.now ?? '2026-08-28T00:10:00.000Z',
    startedAt: () => overrides.startedAt ?? '2026-08-28T00:00:00.000Z',
    completedAt: () => '2026-08-28T00:05:00.000Z',
    runPlaywright: async (input: {
      reportPath: string
      cleanupReportPath: string
      networkReportPath: string
    }): Promise<DeployedJourneyRunOutcome> => {
      space.calls.push('playwright')
      writeFileSync(input.reportPath, playwrightReport(overrides.statuses ?? []))
      writeFileSync(input.cleanupReportPath, cleanupReport(overrides.orphaned ?? 0))
      writeFileSync(input.networkReportPath, networkReport(overrides.unexpected ?? 0))
      return {
        exitCode: 0,
        packageVersion: '1.56.1',
        browserName: 'chromium',
        browserVersion: '141.0.7390.37',
      }
    },
    written,
  }
}

describe('run-deployed-critical-journeys CLI', () => {
  it('refuses to start when the authorization postdates the run', async () => {
    const space = workspace({
      authorization: authorization({ approvedAt: '2026-08-28T00:05:00.000Z' }),
    })
    const dependencies = deps(space)
    const code = await runDeployedCriticalJourneysCli(space.args, dependencies)
    expect(code).toBe(2)
    expect(space.calls).toEqual([])
    expect(dependencies.written.join('\n')).toContain('authorization')
  })

  it('refuses to start when the authorization has expired', async () => {
    const space = workspace({
      authorization: authorization({ expiresAt: '2026-08-27T18:00:00.000Z' }),
    })
    const dependencies = deps(space)
    const code = await runDeployedCriticalJourneysCli(space.args, dependencies)
    expect(code).toBe(2)
    expect(space.calls).toEqual([])
    expect(dependencies.written.join('\n')).toContain('expired')
  })

  it('emits results in exactly the authorized test id order', async () => {
    const space = workspace()
    const dependencies = deps(space)
    expect(await runDeployedCriticalJourneysCli(space.args, dependencies)).toBe(0)
    const evidence = parseDeployedCriticalJourneyEvidence(
      readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8'),
    )
    expect(evidence.ok, evidence.ok ? '' : evidence.errors.join('\n')).toBe(true)
    if (!evidence.ok) return
    expect(evidence.evidence.results.map(({ testId }) => testId)).toEqual([
      ...PERMITTED_TEST_IDS,
    ])
    expect(evidence.evidence.outcome).toBe('passed')
  })

  it('refuses to parse a reordered result set', async () => {
    const space = workspace()
    const dependencies = deps(space)
    await runDeployedCriticalJourneysCli(space.args, dependencies)
    const raw = JSON.parse(
      readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8'),
    ) as { results: unknown[] }
    const reordered = JSON.stringify({ ...raw, results: [...raw.results].reverse() })
    const parsed = parseDeployedCriticalJourneyEvidence(`${reordered}\n`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join('\n')).toContain('exact authorized test id order')
  })

  it('fails the run when cleanup leaves an orphaned synthetic resource', async () => {
    const space = workspace()
    const dependencies = deps(space, { orphaned: 1 })
    const code = await runDeployedCriticalJourneysCli(space.args, dependencies)
    expect(code).not.toBe(0)
    const evidence = parseDeployedCriticalJourneyEvidence(
      readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8'),
    )
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return
    expect(evidence.evidence.outcome).toBe('failed')
    expect(evidence.evidence.cleanup.orphanedSyntheticResources).toBe(1)
  })

  it('fails the run when the redaction scan finds a prohibited field', () => {
    const built = buildDeployedJourneyEvidence({
      candidate: {
        releaseSha: RELEASE_SHA,
        releaseManifestSha256: MANIFEST_SHA256,
        cell: 'us',
        environment: 'cell-us',
        deploymentProfile: 'production',
        projectName: 'reputation-key-us-beta',
        projectId: 'project-id',
        environmentId: 'environment-id',
        appOrigin: DEPLOYED_PRODUCTION_ORIGIN,
      },
      runId: '00000000-0000-4000-8000-000000000002',
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:05:00.000Z',
      capturedAt: '2026-08-28T00:10:00.000Z',
      authorizationDocument: authorization(),
      // A leaked address in a failure message is the exact content-safety
      // failure this counter exists to catch.
      playwrightReport: playwrightReport([]).replace(
        'deployed-liveness-probe',
        'owner@example.com deployed-liveness-probe',
      ),
      cleanupReport: cleanupReport(),
      networkReport: networkReport(),
      specSource: 'spec\n',
      playwrightConfigSource: 'config\n',
      runner: {
        exitCode: 0,
        packageVersion: '1.56.1',
        browserName: 'chromium',
        browserVersion: '141.0.7390.37',
      },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.evidence.redaction.prohibitedFieldOccurrences).toBeGreaterThan(0)
    expect(built.evidence.outcome).toBe('failed')
  })

  it('binds the on-disk spec and Playwright config digests as retained siblings', async () => {
    const space = workspace()
    const dependencies = deps(space)
    expect(await runDeployedCriticalJourneysCli(space.args, dependencies)).toBe(0)
    const evidence = parseDeployedCriticalJourneyEvidence(
      readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8'),
    )
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return

    expect(evidence.evidence.runner.specSha256).toBe(
      releaseEvidenceSha256(readFileSync(resolve(DEPLOYED_CRITICAL_JOURNEY_SPEC))),
    )
    expect(evidence.evidence.runner.playwrightConfigSha256).toBe(
      releaseEvidenceSha256(readFileSync(resolve('playwright.config.ts'))),
    )

    const retained = new Set(
      readdirSync(space.dir)
        .filter((name) => name.endsWith('.dependency'))
        .map((name) => name.replace('.dependency', '')),
    )
    for (const digest of [
      evidence.evidence.authorization.authorizationArtifactSha256,
      evidence.evidence.runner.specSha256,
      evidence.evidence.runner.playwrightConfigSha256,
      evidence.evidence.cleanup.reportSha256,
      evidence.evidence.redaction.reportSha256,
    ]) {
      expect(retained.has(digest), `dependency ${digest} was not retained`).toBe(true)
      expect(
        releaseEvidenceSha256(readFileSync(join(space.dir, `${digest}.dependency`))),
      ).toBe(digest)
    }
  })

  it('refuses a second invocation rather than overwriting the artifact', async () => {
    const space = workspace()
    expect(await runDeployedCriticalJourneysCli(space.args, deps(space))).toBe(0)
    const first = readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8')
    expect(await runDeployedCriticalJourneysCli(space.args, deps(space))).not.toBe(0)
    expect(readFileSync(join(space.dir, 'deployed-journeys.json'), 'utf8')).toBe(first)
  })

  // The exclusive-create flag now lives in write-once.ts, so what this file has
  // to prove is that it never reaches around that helper to a raw write.
  it('creates every artifact only through the write-once helper', () => {
    const source = readFileSync(
      resolve('scripts/release/run-deployed-critical-journeys.ts'),
      'utf8',
    )
    expect(source).toContain("from '../../src/shared/release/write-once'")
    expect(source).not.toContain('writeFileSync')
  })

  it('refuses any origin that is not the production cell-us origin', async () => {
    const space = workspace()
    const dependencies = deps(space)
    const code = await runDeployedCriticalJourneysCli(
      space.args.map((arg) =>
        arg.startsWith('--app-origin=')
          ? '--app-origin=https://staging.example.com'
          : arg,
      ),
      dependencies,
    )
    expect(code).toBe(2)
    expect(space.calls).toEqual([])
  })
})

describe('deployed-critical Playwright project wiring', () => {
  const config = readFileSync(resolve('playwright.config.ts'), 'utf8')

  it('declares the isolated deployed-critical project', () => {
    expect(config).toContain('DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT')
    expect(config).toContain(
      "import { DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT } from './e2e/deployed/deployed-target'",
    )
  })

  it('keeps the full project from picking up the deployed spec', () => {
    // Without this the `full` testMatch ^(?!.*\/critical\/).*\.spec\.ts$ would
    // load the deployed spec and run it against the local stack.
    expect(config).toContain('/deployed\\/.*\\.spec\\.ts/')
    const testIgnore = config.slice(config.indexOf('testIgnore:'))
    expect(testIgnore.slice(0, testIgnore.indexOf('\n'))).toContain('deployed')
  })
})
