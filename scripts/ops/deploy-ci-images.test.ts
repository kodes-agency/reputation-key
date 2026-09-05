import { describe, expect, it } from 'vitest'
import {
  assertLiveEnvironmentOptIn,
  buildClosedBetaImageDeploymentPlan,
  CI_IMAGE_DIGEST_MAP_VERSION,
  CI_PRODUCTION_IMAGE_NAMES,
  closedBetaImageServices,
  CLOSED_BETA_ENVIRONMENT,
  parseCiImageDigestMap,
  resolveDeploymentRevision,
  TRUSTED_CI_WORKFLOW,
  TRUSTED_REPOSITORY,
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
  return closedBetaImageServices(true).map(({ serviceId, serviceName }, index) => ({
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
  it('accepts exactly the seven production digests from the matching main CI run', () => {
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

  it('binds every digest to the fixed closed-beta service without a mutable tag', () => {
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
      closedBetaImageServices(false).map(({ imageName, serviceName, serviceId }) => ({
        imageName,
        serviceName,
        serviceId,
        imageReference: `ghcr.io/kodes-agency/repkey-${imageName}@sha256:${String(
          CI_PRODUCTION_IMAGE_NAMES.indexOf(imageName) + 1,
        ).repeat(64)}`,
      })),
    )
  })

  it('leaves the provider Redis substrate out of the default plan', () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const names = buildClosedBetaImageDeploymentPlan(digestMap, serviceInventory()).map(
      ({ serviceName }) => serviceName,
    )

    // The six GitHub-backed services are a same-bits source change. The
    // provider Redis runs upstream `redis:7` today, so including it by default
    // would swap the live queue substrate for a never-deployed image.
    expect(names).not.toContain('google-provider-redis')
    expect(names).toHaveLength(6)
  })

  it('appends the provider Redis last when it is explicitly opted in', () => {
    const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
    const names = buildClosedBetaImageDeploymentPlan(
      digestMap,
      serviceInventory(),
      true,
    ).map(({ serviceName }) => serviceName)

    // Last, never first: a substrate failure must not precede the services
    // that depend on it.
    expect(names).toHaveLength(7)
    expect(names.at(-1)).toBe('google-provider-redis')
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
      'must contain exactly seven production images: missing worker',
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

  it('refuses a live apply without the explicit live-environment flag', () => {
    expect(() =>
      assertLiveEnvironmentOptIn({
        apply: true,
        live: false,
        environment: CLOSED_BETA_ENVIRONMENT,
      }),
    ).toThrow(
      `refusing to deploy to live environment ${CLOSED_BETA_ENVIRONMENT} without --live`,
    )
  })

  it('allows live dry-runs without pretending they authorize a mutation', () => {
    expect(() =>
      assertLiveEnvironmentOptIn({
        apply: false,
        live: false,
        environment: CLOSED_BETA_ENVIRONMENT,
      }),
    ).not.toThrow()
  })
})
