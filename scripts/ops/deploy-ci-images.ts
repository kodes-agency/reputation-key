// Closed-beta delivery path for the exact production images already built,
// smoke-checked, inventoried and Grype-scanned by the successful main CI run.
// That run publishes the immutable source-revision tags and digest map this
// command consumes; no separate release manifest participates.
//
// Report (default, no Railway mutation):
//   pnpm ops:deploy-ci-images [<source-revision>] --operator <id>
//
// Apply to the fixed live closed-beta target (explicit live opt-in required):
//   pnpm ops:deploy-ci-images [<source-revision>] --operator <id> \
//     --reason <text> --ticket <ref> --live --apply --yes ops:deploy-ci-images

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  array,
  integer,
  parseRailwayServiceSource,
  record,
  string,
  type JsonRecord,
  type RailwayServiceSource,
} from '../../src/shared/release/json-shape-guards'
import { runOperatorCommand } from './operator-command'

export const CI_IMAGE_DIGEST_MAP_VERSION = 'repkey-ci-image-digest-map-1' as const
export const CI_IMAGE_DIGEST_MAP_FILE = 'ci-image-digest-map.json' as const
export const TRUSTED_REPOSITORY = 'kodes-agency/reputation-key' as const
export const TRUSTED_CI_WORKFLOW = '.github/workflows/ci.yml' as const
export const CLOSED_BETA_ENVIRONMENT = 'google-closed-beta' as const
export const CLOSED_BETA_PROJECT_ID = '91ab4b88-25a1-404c-9961-4f2b392e2874' as const
export const CLOSED_BETA_ENVIRONMENT_ID = '4a1eec11-f629-4acc-aa21-b6326fcf97e8' as const

export const CI_PRODUCTION_IMAGE_NAMES = Object.freeze([
  'web',
  'worker',
  'google-provider-redis',
  'google-egress-gateway',
  'google-execution-admission',
  'ai-egress-gateway',
  'ai-execution-admission',
] as const)

export type CiProductionImageName = (typeof CI_PRODUCTION_IMAGE_NAMES)[number]

type ImageDigest = `sha256:${string}`

export type CiImageDigest = Readonly<{
  repository: string
  digest: ImageDigest
  sourceRevision: string
}>

export type CiImageDigestMap = Readonly<{
  version: typeof CI_IMAGE_DIGEST_MAP_VERSION
  sourceRevision: string
  source: Readonly<{
    repository: typeof TRUSTED_REPOSITORY
    ref: 'refs/heads/main'
    workflow: typeof TRUSTED_CI_WORKFLOW
    runId: string
    runAttempt: number
  }>
  images: Readonly<Record<CiProductionImageName, CiImageDigest>>
}>

export type CommandResult = Readonly<{
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}>

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
) => CommandResult

export type GitRevisionReader = Readonly<{
  resolveCommit: (reference: string) => string
  isAncestor: (ancestor: string, descendant: string) => boolean
}>

const SOURCE_REVISION = /^[0-9a-f]{40}$/u
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u
const RUN_ID = /^[1-9][0-9]*$/u
const PENDING_DEPLOYMENT_STATUSES: Readonly<Record<string, true>> = Object.freeze({
  QUEUED: true,
  INITIALIZING: true,
  WAITING: true,
  BUILDING: true,
  DEPLOYING: true,
})
const POLL_INTERVAL_MS = 10_000
const DEPLOY_TIMEOUT_MS = 15 * 60_000
const WEB_HEALTH_TIMEOUT_MS = 2 * 60_000
const WEB_HEALTH_URLS = Object.freeze([
  'https://web-google-closed-beta.up.railway.app/api/health/ready',
  'https://web-google-closed-beta.up.railway.app/api/health/started',
] as const)

/** All six GitHub-backed services are now proven on a digest source. The
 * sidecars were blocked until this command started writing `RELEASE_SHA`
 * itself: `google-egress-gateway` used to crash its first image-sourced boot
 * with `required Google gateway setting is missing: RELEASE_SHA`, because that
 * name is platform-supplied metadata a digest source never receives. With the
 * identity written before the deploy, all four settled healthy on 2026-09-05.
 *
 * The provider Redis stays out. It runs upstream `redis:7` by digest, so
 * repointing it is not a source change but a substitution of the live queue
 * and cache substrate with an image that has never been deployed. It is also
 * ordered LAST so a substrate failure cannot precede the services that depend
 * on it. */
