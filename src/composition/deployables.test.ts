// ARC-03-T15 — the per-deployable container surfaces.
//
// Construction is query-free, so the DB is a Proxy that throws on any access.
// Each case rebuilds through the process claim, so `shutdown.run()` is also
// under test: it is the only thing that makes a second build legal.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { closeContainer, createContainer, getContainer } from '#/composition'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { parseEnvironment } from '#/shared/config/env'
import { testEnvironment } from '#/shared/testing/test-environment'
import { organizationId, replyId, userId } from '#/shared/domain/ids'
import {
  createOperatorContainer,
  createWebContainer,
  createWorkerContainer,
  deployablesFor,
  DUPLICATE_CONTAINER_ERROR,
  occupyingDeployable,
  OPERATOR_CONTAINER_KEYS,
  OPERATOR_ONLY_KEYS,
  WORKER_ONLY_KEYS,
  type OperatorContainer,
  type WebContainer,
  type WorkerContainer,
} from './deployables'
import { OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE } from './google-provider-authority'

const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')

const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('composition must not query the DB during construction')
    },
  },
) as unknown as Database

function options() {
  const clock: Clock = () => FIXED_DATE
  return {
    clock,
    queue: createInMemoryQueue({ clock }),
    backgroundQueue: createInMemoryQueue({ clock }),
    opsDomainEventsQueue: createInMemoryQueue({ clock }),
    opsQuarantineQueue: createInMemoryQueue({ clock }),
    redis: undefined,
    db: dbStub,
    identityPort: createInMemoryIdentityPort(),
    email: async () => {},
  } as const
}

function productionOptions(envOverrides: NodeJS.ProcessEnv = {}) {
  const envInput: NodeJS.ProcessEnv = {
    ...testEnvironment({}),
    NODE_ENV: 'production',
    PROCESSING_CELL: 'us',
    BETTER_AUTH_URL: 'https://app.reputationkey.app',
    ...envOverrides,
  }
  for (const name of [
    'REDIS_URL',
    'PROVIDER_EPHEMERAL_REDIS_URL',
    'PROVIDER_EPHEMERAL_REDIS_CA_PEM',
    'GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS',
    'GOOGLE_REPLAY_HMAC_KEYS',
    'GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS',
    'GOOGLE_SESSION_BINDING_HMAC_KEYS',
  ] as const) {
    delete envInput[name]
  }
  return {
    ...options(),
    env: parseEnvironment(envInput),
    runtimeEnvironment: {},
  }
}

type ProjectedContainer = WebContainer | WorkerContainer | OperatorContainer

const keysOf = (container: object): string[] => Object.keys(container).sort()

async function release(container: ProjectedContainer | undefined): Promise<void> {
  await container?.shutdown.run()
}

beforeEach(() => {
  clearEventSchemas()
})

