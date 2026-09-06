import { describe, expect, it, vi } from 'vitest'
import {
  applyClosedBetaImageDeployment,
  buildClosedBetaImageDeploymentPlan,
  CI_IMAGE_DIGEST_MAP_VERSION,
  CI_PRODUCTION_IMAGE_NAMES,
  CLOSED_BETA_IMAGE_SERVICES,
  parseCiImageDigestMap,
  resolveDeploymentRevision,
  TRUSTED_CI_WORKFLOW,
  TRUSTED_REPOSITORY,
  type CommandRunner,
  type GitRevisionReader,
  type RailwayServiceObservation,
} from './deploy-ci-images'

const REVISION = 'a'.repeat(40)
const ORIGIN_MAIN = 'b'.repeat(40)

function digestMapValue(): Record<string, unknown> {
  return {
    version: CI_IMAGE_DIGEST_MAP_VERSION,
    sourceRevision: REVISION,
    source: {
      repository: TRUSTED_REPOSITORY,
      ref: 'refs/heads/main',
      workflow: TRUSTED_CI_WORKFLOW,
      runId: '33891370093',
      runAttempt: 1,
    },
    images: Object.fromEntries(
      CI_PRODUCTION_IMAGE_NAMES.map((imageName, index) => [
        imageName,
        {
          repository: `ghcr.io/kodes-agency/repkey-${imageName}`,
          digest: `sha256:${String(index + 1).repeat(64)}`,
          sourceRevision: REVISION,
        },
      ]),
    ),
  }
}

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
  it('accepts exactly the three production digests from the matching main CI run', () => {
    const parsed = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION, {
      id: '33891370093',
      attempt: 1,
    })

    expect(Object.keys(parsed.images)).toEqual(CI_PRODUCTION_IMAGE_NAMES)
    expect(parsed.images.web).toEqual({
      repository: 'ghcr.io/kodes-agency/repkey-web',
      digest: `sha256:${'1'.repeat(64)}`,
      sourceRevision: REVISION,
    })
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

  it('refuses a digest map with a missing production image digest', () => {
    const value = digestMapValue()
    const images = value.images as Record<string, Record<string, unknown>>
    delete images.worker

    expect(() => parseCiImageDigestMap(JSON.stringify(value), REVISION)).toThrow(
      /worker/u,
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