const GITHUB_BACKED_IMAGE_SERVICES = Object.freeze([
  {
    imageName: 'google-execution-admission',
    serviceName: 'google-execution-admission',
    serviceId: '20be79ce-7067-4552-bf19-29c0216e6740',
  },
  {
    imageName: 'google-egress-gateway',
    serviceName: 'google-egress-gateway',
    serviceId: 'af50a9d7-5aab-45f5-aa4b-89b0b89f355a',
  },
  {
    imageName: 'ai-execution-admission',
    serviceName: 'ai-execution-admission',
    serviceId: 'b37bf32a-6d64-4f8b-92af-c03695a1907f',
  },
  {
    imageName: 'ai-egress-gateway',
    serviceName: 'ai-egress-gateway',
    serviceId: '24c15645-70ed-4144-8e5a-fee2cfdf51c7',
  },
] as const)

const PROVIDER_REDIS_IMAGE_SERVICE = Object.freeze({
  imageName: 'google-provider-redis',
  serviceName: 'google-provider-redis',
  serviceId: '91935481-1aae-4dcd-b0f2-a84b0b3b34f3',
})

export const CLOSED_BETA_IMAGE_SERVICES = Object.freeze([
  {
    imageName: 'web',
    serviceName: 'web',
    serviceId: '27bbc8e9-c8aa-4104-aa3d-7e8ce9d2071b',
  },
  {
    imageName: 'worker',
    serviceName: 'worker',
    serviceId: 'a667f978-ee3e-4707-9d38-7c23a4f2e4cc',
  },
  ...GITHUB_BACKED_IMAGE_SERVICES,
] as const satisfies ReadonlyArray<
  Readonly<{
    imageName: CiProductionImageName
    serviceName: string
    serviceId: string
  }>
>)

export type ClosedBetaImageScope = Readonly<{
  includeProviderRedis: boolean
}>

export function closedBetaImageServices(
  scope: ClosedBetaImageScope,
): ReadonlyArray<
  Readonly<{ imageName: CiProductionImageName; serviceName: string; serviceId: string }>
> {
  return scope.includeProviderRedis
    ? Object.freeze([...CLOSED_BETA_IMAGE_SERVICES, PROVIDER_REDIS_IMAGE_SERVICE])
    : CLOSED_BETA_IMAGE_SERVICES
}

export type RailwayServiceObservation = Readonly<{
  id: string
  name: string
  source: RailwayServiceSource | null
  status: string
  deploymentStopped: boolean
  deploymentId: string
  configuredReplicas: number
  runningReplicas: number
  crashedReplicas: number
}>

export type ClosedBetaImageDeployment = Readonly<{
  imageName: CiProductionImageName
  serviceName: string
  serviceId: string
  repository: string
  digest: ImageDigest
  imageReference: string
  sourceRevision: string
  beforeSource: RailwayServiceSource | null
  beforeDeploymentId: string
}>

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected)
  const actual = Object.keys(value)
  const missing = expected.filter((key) => !Object.hasOwn(value, key))
  const unexpected = actual.filter((key) => !expectedSet.has(key))
  if (missing.length === 0 && unexpected.length === 0) return
  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
  ].filter(Boolean)
  throw new Error(`${label} has invalid fields: ${details.join('; ')}`)
}

function parseJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function expectedImageRepository(imageName: CiProductionImageName): string {
  return `ghcr.io/kodes-agency/repkey-${imageName}`
}

export function ciImageDigestMapArtifactName(sourceRevision: string): string {
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error('CI image digest artifact revision must be a full lowercase git SHA')
  }
  return `ci-image-digest-map-${sourceRevision}`
}

type CiImageDigestMapEnvelope = Readonly<{
  sourceRevision: string
  source: unknown
  images: unknown
}>

