// Call a real server function as a signed-in test member, over PostgreSQL.
//
// The member signs in through Better Auth and picks their Organization the way
// the app does, and the call runs inside a TanStack Start request that carries
// the session cookie. Tenant resolution, the execution policy and the
// composition root are the production ones: a missing guard or a wrong role
// fails the test. Only external providers (Google, storage, email), queues and
// the clock are fakes. See CONTEXT.md, "Server-function harness".

import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { Pool, PoolClient } from 'pg'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { createContainer, type Container } from '#/composition'
import type { ProviderOverrides } from '#/composition'
import { resetTenantCache } from '#/shared/auth/middleware'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { declareRequestProcess } from '#/shared/db/tenant-scope.server'
import type { Clock } from '#/shared/domain/clock'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { clearTestContainerEnv } from './clear-container-env'
import { deleteTestOrganizations } from './integration-helpers'
import { applyEnvOverlay, type EnvOverlay } from './server-function-env'
import { createHarnessFakes, type HarnessFakes } from './server-function-fakes'
import { acquireHarnessRedis, type HarnessRedis } from './server-function-redis'
import {
  respond,
  type CallRequest,
  type CallResponse,
  type TestCaller,
} from './server-function-request'
import {
  createHarnessSeeds,
  type HarnessSeedContext,
  type HarnessSeeds,
} from './server-function-seeds'
import { acquireTestLease, type TestLease } from './test-environment-lease'

export { createInMemoryStorage } from './server-function-fakes'
export type { CallRequest, CallResponse, TestCaller } from './server-function-request'
export type {
  TestInboxItem,
  TestMember,
  TestOrganization,
  TestPortal,
  TestProperty,
  TestPublishedPortal,
  TestReply,
  TestReview,
  TestStaffParticipation,
  TestUser,
} from './server-function-seeds'

// The composition root's process singleton, keyed by Symbol.for because the
// production build bundles its module twice.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')

const SQL_NAME = /^[a-z_][a-z0-9_]*$/

type ProcessSlots = Record<symbol, unknown>

/** A guard trigger the cleanup transaction disables while it deletes. */
export type GuardTrigger = Readonly<{ table: string; trigger: string }>

/** What a test file seeded or made through its calls, for its own cleanup hook. */
export type CleanupScope = Readonly<{
  organizationIds: readonly string[]
  userIds: readonly string[]
}>

/**
 * The app's Google token encryption adapter factory. Shared testing code may
 * neither import it nor restate its format, so a file that needs Google tokens
 * the app can open passes `createTokenEncryptionAdapter` here.
 */
export type GoogleTokenEncryptionFactory = (
  config: Readonly<{ activeVersion: string; keys: Readonly<Record<string, string>> }>,
) => Readonly<{ encrypt: (plaintext: string) => string }>

export type ServerFunctionHarnessOptions = Readonly<{
  /** The container's clock. Defaults to the wall clock. */
  clock?: Clock
  /** Provider fakes in place of the defaults (in-memory Google OAuth and storage). */
  providers?: ProviderOverrides
  /**
   * Environment variables for the whole file, as the app reads them from its
   * environment (`'true'`, comma lists, JSON). The container and every
   * getEnv() reader see them; `undefined` removes one.
   */
  env?: EnvOverlay
  /**
   * Give the container the local test Redis, so rate limits count and refuse.
   * Without it the limiter fails open outside production.
   */
  redis?: boolean
  /**
   * Tables the file's server functions write, deleted by organization_id after
   * each test before the seeded Properties are. Name the ones whose rows keep a
   * Property from being deleted.
   */
  cleanupTables?: readonly string[]
  /**
   * Runs in the cleanup transaction after the seeded Properties are deleted
   * and before the Organizations are: rows with no organization_id column.
   */
  afterPropertiesCleanup?: (client: PoolClient, scope: CleanupScope) => Promise<void>
  /** Guard triggers disabled inside the cleanup transaction (the last-owner guard always is). */
  disabledTriggers?: readonly GuardTrigger[]
  /** Seal the Google tokens of `seedProperty(org, { google })` as the app does. */
  googleTokenEncryption?: GoogleTokenEncryptionFactory
}>

export type ServerFunctionHarness = Readonly<
  {
    container: () => Container
    pool: () => Pool
    /** The prefixed test Redis the container uses; undefined without `redis` or a local Redis. */
    redis: () => Redis | undefined
    /** The in-memory storage, Google OAuth, email and queues the container was given. */
    fakes: () => HarnessFakes
    /** Clean up an Organization a call created, after each test. */
    trackOrganization: (organizationId: string) => void
    /** Clean up a user a call created (registration, invitation sign-up), after each test. */
    trackUser: (userId: string) => void
    /** Run `call` as a request from a signed-in caller, or from a visitor with no session. */
    callAs: <T>(
      caller: TestCaller | null,
      call: () => Promise<T>,
      request?: CallRequest,
    ) => Promise<T>
    /**
     * Run `call` as `callAs` does and keep the response: the status and the
     * headers the call set, also when it throws.
     */
    respondAs: <T>(
      caller: TestCaller | null,
      call: () => Promise<T>,
      request?: CallRequest,
    ) => Promise<CallResponse<T>>
  } & HarnessSeeds
>

function sqlName(name: string): string {
  if (!SQL_NAME.test(name)) throw new Error(`Not a plain SQL name: ${name}`)
  return name
}

