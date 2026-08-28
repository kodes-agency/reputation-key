// REL-01 Promotion step 4 — `pnpm release:observe-canary`.
//
// The executable half of the canary gate. This command may only ever observe:
// it makes GET requests against the production `cell-us` origin and the
// operator-supplied source endpoints, and writes one canonical
// `repkey-canary-window-1` artifact plus every dependency file that artifact
// names.
//
// Fail-closed contract, in refusal order (cheapest refusal first):
//   1. any `--retries` flag is refused outright — a canary window that can be
//      re-run to green proves nothing, and the evidence schema pins
//      attempts: 1 / retries: 0;
//   2. any `--app-origin` other than the single production cell-us origin is
//      refused, so a staging or local observation can never be relabelled;
//   3. every artifact is created exclusively (see write-once.ts), so an output
//      path that already exists is refused by the write itself and no run can
//      silently replace an earlier artifact;
//   4. the candidate manifest digest must equal the digest of the supplied
//      manifest file;
//   5. the threshold profile must be RATIFIED (ADR 0059). While the duration is
//      an open operating decision the command exits non-zero naming the open
//      decision. There is no default duration and no override;
//   6. a signal whose source has no reachable endpoint is refused before the
//      window starts, rather than sampled as absent.
//
// Nothing here retries, defaults, or synthesizes a reading. An unreachable read
// is a MISSING sample (see canary-sampler.ts), which fails the window.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import {
  observeCanaryWindow,
  type CanarySampleReader,
  type CanarySignalRead,
} from '../../src/shared/release/canary-sampler'
import {
  canaryThresholdSignalReadPlan,
  CANARY_THRESHOLD_DECISION_RECORD_PATH,
  CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH,
  parseCanaryThresholdProfile,
} from '../../src/shared/release/canary-threshold-profile'
import {
  canonicalCanaryWindowEvidence,
  type CanaryThresholdProfile,
} from '../../src/shared/release/canary-window-evidence'
import { releaseEvidenceSha256 } from '../../src/shared/release/candidate-bound-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { writeContentAddressed, writeOnce } from '../../src/shared/release/write-once'

const COMMAND_NAME = 'release:observe-canary'
const PRODUCTION_APP_ORIGIN = 'https://us.reputationkey.app'

/** The ops-token gated private operator surface (BQC-7.2). */
export const CANARY_METRICS_PATH = '/api/health/metrics'
/** The unauthenticated platform readiness probe used for synthetic reads. */
export const CANARY_SYNTHETIC_PATH = '/api/health/ready'

export type CanaryCliIo = Readonly<{
  out: (line: string) => void
  err: (line: string) => void
}>

const consoleIo: CanaryCliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}

const sourceEndpointSchema = z
  .object({
    url: z.url(),
    headerName: z.string().trim().min(1).max(128).optional(),
    tokenEnv: z.string().trim().min(1).max(128).optional(),
  })
  .strict()

/**
 * Only sources this command cannot reach structurally may be pointed at an
 * operator endpoint. `application_metrics` and `external_synthetic` are pinned
 * to the production origin so an operator cannot redirect them.
 */
const sourceEndpointsSchema = z.record(
  z.enum(['sentry', 'provider_control', 'railway_platform', 'release_controller']),
  sourceEndpointSchema,
)

export type CanarySourceEndpoint = z.infer<typeof sourceEndpointSchema> &
  Readonly<{ token?: string }>

export function observeCanaryWindowUsage(): string {
  return [
    `Usage: pnpm ${COMMAND_NAME} -- \\`,
    `  --app-origin=${PRODUCTION_APP_ORIGIN} \\`,
    '  --release-sha=<40 hex> \\',
    '  --release-manifest=<promotion-manifest.json> \\',
    '  --release-manifest-sha256=<64 hex> \\',
    '  --project-id=<railway project id> --environment-id=<railway environment id> \\',
    '  --output=<canary-window.json> [--dependency-dir=<directory>] \\',
    `  [--profile=${CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH}]`,
    `  [--decision-record=${CANARY_THRESHOLD_DECISION_RECORD_PATH}]`,
    '  [--source-endpoints=<endpoints.json>]',
    '',
    'OPS_METRICS_TOKEN must be exported so the private metrics surface answers.',
    'The observation runs exactly once; there is no retry option by design.',
  ].join('\n')
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function resolvePointer(body: unknown, pointer: string): number | undefined {
  let current: unknown = body
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current) && segment === 'length') {
      current = current.length
      continue
    }
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined
}

