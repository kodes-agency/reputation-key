// Deploy the three immutable production images proved by a successful main CI
// run. The command reports by default and mutates only with --apply.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod/v4'

export const CI_IMAGE_DIGEST_MAP_VERSION = 'repkey-ci-image-digest-map-1' as const
export const CI_IMAGE_DIGEST_MAP_FILE = 'ci-image-digest-map.json' as const
export const TRUSTED_REPOSITORY = 'kodes-agency/reputation-key' as const
export const TRUSTED_CI_WORKFLOW = '.github/workflows/ci.yml' as const
export const CLOSED_BETA_ENVIRONMENT = 'google-closed-beta' as const
export const CLOSED_BETA_PROJECT_ID = '91ab4b88-25a1-404c-9961-4f2b392e2874' as const
export const CLOSED_BETA_ENVIRONMENT_ID = '4a1eec11-f629-4acc-aa21-b6326fcf97e8' as const

export const CLOSED_BETA_IMAGE_SERVICES = [
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
  {
    // Provider Redis goes last so a substrate failure cannot precede its users.
    imageName: 'google-provider-redis',
    serviceName: 'google-provider-redis',
    serviceId: '91935481-1aae-4dcd-b0f2-a84b0b3b34f3',
  },
] as const

export type CiProductionImageName =
  (typeof CLOSED_BETA_IMAGE_SERVICES)[number]['imageName']
export const CI_PRODUCTION_IMAGE_NAMES: readonly CiProductionImageName[] =
  CLOSED_BETA_IMAGE_SERVICES.map(({ imageName }) => imageName)

type ImageDigest = `sha256:${string}`
type RailwayServiceSource = Readonly<{ repo: string | null; image: string | null }>

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

const SOURCE_REVISION = /^[0-9a-f]{40}$/u
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u
const imageDigest = z
  .string()
  .regex(IMAGE_DIGEST)
  .transform((value) => value as ImageDigest)
const image = z.strictObject({
  repository: z.string().min(1),
  digest: imageDigest,
  sourceRevision: z.string().regex(SOURCE_REVISION),
})
const DIGEST_MAP_SCHEMA = z.strictObject({
  version: z.literal(CI_IMAGE_DIGEST_MAP_VERSION),
  sourceRevision: z.string().regex(SOURCE_REVISION),
  source: z.strictObject({
    repository: z.literal(TRUSTED_REPOSITORY),
    ref: z.literal('refs/heads/main'),
    workflow: z.literal(TRUSTED_CI_WORKFLOW),
    runId: z.string().regex(/^[1-9][0-9]*$/u),
    runAttempt: z.number().int().positive(),
  }),
  images: z.strictObject({
    web: image,
    worker: image,
    'google-provider-redis': image,
  }),
})

export type CiImageDigest = Readonly<z.output<typeof image>>
export type CiImageDigestMap = Readonly<z.output<typeof DIGEST_MAP_SCHEMA>>

const GITHUB_RUNS_SCHEMA = z.array(
  z.object({
    databaseId: z.number().int().positive(),
    headSha: z.string(),
    headBranch: z.string(),
    event: z.string(),
    conclusion: z.string(),
    attempt: z.number().int().positive(),
  }),
)
const GITHUB_ARTIFACTS_SCHEMA = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
})
const nullableString = z.string().min(1).nullable()
const RAILWAY_INVENTORY_SCHEMA = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.object({ repo: nullableString, image: nullableString }).nullable(),
    status: z.string().min(1),
    deploymentStopped: z.boolean().optional(),
    latestDeployment: z.object({ id: z.string().min(1) }),
    replicas: z.object({
      configured: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      crashed: z.number().int().nonnegative(),
    }),
  }),
)
const RAILWAY_DEPLOYMENTS_SCHEMA = z.array(
  z.object({
    id: z.string().min(1),
    status: z.string().min(1),
    meta: z.object({ imageDigest: z.string().optional() }),
  }),
)
const PENDING_DEPLOYMENT_STATUS: Readonly<Record<string, true>> = {
  QUEUED: true,
  INITIALIZING: true,
  WAITING: true,
  BUILDING: true,
  DEPLOYING: true,
}
const POLL_INTERVAL_MS = 10_000
const DEPLOY_TIMEOUT_MS = 15 * 60_000
const WEB_HEALTH_TIMEOUT_MS = 2 * 60_000
const WEB_HEALTH_URLS = [
  'https://web-google-closed-beta.up.railway.app/api/health/ready',
  'https://web-google-closed-beta.up.railway.app/api/health/started',
] as const

