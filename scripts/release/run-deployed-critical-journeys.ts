// REL-01 Promotion step 4 — `pnpm release:deployed-journeys`.
//
// The safe runner for the deployed critical-journey suite. It drives the
// isolated `deployed-critical` Playwright project against the production
// cell-us origin and turns the run into `repkey-deployed-critical-journeys-1`
// evidence.
//
// The safety properties are structural, not procedural:
//
//   * ONE ATTEMPT. The project pins retries 0 / workers 1 and the schema pins
//     attempts 1 / retries 0. There is no --retries flag here and no re-run
//     path: a suite that is retried until it is green proves nothing about the
//     deployment it was pointed at.
//   * AUTHORIZATION FIRST. The approval artifact is parsed and its window
//     checked BEFORE the browser is launched, so an expired or future-dated
//     authorization costs zero production requests.
//   * EXACT AUTHORIZED ORDER. Results are emitted in `permittedTestIds` order.
//     A test that ran but was not authorized, or an authorized test that did
//     not run, is a failure — never a silently dropped row.
//   * NOTHING IS SYNTHESIZED. The Playwright report, the cleanup report, and
//     the observed-request log are read from files the run itself wrote. An
//     absent file is a refusal, not a default.
//   * CONTENT SAFETY IS MEASURED. The runner scans everything it is about to
//     retain for prohibited fields and records the count. A single occurrence
//     forces `outcome: 'failed'`.
//
// Every digest the evidence names is written beside it as a `<sha256>.dependency`
// file, because gate-f-evidence.ts rejects an unretained dependency.

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import {
  canonicalReleaseEvidence,
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from '../../src/shared/release/candidate-bound-evidence'
import {
  canonicalDeployedCriticalJourneyEvidence,
  deployedCriticalJourneyDependencyDigests,
  parseDeployedCriticalJourneyEvidence,
  DEPLOYED_CRITICAL_JOURNEY_SPEC,
  type DeployedCriticalJourneyEvidence,
} from '../../src/shared/release/deployed-critical-journey-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT_NAME,
  DEPLOYED_PRODUCTION_ORIGIN,
} from '../../e2e/deployed/deployed-target'

const COMMAND_NAME = 'release:deployed-journeys'
const PLAYWRIGHT_CONFIG_PATH = 'playwright.config.ts'

export type DeployedJourneyIo = Readonly<{
  out: (line: string) => void
  err: (line: string) => void
}>

const consoleIo: DeployedJourneyIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}

const authorizationSchema = z
  .object({
    version: z.literal('repkey-deployed-journey-authorization-1'),
    syntheticOrganizationId: z.uuid(),
    approvedBy: z.string().trim().min(1).max(256),
    approvedAt: z.iso.datetime({ offset: false }),
    expiresAt: z.iso.datetime({ offset: false }),
    permittedTestIds: z.array(z.string().trim().min(1).max(512)).min(1),
  })
  .strict()

const cleanupReportSchema = z
  .object({
    syntheticOrganizationId: z.uuid(),
    createdResources: z.array(z.string().trim().min(1).max(512)),
    deletedResources: z.array(z.string().trim().min(1).max(512)),
    orphanedSyntheticResources: z.number().int().safe().nonnegative(),
    mutatingRequests: z.number().int().safe().nonnegative(),
  })
  .strict()

const networkReportSchema = z
  .object({
    observedRequestCount: z.number().int().safe().nonnegative(),
    permittedOrigins: z.array(z.string().trim().min(1).max(512)).min(1),
    unexpectedExternalRequests: z.number().int().safe().nonnegative(),
    unexpectedOrigins: z.array(z.string().trim().min(1).max(512)),
  })
  .strict()

/**
 * Patterns whose presence in retained release evidence is a content-safety
 * defect. Deliberately narrow and unambiguous: a pattern with false positives
 * would train an operator to ignore the counter, which is worse than not
 * having it.
 */
const PROHIBITED_FIELD_PATTERNS: ReadonlyArray<
  Readonly<{ name: string; pattern: RegExp }>