function parseCiImageDigestMapEnvelope(
  content: string,
  expectedRevision: string,
): CiImageDigestMapEnvelope {
  if (!SOURCE_REVISION.test(expectedRevision)) {
    throw new Error('expected source revision must be a full lowercase git SHA')
  }
  const root = record(parseJson(content, 'CI image digest map'), 'CI image digest map')
  exactKeys(
    root,
    ['version', 'sourceRevision', 'source', 'images'],
    'CI image digest map',
  )
  if (root.version !== CI_IMAGE_DIGEST_MAP_VERSION) {
    throw new Error('CI image digest map has an unsupported version')
  }
  const sourceRevision = string(root.sourceRevision, 'CI image digest map sourceRevision')
  if (sourceRevision !== expectedRevision) {
    throw new Error(
      `CI image digest map source revision ${sourceRevision} does not match ${expectedRevision}`,
    )
  }
  return { sourceRevision, source: root.source, images: root.images }
}

function parseCiImageDigestMapSource(
  value: unknown,
  expectedRun?: Readonly<{ id: string; attempt: number }>,
): CiImageDigestMap['source'] {
  const source = record(value, 'CI image digest map source')
  exactKeys(
    source,
    ['repository', 'ref', 'workflow', 'runId', 'runAttempt'],
    'CI image digest map source',
  )
  if (
    source.repository !== TRUSTED_REPOSITORY ||
    source.ref !== 'refs/heads/main' ||
    source.workflow !== TRUSTED_CI_WORKFLOW
  ) {
    throw new Error(
      'CI image digest map was not produced by the trusted main CI workflow',
    )
  }
  const runId = string(source.runId, 'CI image digest map source runId')
  if (!RUN_ID.test(runId)) throw new Error('CI image digest map source runId is invalid')
  const runAttempt = integer(source.runAttempt, 'CI image digest map source runAttempt')
  if (runAttempt < 1) throw new Error('CI image digest map source runAttempt is invalid')
  if (expectedRun && (runId !== expectedRun.id || runAttempt !== expectedRun.attempt)) {
    throw new Error(
      'CI image digest map workflow run identity does not match its artifact',
    )
  }
  return {
    repository: TRUSTED_REPOSITORY,
    ref: 'refs/heads/main',
    workflow: TRUSTED_CI_WORKFLOW,
    runId,
    runAttempt,
  }
}

function assertExactCiImageDigestNames(rawImages: JsonRecord): void {
  const expectedImageNames: string[] = [...CI_PRODUCTION_IMAGE_NAMES].sort()
  const actualImageNames = Object.keys(rawImages).sort()
  const missing = expectedImageNames.filter((name) => !actualImageNames.includes(name))
  const unexpected = actualImageNames.filter((name) => !expectedImageNames.includes(name))
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
    ].filter(Boolean)
    throw new Error(
      `CI image digest map must contain exactly seven production images: ${details}`,
    )
  }
}

function parseCiImageDigestEntry(
  value: unknown,
  imageName: CiProductionImageName,
  expectedRevision: string,
): CiImageDigest {
  const entry = record(value, `CI image digest map images.${imageName}`)
  exactKeys(
    entry,
    ['repository', 'digest', 'sourceRevision'],
    `CI image digest map images.${imageName}`,
  )
  const repository = string(
    entry.repository,
    `CI image digest map images.${imageName}.repository`,
  )
  if (repository !== expectedImageRepository(imageName)) {
    throw new Error(
      `CI image digest map repository for ${imageName} must be ${expectedImageRepository(imageName)}`,
    )
  }
  const digest = string(entry.digest, `CI image digest map images.${imageName}.digest`)
  if (!IMAGE_DIGEST.test(digest)) {
    throw new Error(`CI image digest map is missing a valid digest for ${imageName}`)
  }
  const imageSourceRevision = string(
    entry.sourceRevision,
    `CI image digest map images.${imageName}.sourceRevision`,
  )
  if (imageSourceRevision !== expectedRevision) {
    throw new Error(
      `CI image digest map image ${imageName} has the wrong source revision`,
    )
  }
  return Object.freeze({
    repository,
    digest: digest as ImageDigest,
    sourceRevision: imageSourceRevision,
  })
}

function parseCiImageDigests(
  value: unknown,
  expectedRevision: string,
): Record<CiProductionImageName, CiImageDigest> {
  const rawImages = record(value, 'CI image digest map images')
  assertExactCiImageDigestNames(rawImages)
  const images = {} as Record<CiProductionImageName, CiImageDigest>
  for (const imageName of CI_PRODUCTION_IMAGE_NAMES) {
    images[imageName] = parseCiImageDigestEntry(
      rawImages[imageName],
      imageName,
      expectedRevision,
    )
  }
  return images
}

