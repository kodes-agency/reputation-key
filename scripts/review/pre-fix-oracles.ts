import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

export const FROZEN_REVIEW_SHA = '718fad1807b7422885584660bd3580f2a3a49113' as const

const ORACLE_IDS = [
  'PORTAL_UPLOAD_FOREIGN_KEY',
  'SERVER_FN_CSRF',
  'REVIEW_REOBSERVATION_IDENTITY',
  'AMBIGUOUS_POOL_WRITE',
  'TRUSTED_PROXY_HOP',
  'DIGEST_BATCH_IDEMPOTENCY',
  'PUBLIC_REDIRECT_AND_ABUSE',
  'PUBLIC_CACHE_PRIVACY',
  'REPLY_PUBLICATION_CRASH',
  'GOAL_RECOGNITION_RUNTIME',
  'ARCHITECTURE_BOUNDARY_IMPORTS',
  'PRODUCTION_ARTIFACT_BOUNDARY',
  'BASELINE_GATE_INTERRUPTION',
] as const

type OracleId = (typeof ORACLE_IDS)[number]
type HistoricalConclusion =
  'reproduced_faulty_seam' | 'contrary_evidence' | 'mixed_evidence'
type CheckConclusion = 'fault_reproduced' | 'contrary_evidence'

/**
 * Accepted review semantics live in code as well as data. This deliberately
 * makes changing a conclusion a two-review operation: editing only the JSON
 * cannot turn contrary/mixed evidence into a reproduced or closed finding.
 */
const ACCEPTED_CHECK_CONCLUSIONS: Readonly<
  Record<OracleId, Readonly<Record<string, CheckConclusion>>>
> = {
  PORTAL_UPLOAD_FOREIGN_KEY: {
    caller_selected_key: 'fault_reproduced',
    browser_put_overwrite_unfenced: 'fault_reproduced',
    derivative_key_not_source_versioned: 'fault_reproduced',
  },
  SERVER_FN_CSRF: { no_same_origin_admission: 'fault_reproduced' },
  REVIEW_REOBSERVATION_IDENTITY: {
    destructive_aggregate_replacement: 'fault_reproduced',
  },
  AMBIGUOUS_POOL_WRITE: { ambiguous_query_replayed: 'fault_reproduced' },
  TRUSTED_PROXY_HOP: { short_chain_clamped_to_spoofable_hop: 'fault_reproduced' },
  DIGEST_BATCH_IDEMPOTENCY: { daily_key_omits_batch_identity: 'fault_reproduced' },
  PUBLIC_REDIRECT_AND_ABUSE: {
    arbitrary_https_redirect: 'fault_reproduced',
    get_records_click: 'fault_reproduced',
    read_issues_new_session: 'fault_reproduced',
    rate_limit_omits_network_portal_layer: 'fault_reproduced',
    scan_dedupe_read_before_write: 'fault_reproduced',
  },
  PUBLIC_CACHE_PRIVACY: {
    nonce_response_cache_control_missing: 'fault_reproduced',
    guest_mutation_already_bound_to_signed_csrf: 'contrary_evidence',
  },
  REPLY_PUBLICATION_CRASH: {
    approval_commit_precedes_queue_delivery: 'fault_reproduced',
    approved_fact_has_no_publish_consumer: 'fault_reproduced',
  },
  GOAL_RECOGNITION_RUNTIME: {
    goal_registration_has_definition_only: 'fault_reproduced',
    leaderboard_consumer_name_mismatch: 'fault_reproduced',
  },
  ARCHITECTURE_BOUNDARY_IMPORTS: {
    ai_server_uses_review_repository: 'fault_reproduced',
    composition_exposes_review_repository: 'fault_reproduced',
    application_outbox_internal_import: 'contrary_evidence',
  },
  PRODUCTION_ARTIFACT_BOUNDARY: {
    e2e_seeder_in_serving_bundle: 'fault_reproduced',
    operator_provisioner_in_serving_bundle: 'fault_reproduced',
  },
  BASELINE_GATE_INTERRUPTION: {
    reported_unit_failures_reproduced: 'contrary_evidence',
    storybook_gate_interrupted: 'fault_reproduced',
    coverage_not_run_on_pull_request: 'fault_reproduced',
    environment_backed_gates_skipped: 'fault_reproduced',
  },
}

const markerList = z.array(z.string().min(1)).min(1)
const digest = z.string().regex(/^[0-9a-f]{64}$/u)
const repositoryPath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.includes('..'), {
    message: 'must be a repository-relative path without parent traversal',
  })

