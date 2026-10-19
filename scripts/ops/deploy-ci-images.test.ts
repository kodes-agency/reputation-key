import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  CI_PRODUCTION_IMAGE_NAMES,
  parseCiImageDigestMap,
  TRUSTED_REPOSITORY,
} from './ci-image-digest-map'
import { digestMapValue, REVISION } from './ci-image-digest-map.test-fixtures'
import type { CommandRunner } from './command-runner'
import {
  applyClosedBetaImageDeployment,
  buildClosedBetaImageDeploymentPlan,
  CLOSED_BETA_IMAGE_SERVICES,
  createProviderRedisKeepCheck,
  PROVIDER_REDIS_IMAGE_SOURCES,
  providerRedisKeptRevision,
  resolveDeploymentRevision,
  type ClosedBetaImageDeployment,
  type GitRevisionReader,
  type ProviderRedisKeepCheck,
  type RailwayServiceObservation,
} from './deploy-ci-images'

const ORIGIN_MAIN = 'b'.repeat(40)

function gitReader(isAncestor: boolean): GitRevisionReader {
  return {
    resolveCommit(reference) {
      return reference === 'origin/main' ? ORIGIN_MAIN : REVISION
    },
    isAncestor() {
      return isAncestor
    },
  }
}

function serviceInventory(): RailwayServiceObservation[] {
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

describe('closed-beta CI image deployment authority', () => {
  it('gives every image main CI proves a fixed service', () => {
    const served = CLOSED_BETA_IMAGE_SERVICES.map(({ imageName }) => imageName)

    expect([...served].sort()).toEqual([...CI_PRODUCTION_IMAGE_NAMES].sort())
  })

  it('binds each selected digest to its fixed service without a mutable tag', () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const plan = buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory())

    expect(
      plan.map(({ imageName, serviceName, serviceId, imageReference }) => ({
        imageName,
        serviceName,
        serviceId,
        imageReference,
      })),
    ).toEqual(
      CLOSED_BETA_IMAGE_SERVICES.map(({ imageName, serviceName, serviceId }) => ({
        imageName,
        serviceName,
        serviceId,
        imageReference: `ghcr.io/kodes-agency/repkey-${imageName}@sha256:${String(
          CI_PRODUCTION_IMAGE_NAMES.indexOf(imageName) + 1,
        ).repeat(64)}`,
      })),
    )
  })

  it('plans all three promoted services in dependency-safe order', () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const names = buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory()).map(
      ({ serviceName }) => serviceName,
    )

    expect(names).toEqual(['web', 'worker', 'google-provider-redis'])
  })

  it('refuses a deployment plan when a fixed Railway service is absent', () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const withoutWorker = serviceInventory().filter(({ name }) => name !== 'worker')

    expect(() => buildClosedBetaImageDeploymentPlan(digestMap, withoutWorker)).toThrow(
      'Railway live target does not contain exact service worker',
    )
  })

  it('refuses a source revision that is not an ancestor of origin/main', () => {
    expect(() => resolveDeploymentRevision(REVISION, gitReader(false))).toThrow(
      `source revision ${REVISION} is not an ancestor of origin/main ${ORIGIN_MAIN}`,
    )
  })

  it('refuses a symbolic explicit revision', () => {
    expect(() => resolveDeploymentRevision('main', gitReader(true))).toThrow(
      'explicit source revision must be a full lowercase git SHA',
    )
  })

  it('defaults to the current origin/main revision', () => {
    expect(resolveDeploymentRevision(undefined, gitReader(true))).toBe(ORIGIN_MAIN)
  })

  it('writes the release identity before the container that needs it starts', async () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const plan = buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory()).filter(
      ({ serviceName }) => serviceName === 'web',
    )
    const calls: string[][] = []
    let connected = false
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args])
      if (args[0] === 'service' && args[1] === 'list') {
        const inventory = serviceInventory().map((service) => ({
          id: service.id,
          name: service.name,
          source:
            service.name === 'web' && connected
              ? { repo: null, image: plan[0]!.imageReference }
              : service.source,
          status: 'SUCCESS',
          deploymentStopped: false,
          latestDeployment: {
            id:
              service.name === 'web' && connected
                ? 'deployment-web-next'
                : service.deploymentId,
          },
          replicas: { configured: 1, running: 1, crashed: 0 },
        }))
        return { status: 0, stdout: JSON.stringify(inventory), stderr: '' }
      }
      if (args[0] === 'deployment' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: connected ? 'deployment-web-next' : 'deployment-0',
              status: 'SUCCESS',
              meta: { imageDigest: plan[0]!.digest },
            },
          ]),
          stderr: '',
        }
      }
      if (args[0] === 'service' && args[1] === 'source') connected = true
      return { status: 0, stdout: '{}', stderr: '' }
    }
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    try {
      await expect(
        applyClosedBetaImageDeployment({ plan, runner, out: () => {} }),
      ).resolves.toEqual([{ serviceName: 'web', deploymentId: 'deployment-web-next' }])
    } finally {
      fetchStub.mockRestore()
    }

    const variableSet = calls.findIndex(
      (call) => call[1] === 'variable' && call[2] === 'set',
    )
    const sourceConnect = calls.findIndex(
      (call) => call[1] === 'service' && call[2] === 'source',
    )
    // Image sources receive no Railway git metadata, so the identity must
    // exist before the deploy that reports it through runtime health.
    expect(variableSet).toBeGreaterThanOrEqual(0)
    expect(sourceConnect).toBeGreaterThan(variableSet)
    expect(calls[variableSet]).toContain(`RELEASE_SHA=${REVISION}`)
    // Without this the variable write starts its own deployment and the
    // source connect races a container that is already coming up.
    expect(calls[variableSet]).toContain('--skip-deploys')
  })

  it('redeploys a correctly pinned service whose release identity is stale', async () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const target = buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory()).find(
      ({ serviceName }) => serviceName === 'web',
    )!
    // Already on the exact target digest, but carrying someone else's revision.
    const plan = [
      { ...target, beforeSource: { repo: null, image: target.imageReference } },
    ]
    const calls: string[][] = []
    let redeployed = false
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args])
      if (args[0] === 'variable' && args[1] === 'list') {
        return { status: 0, stdout: `RELEASE_SHA=${'c'.repeat(40)}\n`, stderr: '' }
      }
      if (args[0] === 'service' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify(
            serviceInventory().map((service) => ({
              id: service.id,
              name: service.name,
              source:
                service.name === 'web'
                  ? { repo: null, image: target.imageReference }
                  : service.source,
              status: 'SUCCESS',
              deploymentStopped: false,
              latestDeployment: {
                id:
                  service.name === 'web' && redeployed
                    ? 'deployment-web-next'
                    : service.deploymentId,
              },
              replicas: { configured: 1, running: 1, crashed: 0 },
            })),
          ),
          stderr: '',
        }
      }
      if (args[0] === 'deployment' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: redeployed ? 'deployment-web-next' : 'deployment-0',
              status: 'SUCCESS',
              meta: { imageDigest: target.digest },
            },
          ]),
          stderr: '',
        }
      }
      if (args[0] === 'redeploy') redeployed = true
      return { status: 0, stdout: '{}', stderr: '' }
    }
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    try {
      await expect(
        applyClosedBetaImageDeployment({ plan, runner, out: () => {} }),
      ).resolves.toEqual([{ serviceName: 'web', deploymentId: 'deployment-web-next' }])
    } finally {
      fetchStub.mockRestore()
    }

    // Matching the digest is not enough to skip: the running container would
    // keep reporting the wrong revision in /api/health/metrics.
    expect(calls.some((call) => call[1] === 'redeploy')).toBe(true)
    // Reconnecting an identical source may produce no deployment at all, so
    // the redeploy path must be used instead of connect.
    expect(calls.some((call) => call[1] === 'service' && call[2] === 'source')).toBe(
      false,
    )
    expect(calls.find((call) => call[1] === 'variable' && call[2] === 'set')).toContain(
      `RELEASE_SHA=${REVISION}`,
    )
  })
})

