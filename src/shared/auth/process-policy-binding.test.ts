// ARC-03-T8 — evidence that the policy trio is container-owned and installed
// process-wide exactly once, explicitly.
//
// The three init* functions are wrapped in pass-through spies so the test can
// assert what BUILDING a container does and does not do: constructing one must
// install nothing, and only bindProcessPolicies() may make a container's
// policies the process answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { clearEventSchemas } from '#/shared/events/schema-registry'

const initExecutionPolicySpy = vi.fn()
const initDelayedExecutionPolicySpy = vi.fn()
const initCapabilityPolicyStoreSpy = vi.fn()

vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/auth/execution-policy')>()
  return {
    ...actual,
    initExecutionPolicy: (policy: unknown) => {
      initExecutionPolicySpy(policy)
      actual.initExecutionPolicy(policy as never)
    },
  }
})

vi.mock('#/shared/auth/system-execution-policy', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/auth/system-execution-policy')>()
  return {
    ...actual,
    initDelayedExecutionPolicy: (policy: unknown) => {
      initDelayedExecutionPolicySpy(policy)
      actual.initDelayedExecutionPolicy(policy as never)
    },
  }
})

vi.mock('#/shared/auth/beta-capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/auth/beta-capabilities')>()
  return {
    ...actual,
    initCapabilityPolicyStore: (store: unknown) => {
      initCapabilityPolicyStoreSpy(store)
      actual.initCapabilityPolicyStore(store as never)
    },
  }
})

import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { getDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import { checkGlobalCapability } from '#/shared/auth/beta-capabilities'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import { createContainer } from '#/composition'
import {
  bindProcessPolicies,
  boundProcessPolicies,
  releaseProcessPolicies,
  PROCESS_POLICY_ALREADY_BOUND,
  type ProcessPolicyBundle,
} from '#/shared/auth/process-policy-binding'

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

function bundle(label: string): ProcessPolicyBundle {
  return Object.freeze({
    executionPolicy: Object.freeze({
      decide: vi.fn(async () => ({ label }) as never),
      flushAudits: vi.fn(async () => {}),
    }),
    delayedExecutionPolicy: Object.freeze({ decide: vi.fn(async () => ({}) as never) }),
    capabilityPolicyStore: Object.freeze({
      isCapabilityGloballyEnabled: vi.fn(() => false),
      isOrgAllowlisted: vi.fn(() => false),
      isPropertyAllowlisted: vi.fn(() => false),
      isOrgSuspended: vi.fn(() => false),
      isPropertySuspended: vi.fn(() => false),
    }),
  }) as unknown as ProcessPolicyBundle
}

function buildContainer() {
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

describe('bindProcessPolicies (ARC-03-T8)', () => {
  beforeEach(() => {
    releaseProcessPolicies()
    initExecutionPolicySpy.mockClear()
    initDelayedExecutionPolicySpy.mockClear()
    initCapabilityPolicyStoreSpy.mockClear()
  })

  afterEach(() => {
    releaseProcessPolicies()
  })

  it('installs the trio exactly once', () => {
    const first = bundle('first')

    bindProcessPolicies(first)
    // Re-binding the SAME bundle is the idempotent entry-point/cold-boot case.
    bindProcessPolicies(first)

    expect(initExecutionPolicySpy).toHaveBeenCalledTimes(1)
    expect(initDelayedExecutionPolicySpy).toHaveBeenCalledTimes(1)
    expect(initCapabilityPolicyStoreSpy).toHaveBeenCalledTimes(1)
    expect(getExecutionPolicy()).toBe(first.executionPolicy)
    expect(getDelayedExecutionPolicy()).toBe(first.delayedExecutionPolicy)
    // The capability store answers from the bound bundle, not the env fallback.
    checkGlobalCapability('review.use')
    expect(first.capabilityPolicyStore.isCapabilityGloballyEnabled).toHaveBeenCalled()
    expect(boundProcessPolicies()).toBe(first)
  })

  it('refuses a second, different container', () => {
    bindProcessPolicies(bundle('first'))

    expect(() => bindProcessPolicies(bundle('second'))).toThrow(
      PROCESS_POLICY_ALREADY_BOUND,
    )
    expect(initExecutionPolicySpy).toHaveBeenCalledTimes(1)
  })

  it('permits a re-bind after releaseProcessPolicies', () => {
    const first = bundle('first')
    const second = bundle('second')
    bindProcessPolicies(first)

    releaseProcessPolicies()
    expect(() => bindProcessPolicies(second)).not.toThrow()

    expect(getExecutionPolicy()).toBe(second.executionPolicy)
    expect(initExecutionPolicySpy).toHaveBeenCalledTimes(2)
  })

  it('ignores a conditional release that does not own the binding', () => {
    const first = bundle('first')
    bindProcessPolicies(first)

    releaseProcessPolicies(bundle('someone-else'))

    expect(boundProcessPolicies()).toBe(first)
  })
})

describe('building a container installs nothing (ARC-03-T8)', () => {
  beforeEach(() => {
    releaseProcessPolicies()
    initExecutionPolicySpy.mockClear()
    initDelayedExecutionPolicySpy.mockClear()
    initCapabilityPolicyStoreSpy.mockClear()
  })

  afterEach(() => {
    releaseProcessPolicies()
  })

  it('leaves the process policies uninstalled until an entry point binds', () => {
    const container = buildContainer()

    expect(initExecutionPolicySpy).not.toHaveBeenCalled()
    expect(initDelayedExecutionPolicySpy).not.toHaveBeenCalled()
    expect(initCapabilityPolicyStoreSpy).not.toHaveBeenCalled()
    expect(() => getExecutionPolicy()).toThrow('[EXECUTION POLICY] not initialized')
    expect(() => getDelayedExecutionPolicy()).toThrow(
      '[DELAYED EXECUTION POLICY] not initialized',
    )

    bindProcessPolicies(container)
    expect(getExecutionPolicy()).toBe(container.executionPolicy)
  })
})

describe('initPersistedCapabilityPolicyStore returns instead of installing', () => {
  beforeEach(() => {
    releaseProcessPolicies()
    initExecutionPolicySpy.mockClear()
    initDelayedExecutionPolicySpy.mockClear()
    initCapabilityPolicyStoreSpy.mockClear()
  })

  afterEach(() => {
    releaseProcessPolicies()
  })

  it('hands back the trio plus the refresh contract and installs none of it', () => {
    const handle = initPersistedCapabilityPolicyStore({
      db: dbStub,
      env: {},
      clock,
      logger: { warn: () => {} },
    })
    handle.stopPolling()

    expect(Object.keys(handle).sort()).toEqual([
      'capabilityPolicyStore',
      'currentEmergencyKillVersion',
      'currentVersion',
      'delayedExecutionPolicy',
      'executionPolicy',
      'refresh',
      'refreshRequired',
      'stopPolling',
    ])
    expect(initExecutionPolicySpy).toHaveBeenCalledTimes(0)
    expect(initDelayedExecutionPolicySpy).toHaveBeenCalledTimes(0)
    expect(initCapabilityPolicyStoreSpy).toHaveBeenCalledTimes(0)
  })
})
