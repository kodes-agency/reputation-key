// Deploy the three immutable production images proved by a successful main CI
// run. The command reports by default and mutates only with --apply.

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  type CiImageDigestMap,
  type CiProductionImageName,
  downloadCiImageDigestMap,
  type ImageDigest,
  SOURCE_REVISION,
} from './ci-image-digest-map'
import {
  checkedOutput,
  defaultCommandRunner,
  parseJson,
  type CommandRunner,
} from './command-runner'
import { runGoogleOAuthPreflight } from './google-oauth-preflight'

export const CLOSED_BETA_ENVIRONMENT = 'closed-beta-v2' as const
export const CLOSED_BETA_PROJECT_ID = '91ab4b88-25a1-404c-9961-4f2b392e2874' as const
export const CLOSED_BETA_ENVIRONMENT_ID = '500b4fba-5567-49c3-89a5-323abb908d19' as const

export const CLOSED_BETA_IMAGE_SERVICES = [
  {
    imageName: 'web',
    serviceName: 'web',
    serviceId: '9d3ceeb9-9f04-44da-8b9c-087d868bc010',
  },
  {
    imageName: 'worker',
    serviceName: 'worker',
    serviceId: 'ca163de9-a106-4e02-b1b6-1341dd179c5c',
  },
  {
    // Provider Redis goes last so a substrate failure cannot precede its users.
    imageName: 'google-provider-redis',
    serviceName: 'google-provider-redis',
    serviceId: 'dc955f6c-0775-47f3-8bbc-8a6077edc3d3',
  },
] as const satisfies readonly Readonly<{
  imageName: CiProductionImageName
  serviceName: string
  serviceId: string
}>[]

/**
 * What the google-provider-redis image is built from. CI also bakes the source
 * revision into it (IMAGE_SOURCE_REVISION, which its entrypoint compares with
 * RELEASE_SHA), so its digest changes on every commit even when none of these
 * did. Every COPY in the Dockerfile must read from one of them.
 */
export const PROVIDER_REDIS_IMAGE_SOURCES = [
  'Dockerfile.google-provider-redis',
  'services/google-provider-redis',
] as const

type RailwayServiceSource = Readonly<{ repo: string | null; image: string | null }>

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
    // A deployment may record no image digest, or no meta at all. That must
    // read as "not proven", never as a parse failure that blocks the deploy.
    meta: z.object({ imageDigest: z.string().nullish() }).nullish(),
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
  'https://web-closed-beta-v2.up.railway.app/api/health/ready',
  'https://web-closed-beta-v2.up.railway.app/api/health/started',
] as const

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