const sourceMarkers = {
  contains: markerList,
  omits: z.array(z.string().min(1)).default([]),
  scope: z
    .object({
      startAt: z.string().min(1),
      endBefore: z.string().min(1),
    })
    .strict()
    .optional(),
}

const historicalProof = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git_source'),
      path: repositoryPath,
      sha256: digest,
      ...sourceMarkers,
    })
    .strict(),
  z
    .object({
      kind: z.literal('git_search'),
      pattern: z.string().min(1),
      pathspecs: z.array(repositoryPath).min(1),
      expectedOutput: z.array(z.string()),
      outputSha256: digest,
    })
    .strict(),
  z
    .object({
      kind: z.literal('retained_file'),
      path: repositoryPath,
      retainedAtCommit: z.string().regex(/^[0-9a-f]{40}$/u),
      sha256: digest,
      ...sourceMarkers,
    })
    .strict(),
])

const historicalCheck = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/u),
    conclusion: z.enum(['fault_reproduced', 'contrary_evidence']),
    statement: z.string().min(1),
    proof: historicalProof,
  })
  .strict()

const currentProof = z
  .object({
    path: repositoryPath.refine(
      (path) => path.endsWith('.test.ts') || path.endsWith('.integration.test.ts'),
      { message: 'current regression proof must be an executable test file' },
    ),
    project: z.enum(['unit', 'integration']),
    contains: markerList,
  })
  .strict()

const failureArtifact = z
  .object({
    command: z.string().min(1),
    expectedExitCode: z.number().int().min(0).max(2),
    expectedConclusion: z.enum([
      'reproduced_faulty_seam',
      'contrary_evidence',
      'mixed_evidence',
    ]),
    resultSha256: digest,
  })
  .strict()

const oracle = z
  .object({
    id: z.enum(ORACLE_IDS),
    title: z.string().min(1),
    baselineOutcome: z.enum([
      'reproduced_faulty_seam',
      'contrary_evidence',
      'mixed_evidence',
    ]),
    historicalChecks: z.array(historicalCheck).min(1),
    failureArtifact,
    currentRegressionProofs: z.array(currentProof).min(1),
    resolution: z.enum(['closed', 'partial', 'open']),
    remaining: z.array(z.string().min(1)),
    note: z.string().min(1),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.resolution === 'closed' && entry.remaining.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['remaining'],
        message: 'closed cases cannot retain unresolved work',
      })
    }
    if (entry.resolution !== 'closed' && entry.remaining.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['remaining'],
        message: 'partial/open cases must name the residual work',
      })
    }
  })

const oracleIndex = z
  .object({
    version: z.literal(2),
    frozenSha: z.literal(FROZEN_REVIEW_SHA),
    evidenceCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    assessedAt: z.iso.date(),
    limitation: z.string().min(1),
    oracles: z.array(oracle),
  })
  .strict()

type ParsedIndex = z.infer<typeof oracleIndex>
type ParsedOracle = ParsedIndex['oracles'][number]
type ParsedHistoricalProof = ParsedOracle['historicalChecks'][number]['proof']

export type OracleReaders = Readonly<{
  assertCommitExists: (sha: string) => void
  readGitSource: (sha: string, path: string) => string
  searchGitSource: (
    sha: string,
    pattern: string,
    pathspecs: readonly string[],
  ) => readonly string[]
  readCurrentFile: (path: string) => string
}>