export function parseCiImageDigestMap(
  content: string,
  expectedRevision: string,
  expectedRun?: Readonly<{ id: string; attempt: number }>,
): CiImageDigestMap {
  const envelope = parseCiImageDigestMapEnvelope(content, expectedRevision)
  const source = parseCiImageDigestMapSource(envelope.source, expectedRun)
  const images = parseCiImageDigests(envelope.images, expectedRevision)

  return Object.freeze({
    version: CI_IMAGE_DIGEST_MAP_VERSION,
    sourceRevision: envelope.sourceRevision,
    source: Object.freeze(source),
    images: Object.freeze(images),
  })
}

export function resolveDeploymentRevision(
  requestedRevision: string | undefined,
  git: GitRevisionReader,
): string {
  if (requestedRevision && !SOURCE_REVISION.test(requestedRevision)) {
    throw new Error('explicit source revision must be a full lowercase git SHA')
  }
  const originMain = git.resolveCommit('origin/main')
  if (!SOURCE_REVISION.test(originMain)) {
    throw new Error('origin/main did not resolve to a full lowercase git SHA')
  }
  const revision = requestedRevision ? git.resolveCommit(requestedRevision) : originMain
  if (!SOURCE_REVISION.test(revision)) {
    throw new Error('source revision did not resolve to a full lowercase git SHA')
  }
  if (!git.isAncestor(revision, originMain)) {
    throw new Error(
      `source revision ${revision} is not an ancestor of origin/main ${originMain}`,
    )
  }
  return revision
}

export function assertLiveEnvironmentOptIn(
  input: Readonly<{
    apply: boolean
    live: boolean
    environment: string
  }>,
): void {
  if (input.apply && input.environment === CLOSED_BETA_ENVIRONMENT && !input.live) {
    throw new Error(
      `refusing to deploy to live environment ${CLOSED_BETA_ENVIRONMENT} without --live`,
    )
  }
}

export const defaultCommandRunner: CommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

function commandFailure(
  command: string,
  args: readonly string[],
  result: CommandResult,
): Error {
  const detail = result.error?.message || result.stderr.trim() || result.stdout.trim()
  const status = result.status === null ? '' : ` (${String(result.status)})`
  return new Error(
    `${command} ${args.join(' ')} failed${status}: ${detail || 'no diagnostic output'}`,
  )
}

function checkedOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
): string {
  const result = runner(command, args, options)
  if (result.status !== 0) throw commandFailure(command, args, result)
  return result.stdout
}

export function createGitRevisionReader(
  runner: CommandRunner,
  cwd = process.cwd(),
): GitRevisionReader {
  return {
    resolveCommit(reference) {
      return checkedOutput(
        runner,
        'git',
        ['rev-parse', '--verify', `${reference}^{commit}`],
        {
          cwd,
        },
      ).trim()
    },
    isAncestor(ancestor, descendant) {
      const result = runner(
        'git',
        ['merge-base', '--is-ancestor', ancestor, descendant],
        { cwd },
      )
      if (result.status === 0) return true
      if (result.status === 1) return false
      throw commandFailure(
        'git',
        ['merge-base', '--is-ancestor', ancestor, descendant],
        result,
      )
    },
  }
}

type GitHubRun = Readonly<{
  databaseId: number
  headSha: string
  headBranch: string
  event: string
  conclusion: string
  attempt: number
}>

function eligibleGitHubRuns(content: string, revision: string): readonly GitHubRun[] {
  return array(parseJson(content, 'GitHub CI runs'), 'GitHub CI runs').flatMap(
    (value) => {
      const run = record(value, 'GitHub CI run')
      if (
        typeof run.databaseId !== 'number' ||
        !Number.isSafeInteger(run.databaseId) ||
        run.databaseId < 1 ||
        run.headSha !== revision ||
        run.headBranch !== 'main' ||
        run.event !== 'push' ||
        run.conclusion !== 'success' ||
        typeof run.attempt !== 'number' ||
        !Number.isSafeInteger(run.attempt) ||
        run.attempt < 1
      ) {
        return []
      }
      return [
        {
          databaseId: run.databaseId,
          headSha: run.headSha,
          headBranch: run.headBranch,
          event: run.event,
          conclusion: run.conclusion,
          attempt: run.attempt,
        },
      ]
    },
  )
}

