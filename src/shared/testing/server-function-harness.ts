// Call a real server function as a signed-in test member, over PostgreSQL.
//
// The member signs in through Better Auth and picks their Organization the way
// the app does, and the call runs inside a TanStack Start request that carries
// the session cookie. Tenant resolution, the execution policy and the
// composition root are the production ones: a missing guard or a wrong role
// fails the test. Only external providers (Google, storage, email), queues and
// the clock are fakes. See CONTEXT.md, "Server-function harness".

import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { hashPassword } from 'better-auth/crypto'
import { H3Event } from 'nitro/h3'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { createContainer, type Container } from '#/composition'
import type { ProviderOverrides } from '#/composition'
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import { getAuth } from '#/shared/auth/auth'
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
import type { Role } from '#/shared/domain/roles'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { clearTestContainerEnv } from './clear-container-env'
import { createInMemoryGoogleOAuthPort } from './in-memory-google-oauth-port'
import { createInMemoryObjectStore } from './in-memory-object-store'
import { createInMemoryQueue } from './in-memory-queue'
import { deleteTestOrganizations } from './integration-helpers'
import { acquireTestLease, type TestLease } from './test-environment-lease'

const BETTER_AUTH_ROLE: Readonly<Record<Role, string>> = {
  AccountAdmin: 'owner',
  PropertyManager: 'admin',
  Member: 'member',
}

const PASSWORD = 'harness-password-123!'

// The two process-level slots a web request reads: the composition root's
// singleton and Start's request event. Both are keyed by Symbol.for because the
// production build bundles their modules twice.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')
const EVENT_STORAGE_KEY = Symbol.for('tanstack-start:event-storage')
const START_STORAGE_KEY = Symbol.for('tanstack-start:start-storage-context')

type ProcessSlots = Record<symbol, unknown>

export type TestOrganization = Readonly<{ id: string }>

export type TestMember = Readonly<{
  userId: string
  organizationId: string
  role: Role
  email: string
  /** The session cookie the member's requests carry. */
  cookie: string
}>

export type TestProperty = Readonly<{ id: string; organizationId: string }>

export type TestPortal = Readonly<{
  id: string
  organizationId: string
  propertyId: string
}>

export type ServerFunctionHarnessOptions = Readonly<{
  /** The container's clock. Defaults to the wall clock. */
  clock?: Clock
  /** Provider fakes in place of the defaults (in-memory Google OAuth and storage). */
  providers?: ProviderOverrides
  /**
   * Tables the file's server functions write, deleted by organization_id after
   * each test before the seeded Properties are. Name the ones whose rows keep a
   * Property from being deleted.
   */
  cleanupTables?: readonly string[]
}>

export type ServerFunctionHarness = Readonly<{
  container: () => Container
  pool: () => TestLease['pool']
  seedOrganization: () => Promise<TestOrganization>
  /** A verified user who is a member of the Organization in this role, signed in to it. */
  seedMember: (organization: TestOrganization, role: Role) => Promise<TestMember>
  seedProperty: (organization: TestOrganization) => Promise<TestProperty>
  seedPortal: (property: TestProperty) => Promise<TestPortal>
  /** Give a PropertyManager the Property, as an accepted invitation does. */
  grantProperty: (member: TestMember, property: TestProperty) => Promise<void>
  /** Run `call` as a request from `member`, or from a visitor with no session. */
  callAs: <T>(member: TestMember | null, call: () => Promise<T>) => Promise<T>
}>

/** In-memory storage that answers every StoragePort call without a network. */
export function createInMemoryStorage(): StoragePort {
  const store = createInMemoryObjectStore()
  return {
    ...store,
    createPresignedUploadUrl: async (key) => ({ uploadUrl: `memory://${key}`, key }),
    confirmUpload: async (key) => {
      if (!store.objects().has(key)) throw new Error(`No object at ${key}`)
    },
    listObjects: async (prefix, maxKeys, startAfter) => {
      const keys = [...store.objects().keys()]
        .filter((key) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort()
      return {
        objects: keys.slice(0, maxKeys).map((key) => ({
          key,
          sizeBytes: store.objects().get(key)?.body.length ?? 0,
          lastModified: null,
        })),
        truncated: keys.length > maxKeys,
      }
    },
  }
}

function storageFor<T>(key: symbol): AsyncLocalStorage<T> {
  const slots = globalThis as ProcessSlots
  if (!slots[key]) slots[key] = new AsyncLocalStorage<T>()
  return slots[key] as AsyncLocalStorage<T>
}

function requestFrom(member: TestMember | null): Request {
  const { BETTER_AUTH_URL } = getEnv()
  const headers = new Headers({
    origin: BETTER_AUTH_URL,
    'sec-fetch-site': 'same-origin',
  })
  if (member) headers.set('cookie', member.cookie)
  return new Request(new URL('/_serverFn/harness', BETTER_AUTH_URL), {
    method: 'POST',
    headers,
  })
}

function sessionCookie(headers: Headers): string {
  const pairs = headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '')
  const session = pairs.find((pair) =>
    /^(__Secure-)?better-auth\.session_token=./.test(pair),
  )
  if (!session) throw new Error('Sign-in returned no session cookie')
  return session
}