export const repositoryOracleReaders: OracleReaders = {
  assertCommitExists(sha) {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' })
  },
  readGitSource(sha, path) {
    return execFileSync('git', ['show', `${sha}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  },
  searchGitSource(sha, pattern, pathspecs) {
    try {
      const output = execFileSync(
        'git',
        ['grep', '-n', '--fixed-strings', pattern, sha, '--', ...pathspecs],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      return output.trimEnd() === '' ? [] : output.trimEnd().split('\n')
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 1) return []
      throw error
    }
  },
  readCurrentFile(path) {
    return readFileSync(resolve(path), 'utf8')
  },
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertMarkers(
  label: string,
  content: string,
  contains: readonly string[],
  omits: readonly string[] = [],
  ordered = false,
): void {
  let cursor = 0
  for (const marker of contains) {
    const markerIndex = content.indexOf(marker, ordered ? cursor : 0)
    if (markerIndex < 0) {
      throw new Error(
        `${label} does not contain required marker ${JSON.stringify(marker)}`,
      )
    }
    if (ordered) cursor = markerIndex + marker.length
  }
  for (const marker of omits) {
    if (content.includes(marker)) {
      throw new Error(
        `${label} unexpectedly contains forbidden marker ${JSON.stringify(marker)}`,
      )
    }
  }
}

function proofScope(
  label: string,
  content: string,
  scope: Readonly<{ startAt: string; endBefore: string }> | undefined,
): string {
  if (!scope) return content
  const start = content.indexOf(scope.startAt)
  if (start < 0) throw new Error(`${label} scope start marker was not found`)
  const end = content.indexOf(scope.endBefore, start + scope.startAt.length)
  if (end < 0) throw new Error(`${label} scope end marker was not found`)
  return content.slice(start, end)
}

function assertDigest(label: string, content: string, expected: string): string {
  const actual = sha256(content)
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch; expected ${expected}, received ${actual}`)
  }
  return actual
}

function deriveConclusion(
  checks: readonly { conclusion: CheckConclusion }[],
): HistoricalConclusion {
  const conclusions = new Set(checks.map(({ conclusion }) => conclusion))
  if (conclusions.size > 1) return 'mixed_evidence'
  return conclusions.has('fault_reproduced')
    ? 'reproduced_faulty_seam'
    : 'contrary_evidence'
}

function expectedExitCode(conclusion: HistoricalConclusion): number {
  return conclusion === 'reproduced_faulty_seam'
    ? 1
    : conclusion === 'mixed_evidence'
      ? 2
      : 0
}

function canonicalResult(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function verifyProof(
  oracleId: OracleId,
  checkId: string,
  proof: ParsedHistoricalProof,
  index: ParsedIndex,
  readers: OracleReaders,
): string {
  const label = `${oracleId}/${checkId}/${proof.kind}`
  if (proof.kind === 'git_search') {
    const output = readers.searchGitSource(
      index.frozenSha,
      proof.pattern,
      proof.pathspecs,
    )
    if (JSON.stringify(output) !== JSON.stringify(proof.expectedOutput)) {
      throw new Error(
        `${label} search output mismatch; expected ${JSON.stringify(proof.expectedOutput)}, received ${JSON.stringify(output)}`,
      )
    }
    return assertDigest(label, canonicalResult(output), proof.outputSha256)
  }

  const commit = proof.kind === 'git_source' ? index.frozenSha : proof.retainedAtCommit
  if (proof.kind === 'retained_file' && commit !== index.evidenceCommit) {
    throw new Error(
      `${label} retained evidence commit does not match the index evidenceCommit`,
    )
  }
  readers.assertCommitExists(commit)
  const content = readers.readGitSource(commit, proof.path)
  assertMarkers(
    label,
    proofScope(label, content, proof.scope),
    proof.contains,
    proof.omits,
    true,
  )
  return assertDigest(label, content, proof.sha256)
}

export type HistoricalCaseResult = Readonly<{
  schemaVersion: 1
  id: OracleId
  frozenSha: typeof FROZEN_REVIEW_SHA
  conclusion: HistoricalConclusion
  checks: ReadonlyArray<
    Readonly<{
      id: string
      conclusion: CheckConclusion
      proofSha256: string
    }>
  >
}>

function buildHistoricalCaseResult(
  entry: ParsedOracle,
  index: ParsedIndex,
  readers: OracleReaders,
): HistoricalCaseResult {
  const accepted = ACCEPTED_CHECK_CONCLUSIONS[entry.id]
  const actualContract = Object.fromEntries(
    entry.historicalChecks.map(({ id, conclusion }) => [id, conclusion]),
  )
  if (JSON.stringify(actualContract) !== JSON.stringify(accepted)) {
    throw new Error(
      `${entry.id} conclusion contract mismatch; evidence classifications require independent code and index review`,
    )
  }
  const checks = entry.historicalChecks.map((check) => ({
    id: check.id,
    conclusion: check.conclusion,
    proofSha256: verifyProof(entry.id, check.id, check.proof, index, readers),
  }))
  const conclusion = deriveConclusion(checks)
  if (entry.baselineOutcome !== conclusion) {
    throw new Error(
      `${entry.id} baselineOutcome ${entry.baselineOutcome} does not match derived conclusion ${conclusion}`,
    )
  }
  return {
    schemaVersion: 1,
    id: entry.id,
    frozenSha: FROZEN_REVIEW_SHA,
    conclusion,
    checks,
  }
}

function assertFailureArtifact(entry: ParsedOracle, result: HistoricalCaseResult): void {
  const expectedCommand = `pnpm review:run-pre-fix-oracle -- ${entry.id}`
  if (entry.failureArtifact.command !== expectedCommand) {
    throw new Error(
      `${entry.id} command mismatch; expected ${JSON.stringify(expectedCommand)}`,
    )
  }
  if (entry.failureArtifact.expectedConclusion !== result.conclusion) {
    throw new Error(`${entry.id} failure artifact conclusion does not match result`)
  }
  const exitCode = expectedExitCode(result.conclusion)
  if (entry.failureArtifact.expectedExitCode !== exitCode) {
    throw new Error(
      `${entry.id} failure artifact exit code must be ${exitCode} for ${result.conclusion}`,
    )
  }
  assertDigest(
    `${entry.id} failure artifact`,
    canonicalResult(result),
    entry.failureArtifact.resultSha256,
  )
}

function parseAndAssertIndex(input: unknown, readers: OracleReaders): ParsedIndex {
  const index = oracleIndex.parse(input)
  const ids = index.oracles.map(({ id }) => id)
  if (JSON.stringify(ids) !== JSON.stringify(ORACLE_IDS)) {
    throw new Error(
      `oracle index must contain all 13 accepted cases exactly once and in order; expected ${ORACLE_IDS.join(', ')}`,
    )
  }
  readers.assertCommitExists(index.frozenSha)
  readers.assertCommitExists(index.evidenceCommit)
  return index
}

/**
 * Validates immutable, SHA-256-bound historical failure artifacts and their
 * current executable recovery/release-assurance gates. Structural artifacts
 * do not claim that current test code compiled unchanged at the frozen SHA.
 */
export function validatePreFixOracleIndex(
  input: unknown,
  readers: OracleReaders = repositoryOracleReaders,
): readonly string[] {
  const index = parseAndAssertIndex(input, readers)

  for (const entry of index.oracles) {
    const result = buildHistoricalCaseResult(entry, index, readers)
    assertFailureArtifact(entry, result)
    for (const proof of entry.currentRegressionProofs) {
      assertMarkers(
        `${entry.id} current regression ${proof.path}`,
        readers.readCurrentFile(proof.path),
        proof.contains,
      )
    }
  }

  return index.oracles.map(({ id }) => id)
}

export function runHistoricalOracleCase(
  input: unknown,
  id: string,
  readers: OracleReaders = repositoryOracleReaders,
): Readonly<{ result: HistoricalCaseResult; exitCode: number }> {
  const index = parseAndAssertIndex(input, readers)
  const entry = index.oracles.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`unknown pre-fix oracle ${JSON.stringify(id)}`)
  const result = buildHistoricalCaseResult(entry, index, readers)
  assertFailureArtifact(entry, result)
  return { result, exitCode: expectedExitCode(result.conclusion) }
}

type CliIo = Readonly<{
  stdout: (value: string) => void
  stderr: (value: string) => void
}>

const processIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
}