function runHasDigestArtifact(content: string, artifactName: string): boolean {
  const response = record(
    parseJson(content, 'GitHub run artifacts'),
    'GitHub run artifacts',
  )
  const matches = array(response.artifacts, 'GitHub run artifacts.artifacts').filter(
    (value) => {
      const artifact = record(value, 'GitHub run artifact')
      return artifact.name === artifactName && artifact.expired === false
    },
  )
  if (matches.length > 1) {
    throw new Error(`GitHub CI run contains duplicate ${artifactName} artifacts`)
  }
  return matches.length === 1
}

export function downloadCiImageDigestMap(
  revision: string,
  runner: CommandRunner = defaultCommandRunner,
): CiImageDigestMap {
  const runs = eligibleGitHubRuns(
    checkedOutput(runner, 'gh', [
      'run',
      'list',
      '--repo',
      TRUSTED_REPOSITORY,
      '--workflow',
      'ci.yml',
      '--branch',
      'main',
      '--commit',
      revision,
      '--event',
      'push',
      '--status',
      'success',
      '--limit',
      '100',
      '--json',
      'databaseId,headSha,headBranch,event,conclusion,attempt',
    ]),
    revision,
  )
  if (runs.length === 0) {
    throw new Error(
      `no successful main push CI run exists for source revision ${revision}`,
    )
  }

  const artifactName = ciImageDigestMapArtifactName(revision)
  for (const run of runs) {
    const artifacts = checkedOutput(runner, 'gh', [
      'api',
      `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(run.databaseId)}/artifacts?per_page=100`,
    ])
    if (!runHasDigestArtifact(artifacts, artifactName)) continue

    const directory = mkdtempSync(join(tmpdir(), 'repkey-ci-image-digest-map-'))
    try {
      checkedOutput(runner, 'gh', [
        'run',
        'download',
        String(run.databaseId),
        '--repo',
        TRUSTED_REPOSITORY,
        '--name',
        artifactName,
        '--dir',
        directory,
      ])
      return parseCiImageDigestMap(
        readFileSync(join(directory, CI_IMAGE_DIGEST_MAP_FILE), 'utf8'),
        revision,
        { id: String(run.databaseId), attempt: run.attempt },
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  throw new Error(
    `no unexpired ${artifactName} artifact exists on a successful main push CI run`,
  )
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return string(value, label)
}

function parseRailwayServiceInventory(
  content: string,
): readonly RailwayServiceObservation[] {
  return array(
    parseJson(content, 'Railway service inventory'),
    'Railway service inventory',
  ).map((value) => {
    const service = record(value, 'Railway service')
    const latestDeployment = record(
      service.latestDeployment,
      `Railway service ${String(service.name)} latestDeployment`,
    )
    const replicas = record(
      service.replicas,
      `Railway service ${String(service.name)} replicas`,
    )
    return Object.freeze({
      id: string(service.id, 'Railway service id'),
      name: string(service.name, 'Railway service name'),
      source: parseRailwayServiceSource(
        service.source,
        `Railway service ${String(service.name)} source`,
        nullableString,
      ),
      status: string(service.status, `Railway service ${String(service.name)} status`),
      deploymentStopped: service.deploymentStopped === true,
      deploymentId: string(
        latestDeployment.id,
        `Railway service ${String(service.name)} latest deployment id`,
      ),
      configuredReplicas: integer(
        replicas.configured,
        `Railway service ${String(service.name)} configured replicas`,
      ),
      runningReplicas: integer(
        replicas.running,
        `Railway service ${String(service.name)} running replicas`,
      ),
      crashedReplicas: integer(
        replicas.crashed,
        `Railway service ${String(service.name)} crashed replicas`,
      ),
    })
  })
}

export function readClosedBetaServiceInventory(
  runner: CommandRunner = defaultCommandRunner,
): readonly RailwayServiceObservation[] {
  return parseRailwayServiceInventory(
    checkedOutput(runner, 'railway', [
      'service',
      'list',
      '--project',
      CLOSED_BETA_PROJECT_ID,
      '--environment',
      CLOSED_BETA_ENVIRONMENT_ID,
      '--json',
    ]),
  )
}

function serviceObservation(
  inventory: readonly RailwayServiceObservation[],
  serviceId: string,
  serviceName: string,
): RailwayServiceObservation {
  const matches = inventory.filter((service) => service.id === serviceId)
  if (matches.length !== 1 || matches[0]?.name !== serviceName) {
    throw new Error(
      `Railway live target does not contain exact service ${serviceName} (${serviceId})`,
    )
  }
  return matches[0]
}

export function buildClosedBetaImageDeploymentPlan(
  digestMap: CiImageDigestMap,
  inventory: readonly RailwayServiceObservation[],
  scope: ClosedBetaImageScope = { includeProviderRedis: false },
): readonly ClosedBetaImageDeployment[] {
  return Object.freeze(
    closedBetaImageServices(scope).map(({ imageName, serviceName, serviceId }) => {
      const image = digestMap.images[imageName]
      if (!image?.digest) {
        throw new Error(`CI image digest map is missing a valid digest for ${imageName}`)
      }
      const current = serviceObservation(inventory, serviceId, serviceName)
      return Object.freeze({
        imageName,
        serviceName,
        serviceId,
        repository: image.repository,
        digest: image.digest,
        imageReference: `${image.repository}@${image.digest}`,
        sourceRevision: digestMap.sourceRevision,
        beforeSource: current.source,
        beforeDeploymentId: current.deploymentId,
      })
    }),
  )
}

function serviceIsHealthy(service: RailwayServiceObservation): boolean {
  return (
    service.status === 'SUCCESS' &&
    !service.deploymentStopped &&
    service.configuredReplicas > 0 &&
    service.runningReplicas >= service.configuredReplicas &&
    service.crashedReplicas === 0
  )
}

type RailwayDeployment = Readonly<{
  id: string
  status: string
  imageDigest: string | undefined
}>

function latestRailwayDeployment(
  runner: CommandRunner,
  service: ClosedBetaImageDeployment,
): RailwayDeployment {
  const deployments = array(
    parseJson(
      checkedOutput(runner, 'railway', [
        'deployment',
        'list',
        '--project',
        CLOSED_BETA_PROJECT_ID,
        '--environment',
        CLOSED_BETA_ENVIRONMENT_ID,
        '--service',
        service.serviceId,
        '--limit',
        '1',
        '--json',
      ]),
      `${service.serviceName} Railway deployments`,
    ),
    `${service.serviceName} Railway deployments`,
  )
  const latest = record(
    deployments[0],
    `${service.serviceName} latest Railway deployment`,
  )
  const meta = record(
    latest.meta,
    `${service.serviceName} latest Railway deployment metadata`,
  )
  return Object.freeze({
    id: string(latest.id, `${service.serviceName} latest Railway deployment id`),
    status: string(
      latest.status,
      `${service.serviceName} latest Railway deployment status`,
    ),
    imageDigest: typeof meta.imageDigest === 'string' ? meta.imageDigest : undefined,
  })
}

function sleep(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, milliseconds)
  return promise
}
async function waitForServiceHealth(
  service: ClosedBetaImageDeployment,
  previousDeploymentId: string,
  runner: CommandRunner,
  out: (line: string) => void,
): Promise<string> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS
  while (Date.now() <= deadline) {
    const deployment = latestRailwayDeployment(runner, service)
    if (deployment.id === previousDeploymentId) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    if (deployment.status === 'SUCCESS') {
      if (deployment.imageDigest !== service.digest) {
        throw new Error(
          `${service.serviceName} settled at ${deployment.imageDigest ?? 'an unknown digest'}, expected ${service.digest}`,
        )
      }
      const current = serviceObservation(
        readClosedBetaServiceInventory(runner),
        service.serviceId,
        service.serviceName,
      )
      if (current.deploymentId === deployment.id && serviceIsHealthy(current)) {
        out(
          `${service.serviceName}: deployment ${deployment.id} is healthy at ${service.digest}`,
        )
        return deployment.id
      }
    } else if (!PENDING_DEPLOYMENT_STATUSES[deployment.status]) {
      throw new Error(
        `${service.serviceName} deployment ${deployment.id} settled ${deployment.status}`,
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(
    `${service.serviceName} did not reach healthy SUCCESS within ${String(DEPLOY_TIMEOUT_MS / 1000)}s`,
  )
}

async function waitForWebHealth(out: (line: string) => void): Promise<void> {
  for (const url of WEB_HEALTH_URLS) {
    const deadline = Date.now() + WEB_HEALTH_TIMEOUT_MS
    let healthy = false
    while (Date.now() <= deadline) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        })
        if (response.status === 200) {
          out(`web: ${url} returned 200`)
          healthy = true
          break
        }
      } catch {
        // A rolling deployment may briefly refuse the connection; bounded retry below.
      }
      await sleep(POLL_INTERVAL_MS)
    }
    if (!healthy) {
      throw new Error(
        `web health endpoint ${url} did not return 200 within ${String(WEB_HEALTH_TIMEOUT_MS / 1000)}s`,
      )
    }
  }
}

