import { vi } from 'vitest'
import { railwayServiceManifest } from '../../src/shared/release/railway-service-settings.test-fixtures'
import { parseCiImageDigestMap, TRUSTED_REPOSITORY } from './ci-image-digest-map'
import { digestMapValue, REVISION } from './ci-image-digest-map.test-fixtures'
import type { CommandRunner } from './command-runner'
import {
  buildClosedBetaImageDeploymentPlan,
  CLOSED_BETA_IMAGE_SERVICES,
  type ClosedBetaImageDeployment,
  type RailwayServiceObservation,
} from './deploy-ci-images'

export function serviceInventory(): RailwayServiceObservation[] {
  return CLOSED_BETA_IMAGE_SERVICES.map(({ serviceId, serviceName }, index) => ({
    id: serviceId,
    name: serviceName,
    source: {
      repo: serviceName === 'google-provider-redis' ? null : TRUSTED_REPOSITORY,
      image: serviceName === 'google-provider-redis' ? 'redis:7' : null,
    },
    status: 'SUCCESS',
    deploymentStopped: false,
    deploymentId: `deployment-${String(index)}`,
    configuredReplicas: 1,
    runningReplicas: 1,
    crashedReplicas: 0,
  }))
}

export function planFor(
  serviceName: string,
  inventory: RailwayServiceObservation[] = serviceInventory(),
): ClosedBetaImageDeployment {
  const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
  return buildClosedBetaImageDeploymentPlan(digestMap, inventory).find(
    (service) => service.serviceName === serviceName,
  )!
}

export type FakeRailwayOptions = Readonly<{
  /** The services as `service list` reports them before anything changes. */
  inventory: RailwayServiceObservation[]
  /** The digest the new web deployment reports, and the default old one. */
  digest: string
  /** The image web's source names once `service source` has connected it. */
  connectedImage?: string
  /** The RELEASE_SHA `variable list` reports; absent means no handler. */
  releaseSha?: string
  /** The `meta` of the deployment running before a redeploy or connect. */
  runningMeta?: Record<string, unknown> | undefined
  /** The id the deployment listing gives that deployment. */
  runningId?: string
  /** The image digest of the deployment a redeploy creates. */
  redeployedDigest?: string
  /** Listings after a redeploy that still show the deployment from before. */
  staleListings?: number
  /** Throw on every command other than the two read-only listings. */
  strictUnexpected?: boolean
}>

const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' })

const isRailway = (args: readonly string[], first: string, second: string) =>
  args[0] === first && args[1] === second

const isJournalLookup = (command: string, args: readonly string[]) =>
  command === 'git' &&
  args[0] === 'show' &&
  Boolean(args[1]?.endsWith(':drizzle/meta/_journal.json'))

function serviceListing(
  options: FakeRailwayOptions,
  state: Readonly<{ connected: boolean; changed: boolean }>,
) {
  const sourceOf = (service: RailwayServiceObservation) =>
    service.name === 'web' && state.connected && options.connectedImage
      ? { repo: null, image: options.connectedImage }
      : service.source
  const deploymentIdOf = (service: RailwayServiceObservation) =>
    service.name === 'web' && state.changed ? 'deployment-web-next' : service.deploymentId
  return ok(
    JSON.stringify(
      options.inventory.map((service) => ({
        id: service.id,
        name: service.name,
        source: sourceOf(service),
        status: 'SUCCESS',
        deploymentStopped: false,
        latestDeployment: { id: deploymentIdOf(service) },
        replicas: { configured: 1, running: 1, crashed: 0 },
      })),
    ),
  )
}

function deploymentListing(options: FakeRailwayOptions, newOneListed: boolean) {
  const meta =
    'runningMeta' in options
      ? options.runningMeta
      : {
          imageDigest: options.digest,
          serviceManifest: railwayServiceManifest('web'),
        }
  const next = {
    id: 'deployment-web-next',
    status: 'SUCCESS',
    meta: {
      imageDigest: options.redeployedDigest ?? options.digest,
      serviceManifest: railwayServiceManifest('web'),
    },
  }
  const running = {
    id: options.runningId ?? 'deployment-0',
    status: 'SUCCESS',
    ...(meta === undefined ? {} : { meta }),
  }
  return ok(JSON.stringify([newOneListed ? next : running]))
}

/**
 * A Railway CLI stand-in. The git journal lookup is answered but not recorded;
 * `calls` keeps the `[command, ...args]` shape of every other command.
 */
export function fakeRailwayRunner(options: FakeRailwayOptions) {
  const calls: string[][] = []
  let connected = false
  let redeployed = false
  let listingsSinceChange = 0
  const runner: CommandRunner = (command, args) => {
    if (isJournalLookup(command, args)) return ok(JSON.stringify({ entries: [] }))
    calls.push([command, ...args])
    const changed = connected || redeployed
    if (isRailway(args, 'variable', 'list') && options.releaseSha) {
      return ok(`RELEASE_SHA=${options.releaseSha}\n`)
    }
    if (isRailway(args, 'service', 'list')) {
      return serviceListing(options, { connected, changed })
    }
    if (options.strictUnexpected) {
      throw new Error(`unexpected command ${[command, ...args].join(' ')}`)
    }
    if (isRailway(args, 'deployment', 'list')) {
      const newOneListed =
        changed && listingsSinceChange++ >= (options.staleListings ?? 0)
      return deploymentListing(options, newOneListed)
    }
    if (isRailway(args, 'service', 'source')) connected = true
    if (args[0] === 'redeploy') redeployed = true
    return ok('{}')
  }
  return { runner, calls }
}

export async function withWebEndpointUp<T>(run: () => Promise<T>): Promise<T> {
  const fetchStub = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }))
  try {
    return await run()
  } finally {
    fetchStub.mockRestore()
  }
}

/** Whether any call ran one of the given Railway subcommands, e.g. ['service', 'source']. */
export function ranRailway(
  calls: readonly string[][],
  ...commands: ReadonlyArray<readonly string[]>
): boolean {
  return calls.some((call) =>
    commands.some((words) => words.every((word, index) => call[index + 1] === word)),
  )
}

export function railwayCallIndex(calls: readonly string[][], ...words: string[]): number {
  return calls.findIndex((call) => words.every((word, index) => call[index + 1] === word))
}
