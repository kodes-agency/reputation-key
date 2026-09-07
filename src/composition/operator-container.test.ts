import type { Redis } from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Container } from '#/composition'
import type { Database } from '#/shared/db'
import { parseEnvironment, resetEnv } from '#/shared/config/env'
import type { Clock } from '#/shared/domain/clock'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { clearTestContainerEnv } from '#/shared/testing/clear-container-env'
import { testEnvironment } from '#/shared/testing/test-environment'
import { organizationId, replyId, userId } from '#/shared/domain/ids'
import { OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE } from './google-provider-authority'
import {
  createOperatorContainer,
  OPERATOR_QUEUE_CONFIGURATION_ERROR,
} from './operator-container'

const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
const ORIGINAL_QUEUE_REDIS_URL = process.env.QUEUE_REDIS_URL

const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('composition must not query the DB during construction')
    },
  },
) as unknown as Database

const redisTrap = new Proxy(
  {},
  {
    get: () => {
      throw new Error('operator composition must not use ambient Redis')
    },
  },
) as unknown as Redis

function options() {
  const clock: Clock = () => FIXED_DATE
  return {
    clock,
    queue: createInMemoryQueue({ clock }),
    backgroundQueue: createInMemoryQueue({ clock }),
    opsDomainEventsQueue: createInMemoryQueue({ clock }),
    opsQuarantineQueue: createInMemoryQueue({ clock }),
    redis: redisTrap,
    db: dbStub,
    identityPort: createInMemoryIdentityPort(),
    email: async () => {},
    env: parseEnvironment(testEnvironment({})),
    runtimeEnvironment: {},
  } as const
}

function productionOptions() {
  const envInput: NodeJS.ProcessEnv = {
    ...testEnvironment({}),
    NODE_ENV: 'production',
    PROCESSING_CELL: 'us',
    BETTER_AUTH_URL: 'https://app.reputationkey.app',
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
    enableJobs: true,
    env: parseEnvironment(envInput),
  } as const
}

function restoreEnvironment(name: 'REDIS_URL' | 'QUEUE_REDIS_URL', value?: string): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('operator container controls', () => {
  let container: Container | undefined

  beforeEach(() => {
    clearEventSchemas()
    clearTestContainerEnv()
  })

  afterEach(async () => {
    await container?.shutdown.run()
    container = undefined
    restoreEnvironment('REDIS_URL', ORIGINAL_REDIS_URL)
    restoreEnvironment('QUEUE_REDIS_URL', ORIGINAL_QUEUE_REDIS_URL)
    resetEnv()
  })

  it('refuses to build without an explicitly configured queue runtime', () => {
    delete process.env.REDIS_URL
    delete process.env.QUEUE_REDIS_URL
    resetEnv()

    expect(() => createOperatorContainer()).toThrow(OPERATOR_QUEUE_CONFIGURATION_ERROR)
  })

  it('forces a job-free graph and removes Redis even when requested by the caller', () => {
    container = createOperatorContainer(productionOptions())

    expect(container.redis).toBeUndefined()
    expect(container.jobRegistry.getAll()).toHaveLength(0)
    expect(container.jobQueue).toBeDefined()
    expect(container.backgroundQueue).toBeDefined()
  })

  it('refuses all provider-dependent operator call boundaries', async () => {
    container = createOperatorContainer(options())
    const orgId = organizationId('00000000-0000-4000-8000-000000000001')

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
      container.integrationMaintenanceRuntime.subscribeNotifications.apply(orgId),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
    await expect(
      container.reviewMaintenanceRuntime.publicationReconciliation.reconcile({
        organizationId: orgId,
        replyId: replyId('00000000-0000-4000-8000-000000000004'),
      }),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
  })
})