/** An image source receives no Railway git metadata, so nothing supplies
 * `RELEASE_SHA`. Two things then break: the Google and AI gateways require it
 * unconditionally and refuse to boot
 * (`services/google-egress-gateway/environment.ts:137`,
 * `services/ai-egress-gateway/environment.ts:106`), and `/api/health/metrics`
 * reports `release.sha` as `unknown`.
 *
 * This command owns that identity explicitly: it writes `RELEASE_SHA` as a
 * Railway service variable before connecting each immutable image source for
 * `google-closed-beta`.
 *
 * `--skip-deploys` keeps this from starting its own deployment; the source
 * connect that follows is the single deploy, so the new container starts with
 * the identity already in place. Setting the value also makes
 * `assertReleaseIdentity` (`src/shared/config/release-identity.ts:22-38`)
 * meaningful again instead of vacuous: it now compares a written identity
 * against the revision baked into the image, and a stale pin fails closed. */
function writeReleaseIdentity(
  service: ClosedBetaImageDeployment,
  runner: CommandRunner,
  out: (line: string) => void,
): void {
  checkedOutput(runner, 'railway', [
    'variable',
    'set',
    `RELEASE_SHA=${service.sourceRevision}`,
    '--project',
    CLOSED_BETA_PROJECT_ID,
    '--environment',
    CLOSED_BETA_ENVIRONMENT_ID,
    '--service',
    service.serviceId,
    '--skip-deploys',
    '--json',
  ])
  out(`${service.serviceName}: RELEASE_SHA set to ${service.sourceRevision}`)
}