// google-provider-redis keeps nothing across a restart (ADR 0050): every
// redeploy drops the cursors of the Google review syncs in flight and the
// OAuth state of any Google connect in progress. Its image differs on every
// commit only by the revision CI bakes in, so the deploy leaves it running
// when nothing it is built from changed, and only when that can be proved.
describe('keeping google-provider-redis when its image sources did not change', () => {
  const RUNNING = 'c'.repeat(40)
  const RUNNING_IMAGE = `ghcr.io/kodes-agency/repkey-google-provider-redis@sha256:${'9'.repeat(64)}`

  const planFor = (serviceName: string): ClosedBetaImageDeployment => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    return buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory()).find(
      (service) => service.serviceName === serviceName,
    )!
  }
  const running = (
    overrides: Partial<RailwayServiceObservation> = {},
  ): RailwayServiceObservation => ({
    ...serviceInventory().find(({ name }) => name === 'google-provider-redis')!,
    source: { repo: null, image: RUNNING_IMAGE },
    ...overrides,
  })
  const provable = (
    overrides: Partial<ProviderRedisKeepCheck> = {},
  ): ProviderRedisKeepCheck => ({
    isAncestor: vi.fn(() => true),
    imageSourcesUnchanged: vi.fn(() => true),
    ciImageReference: vi.fn(() => RUNNING_IMAGE),
    ...overrides,
  })

  it('names every file the image is built from', () => {
    const dockerfile = readFileSync('Dockerfile.google-provider-redis', 'utf8')
    const copied = dockerfile
      .split('\n')
      .filter((line) => /^(COPY|ADD)\s/u.test(line))
      .flatMap((line) => {
        const operands = line
          .split(/\s+/u)
          .slice(1)
          .filter((part) => !part.startsWith('--'))
        return operands.slice(0, -1)
      })

    expect(copied.length).toBeGreaterThan(0)
    for (const source of copied) {
      expect(
        PROVIDER_REDIS_IMAGE_SOURCES.some(
          (path) => source === path || source.startsWith(`${path}/`),
        ),
      ).toBe(true)
    }
    expect(PROVIDER_REDIS_IMAGE_SOURCES).toContain('Dockerfile.google-provider-redis')
    for (const path of PROVIDER_REDIS_IMAGE_SOURCES) expect(existsSync(path)).toBe(true)
  })

  it('keeps the revision it runs when nothing it is built from changed', () => {
    const check = provable()

    expect(
      providerRedisKeptRevision(
        planFor('google-provider-redis'),
        running(),
        RUNNING,
        check,
      ),
    ).toBe(RUNNING)
    expect(check.imageSourcesUnchanged).toHaveBeenCalledWith(RUNNING, REVISION)
    expect(check.ciImageReference).toHaveBeenCalledWith(RUNNING)
  })

  it('moves it when its Dockerfile or entrypoint changed', () => {
    expect(
      providerRedisKeptRevision(
        planFor('google-provider-redis'),
        running(),
        RUNNING,
        provable({ imageSourcesUnchanged: () => false }),
      ),
    ).toBeNull()
  })

  // An interrupted deploy writes RELEASE_SHA before it connects the image.
  // Keeping that service would leave a release identity its image does not
  // carry, and the entrypoint refuses to boot on the next restart.
  it('moves it when the image it runs is not the one CI built for its release identity', () => {
    for (const ciImageReference of [
      () => `ghcr.io/kodes-agency/repkey-google-provider-redis@sha256:${'8'.repeat(64)}`,
      () => null,
    ]) {
      expect(
        providerRedisKeptRevision(
          planFor('google-provider-redis'),
          running(),
          RUNNING,
          provable({ ciImageReference }),
        ),
      ).toBeNull()
    }
  })

  it('moves it when it is not healthy, has no release identity, or is being rolled back', () => {
    const service = planFor('google-provider-redis')

    expect(
      providerRedisKeptRevision(
        service,
        running({ crashedReplicas: 1 }),
        RUNNING,
        provable(),
      ),
    ).toBeNull()
    expect(providerRedisKeptRevision(service, running(), null, provable())).toBeNull()
    expect(
      providerRedisKeptRevision(
        service,
        running(),
        RUNNING,
        provable({ isAncestor: () => false }),
      ),
    ).toBeNull()
  })

  it('never keeps web or worker', () => {
    for (const serviceName of ['web', 'worker']) {
      expect(
        providerRedisKeptRevision(planFor(serviceName), running(), RUNNING, provable()),
      ).toBeNull()
    }
  })

  it('leaves a kept google-provider-redis untouched during the deploy', async () => {
    const service = planFor('google-provider-redis')
    const plan = [{ ...service, beforeSource: { repo: null, image: RUNNING_IMAGE } }]
    const calls: string[][] = []
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args])
      if (args[0] === 'variable' && args[1] === 'list') {
        return { status: 0, stdout: `RELEASE_SHA=${RUNNING}\n`, stderr: '' }
      }
      if (args[0] === 'service' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify(
            serviceInventory().map((observed) => ({
              id: observed.id,
              name: observed.name,
              source:
                observed.name === 'google-provider-redis'
                  ? { repo: null, image: RUNNING_IMAGE }
                  : observed.source,
              status: 'SUCCESS',
              deploymentStopped: false,
              latestDeployment: { id: observed.deploymentId },
              replicas: { configured: 1, running: 1, crashed: 0 },
            })),
          ),
          stderr: '',
        }
      }
      throw new Error(`unexpected command ${[command, ...args].join(' ')}`)
    }
    const lines: string[] = []
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    try {
      await expect(
        applyClosedBetaImageDeployment({
          plan,
          runner,
          out: (line) => lines.push(line),
          keepProviderRedis: provable(),
        }),
      ).resolves.toEqual([
        { serviceName: 'google-provider-redis', deploymentId: 'deployment-2' },
      ])
    } finally {
      fetchStub.mockRestore()
    }

    expect(calls.some((call) => call[1] === 'variable' && call[2] === 'set')).toBe(false)
    expect(
      calls.some(
        (call) =>
          call[1] === 'redeploy' || (call[1] === 'service' && call[2] === 'source'),
      ),
    ).toBe(false)
    expect(lines).toContain(
      `google-provider-redis: kept at ${RUNNING}; nothing it is built from changed, and a redeploy would empty the provider-ephemeral store`,
    )
  })

  it('compares the image sources between the two revisions with git', () => {
    const calls: string[][] = []
    const answers = [0, 1, 128]
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args])
      return { status: answers.shift() ?? 0, stdout: '', stderr: '' }
    }
    const check = createProviderRedisKeepCheck(runner, () => {})

    expect(check.imageSourcesUnchanged(RUNNING, REVISION)).toBe(true)
    expect(check.imageSourcesUnchanged(RUNNING, REVISION)).toBe(false)
    // A revision git cannot read proves nothing, so the service moves.
    expect(check.imageSourcesUnchanged(RUNNING, REVISION)).toBe(false)
    expect(calls[0]).toEqual([
      'git',
      'diff',
      '--quiet',
      RUNNING,
      REVISION,
      '--',
      ...PROVIDER_REDIS_IMAGE_SOURCES,
    ])
  })

  it('cannot prove the running image when its release has no CI digest map', () => {
    const lines: string[] = []
    const check = createProviderRedisKeepCheck(
      () => ({ status: 0, stdout: '[]', stderr: '' }),
      (line) => lines.push(line),
    )

    expect(check.ciImageReference(RUNNING)).toBeNull()
    expect(lines.join('\n')).toContain(
      `google-provider-redis: cannot prove the image CI built for ${RUNNING}`,
    )
  })
})