type ObservedReleaseIdentity = Readonly<{
  releaseSha?: string
  releaseManifestSha256?: string
}>

function identityFrom(body: unknown): ObservedReleaseIdentity | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const release = record.release
  const releaseSha =
    release !== null && typeof release === 'object'
      ? (release as Record<string, unknown>).sha
      : record.releaseSha
  const manifest =
    release !== null && typeof release === 'object'
      ? (release as Record<string, unknown>).manifestSha256
      : record.releaseManifestSha256
  if (typeof releaseSha !== 'string' && typeof manifest !== 'string') return undefined
  return {
    ...(typeof releaseSha === 'string' ? { releaseSha } : {}),
    ...(typeof manifest === 'string' ? { releaseManifestSha256: manifest } : {}),
  }
}

function configurationHeadFrom(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const versions = (body as Record<string, unknown>).versions
  if (versions === null || typeof versions !== 'object') return undefined
  const record = versions as Record<string, unknown>
  return `${JSON.stringify(
    Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key] ?? null]),
    ),
  )}\n`
}

/**
 * Build the reader. Sources this command can reach structurally
 * (`application_metrics`, `external_synthetic`) are pinned to the production
 * origin and are NOT operator-overridable. Every other source needs an explicit
 * endpoint; an absent one is a refusal, never a defaulted read.
 */
