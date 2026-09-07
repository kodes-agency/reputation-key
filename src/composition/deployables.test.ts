// ARC-03-T15 — the per-deployable container surfaces.
//
// Construction is query-free, so the DB is a Proxy that throws on any access.
// Each case rebuilds through the process claim, so `shutdown.run()` is also
// under test: it is the only thing that makes a second build legal.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearTestContainerEnv } from '#/shared/testing/clear-container-env'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { closeContainer, getContainer } from '#/composition'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { parseEnvironment } from '#/shared/config/env'
import { testEnvironment } from '#/shared/testing/test-environment'
import {
  createWebContainer,
  createWorkerContainer,
  DUPLICATE_CONTAINER_ERROR,
  OPERATOR_ONLY_KEYS,
  WORKER_ONLY_KEYS,
  type WebContainer,
  type WorkerContainer,
} from './deployables'

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

type ProjectedContainer = WebContainer | WorkerContainer

const keysOf = (container: object): string[] => Object.keys(container).sort()

async function release(container: ProjectedContainer | undefined): Promise<void> {
  await container?.shutdown.run()
}

beforeEach(() => {
  clearEventSchemas()
})

beforeEach(clearTestContainerEnv)

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

  it('keeps web and worker fail-fast when provider-ephemeral Redis is absent', () => {
    expect(() => createWebContainer(productionOptions())).toThrow(
      'Opaque OAuth state requires provider-ephemeral Redis',
    )

    clearEventSchemas()
    expect(() =>
      createWorkerContainer(
        productionOptions({
          REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${'a'.repeat(64)}`,
        }),
      ),
    ).toThrow('Opaque OAuth state requires provider-ephemeral Redis')
  })

  it('freezes every deployable surface', async () => {
    container = createWebContainer(options())
    expect(Object.isFrozen(container)).toBe(true)
    await release(container)

    container = createWorkerContainer(options())
    expect(Object.isFrozen(container)).toBe(true)
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

    await closeContainer()
  })
})

describe('one complete Application Container per process', () => {
  it('refuses a second container by name', async () => {
    const first = createWebContainer(options())
    try {
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

    clearEventSchemas()
    const rebuilt = createWebContainer(options())
    try {
      clearEventSchemas()
      expect(() => createWebContainer(options())).toThrow(DUPLICATE_CONTAINER_ERROR)
    } finally {
      await release(rebuilt)
    }
  })
})