export function railwayTargetArgs(serviceId?: string): string[] {
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

/** What `providerRedisKeptRevision` must prove before it keeps the service. */
export type ProviderRedisKeepCheck = Readonly<{
  isAncestor: (ancestor: string, descendant: string) => boolean
  /** True when no PROVIDER_REDIS_IMAGE_SOURCES path differs between the two. */
  imageSourcesUnchanged: (from: string, to: string) => boolean
  /** The google-provider-redis image main CI built for `revision`, or null. */
  ciImageReference: (revision: string) => string | null
}>

/**
 * The revision google-provider-redis may stay on instead of moving to the
 * target, or null when it must move.
 *
 * It keeps nothing across a restart (ADR 0050), so every redeploy drops the
 * page cursors of the Google review syncs in flight and the OAuth state of any
 * Google connect in progress. When nothing it is built from changed between
 * the revision it runs and the target, the new image differs only by the
 * revision baked in, and the restart buys nothing. It stays only when that is
 * proved: it is healthy, its RELEASE_SHA is an ancestor of the target (not a
 * rollback), its image sources are identical, and the image it runs is the
 * one CI built for that RELEASE_SHA. The last guards an interrupted deploy,
 * which writes RELEASE_SHA before it connects the image: keeping that service
 * would leave an identity its image does not carry, and the entrypoint refuses
 * to boot on the next restart.
 */
export function providerRedisKeptRevision(
  service: ClosedBetaImageDeployment,
  current: RailwayServiceObservation,
  identity: string | null,
  check: ProviderRedisKeepCheck,
): string | null {
  if (service.imageName !== 'google-provider-redis') return null
  if (identity === null || identity === service.sourceRevision) return null
  const runningImage = current.source?.image
  if (!runningImage || !serviceIsHealthy(current)) return null
  if (!check.isAncestor(identity, service.sourceRevision)) return null
  if (!check.imageSourcesUnchanged(identity, service.sourceRevision)) return null
  return check.ciImageReference(identity) === runningImage ? identity : null
}

/**
 * The real proofs: git for ancestry and the image sources, the running
 * release's own CI digest map for its image. Anything that cannot be read
 * proves nothing, so the service moves as it always did.
 */
export function createProviderRedisKeepCheck(
  runner: CommandRunner,
  out: (line: string) => void,
  cwd = process.cwd(),
): ProviderRedisKeepCheck {
  const git = createGitRevisionReader(runner, cwd)
  return {
    isAncestor: (ancestor, descendant) => {
      try {
        return git.isAncestor(ancestor, descendant)
      } catch {
        return false
      }
    },
    imageSourcesUnchanged: (from, to) =>
      runner(
        'git',
        ['diff', '--quiet', from, to, '--', ...PROVIDER_REDIS_IMAGE_SOURCES],
        {
          cwd,
        },
      ).status === 0,
    ciImageReference: (revision) => {
      try {
        const image = downloadCiImageDigestMap(revision, runner).images[
          'google-provider-redis'
        ]
        return `${image.repository}@${image.digest}`
      } catch (error) {
        out(
          `google-provider-redis: cannot prove the image CI built for ${revision} (${
            error instanceof Error ? error.message : String(error)
          }); moving it`,
        )
        return null
      }
    },
  }
}

function sleep(milliseconds: number): Promise<void> {
  const { promise, resolve: done } = Promise.withResolvers<void>()
  setTimeout(done, milliseconds)
  return promise
}

type LatestDeployment = Readonly<{
  id: string
  status: string
  /** The image digest Railway recorded for it, or null when it recorded none. */
  imageDigest: string | null
}>

function readLatestDeployment(
  service: ClosedBetaImageDeployment,
  runner: CommandRunner,
): LatestDeployment {
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
  return {
    id: deployment.id,
    status: deployment.status,
    imageDigest: deployment.meta?.imageDigest ?? null,
  }
}

/**
 * Whether the container Railway runs right now is the target image.
 *
 * The configured source says only what Railway will deploy next. During the
 * 2026-10-21 Railway outage `service source connect` stored the new image and
 * created no deployment: the latest deployment stayed SUCCESS on the morning's
 * image while the source already named the target, and four deploys reported
 * "already healthy". Only the latest deployment's own image digest proves what
 * runs. A deployment that records no digest, or that is not the deployment the
 * service inventory calls latest, proves nothing, so it counts as not running
 * the target and the service is redeployed.
 */
function latestDeploymentRunsTarget(
  service: ClosedBetaImageDeployment,
  current: RailwayServiceObservation,
  runner: CommandRunner,
  out: (line: string) => void,
): boolean {
  const latest = readLatestDeployment(service, runner)
  if (latest.id !== current.deploymentId) {
    out(
      `${service.serviceName}: Railway names ${current.deploymentId} and ${latest.id} as the latest deployment; redeploying from the source`,
    )
    return false
  }
  if (latest.imageDigest === service.digest) return true
  out(
    `${service.serviceName}: source already names ${service.imageReference}, but its latest deployment ${latest.id} runs ${
      latest.imageDigest ?? 'an unrecorded digest'
    }; redeploying from the source`,
  )
  return false
}

/**
 * The Railway command that puts the target image in front of a service.
 *
 * With the source already on the target, connecting it again may create no
 * deployment, so it redeploys. A plain `railway redeploy` runs the latest
 * deployment again, and that is the old image whenever the latest deployment
 * was not proved to run the target; `--from-source` deploys the configured
 * image instead.
 */
function deployArgs(
  service: ClosedBetaImageDeployment,
  configuredAtTarget: boolean,
  runsTarget: boolean,
): string[] {
  if (!configuredAtTarget) {
    return [
      'service',
      'source',
      'connect',
      ...railwayTargetArgs(service.serviceId),
      '--image',
      service.imageReference,
      '--json',
    ]
  }
  return [
    'redeploy',
    ...railwayTargetArgs(service.serviceId),
    '--yes',
    ...(runsTarget ? [] : ['--from-source']),
  ]
}

async function waitForServiceHealth(
  service: ClosedBetaImageDeployment,
  previousDeploymentId: string,
  runner: CommandRunner,
  out: (line: string) => void,
): Promise<string> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS
  while (Date.now() <= deadline) {
    const deployment = readLatestDeployment(service, runner)
    // Only a deployment other than the one that ran before counts, and only one
    // on the target digest: the deployment that was already SUCCESS is not it.
    if (deployment.id !== previousDeploymentId) {
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
    /** Absent: google-provider-redis moves with the others, as it always did. */
    keepProviderRedis?: ProviderRedisKeepCheck
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
    const kept = input.keepProviderRedis
      ? providerRedisKeptRevision(service, current, identity, input.keepProviderRedis)
      : null
    if (kept) {
      out(
        `${service.serviceName}: kept at ${kept}; nothing it is built from changed, and a redeploy would empty the provider-ephemeral store`,
      )
      settled.push({
        serviceName: service.serviceName,
        deploymentId: current.deploymentId,
      })
      continue
    }
    const configuredAtTarget = current.source?.image === service.imageReference
    const runsTarget =
      configuredAtTarget && latestDeploymentRunsTarget(service, current, runner, out)
    if (runsTarget && serviceIsHealthy(current) && identity === service.sourceRevision) {
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
    checkedOutput(runner, 'railway', deployArgs(service, configuredAtTarget, runsTarget))
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

/**
 * Google must accept the web service's callback address and client secret, or
 * "Connect Google" dead-ends on Google's own error page. Neither depends on the
 * image, so a failure never blocks the deploy; it fails the command instead.
 */
export function verifyClosedBetaGoogleOAuth(
  out: (line: string) => void = console.log,
  runner: CommandRunner = defaultCommandRunner,
): Promise<boolean> {
  const web = CLOSED_BETA_IMAGE_SERVICES.find(({ serviceName }) => serviceName === 'web')!
  return runGoogleOAuthPreflight({
    runner,
    targetArgs: railwayTargetArgs(web.serviceId),
    out,
  })
}

/**
 * The bucket must let the app's origin PUT, or avatar and logo uploads fail in
 * the browser. A deploy adds the rule when it is missing; a report only says so.
 * Like the Google check it never blocks the deploy, it fails the command.
 */
export async function verifyClosedBetaStorageCors(
  apply: boolean,
  out: (line: string) => void = console.log,
): Promise<boolean> {
  try {
    // Loaded here: storage-cors reads this module's service table.
    // fallow-ignore-next-line circular-dependency
    const { runStorageCors } = await import('./storage-cors')
    return await runStorageCors({ apply, out })
  } catch (error) {
    out(
      `Storage CORS: FAIL — could not check the bucket (${error instanceof Error ? error.message : String(error)})`,
    )
    return false
  }
}

/** The report's answer to whether an apply would keep google-provider-redis. */
function reportedProviderRedisKeep(
  plan: readonly ClosedBetaImageDeployment[],
  inventory: readonly RailwayServiceObservation[],
  check: ProviderRedisKeepCheck,
): string | null {
  const service = plan.find(({ imageName }) => imageName === 'google-provider-redis')
  if (!service) return null
  return providerRedisKeptRevision(
    service,
    serviceObservation(inventory, service.serviceId, service.serviceName),
    readReleaseIdentity(service, defaultCommandRunner),
    check,
  )
}

const COMMAND = 'ops:deploy-ci-images'
const USAGE = 'pnpm ops deploy-ci-images [--sha <source-revision>] [--apply]'

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
  const inventory = readClosedBetaServiceInventory()
  const plan = buildClosedBetaImageDeploymentPlan(digestMap, inventory)
  const keepProviderRedis = createProviderRedisKeepCheck(defaultCommandRunner, out)
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
    const kept = reportedProviderRedisKeep(plan, inventory, keepProviderRedis)
    out(
      kept
        ? `google-provider-redis: would stay at ${kept}; nothing it is built from changed`
        : 'google-provider-redis: would move with the others',
    )
    await verifyClosedBetaGoogleOAuth(out)
    await verifyClosedBetaStorageCors(false, out)
    out(
      `report only — re-run with --sha ${revision} --apply to move ${
        kept ? 'web and worker' : 'three services'
      }`,
    )
    return 0
  }
  const settled = await applyClosedBetaImageDeployment({ plan, out, keepProviderRedis })
  out(
    JSON.stringify(
      { command: COMMAND, mode: 'applied', sourceRevision: revision, settled },
      null,
      2,
    ),
  )
  const googleAccepted = await verifyClosedBetaGoogleOAuth(out)
  const storageAccepts = await verifyClosedBetaStorageCors(true, out)
  if (!googleAccepted) {
    out('deployed, but "Connect Google" will fail until the Google OAuth check passes')
  }
  if (!storageAccepts) {
    out(
      'deployed, but avatar and logo uploads will fail until the Storage CORS check passes',
    )
  }
  return googleAccepted && storageAccepts ? 0 : 1
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