export function createCanarySampleReader(
  input: Readonly<{
    appOrigin: string
    opsToken: string
    endpoints: ReadonlyMap<string, CanarySourceEndpoint>
    fetchImpl: typeof fetch
  }>,
): CanarySampleReader {
  return async ({ signal }) => {
    if (signal.source === 'external_synthetic') {
      const url = `${input.appOrigin}${CANARY_SYNTHETIC_PATH}`
      const startedAt = Date.now()
      const response = await input.fetchImpl(url, { method: 'GET' })
      const durationMs = Date.now() - startedAt
      // The synthetic body is the sampler's OWN measurement of the deployed
      // origin, not a claim copied out of the application.
      const rawSample = `${JSON.stringify({
        probe: {
          durationMs,
          failedCount: response.ok ? 0 : 1,
          status: response.status,
          url,
        },
      })}\n`
      const value = resolvePointer(JSON.parse(rawSample), signal.valuePointer)
      if (value === undefined) {
        return { ok: false, reason: `${url}: ${signal.valuePointer} did not resolve` }
      }
      return { ok: true, value, rawSample }
    }

    const endpoint: CanarySourceEndpoint | undefined =
      signal.source === 'application_metrics'
        ? {
            url: `${input.appOrigin}${CANARY_METRICS_PATH}`,
            headerName: 'x-ops-token',
            token: input.opsToken,
          }
        : input.endpoints.get(signal.source)
    if (!endpoint) {
      return {
        ok: false,
        reason: `no endpoint is configured for source ${signal.source}`,
      }
    }

    let response: Response
    try {
      response = await input.fetchImpl(endpoint.url, {
        method: 'GET',
        headers:
          endpoint.headerName && endpoint.token
            ? { [endpoint.headerName]: endpoint.token }
            : {},
      })
    } catch (error) {
      return {
        ok: false,
        reason: `${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (!response.ok) {
      return { ok: false, reason: `GET ${endpoint.url} returned ${response.status}` }
    }

    const rawSample = await response.text()
    let body: unknown
    try {
      body = JSON.parse(rawSample)
    } catch {
      return { ok: false, reason: `${endpoint.url}: response was not JSON` }
    }
    const value = resolvePointer(body, signal.valuePointer)
    if (value === undefined) {
      return {
        ok: false,
        reason: `${endpoint.url}: ${signal.valuePointer} did not resolve to a finite number`,
      }
    }
    const identity = identityFrom(body)
    const configurationHead = configurationHeadFrom(body)
    return {
      ok: true,
      value,
      rawSample: rawSample.endsWith('\n') ? rawSample : `${rawSample}\n`,
      ...(identity ? { identity } : {}),
      ...(configurationHead ? { configurationHead } : {}),
    }
  }
}

function readEndpoints(
  path: string | undefined,
  env: NodeJS.ProcessEnv,
):
  | Readonly<{ ok: true; endpoints: Map<string, CanarySourceEndpoint> }>
  | Readonly<{
      ok: false
      errors: readonly string[]
    }> {
  const endpoints = new Map<string, CanarySourceEndpoint>()
  if (!path) return { ok: true, endpoints }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolve(path), 'utf8'))
  } catch (error) {
    return {
      ok: false,
      errors: [`${path}: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const parsed = sourceEndpointsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${path}: ${issue.path.join('.')} ${issue.message}`,
      ),
    }
  }
  const errors: string[] = []
  for (const [source, value] of Object.entries(parsed.data)) {
    const entry = sourceEndpointSchema.safeParse(value)
    if (!entry.success) continue
    const token = entry.data.tokenEnv ? env[entry.data.tokenEnv] : undefined
    if (entry.data.tokenEnv && !token) {
      errors.push(`${source}: ${entry.data.tokenEnv} is not exported`)
      continue
    }
    endpoints.set(source, { ...entry.data, ...(token ? { token } : {}) })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, endpoints }
}

export type ObserveCanaryWindowDeps = Readonly<{
  io?: CanaryCliIo
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  now?: () => string
  waitUntil?: (scheduledAt: string) => Promise<void>
}>

async function sleepUntil(scheduledAt: string): Promise<void> {
  const delay = Date.parse(scheduledAt) - Date.now()
  if (delay <= 0) return
  await new Promise((done) => setTimeout(done, delay))
}

export async function runObserveCanaryWindowCli(
  args: readonly string[],
  deps: ObserveCanaryWindowDeps = {},
): Promise<number> {
  const io = deps.io ?? consoleIo
  const env = deps.env ?? process.env

  // 1. Retries are refused before anything else: the flag itself is the defect.
  const retryFlag = args.find(
    (arg) => arg === '--retries' || arg.startsWith('--retries='),
  )
  if (retryFlag) {
    io.err(
      `${COMMAND_NAME} refuses --retries. A canary window is observed exactly once; ` +
        're-running it to green would prove nothing.',
    )
    return 2
  }

  const required = [
    '--app-origin',
    '--release-sha',
    '--release-manifest',
    '--release-manifest-sha256',
    '--project-id',
    '--environment-id',
    '--output',
  ]
  const missing = required.filter((flag) => flagValue(args, flag) === undefined)
  if (missing.length > 0) {
    io.err(`${COMMAND_NAME} needs ${missing.join(', ')}.`)
    io.err(observeCanaryWindowUsage())
    return 2
  }

  const appOrigin = flagValue(args, '--app-origin') ?? ''
  if (appOrigin !== PRODUCTION_APP_ORIGIN) {
    io.err(
      `${COMMAND_NAME} refuses --app-origin=${appOrigin}. Canary evidence is only ` +
        `meaningful against the single production cell-us origin ${PRODUCTION_APP_ORIGIN}.`,
    )
    return 2
  }

  const outputPath = resolve(flagValue(args, '--output') ?? '')

  const manifestPath = resolve(flagValue(args, '--release-manifest') ?? '')
  let manifestDigest: string
  try {
    manifestDigest = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const declaredManifestDigest = flagValue(args, '--release-manifest-sha256')
  if (declaredManifestDigest !== manifestDigest) {
    io.err(
      `${COMMAND_NAME}: --release-manifest-sha256=${declaredManifestDigest} does not match ` +
        `${manifestPath} (${manifestDigest}).`,
    )
    return 2
  }

  const decisionRecordPath = resolve(
    flagValue(args, '--decision-record') ?? CANARY_THRESHOLD_DECISION_RECORD_PATH,
  )
  const profilePath = resolve(
    flagValue(args, '--profile') ?? CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH,
  )
  let decisionRecord: string
  let profileDocument: string
  try {
    decisionRecord = readFileSync(decisionRecordPath, 'utf8')
    profileDocument = readFileSync(profilePath, 'utf8')
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const decisionRecordSha256 = releaseEvidenceSha256(decisionRecord)

  const profileResult = parseCanaryThresholdProfile(profileDocument, {
    decisionRecordSha256,
  })
  if (!profileResult.ok) {
    io.err(`${COMMAND_NAME}: ${profilePath} is not a usable threshold profile:`)
    for (const error of profileResult.errors) io.err(`  ${error}`)
    return 1
  }
  if (profileResult.state === 'open') {
    io.err(
      `${COMMAND_NAME}: the canary threshold profile is unratified. ` +
        `${profileResult.openDecisions.join(', ')} remain open operating decisions in ` +
        `${CANARY_THRESHOLD_DECISION_RECORD_PATH}. An unratified window is a closed gate; ` +
        'there is no default duration.',
    )
    return 1
  }
  const profile: CanaryThresholdProfile = profileResult.profile

  const opsToken = env.OPS_METRICS_TOKEN
  if (!opsToken) {
    io.err(
      `${COMMAND_NAME}: OPS_METRICS_TOKEN is not exported, so the private metrics surface ` +
        'answers 404 to every sample. Refusing to start rather than recording a window of ' +
        'missing samples.',
    )
    return 1
  }

  const endpointResult = readEndpoints(flagValue(args, '--source-endpoints'), env)
  if (!endpointResult.ok) {
    for (const error of endpointResult.errors) io.err(`${COMMAND_NAME}: ${error}`)
    return 1
  }

  const readPlan: readonly CanarySignalRead[] = canaryThresholdSignalReadPlan(
    profileResult.authority,
  )
  const unreachable = readPlan.filter(
    (signal) =>
      signal.source !== 'application_metrics' &&
      signal.source !== 'external_synthetic' &&
      !endpointResult.endpoints.has(signal.source),
  )
  if (unreachable.length > 0) {
    io.err(
      `${COMMAND_NAME}: no endpoint is configured for ${unreachable
        .map(({ source }) => source)
        .join(', ')}. Supply --source-endpoints; a signal that cannot be read is not ` +
        'observed, it is missing.',
    )
    return 1
  }

  const startedAt = (deps.now ?? (() => new Date().toISOString()))()
  const result = await observeCanaryWindow({
    candidate: {
      releaseSha: flagValue(args, '--release-sha') ?? '',
      releaseManifestSha256: manifestDigest,
      cell: 'us',
      environment: 'cell-us',
      deploymentProfile: 'production',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: flagValue(args, '--project-id') ?? '',
      environmentId: flagValue(args, '--environment-id') ?? '',
      appOrigin: PRODUCTION_APP_ORIGIN,
    },
    profile,
    readPlan,
    runId: randomUUID(),
    startedAt,
    read: createCanarySampleReader({
      appOrigin: PRODUCTION_APP_ORIGIN,
      opsToken,
      endpoints: endpointResult.endpoints,
      fetchImpl: deps.fetchImpl ?? fetch,
    }),
    waitUntil: deps.waitUntil ?? sleepUntil,
    now: deps.now ?? (() => new Date().toISOString()),
    authorities: [{ sha256: decisionRecordSha256, content: decisionRecord }],
  })

  if (!result.ok) {
    io.err(`${COMMAND_NAME}: refusing to emit canary evidence:`)
    for (const error of result.errors) io.err(`  ${error}`)
    return 1
  }

  const dependencyDir = resolve(
    flagValue(args, '--dependency-dir') ?? dirname(outputPath),
  )
  for (const dependency of result.dependencies) {
    const path = resolve(dependencyDir, `${dependency.sha256}.dependency`)
    // The filename is the digest, so a sibling that is already there holds
    // these exact bytes. Retaining it twice is not a conflict.
    const retained = writeContentAddressed(path, dependency.content)
    if (retained.status === 'failed') {
      io.err(`${COMMAND_NAME}: ${retained.message}`)
      return 1
    }
  }

  // The exclusive create IS the refusal — there is no separate existence check
  // to race against. An artifact that is already there ends the run.
  const emitted = writeOnce(outputPath, canonicalCanaryWindowEvidence(result.evidence))
  if (emitted.status === 'already_present') {
    io.err(`${COMMAND_NAME} refuses to overwrite the existing artifact ${outputPath}.`)
    return 2
  }
  if (emitted.status === 'failed') {
    io.err(`${COMMAND_NAME}: ${emitted.message}`)
    return 1
  }

  io.out(`canary window ${result.evidence.outcome}: ${outputPath}`)
  io.out(`retained ${result.dependencies.length} dependency files in ${dependencyDir}`)
  return result.evidence.outcome === 'passed' ? 0 : 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runObserveCanaryWindowCli(process.argv.slice(2))
}