function parseJson<T>(content: string, schema: z.ZodType<T>, label: string): T {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(({ path, message }) => `${path.join('.') || '<root>'}: ${message}`)
      .join('; ')
    throw new Error(`${label} is invalid: ${issues}`)
  }
  return parsed.data
}

export function ciImageDigestMapArtifactName(sourceRevision: string): string {
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error('CI image digest artifact revision must be a full lowercase git SHA')
  }
  return `ci-image-digest-map-${sourceRevision}`
}

export function parseCiImageDigestMap(
  content: string,
  expectedRevision: string,
  expectedRun?: Readonly<{ id: string; attempt: number }>,
): CiImageDigestMap {
  if (!SOURCE_REVISION.test(expectedRevision)) {
    throw new Error('expected source revision must be a full lowercase git SHA')
  }
  const parsed = parseJson(content, DIGEST_MAP_SCHEMA, 'CI image digest map')
  if (parsed.sourceRevision !== expectedRevision) {
    throw new Error(
      `CI image digest map source revision ${parsed.sourceRevision} does not match ${expectedRevision}`,
    )
  }
  if (
    expectedRun &&
    (parsed.source.runId !== expectedRun.id ||
      parsed.source.runAttempt !== expectedRun.attempt)
  ) {
    throw new Error(
      'CI image digest map workflow run identity does not match its artifact',
    )
  }
  for (const imageName of CI_PRODUCTION_IMAGE_NAMES) {
    const entry = parsed.images[imageName]
    const expectedRepository = `ghcr.io/kodes-agency/repkey-${imageName}`
    if (entry.repository !== expectedRepository) {
      throw new Error(
        `CI image digest map repository for ${imageName} must be ${expectedRepository}`,
      )
    }
    if (entry.sourceRevision !== expectedRevision) {
      throw new Error(
        `CI image digest map image ${imageName} has the wrong source revision`,
      )
    }
  }
  return parsed
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

function checkedOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
): string {
  const result = runner(command, args, options)
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || result.stdout.trim()
    const status = result.status === null ? '' : ` (${String(result.status)})`
    throw new Error(
      `${command} ${args.join(' ')} failed${status}: ${detail || 'no diagnostic output'}`,
    )
  }
  return result.stdout
}

export function createGitRevisionReader(
  runner: CommandRunner,
  cwd = process.cwd(),
): GitRevisionReader {
  return {
    resolveCommit: (reference) =>
      checkedOutput(runner, 'git', ['rev-parse', '--verify', `${reference}^{commit}`], {
        cwd,
      }).trim(),
    isAncestor(ancestor, descendant) {
      const args = ['merge-base', '--is-ancestor', ancestor, descendant]
      const result = runner('git', args, { cwd })
      if (result.status === 0) return true
      if (result.status === 1) return false
      const detail = result.error?.message || result.stderr.trim() || result.stdout.trim()
      throw new Error(`git ${args.join(' ')} failed: ${detail || 'no diagnostic output'}`)
    },
  }
}