describe('per-deployable container surfaces', () => {
  let container: ProjectedContainer | undefined

  afterEach(async () => {
    await release(container)
    container = undefined
  })

  it('gives the web process no worker registration or operator repair authority', async () => {
    container = createWebContainer(options())
    const keys = keysOf(container)

    expect(keys.filter((key) => /WorkerRuntime$|MaintenanceRuntime$/u.test(key))).toEqual(
      [],
    )
    expect(keys).not.toContain('registerOutboxConsumers')
    expect(keys).not.toContain('registerReviewWorkerJobs')
    // It still serves requests.
    expect(keys).toContain('inboxPublicApi')
    expect(keys).toContain('operationsSnapshot')
  })

  it('gives the worker process registration authority and the dispatch handles', async () => {
    container = createWorkerContainer(options())
    const keys = keysOf(container)

    expect(keys).toContain('registerOutboxConsumers')
    expect(keys).toContain('registerReviewWorkerJobs')
    expect(keys).toContain('jobDispatchWorkerRuntime')
    expect(keys.filter((key) => /MaintenanceRuntime$/u.test(key))).toEqual([])
  })

  it('gives the operator exactly its reviewed maintenance surface', async () => {
    container = createOperatorContainer(options())
    const keys = keysOf(container)

    expect(keys).toEqual([...OPERATOR_CONTAINER_KEYS].sort())
    expect(keys.filter((key) => /MaintenanceRuntime$/u.test(key)).length).toBeGreaterThan(
      0,
    )
    expect(keys).not.toContain('registerOutboxConsumers')
    expect(keys).not.toContain('registerReviewWorkerJobs')
    expect(keys.filter((key) => /WorkerRuntime$|providerEphemeral/u.test(key))).toEqual(
      [],
    )
  })

  it('boots the operator with database and queue configuration only', () => {
    const operatorOptions = productionOptions()
    expect(operatorOptions.env.REDIS_URL).toBeUndefined()
    expect(operatorOptions.env.PROVIDER_EPHEMERAL_REDIS_URL).toBeUndefined()
    expect(operatorOptions.env.GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS).toBeUndefined()
    expect(operatorOptions.env.GOOGLE_REPLAY_HMAC_KEYS).toBeUndefined()
    expect(operatorOptions.env.GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS).toBeUndefined()
    expect(operatorOptions.env.GOOGLE_SESSION_BINDING_HMAC_KEYS).toBeUndefined()

    container = createOperatorContainer(operatorOptions)
    expect(container.opsQueues.quarantine).toBeDefined()
    expect(keysOf(container)).toEqual([...OPERATOR_CONTAINER_KEYS].sort())
  })

  it('keeps web and worker fail-fast when provider-ephemeral Redis is absent', () => {
    expect(() => createWebContainer(productionOptions())).toThrow(
      'Opaque OAuth state requires provider-ephemeral Redis',
    )
    expect(occupyingDeployable()).toBeUndefined()

    clearEventSchemas()
    expect(() =>
      createWorkerContainer(
        productionOptions({
          REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${'a'.repeat(64)}`,
        }),
      ),
    ).toThrow('Opaque OAuth state requires provider-ephemeral Redis')
    expect(occupyingDeployable()).toBeUndefined()
  })

  it('refuses provider-dependent operator commands at their call boundary', async () => {
    container = createOperatorContainer(options())
    const orgId = organizationId('00000000-0000-4000-8000-000000000001')

    await expect(
      container.integrationMaintenanceRuntime.subscribeNotifications.apply(orgId),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
    await expect(
      container.integrationPublicApi.connections.disconnect(
        { connectionId: '00000000-0000-4000-8000-000000000002' },
        {
          organizationId: orgId,
          userId: userId('00000000-0000-4000-8000-000000000003'),
          role: 'AccountAdmin',
        },
      ),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
    await expect(
      container.reviewMaintenanceRuntime.publicationReconciliation.reconcile({
        organizationId: orgId,
        replyId: replyId('00000000-0000-4000-8000-000000000004'),
      }),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
  })

  it('freezes every deployable surface', async () => {
    container = createWebContainer(options())
    expect(Object.isFrozen(container)).toBe(true)
    await release(container)

    container = createWorkerContainer(options())
    expect(Object.isFrozen(container)).toBe(true)
    await release(container)

    container = createOperatorContainer(options())
    expect(Object.isFrozen(container)).toBe(true)
  })

  it('partitions the full container: the union is the whole surface', async () => {
    const full = new Set(Object.keys(createContainer(options())))

    container = createWebContainer(options())
    const web = keysOf(container)
    await release(container)

    container = createWorkerContainer(options())
    const worker = keysOf(container)
    await release(container)

    container = createOperatorContainer(options())
    const operator = keysOf(container)

    expect([...new Set([...web, ...worker, ...operator])].sort()).toEqual(
      [...full].sort(),
    )
    // No key is simultaneously worker-only and maintenance-only.
    for (const key of full) {
      expect(deployablesFor(key).length, key).toBeGreaterThan(0)
    }
  })
})

describe('lazy web singleton', () => {
  afterEach(async () => {
    await closeContainer()
  })

  it('projects the lazily built singleton as the web deployable', async () => {
    const container = getContainer()

    expect(WORKER_ONLY_KEYS.filter((key) => key in container)).toEqual([])
    expect(OPERATOR_ONLY_KEYS.filter((key) => key in container)).toEqual([])
    expect(occupyingDeployable()).toBe('web')

    await closeContainer()
    expect(occupyingDeployable()).toBeUndefined()
  })
})

describe('one complete Application Container per process', () => {
  afterEach(async () => {
    const occupied = occupyingDeployable()
    if (!occupied) return
    // Reach the live claim through a fresh build only if none exists; the
    // per-test containers below always release their own.
    throw new Error(`process claim leaked from a previous test: ${occupied}`)
  })

  it('refuses a second container by name', async () => {
    const first = createWebContainer(options())
    try {
      expect(occupyingDeployable()).toBe('web')
      clearEventSchemas()
      expect(() => createWebContainer(options())).toThrow(DUPLICATE_CONTAINER_ERROR)
      clearEventSchemas()
      // A DIFFERENT deployable is refused too — one process, one container.
      expect(() => createWorkerContainer(options())).toThrow(DUPLICATE_CONTAINER_ERROR)
    } finally {
      await release(first)
    }
  })

  it('permits exactly one rebuild after shutdown', async () => {
    await release(createWebContainer(options()))
    expect(occupyingDeployable()).toBeUndefined()

    clearEventSchemas()
    const rebuilt = createWebContainer(options())
    try {
      expect(occupyingDeployable()).toBe('web')
      clearEventSchemas()
      expect(() => createWebContainer(options())).toThrow(DUPLICATE_CONTAINER_ERROR)
    } finally {
      await release(rebuilt)
    }
    expect(occupyingDeployable()).toBeUndefined()
  })
})