> = [
  { name: 'emailAddress', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu },
  { name: 'bearerToken', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/giu },
  { name: 'googleApiKey', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu },
  { name: 'privateKey', pattern: /PRIVATE KEY/gu },
  { name: 'sessionCookie', pattern: /better-auth\.session[^\s";]{16,}/gu },
]

export function countProhibitedFields(
  text: string,
): Readonly<{ total: number; byPattern: Readonly<Record<string, number>> }> {
  const byPattern: Record<string, number> = {}
  let total = 0
  for (const { name, pattern } of PROHIBITED_FIELD_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, pattern.flags))
    const count = matches?.length ?? 0
    byPattern[name] = count
    total += count
  }
  return { total, byPattern }
}

type PlaywrightSpecResult = Readonly<{
  title: string
  status: string
  durationMs: number
}>

type PlaywrightSuite = Readonly<{
  specs?: ReadonlyArray<
    Readonly<{
      title?: unknown
      tests?: ReadonlyArray<
        Readonly<{
          results?: ReadonlyArray<Readonly<{ status?: unknown; duration?: unknown }>>
        }>
      >
    }>
  >
  suites?: readonly PlaywrightSuite[]
}>

/** Flatten the Playwright JSON reporter tree into ordered spec outcomes. */
export function playwrightSpecResults(report: unknown): readonly PlaywrightSpecResult[] {
  const collected: PlaywrightSpecResult[] = []
  const walk = (suite: PlaywrightSuite): void => {
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.[0]?.results?.[0]
      collected.push({
        title: typeof spec.title === 'string' ? spec.title : '',
        status: typeof result?.status === 'string' ? result.status : 'interrupted',
        durationMs:
          typeof result?.duration === 'number' ? Math.trunc(result.duration) : 0,
      })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  if (report !== null && typeof report === 'object') {
    for (const suite of (report as { suites?: readonly PlaywrightSuite[] }).suites ??
      []) {
      walk(suite)
    }
  }
  return collected
}

function mappedOutcome(
  status: string,
): 'passed' | 'failed' | 'timed_out' | 'interrupted' {
  if (status === 'passed') return 'passed'
  if (status === 'timedOut' || status === 'timed_out') return 'timed_out'
  if (status === 'interrupted') return 'interrupted'
  return 'failed'
}

export type DeployedJourneyRunOutcome = Readonly<{
  exitCode: number
  packageVersion: string
  browserName: 'chromium' | 'firefox' | 'webkit'
  browserVersion: string
}>

export type DeployedJourneyDependencyFile = Readonly<{ sha256: string; content: string }>

export type DeployedJourneyBuildResult =
  | Readonly<{
      ok: true
      evidence: DeployedCriticalJourneyEvidence
      dependencies: readonly DeployedJourneyDependencyFile[]
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function buildDeployedJourneyEvidence(
  input: Readonly<{
    candidate: ReleaseCandidateBinding
    runId: string
    startedAt: string
    completedAt: string
    capturedAt: string
    authorizationDocument: string
    playwrightReport: string
    cleanupReport: string
    networkReport: string
    specSource: string
    playwrightConfigSource: string
    runner: DeployedJourneyRunOutcome
  }>,
): DeployedJourneyBuildResult {
  const errors: string[] = []
  const authorization = authorizationSchema.safeParse(
    JSON.parse(input.authorizationDocument),
  )
  if (!authorization.success) {
    return {
      ok: false,
      errors: authorization.error.issues.map(
        (issue) => `authorization.${issue.path.join('.')}: ${issue.message}`,
      ),
    }
  }
  const cleanupParsed = cleanupReportSchema.safeParse(JSON.parse(input.cleanupReport))
  if (!cleanupParsed.success) {
    return {
      ok: false,
      errors: cleanupParsed.error.issues.map(
        (issue) => `cleanup.${issue.path.join('.')}: ${issue.message}`,
      ),
    }
  }
  const networkParsed = networkReportSchema.safeParse(JSON.parse(input.networkReport))
  if (!networkParsed.success) {
    return {
      ok: false,
      errors: networkParsed.error.issues.map(
        (issue) => `network.${issue.path.join('.')}: ${issue.message}`,
      ),
    }
  }

  const observed = playwrightSpecResults(JSON.parse(input.playwrightReport))
  const byTitle = new Map(observed.map((result) => [result.title, result] as const))
  const failures: string[] = []
  const results = authorization.data.permittedTestIds.map((testId) => {
    const observation = byTitle.get(testId)
    if (!observation) {
      failures.push(`authorized test did not run: ${testId}`)
      return { testId, title: testId, outcome: 'interrupted' as const, durationMs: 0 }
    }
    const outcome = mappedOutcome(observation.status)
    if (outcome !== 'passed') failures.push(`${testId}: ${observation.status}`)
    return { testId, title: testId, outcome, durationMs: observation.durationMs }
  })
  for (const observation of observed) {
    if (!authorization.data.permittedTestIds.includes(observation.title)) {
      failures.push(`unauthorized test ran: ${observation.title}`)
    }
  }
  if (input.runner.exitCode !== 0 && failures.length === 0) {
    failures.push(`playwright exited ${input.runner.exitCode} with no failing test`)
  }

  const scanned = countProhibitedFields(
    [input.playwrightReport, input.cleanupReport, input.networkReport].join('\n'),
  )
  if (scanned.total > 0) {
    failures.push(`${scanned.total} prohibited field occurrences in retained evidence`)
  }
  if (cleanupParsed.data.orphanedSyntheticResources > 0) {
    failures.push(
      `${cleanupParsed.data.orphanedSyntheticResources} orphaned synthetic resources`,
    )
  }
  if (networkParsed.data.unexpectedExternalRequests > 0) {
    failures.push(
      `${networkParsed.data.unexpectedExternalRequests} unexpected external requests`,
    )
  }

  const redactionReport = canonicalReleaseEvidence({
    scannedSources: ['playwright-report', 'cleanup-report', 'network-report'],
    prohibitedFieldOccurrences: scanned.total,
    occurrencesByPattern: scanned.byPattern,
    unexpectedExternalRequests: networkParsed.data.unexpectedExternalRequests,
    unexpectedOrigins: networkParsed.data.unexpectedOrigins,
  })

  const dependencies: DeployedJourneyDependencyFile[] = [
    {
      sha256: releaseEvidenceSha256(input.authorizationDocument),
      content: input.authorizationDocument,
    },
    { sha256: releaseEvidenceSha256(input.specSource), content: input.specSource },
    {
      sha256: releaseEvidenceSha256(input.playwrightConfigSource),
      content: input.playwrightConfigSource,
    },
    { sha256: releaseEvidenceSha256(input.cleanupReport), content: input.cleanupReport },
    { sha256: releaseEvidenceSha256(redactionReport), content: redactionReport },
  ]

  const evidence: DeployedCriticalJourneyEvidence = {
    version: 'repkey-deployed-critical-journeys-1',
    evidenceKind: 'deployed-critical-journeys',
    candidate: input.candidate,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    capturedAt: input.capturedAt,
    authorization: {
      syntheticOrganizationId: authorization.data.syntheticOrganizationId,
      authorizationArtifactSha256: releaseEvidenceSha256(input.authorizationDocument),
      approvedBy: authorization.data.approvedBy,
      approvedAt: authorization.data.approvedAt,
      expiresAt: authorization.data.expiresAt,
      permittedTestIds: authorization.data.permittedTestIds,
    },
    runner: {
      kind: 'playwright',
      specPath: DEPLOYED_CRITICAL_JOURNEY_SPEC,
      specSha256: releaseEvidenceSha256(input.specSource),
      playwrightConfigSha256: releaseEvidenceSha256(input.playwrightConfigSource),
      packageVersion: input.runner.packageVersion,
      project: DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT_NAME,
      browserName: input.runner.browserName,
      browserVersion: input.runner.browserVersion,
      attempts: 1,
      retries: 0,
      workers: 1,
    },
    results,
    cleanup: {
      attempted: true,
      completed:
        cleanupParsed.data.createdResources.length ===
        cleanupParsed.data.deletedResources.length,
      orphanedSyntheticResources: cleanupParsed.data.orphanedSyntheticResources,
      reportSha256: releaseEvidenceSha256(input.cleanupReport),
    },
    redaction: {
      reportSha256: releaseEvidenceSha256(redactionReport),
      prohibitedFieldOccurrences: scanned.total,
      unexpectedExternalRequests: networkParsed.data.unexpectedExternalRequests,
    },
    outcome: failures.length === 0 ? 'passed' : 'failed',
    failures,
  }

  const parsed = parseDeployedCriticalJourneyEvidence(
    canonicalDeployedCriticalJourneyEvidence(evidence),
  )
  if (!parsed.ok) return { ok: false, errors: [...errors, ...parsed.errors] }

  const retained = new Set(dependencies.map(({ sha256 }) => sha256))
  const unretained = deployedCriticalJourneyDependencyDigests(parsed.evidence).filter(
    (digest) => !retained.has(digest),
  )
  if (unretained.length > 0) {
    return {
      ok: false,
      errors: unretained.map((digest) => `dependency ${digest} has no retained file`),
    }
  }
  return { ok: true, evidence: parsed.evidence, dependencies }
}

export type DeployedJourneyRunInput = Readonly<{
  reportPath: string
  cleanupReportPath: string
  networkReportPath: string
  syntheticOrganizationId: string
}>

export type DeployedJourneyDeps = Readonly<{
  io?: DeployedJourneyIo
  env?: NodeJS.ProcessEnv
  now?: () => string
  startedAt?: () => string
  completedAt?: () => string
  runId?: () => string
  runPlaywright?: (input: DeployedJourneyRunInput) => Promise<DeployedJourneyRunOutcome>
}>

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/**
 * The real runner: one Playwright invocation, no retries, one worker, pointed
 * at the production origin through the guarded environment the spec reads.
 */
async function defaultRunPlaywright(
  input: DeployedJourneyRunInput,
): Promise<DeployedJourneyRunOutcome> {
  const { spawnSync } = await import('node:child_process')
  const { chromium } = await import('@playwright/test')
  const require = createRequire(import.meta.url)
  const playwrightPackage = require('@playwright/test/package.json') as {
    version: string
  }

  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      `--project=${DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT_NAME}`,
      '--workers=1',
      '--retries=0',
      '--reporter=json',
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        DEPLOYED_BASE_URL: DEPLOYED_PRODUCTION_ORIGIN,
        DEPLOYED_SYNTHETIC_ORGANIZATION_ID: input.syntheticOrganizationId,
        DEPLOYED_NETWORK_REPORT: input.networkReportPath,
        DEPLOYED_CLEANUP_REPORT: input.cleanupReportPath,
        PLAYWRIGHT_JSON_OUTPUT_NAME: input.reportPath,
      },
    },
  )

  const browser = await chromium.launch()
  const browserVersion = browser.version()
  await browser.close()

  return {
    exitCode: run.status ?? 1,
    packageVersion: playwrightPackage.version,
    browserName: 'chromium',
    browserVersion,
  }
}

