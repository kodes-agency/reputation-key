// ARC-03-T15 — a SIDECAR deployable, booted in its own process.
//
// A Google/AI sidecar is deliberately NOT an Application Container host: it
// owns one narrow provider trust boundary and must reach neither the database
// nor a job queue. That absence is the property under test, so this fixture
// composes the one unit a sidecar process legitimately builds — the Google
// provider trust boundary — and reports zero database and zero queue handles.
//
// `containerBoots` is 1 in the same sense as the other two fixtures: exactly
// one composition unit was built in this process.

import { buildGoogleProviderAuthority } from '#/composition/google-provider-authority'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Env } from '#/shared/config/env'
import { providerConfigFor } from '#/composition/provider-runtime'
import { emitBootReport } from './boot-report'
import { FIXTURE_CLOCK_INSTANT } from './fixture-runtime'

/** A sidecar must not query. Any access is a failed boot, not a warning. */
const forbiddenDatabase = new Proxy(
  {},
  {
    get: () => {
      throw new Error('a sidecar process must not hold a database handle')
    },
  },
) as unknown as Database

const inertEventBus = {
  emit: async () => {},
  on: () => {},
} as unknown as EventBus

function main(): void {
  const authority = buildGoogleProviderAuthority({
    db: forbiddenDatabase,
    eventBus: inertEventBus,
    clock: () => FIXTURE_CLOCK_INSTANT,
    logger: { warn: () => {}, info: () => {} },
    env: {
      NODE_ENV: 'test',
      OAUTH_STATE_SECRET: 'fixture-oauth-state-secret',
    } as unknown as Env,
    redis: undefined,
    providerEndpoints: providerConfigFor('gbp-default'),
    dataCellExecutionFence: {
      localCell: 'us',
      decideProperty: async () => ({ kind: 'deny' }),
    } as never,
    identity: {
      refreshPolicyStoreRequired: async () => {
        throw new Error('a sidecar has no policy store')
      },
      hasActivePropertyGrant: async () => false,
    },
  })

  emitBootReport({
    deployable: 'sidecar',
    containerBoots: 1,
    jobNames: [],
    consumerNames: [],
    schedulerIds: [],
    policyBindings: [],
    // Names only. The provider-ephemeral store is in-memory here because no
    // provider-ephemeral Redis URL is configured.
    openHandleNames: authority.providerEphemeralRedis ? ['provider-ephemeral-redis'] : [],
  })

  process.exit(0)
}

main()