export function downloadCiImageDigestMap(
  revision: string,
  runner: CommandRunner = defaultCommandRunner,
): CiImageDigestMap {
  const runs = parseJson(
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
    GITHUB_RUNS_SCHEMA,
    'GitHub CI runs',
  ).filter(
    (run) =>
      run.headSha === revision &&
      run.headBranch === 'main' &&
      run.event === 'push' &&
      run.conclusion === 'success',
  )
  if (runs.length === 0) {
    throw new Error(
      `no successful main push CI run exists for source revision ${revision}`,
    )
  }

  const artifactName = ciImageDigestMapArtifactName(revision)
  for (const run of runs) {
    const { artifacts } = parseJson(
      checkedOutput(runner, 'gh', [
        'api',
        `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(run.databaseId)}/artifacts?per_page=100`,
      ]),
      GITHUB_ARTIFACTS_SCHEMA,
      'GitHub run artifacts',
    )
    const matches = artifacts.filter(
      (artifact) => artifact.name === artifactName && !artifact.expired,
    )
    if (matches.length > 1) {
      throw new Error(`GitHub CI run contains duplicate ${artifactName} artifacts`)
    }
    if (matches.length === 0) continue

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

function railwayTargetArgs(serviceId?: string): string[] {
  return [
    '--project',
    CLOSED_BETA_PROJECT_ID,
    '--environment',
    CLOSED_BETA_ENVIRONMENT_ID,
    ...(serviceId ? ['--service', serviceId] : []),
  ]
}

function parseRailwayServiceInventory(
  content: string,
): readonly RailwayServiceObservation[] {
  return parseJson(content, RAILWAY_INVENTORY_SCHEMA, 'Railway service inventory').map(
    (service) => ({
      id: service.id,
      name: service.name,
      source: service.source,
      status: service.status,
      deploymentStopped: service.deploymentStopped === true,
      deploymentId: service.latestDeployment.id,
      configuredReplicas: service.replicas.configured,
      runningReplicas: service.replicas.running,
      crashedReplicas: service.replicas.crashed,
    }),
  )
}

export function readClosedBetaServiceInventory(
  runner: CommandRunner = defaultCommandRunner,
): readonly RailwayServiceObservation[] {
  return parseRailwayServiceInventory(
    checkedOutput(runner, 'railway', [
      'service',
      'list',
      ...railwayTargetArgs(),
      '--json',
    ]),
  )
}

function serviceObservation(
  inventory: readonly RailwayServiceObservation[],
  serviceId: string,
  serviceName: string,
): RailwayServiceObservation {
  const matches = inventory.filter(({ id }) => id === serviceId)
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
): readonly ClosedBetaImageDeployment[] {
  return CLOSED_BETA_IMAGE_SERVICES.map(({ imageName, serviceName, serviceId }) => {
    const imageEntry = digestMap.images[imageName]
    if (!imageEntry?.digest) {
      throw new Error(`CI image digest map is missing a valid digest for ${imageName}`)
    }
    const current = serviceObservation(inventory, serviceId, serviceName)
    return {
      imageName,
      serviceName,
      serviceId,
      repository: imageEntry.repository,
      digest: imageEntry.digest,
      imageReference: `${imageEntry.repository}@${imageEntry.digest}`,
      sourceRevision: digestMap.sourceRevision,
      beforeSource: current.source,
      beforeDeploymentId: current.deploymentId,
    }
  })
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

function sleep(milliseconds: number): Promise<void> {
  const { promise, resolve: done } = Promise.withResolvers<void>()
  setTimeout(done, milliseconds)
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
    const deployments = parseJson(
      checkedOutput(runner, 'railway', [
        'deployment',
        'list',
        ...railwayTargetArgs(service.serviceId),
        '--limit',
        '1',
        '--json',
      ]),
      RAILWAY_DEPLOYMENTS_SCHEMA,
      `${service.serviceName} Railway deployments`,
    )
    const deployment = deployments[0]
    if (!deployment) {
      throw new Error(`${service.serviceName} has no Railway deployment`)
    }
    if (deployment.id !== previousDeploymentId) {
      if (deployment.status === 'SUCCESS') {
        if (deployment.meta.imageDigest !== service.digest) {
          throw new Error(
            `${service.serviceName} settled at ${deployment.meta.imageDigest ?? 'an unknown digest'}, expected ${service.digest}`,
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
      } else if (!PENDING_DEPLOYMENT_STATUS[deployment.status]) {
        throw new Error(
          `${service.serviceName} deployment ${deployment.id} settled ${deployment.status}`,
        )
      }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(
    `${service.serviceName} did not reach healthy SUCCESS within ${String(
      DEPLOY_TIMEOUT_MS / 1000,
    )}s`,
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
        // Rolling deployment connection failures are retried within the bound.
      }
      await sleep(POLL_INTERVAL_MS)
    }
    if (!healthy) {
      throw new Error(
        `web health endpoint ${url} did not return 200 within ${String(
          WEB_HEALTH_TIMEOUT_MS / 1000,
        )}s`,
      )
    }
  }
}

function readReleaseIdentity(
  service: ClosedBetaImageDeployment,
  runner: CommandRunner,
): string | null {
  const listed = checkedOutput(runner, 'railway', [
    'variable',
    'list',
    ...railwayTargetArgs(service.serviceId),
    '--kv',
  ])
  for (const line of listed.split('\n')) {
    if (!line.startsWith('RELEASE_SHA=')) continue
    const value = line.slice('RELEASE_SHA='.length).trim()
    return SOURCE_REVISION.test(value) ? value : null
  }
  return null
}

function writeReleaseIdentity(
  service: ClosedBetaImageDeployment,
  runner: CommandRunner,
  out: (line: string) => void,
): void {
  checkedOutput(runner, 'railway', [
    'variable',
    'set',
    `RELEASE_SHA=${service.sourceRevision}`,
    ...railwayTargetArgs(service.serviceId),
    '--skip-deploys',
    '--json',
  ])
  out(`${service.serviceName}: RELEASE_SHA set to ${service.sourceRevision}`)
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

  // Promotion barrier: each exact digest settles healthy before the next moves.
  for (const service of input.plan) {
    const current = serviceObservation(
      readClosedBetaServiceInventory(runner),
      service.serviceId,
      service.serviceName,
    )
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
    checkedOutput(
      runner,
      'railway',
      current.source?.image === service.imageReference
        ? ['redeploy', ...railwayTargetArgs(service.serviceId), '--yes']
        : [
            'service',
            'source',
            'connect',
            ...railwayTargetArgs(service.serviceId),
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
  return settled
}

const COMMAND = 'ops:deploy-ci-images'
const USAGE = `pnpm ${COMMAND} [--sha <source-revision>] [--apply]`

function parseCommandArgs(argv: readonly string[]): {
  revision: string | undefined
  apply: boolean
} {
  let revision: string | undefined
  let apply = false
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--apply') {
      apply = true
      continue
    }
    if (token === '--sha' && revision === undefined) {
      revision = argv[++index]
      if (!revision) throw new Error(`usage: ${USAGE}`)
      continue
    }
    throw new Error(`usage: ${USAGE}`)
  }
  return { revision, apply }
}

export async function runDeployCiImagesCommand(
  argv: readonly string[] = process.argv.slice(2),
  out: (line: string) => void = console.log,
): Promise<number> {
  const args = parseCommandArgs(argv)
  const revision = resolveDeploymentRevision(
    args.revision,
    createGitRevisionReader(defaultCommandRunner),
  )
  const digestMap = downloadCiImageDigestMap(revision)
  const plan = buildClosedBetaImageDeploymentPlan(
    digestMap,
    readClosedBetaServiceInventory(),
  )
  out(
    JSON.stringify(
      {
        command: COMMAND,
        mode: args.apply ? 'apply' : 'report',
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
  if (!args.apply) {
    out(`report only — re-run with --sha ${revision} --apply to move three services`)
    return 0
  }
  const settled = await applyClosedBetaImageDeployment({ plan, out })
  out(
    JSON.stringify(
      { command: COMMAND, mode: 'applied', sourceRevision: revision, settled },
      null,
      2,
    ),
  )
  return 0
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void runDeployCiImagesCommand().catch((error: unknown) => {
    process.stderr.write(
      `${COMMAND} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
