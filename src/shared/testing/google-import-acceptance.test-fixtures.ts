import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod/v4'
import { createContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId } from '#/shared/domain/ids'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import type { GoogleAuthorizedProviderExecutor } from '#/contexts/integration/application/ports/google-authorized-provider-executor.port'
import { startPropertyImportInputSchema } from '#/contexts/integration/application/dto/google-import.dto'

export const IMPORT_TEST_NOW = new Date('2026-11-07T10:00:00.000Z')
export const IMPORT_TEST_DAY_MS = 86_400_000
export const IMPORT_TEST_REFERENCE_KEYS = `v1:${'41'.repeat(32)}`
export const IMPORT_TEST_ENCRYPTION_KEY = '42'.repeat(32)

const deliverySchema = z.object({
  jobId: z.string(),
  organizationId: z.string(),
  importJobId: z.string(),
  itemId: z.string(),
  retryRevision: z.number(),
  dispatchEpoch: z.number(),
})

export function createGoogleImportAcceptanceFixture(input: {
  db: Database
  pool: Pool
  orgId: string
  connectionId: string
  actor: AuthContext
  otherActor: AuthContext
}) {
  const { db, pool, orgId, connectionId, actor, otherActor } = input
  const accountId = `provider-account-${randomUUID()}`
  const locationIds = [randomUUID(), randomUUID()]
  let now = IMPORT_TEST_NOW
  let suspended = false
  const clock = () => now
  const ephemeral = createInMemoryProviderEphemeralStore(() => now.getTime())
  const queue = createInMemoryQueue({ clock })
  queue.addBulk = async (jobs) =>
    Promise.all(jobs.map((job) => queue.add(job.name, job.data, job.opts)))
  const executor: GoogleAuthorizedProviderExecutor = {
    execute: async (descriptor) => {
      let payload: unknown
      switch (descriptor.routeKey) {
        case 'account-management.accounts.list':
          payload = {
            accounts: [
              {
                name: `accounts/${accountId}`,
                accountName: 'Provider account',
                role: 'OWNER',
              },
            ],
          }
          break
        case 'business-information.locations.list': {
          const offset = Number(descriptor.pageToken ?? 0)
          const page = locationIds.slice(offset, offset + 100)
          payload = {
            ...(offset + page.length < locationIds.length
              ? { nextPageToken: String(offset + page.length) }
              : {}),
            locations: page.map((id, index) => ({
              name: `locations/${id}`,
              title: `Import cafe ${index + 1}`,
              storefrontAddress: { regionCode: 'US' },
              metadata: { hasVoiceOfMerchant: true },
            })),
          }
          break
        }
        default:
          throw new Error('Unexpected provider route in import acceptance test')
      }
      return {
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode(JSON.stringify(payload)),
      }
    },
  }
  function build() {
    const container = createContainer({
      db,
      pool,
      redis: undefined,
      clock,
      queue,
      enableJobs: true,
      providerEphemeralStore: ephemeral,
      runtimeEnvironment: {},
      providers: {
        googleOAuth: createInMemoryGoogleOAuthPort(),
        googleAuthorizedProviderExecutor: executor,
      },
      env: {
        ...getEnv(),
        NODE_ENV: 'test',
        BETA_ALLOWLIST_ORGS: orgId,
        BETA_SUSPENDED_ORGS: suspended ? orgId : '',
        ENCRYPTION_KEY: IMPORT_TEST_ENCRYPTION_KEY,
        GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS: IMPORT_TEST_REFERENCE_KEYS,
        GOOGLE_REPLAY_HMAC_KEYS: IMPORT_TEST_REFERENCE_KEYS,
        GBP_PUBSUB_TOPIC: '',
      },
    })
    bindProcessPolicies(container)
    return container
  }
  let container = build()
  async function close() {
    try {
      await container.shutdown.run()
    } finally {
      releaseProcessPolicies(container)
    }
  }
  async function restart() {
    await close()
    container = build()
  }
  function commands() {
    const commands = container.integrationPublicApi.imports.transact
    if (!commands) throw new Error('Public import commands were not composed')
    return commands
  }
  async function selection(count = 1, manager: AuthContext = actor) {
    const discovery = container.integrationPublicApi.imports.discover
    if (!discovery) throw new Error('Public import discovery was not composed')
    const accounts = await discovery.listAccounts(
      { connectionId: actorConnectionId() },
      manager,
    )
    const account = accounts.items[0]
    if (!account) throw new Error('Provider account was not discovered')
    const firstPage = await discovery.listCandidates(
      { connectionId: actorConnectionId(), accountRef: account.accountRef },
      manager,
    )
    const pages = [firstPage]
    let cursorRef = firstPage.nextCursor
    while (
      cursorRef &&
      pages.reduce((total, page) => total + page.items.length, 0) < count
    ) {
      const page = await discovery.listCandidates(
        { connectionId: actorConnectionId(), cursorRef },
        manager,
      )
      pages.push(page)
      cursorRef = page.nextCursor
    }
    const candidates = {
      ...firstPage,
      items: pages.flatMap((page) => page.items),
      nextCursor: cursorRef,
    }
    return {
      accounts,
      candidates,
      input: startPropertyImportInputSchema.parse({
        requestId: randomUUID(),
        confirmation: 'apply',
        items: candidates.items.slice(0, count).map((item) =>
          item.eligibility.kind === 'relink'
            ? {
                candidateRef: item.candidateRef,
                action: 'relink',
                existingPropertyId: item.eligibility.propertyId,
                profile: {
                  timezone: 'UTC',
                  confirmed: true,
                  updateExistingProfile: false,
                },
              }
            : {
                candidateRef: item.candidateRef,
                action: 'create',
                profile: {
                  name: item.businessName,
                  address: null,
                  countryCode: 'US',
                  timezone: 'UTC',
                  confirmed: true,
                },
              },
        ),
      }),
    }
  }
  function actorConnectionId() {
    return googleConnectionId(connectionId)
  }

  return {
    orgId,
    actor,
    otherActor,
    connectionId,
    accountId,
    locationIds,
    addLocations: (count: number) => {
      locationIds.push(...Array.from({ length: count }, () => randomUUID()))
    },
    queue,
    commands,
    selection,
    suspend: async (value: boolean) => {
      suspended = value
      await restart()
    },
    clock,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
    restart,
    close,
    deliveries: () => queue.enqueuedJobs.map((job) => deliverySchema.parse(job.data)),
    recover: () => container.integrationWorkerRuntime.recoverImports(),
    process: async (delivery: z.infer<typeof deliverySchema>) => {
      const process = container.integrationWorkerRuntime.processImportItem
      if (!process) throw new Error('Import worker was not composed')
      await process({ ...delivery, attemptOrdinal: 1 })
    },
    sweep: async () => {
      const sweep = container.integrationWorkerRuntime.sweepImportLifecycle
      if (!sweep) throw new Error('Import lifecycle was not composed')
      return sweep()
    },
    disconnect: () =>
      container.integrationPublicApi.connections.disconnect({ connectionId }, actor),
  }
}