async function setGuardTriggers(
  client: PoolClient,
  triggers: readonly GuardTrigger[],
  state: 'ENABLE' | 'DISABLE',
): Promise<void> {
  for (const { table, trigger } of triggers) {
    await client.query(
      `ALTER TABLE ${sqlName(table)} ${state} TRIGGER ${sqlName(trigger)}`,
    )
  }
}

/**
 * Build the real container with fakes for what lies outside the process, make
 * it the process's container, and clean up what each test seeded. Call once at
 * the top of a *.integration.test.ts file.
 */
export function setupServerFunctionHarness(
  options: ServerFunctionHarnessOptions = {},
): ServerFunctionHarness {
  const clock = options.clock ?? (() => new Date())
  let lease: TestLease | undefined
  let redis: HarnessRedis | undefined
  let container: Container | undefined
  let fakes: HarnessFakes | undefined
  let restoreEnv: (() => void) | undefined
  const organizations = new Set<string>()
  const users = new Set<string>()
  const started = <T>(value: T | undefined): T => {
    if (value === undefined)
      throw new Error('The server-function harness has not started')
    return value
  }
  const pool = () => started(lease).pool
  let googleTokenEncryption: ReturnType<GoogleTokenEncryptionFactory> | undefined

  beforeAll(async () => {
    restoreEnv = applyEnvOverlay(options.env ?? {})
    lease = await acquireTestLease(getEnv().DATABASE_URL, 5)
    redis = options.redis ? await acquireHarnessRedis() : undefined
    clearTestContainerEnv()
    clearEventSchemas()
    fakes = createHarnessFakes(clock)
    // The production composition's one key version (connections-runtime.server.ts).
    googleTokenEncryption = options.googleTokenEncryption?.({
      activeVersion: 'v1',
      keys: { v1: getEnv().ENCRYPTION_KEY },
    })
    container = createContainer({
      db: getDb(),
      pool: lease.pool,
      env: getEnv(),
      redis: redis?.client,
      clock,
      queue: fakes.queues.default,
      backgroundQueue: fakes.queues.background,
      opsDomainEventsQueue: fakes.queues.opsDomainEvents,
      opsBackgroundQueue: fakes.queues.opsBackground,
      opsQuarantineQueue: fakes.queues.opsQuarantine,
      runtimeEnvironment: {},
      email: fakes.email.send,
      providers: {
        googleOAuth: fakes.googleOAuth,
        storage: fakes.storage,
        ...options.providers,
      },
    })
    bindProcessPolicies(container)
    ;(globalThis as ProcessSlots)[CONTAINER_KEY] = container
    declareRequestProcess()
  })

  afterEach(async () => {
    resetTenantCache()
    await redis?.clear()
    fakes?.email.clear()
    for (const queue of Object.values(fakes?.queues ?? {})) queue.clear()
    const scope: CleanupScope = {
      organizationIds: [...organizations],
      userIds: [...users],
    }
    organizations.clear()
    users.clear()
    const { organizationIds, userIds } = scope
    const triggers = options.disabledTriggers ?? []
    await withLastOwnerGuardDisabled(pool(), async (client) => {
      await setGuardTriggers(client, triggers, 'DISABLE')
      for (const table of options.cleanupTables ?? []) {
        await client.query(
          `DELETE FROM ${sqlName(table)} WHERE organization_id = ANY($1)`,
          [organizationIds],
        )
      }
      await client.query(
        `DELETE FROM property_access_grant WHERE organization_id = ANY($1)`,
        [organizationIds],
      )
      await client.query(`DELETE FROM portals WHERE organization_id = ANY($1)`, [
        organizationIds,
      ])
      await client.query(`DELETE FROM properties WHERE organization_id = ANY($1)`, [
        organizationIds,
      ])
      await client.query(
        `DELETE FROM google_connections WHERE organization_id = ANY($1)`,
        [organizationIds],
      )
      await options.afterPropertiesCleanup?.(client, scope)
      await client.query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
        organizationIds,
      ])
      await client.query(`DELETE FROM member WHERE "organizationId" = ANY($1)`, [
        organizationIds,
      ])
      await deleteTestOrganizations(client, organizationIds)
      await client.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds])
      await setGuardTriggers(client, triggers, 'ENABLE')
    })
  })

  afterAll(async () => {
    const slots = globalThis as ProcessSlots
    try {
      if (container) {
        if (slots[CONTAINER_KEY] === container) slots[CONTAINER_KEY] = undefined
        releaseProcessPolicies(container)
        await container.shutdown.run()
      }
    } finally {
      clearEventSchemas()
      redis?.release()
      await lease?.release()
      restoreEnv?.()
    }
  })

  const seedContext: HarnessSeedContext = {
    pool,
    clock,
    newId: randomUUID,
    trackOrganization: (id) => organizations.add(id),
    trackUser: (id) => users.add(id),
    ...(options.googleTokenEncryption && {
      sealGoogleToken: (token: string) => started(googleTokenEncryption).encrypt(token),
    }),
  }

  return {
    container: () => started(container),
    pool,
    redis: () => redis?.client,
    fakes: () => started(fakes),
    trackOrganization: seedContext.trackOrganization,
    trackUser: seedContext.trackUser,
    callAs: async (caller, call, request) => {
      const response = await respond(caller, call, request)
      if (!response.ok) throw response.error
      return response.value
    },
    respondAs: respond,
    ...createHarnessSeeds(seedContext),
  }
}