/** Reads the written identity, so a service already on the right digest but
 * carrying a stale one is still corrected. Returns null when unset. */
function readReleaseIdentity(
  service: ClosedBetaImageDeployment,
  runner: CommandRunner,
): string | null {
  const listed = checkedOutput(runner, 'railway', [
    'variable',
    'list',
    '--project',
    CLOSED_BETA_PROJECT_ID,
    '--environment',
    CLOSED_BETA_ENVIRONMENT_ID,
    '--service',
    service.serviceId,
    '--kv',
  ])
  for (const line of listed.split('\n')) {
    if (!line.startsWith('RELEASE_SHA=')) continue
    const value = line.slice('RELEASE_SHA='.length).trim()
    return SOURCE_REVISION.test(value) ? value : null
  }
  return null
}

export async function applyClosedBetaImageDeployment(
  input: Readonly<{
    plan: readonly ClosedBetaImageDeployment[]
    runner?: CommandRunner
    out?: (line: string) => void
  }>,
): Promise<readonly Readonly<{ serviceName: string; deploymentId: string }>[]> {
  const runner = input.runner ?? defaultCommandRunner
  const out = input.out ?? console.log
  const settled: Array<Readonly<{ serviceName: string; deploymentId: string }>> = []

  for (const service of input.plan) {
    const current = serviceObservation(
      readClosedBetaServiceInventory(runner),
      service.serviceId,
      service.serviceName,
    )
    // Matching the image is not enough: a service pinned to the right digest
    // but carrying a stale RELEASE_SHA reports the WRONG revision in
    // `/api/health/metrics` and its boot logs, because release identity falls
    // back to Railway's branch metadata when the variable is absent. That
    // turns "the deployed bits are provably the tested bits" into a claim the
    // snapshot contradicts, so a wrong identity is a reason to redeploy.
    const identity = readReleaseIdentity(service, runner)
    if (
      current.source?.image === service.imageReference &&
      serviceIsHealthy(current) &&
      identity === service.sourceRevision
    ) {
      out(`${service.serviceName}: already healthy at ${service.imageReference}`)
      settled.push({
        serviceName: service.serviceName,
        deploymentId: current.deploymentId,
      })
      continue
    }
    if (identity !== service.sourceRevision) {
      out(
        `${service.serviceName}: release identity is ${identity ?? 'unset'}, redeploying to publish ${service.sourceRevision}`,
      )
    }
    if (
      current.deploymentId !== service.beforeDeploymentId ||
      current.source?.repo !== service.beforeSource?.repo ||
      current.source?.image !== service.beforeSource?.image
    ) {
      throw new Error(
        `${service.serviceName} source changed after the reviewed deployment plan`,
      )
    }

    writeReleaseIdentity(service, runner, out)

    // Reconnecting a source that is already the target digest may not produce
    // a new deployment at all, and the health wait would then sit until its
    // timeout. A plain redeploy always does, and picks up the identity just
    // written.
    checkedOutput(
      runner,
      'railway',
      current.source?.image === service.imageReference
        ? [
            'redeploy',
            '--project',
            CLOSED_BETA_PROJECT_ID,
            '--environment',
            CLOSED_BETA_ENVIRONMENT_ID,
            '--service',
            service.serviceId,
            '--yes',
          ]
        : [
            'service',
            'source',
            'connect',
            '--project',
            CLOSED_BETA_PROJECT_ID,
            '--environment',
            CLOSED_BETA_ENVIRONMENT_ID,
            '--service',
            service.serviceId,
            '--image',
            service.imageReference,
            '--json',
          ],
    )
    const deploymentId = await waitForServiceHealth(
      service,
      current.deploymentId,
      runner,
      out,
    )
    settled.push({ serviceName: service.serviceName, deploymentId })
  }

  await waitForWebHealth(out)
  return Object.freeze(settled)
}