/**
 * Build the real container with fakes for what lies outside the process, make
 * it the process's container, and clean up what each test seeded. Call once at
 * the top of a *.integration.test.ts file.
 */
export function setupServerFunctionHarness(
  options: ServerFunctionHarnessOptions = {},
): ServerFunctionHarness {
  let lease: TestLease | undefined
  let container: Container | undefined
  const organizations = new Set<string>()
  const users = new Set<string>()
  const pool = () => {
    if (!lease) throw new Error('The server-function harness has not started')
    return lease.pool
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 5)
    clearTestContainerEnv()
    clearEventSchemas()
    const clock = options.clock ?? (() => new Date())
    container = createContainer({
      db: getDb(),
      pool: lease.pool,
      redis: undefined,
      clock,
      queue: createInMemoryQueue({ clock }),
      backgroundQueue: createInMemoryQueue({ clock }),
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsBackgroundQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      runtimeEnvironment: {},
      email: async () => {},
      providers: {
        googleOAuth: createInMemoryGoogleOAuthPort(),
        storage: createInMemoryStorage(),
        ...options.providers,
      },
    })
    bindProcessPolicies(container)
    ;(globalThis as ProcessSlots)[CONTAINER_KEY] = container
    declareRequestProcess()
  })

  afterEach(async () => {
    resetTenantCache()
    const organizationIds = [...organizations]
    const userIds = [...users]
    organizations.clear()
    users.clear()
    await withLastOwnerGuardDisabled(pool(), async (client) => {
      for (const table of options.cleanupTables ?? []) {
        // Table names come from the test file's own literal list.
        await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
          organizationIds,
        ])
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
      await client.query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
        organizationIds,
      ])
      await client.query(`DELETE FROM member WHERE "organizationId" = ANY($1)`, [
        organizationIds,
      ])
      await deleteTestOrganizations(client, organizationIds)
      await client.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds])
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
      await lease?.release()
    }
  })

  const seedOrganization = async (): Promise<TestOrganization> => {
    const id = `org-harness-${randomUUID()}`
    organizations.add(id)
    await pool().query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())`,
      [id, 'Harness Hotels', `h-${id.replace(/-/g, '')}`],
    )
    return { id }
  }

  const seedMember = async (
    organization: TestOrganization,
    role: Role,
  ): Promise<TestMember> => {
    const userId = `user-harness-${randomUUID()}`
    const email = `${userId}@example.test`
    users.add(userId)
    await pool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Harness Member', $2, true, NOW(), NOW())`,
      [userId, email],
    )
    await pool().query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
      [`account-${userId}`, userId, await hashPassword(PASSWORD)],
    )
    await pool().query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      [`member-${userId}`, organization.id, userId, BETTER_AUTH_ROLE[role]],
    )
    const signedIn = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      headers: new Headers(),
      returnHeaders: true,
    })
    const cookie = sessionCookie(signedIn.headers)
    await getAuth().api.setActiveOrganization({
      headers: new Headers({ cookie }),
      body: { organizationId: organization.id },
    })
    return { userId, organizationId: organization.id, role, email, cookie }
  }

  const seedProperty = async (organization: TestOrganization): Promise<TestProperty> => {
    const id = randomUUID()
    await pool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Harbour House', $3, 'UTC')`,
      [id, organization.id, `harbour-${id}`],
    )
    return { id, organizationId: organization.id }
  }

  const seedPortal = async (property: TestProperty): Promise<TestPortal> => {
    const id = randomUUID()
    await pool().query(
      `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, theme)
       VALUES ($1, $2, $3, $4, 'Reception', $5, '{"primaryColor":"#6366F1"}')`,
      [id, property.organizationId, property.id, property.id, `reception-${id}`],
    )
    return { id, organizationId: property.organizationId, propertyId: property.id }
  }

  const grantProperty = async (member: TestMember, property: TestProperty) => {
    await pool().query(
      `INSERT INTO property_access_grant (organization_id, property_id, user_id, source, created_by)
       VALUES ($1, $2, $3, 'invitation', $3)`,
      [property.organizationId, property.id, member.userId],
    )
  }

  const callAs = <T>(member: TestMember | null, call: () => Promise<T>): Promise<T> => {
    const request = requestFrom(member)
    return storageFor<{ h3Event: H3Event }>(EVENT_STORAGE_KEY).run(
      { h3Event: new H3Event(request) },
      () =>
        storageFor(START_STORAGE_KEY).run(
          { startOptions: {}, request, contextAfterGlobalMiddlewares: {} },
          call,
        ),
    )
  }

  return {
    container: () => {
      if (!container) throw new Error('The server-function harness has not started')
      return container
    },
    pool,
    seedOrganization,
    seedMember,
    seedProperty,
    seedPortal,
    grantProperty,
    callAs,
  }
}
