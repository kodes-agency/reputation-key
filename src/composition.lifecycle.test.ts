// ARC-03-T6 — the container owns what it starts.
//
// RULE: building a container may start background work only if that work is
// reachable from the container's own shutdown capability.
//
// WHY: buildIdentityContext calls initPersistedCapabilityPolicyStore, which
// starts a POLICY_REFRESH_INTERVAL_MS poller and fires an unawaited database
// refresh. Its stopPolling used to be dropped on the floor — closeContainer(),
// the web graceful-shutdown plugin and the worker drain could not reach it, so
// every container built in a process leaked a live interval. These tests pin
// BOTH sides: the leak is real without shutdown, and gone with it.
//
// The real policy-store-init runs; the handle it returns is wrapped so
// stopPolling is observable (an injected handle, not a stubbed subsystem).
// Only the two policy-state row reads are replaced, so the poller is exercised
// end to end without a database.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createContainer, closeContainer, type Container } from '#/composition'
import { POLICY_REFRESH_INTERVAL_MS } from '#/contexts/identity/infrastructure/policy-store-init'

type PolicyStoreInitModule =
  typeof import('#/contexts/identity/infrastructure/policy-store-init')

/** Every policy handle the containers built in this file were given. */
const policyHandles: Array<{ stopPolling: ReturnType<typeof vi.fn> }> = []

vi.mock(
  '#/contexts/identity/infrastructure/policy-store-init',
  async (importOriginal) => {
    const actual = await importOriginal<PolicyStoreInitModule>()
    return {
      ...actual,
      initPersistedCapabilityPolicyStore: (
        deps: Parameters<PolicyStoreInitModule['initPersistedCapabilityPolicyStore']>[0],
      ) => {
        const handle = actual.initPersistedCapabilityPolicyStore(deps)
        const stopPolling = vi.fn(() => {
          handle.stopPolling()
        })
        const observed = Object.freeze({ ...handle, stopPolling })
        policyHandles.push(observed)
        return observed
      },
    }
  },
)

const loadPolicySnapshot = vi.fn()
const getPolicyControlVersion = vi.fn()

vi.mock(
  '#/contexts/identity/infrastructure/repositories/policy-state.repository',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('#/contexts/identity/infrastructure/repositories/policy-state.repository')
      >()
    return {
      ...actual,
      loadPolicySnapshot: () => loadPolicySnapshot() as unknown,
      getPolicyControlVersion: () => getPolicyControlVersion() as unknown,
    }
  },
)

const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')
const clock: Clock = () => FIXED_DATE

/** Query-free guard: any DB access during construction throws. */
const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('composition must not query the DB during construction')
    },
  },
) as unknown as Database

/**
 * Every control read reports a NEW generation, so each poll tick performs a
 * full snapshot load. Without this the version gate would skip loadSnapshot
 * and the leak would be invisible to the test.
 */
function seedMovingPolicyGeneration(): void {
  let version = 0
  getPolicyControlVersion.mockImplementation(() => {
    version += 1
    return Promise.resolve({ version, emergencyKillVersion: 0 })
  })
  loadPolicySnapshot.mockImplementation(() =>
    Promise.resolve({
      version,
      emergencyKillVersion: 0,
      killedCapabilities: [],
      orgAllowlistAll: [],
      propertyAllowlistAll: [],
      orgCapabilities: [],
      propertyCapabilities: [],
      orgPolicies: [],
      propertyPolicies: [],
    }),
  )
}

function buildContainer(): Container {
  clearEventSchemas()
  return createContainer({
    clock,
    queue: createInMemoryQueue({ clock }),
    backgroundQueue: createInMemoryQueue({ clock }),
    opsDomainEventsQueue: createInMemoryQueue({ clock }),
    opsQuarantineQueue: createInMemoryQueue({ clock }),
    redis: undefined,
    enableJobs: true,
    db: dbStub,
    identityPort: createInMemoryIdentityPort(),
    email: async () => {},
  })
}

describe('container shutdown seam (ARC-03-T6)', () => {
  beforeEach(() => {
    policyHandles.length = 0
    seedMovingPolicyGeneration()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes a frozen shutdown capability with exactly one key', () => {
    const container = buildContainer()

    expect(Object.keys(container.shutdown)).toEqual(['run'])
    expect(Object.isFrozen(container.shutdown)).toBe(true)
  })

  it('stops the identity policy poller exactly once and is idempotent', async () => {
    const container = buildContainer()
    const handle = policyHandles.at(-1)
    expect(handle).toBeDefined()

    await container.shutdown.run()
    await container.shutdown.run()

    expect(handle?.stopPolling).toHaveBeenCalledTimes(1)
  })

  it('leaks policy refreshes without shutdown and stops them after it', async () => {
    vi.useFakeTimers()

    const leaking = buildContainer()
    loadPolicySnapshot.mockClear()
    await vi.advanceTimersByTimeAsync(POLICY_REFRESH_INTERVAL_MS * 10)
    const leakedRefreshes = loadPolicySnapshot.mock.calls.length
    // Proves the leak the seam exists to close: an unattended container keeps
    // polling the policy tables for the life of the process.
    expect(leakedRefreshes).toBeGreaterThan(0)
    await leaking.shutdown.run()

    const stopped = buildContainer()
    await stopped.shutdown.run()
    loadPolicySnapshot.mockClear()
    await vi.advanceTimersByTimeAsync(POLICY_REFRESH_INTERVAL_MS * 10)

    expect(loadPolicySnapshot).toHaveBeenCalledTimes(0)
  })
})

// closeContainer() only ever touches the getContainer() singleton, which lives
// on the process-wide Symbol.for store (the production build bundles
// composition twice). Tests seed the same well-known key — no test-only export.
describe('closeContainer runs the container shutdown first (ARC-03-T6)', () => {
  const CONTAINER_KEY = Symbol.for('repkey.composition.container')

  function seed(container: unknown): void {
    if (container === undefined)
      delete (globalThis as Record<symbol, unknown>)[CONTAINER_KEY]
    else (globalThis as Record<symbol, unknown>)[CONTAINER_KEY] = container
  }

  afterEach(() => seed(undefined))

  it('no-ops when the singleton was never built', async () => {
    seed(undefined)
    await expect(closeContainer()).resolves.toBeUndefined()
  })

  it('awaits shutdown before quitting the queues and provider-ephemeral Redis', async () => {
    const order: string[] = []
    const shutdown = Object.freeze({
      run: vi.fn(async () => {
        order.push('shutdown')
      }),
    })
    seed({
      shutdown,
      jobQueue: { close: vi.fn(async () => void order.push('jobQueue')) },
      backgroundQueue: { close: vi.fn(async () => void order.push('backgroundQueue')) },
      providerEphemeralRedis: {
        quit: vi.fn(async () => void order.push('providerEphemeralRedis')),
      },
    })

    await closeContainer()

    expect(shutdown.run).toHaveBeenCalledTimes(1)
    expect(order[0]).toBe('shutdown')
    expect(order.slice(1).sort()).toEqual([
      'backgroundQueue',
      'jobQueue',
      'providerEphemeralRedis',
    ])
  })
})