const COMMAND = 'ops:deploy-ci-images'
const USAGE =
  `pnpm ${COMMAND} [<source-revision>] --operator <id> ` +
  `[--reason <text> --ticket <ref> --live ` +
  `--include-provider-redis --apply --yes ${COMMAND}]`

export async function runDeployCiImagesCommand(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      extraFlags: ['live', 'include-provider-redis'],
      usage: USAGE,
    },
    async (ctx, args, io) => {
      if (args.positionals.length > 1) throw new Error(`usage: ${USAGE}`)
      assertLiveEnvironmentOptIn({
        apply: args.apply,
        live: args.flags.has('live'),
        environment: CLOSED_BETA_ENVIRONMENT,
      })

      const revision = resolveDeploymentRevision(
        args.positionals[0],
        createGitRevisionReader(defaultCommandRunner),
      )
      const digestMap = downloadCiImageDigestMap(revision)
      const scope = {
        includeProviderRedis: args.flags.has('include-provider-redis'),
      }
      const plan = buildClosedBetaImageDeploymentPlan(
        digestMap,
        readClosedBetaServiceInventory(),
        scope,
      )
      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            mode: ctx.dryRun ? 'report' : 'apply',
            sourceRevision: revision,
            ci: digestMap.source,
            target: {
              projectId: CLOSED_BETA_PROJECT_ID,
              environmentId: CLOSED_BETA_ENVIRONMENT_ID,
              environment: CLOSED_BETA_ENVIRONMENT,
            },
            services: plan.map((service) => ({
              serviceName: service.serviceName,
              serviceId: service.serviceId,
              beforeSource: service.beforeSource,
              imageReference: service.imageReference,
            })),
          },
          null,
          2,
        ),
      )

      if (ctx.dryRun) {
        io.out(
          `report only — re-run with --live --apply --yes ${COMMAND} to move ${plan.length} service(s)`,
        )
        return
      }

      const settled = await applyClosedBetaImageDeployment({ plan, out: io.out })
      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            mode: 'applied',
            sourceRevision: revision,
            settled,
          },
          null,
          2,
        ),
      )
    },
    argv,
  )
  return result.exitCode
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void runDeployCiImagesCommand()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`${COMMAND} failed: ${message}\n`)
      process.exitCode = 1
    })
}