export async function runDeployedCriticalJourneysCli(
  args: readonly string[],
  deps: DeployedJourneyDeps = {},
): Promise<number> {
  const io = deps.io ?? consoleIo
  const clock = deps.now ?? (() => new Date().toISOString())

  const required = [
    '--app-origin',
    '--release-sha',
    '--release-manifest',
    '--release-manifest-sha256',
    '--project-id',
    '--environment-id',
    '--authorization',
    '--output',
  ]
  const missing = required.filter((flag) => flagValue(args, flag) === undefined)
  if (missing.length > 0) {
    io.err(`${COMMAND_NAME} needs ${missing.join(', ')}.`)
    return 2
  }
  if (args.some((arg) => arg === '--retries' || arg.startsWith('--retries='))) {
    io.err(
      `${COMMAND_NAME} refuses --retries. The deployed suite runs once; a retried run ` +
        'cannot produce valid evidence.',
    )
    return 2
  }

  const appOrigin = flagValue(args, '--app-origin')
  if (appOrigin !== DEPLOYED_PRODUCTION_ORIGIN) {
    io.err(
      `${COMMAND_NAME} refuses --app-origin=${appOrigin}. Deployed journey evidence is only ` +
        `meaningful against ${DEPLOYED_PRODUCTION_ORIGIN}.`,
    )
    return 2
  }

  const outputPath = resolve(flagValue(args, '--output') ?? '')
  if (existsSync(outputPath)) {
    io.err(`${COMMAND_NAME} refuses to overwrite the existing artifact ${outputPath}.`)
    return 2
  }

  let manifestDigest: string
  let authorizationDocument: string
  let specSource: string
  let playwrightConfigSource: string
  try {
    manifestDigest = releaseEvidenceSha256(
      readFileSync(resolve(flagValue(args, '--release-manifest') ?? '')),
    )
    authorizationDocument = readFileSync(
      resolve(flagValue(args, '--authorization') ?? ''),
      'utf8',
    )
    specSource = readFileSync(resolve(DEPLOYED_CRITICAL_JOURNEY_SPEC), 'utf8')
    playwrightConfigSource = readFileSync(resolve(PLAYWRIGHT_CONFIG_PATH), 'utf8')
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  if (flagValue(args, '--release-manifest-sha256') !== manifestDigest) {
    io.err(
      `${COMMAND_NAME}: --release-manifest-sha256 does not match the supplied manifest ` +
        `(${manifestDigest}).`,
    )
    return 2
  }

  let authorization: z.infer<typeof authorizationSchema>
  try {
    const parsed = authorizationSchema.safeParse(JSON.parse(authorizationDocument))
    if (!parsed.success) {
      io.err(`${COMMAND_NAME}: authorization artifact is invalid:`)
      for (const issue of parsed.error.issues) {
        io.err(`  authorization.${issue.path.join('.')}: ${issue.message}`)
      }
      return 2
    }
    authorization = parsed.data
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  // Authorization is checked BEFORE the browser starts: an expired or
  // future-dated approval must cost zero production requests.
  const startedAt = (deps.startedAt ?? clock)()
  const now = clock()
  if (Date.parse(authorization.approvedAt) > Date.parse(startedAt)) {
    io.err(
      `${COMMAND_NAME}: authorization approvedAt=${authorization.approvedAt} postdates the ` +
        `run start ${startedAt}. An approval cannot be granted after the run it authorizes.`,
    )
    return 2
  }
  if (Date.parse(authorization.expiresAt) < Date.parse(now)) {
    io.err(
      `${COMMAND_NAME}: authorization expired at ${authorization.expiresAt}. Re-approve ` +
        'before running deployed journeys.',
    )
    return 2
  }

  const dependencyDir = resolve(
    flagValue(args, '--dependency-dir') ?? dirname(outputPath),
  )
  const runInput: DeployedJourneyRunInput = {
    reportPath: resolve(dependencyDir, 'playwright-deployed-report.json'),
    cleanupReportPath: resolve(dependencyDir, 'deployed-cleanup-report.json'),
    networkReportPath: resolve(dependencyDir, 'deployed-network-report.json'),
    syntheticOrganizationId: authorization.syntheticOrganizationId,
  }

  let runner: DeployedJourneyRunOutcome
  try {
    runner = await (deps.runPlaywright ?? defaultRunPlaywright)(runInput)
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  let playwrightReport: string
  let cleanupReport: string
  let networkReport: string
  try {
    playwrightReport = readFileSync(runInput.reportPath, 'utf8')
    cleanupReport = readFileSync(runInput.cleanupReportPath, 'utf8')
    networkReport = readFileSync(runInput.networkReportPath, 'utf8')
  } catch (error) {
    io.err(
      `${COMMAND_NAME}: the run produced no readable report — ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        'Unwritten evidence is missing evidence; refusing to emit.',
    )
    return 1
  }

  const built = buildDeployedJourneyEvidence({
    candidate: {
      releaseSha: flagValue(args, '--release-sha') ?? '',
      releaseManifestSha256: manifestDigest,
      cell: 'us',
      environment: 'cell-us',
      deploymentProfile: 'production',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: flagValue(args, '--project-id') ?? '',
      environmentId: flagValue(args, '--environment-id') ?? '',
      appOrigin: DEPLOYED_PRODUCTION_ORIGIN,
    },
    runId: (deps.runId ?? (() => crypto.randomUUID()))(),
    startedAt,
    completedAt: (deps.completedAt ?? clock)(),
    capturedAt: clock(),
    authorizationDocument,
    playwrightReport,
    cleanupReport,
    networkReport,
    specSource,
    playwrightConfigSource,
    runner,
  })
  if (!built.ok) {
    io.err(`${COMMAND_NAME}: refusing to emit deployed journey evidence:`)
    for (const error of built.errors) io.err(`  ${error}`)
    return 1
  }

  try {
    for (const dependency of built.dependencies) {
      const path = resolve(dependencyDir, `${dependency.sha256}.dependency`)
      if (existsSync(path)) continue
      writeFileSync(path, dependency.content, { encoding: 'utf8', flag: 'wx' })
    }
    writeFileSync(outputPath, canonicalDeployedCriticalJourneyEvidence(built.evidence), {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  io.out(`deployed critical journeys ${built.evidence.outcome}: ${outputPath}`)
  return built.evidence.outcome === 'passed' ? 0 : 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDeployedCriticalJourneysCli(process.argv.slice(2))
}