export function runPreFixOracleCli(
  args: readonly string[],
  io: CliIo = processIo,
): number {
  try {
    const normalizedArgs =
      args[0] === '--case' && args[1] === '--' ? [args[0], ...args.slice(2)] : [...args]
    const caseMode = normalizedArgs[0] === '--case'
    const path = resolve(
      caseMode
        ? (normalizedArgs[2] ??
            'docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json')
        : (normalizedArgs[0] ??
            'docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json'),
    )
    const input = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (caseMode) {
      const { result, exitCode } = runHistoricalOracleCase(input, normalizedArgs[1] ?? '')
      io.stdout(canonicalResult(result))
      return exitCode
    }

    const ids = validatePreFixOracleIndex(input)
    const index = oracleIndex.parse(input)
    const outcomes = Object.fromEntries(
      ['reproduced_faulty_seam', 'contrary_evidence', 'mixed_evidence'].map((outcome) => [
        outcome,
        index.oracles.filter((entry) => entry.baselineOutcome === outcome).length,
      ]),
    )
    const resolution = Object.fromEntries(
      ['closed', 'partial', 'open'].map((state) => [
        state,
        index.oracles.filter((entry) => entry.resolution === state).length,
      ]),
    )
    io.stdout(canonicalResult({ oracles: ids.length, outcomes, resolution }))
    return 0
  } catch (error) {
    io.stderr(
      `pre-fix oracle index invalid: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPreFixOracleCli(process.argv.slice(2))
}
