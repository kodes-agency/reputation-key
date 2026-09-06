// ARC-03-T15 — a narrow trust-boundary composition unit, booted in its own
// process.
//
// The subject used to be a Google SIDECAR deployable. WP2.1 moved that runtime
// in-process, so the subject is now the composition unit that replaced it:
// `createInProcessGoogleEgressRuntime` builds the admission service and the
// egress gateway that used to be two containers reached over mTLS.
//
// WHAT THIS PROVES, and why it still earns its place. The runtime is handed a
// pool and a Redis, and the claim is that CONSTRUCTION acquires neither — no
// query, no connection, no timer, no queue. That is the invariant the old
// sidecars got for free by being separate processes and that the collapse has
// to keep by discipline instead: if building the Google trust boundary ever
// starts touching the database, it does so on the web request path, and this
// fixture reports a nonzero open-handle count instead of the boot succeeding.
//
// The boundaries are inert on purpose. Any call through them throws, so a
// construction that reached for the network fails loudly here rather than
// hanging in a test that mocks it away.
//
// `containerBoots` is 1 in the same sense as the other process fixtures:
// exactly one composition unit was built in this process.

import type { Pool } from 'pg'
import { createInProcessGoogleEgressRuntime } from '../../../composition/google-egress-runtime'
import type { GoogleEgressCoordinationRedis } from '../../../composition/google-egress-runtime'
import { emitBootReport } from './boot-report'
import { FIXTURE_CLOCK_INSTANT } from './fixture-runtime'

function unusedBoundary(): never {
  throw new Error('the sidecar fixture must not invoke a network boundary')
}

function main(): void {
  const pool = { query: unusedBoundary } as unknown as Pool
  const redis = {
    defineCommand: () => undefined,
    get: unusedBoundary,
    set: unusedBoundary,
    del: unusedBoundary,
    eval: unusedBoundary,
  } as unknown as GoogleEgressCoordinationRedis

  createInProcessGoogleEgressRuntime({
    pool,
    redis,
    nowMs: () => FIXTURE_CLOCK_INSTANT.getTime(),
    gatewayIdentity: 'google-egress-runtime-fixture',
    releaseSha: 'a'.repeat(40),
    credentialBindingKeys: `fixture-credential:${'0'.repeat(64)}`,
    grantKeys: `fixture-grant:${'1'.repeat(64)}`,
    logger: { warn: () => undefined },
  })

  emitBootReport({
    deployable: 'sidecar',
    containerBoots: 1,
    jobNames: [],
    consumerNames: [],
    schedulerIds: [],
    policyBindings: [],
    openHandleNames: [],
  })

  process.exit(0)
}

main()
