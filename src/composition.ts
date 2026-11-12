// Composition root — the only place a full container is built. It SELECTS
// implementations and configuration rather than being one.
//
// Each context's build.ts owns its private wiring and exposes only NAMED
// CAPABILITY GROUPS (docs/standards.md 3.1). ARC-03-T11/T12: the root reads no
// context's private hatch — the single exception is the simulation runtime,
// guarded by its option and absent from every application container. The root
// imports no individual use case, event handler or business rule; job/consumer
// registration stays owned by BQC-3 (bootstrap.ts + worker/). Cohesive
// sub-graphs live in src/composition/: one <context>-wiring.ts per context
// build, while this file fixes the order they run in. A callback into a context
// built later is passed as a getter and called only after construction ends.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { randomUUID } from 'node:crypto'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  bindProcessPolicies,
  registerProcessPolicyColdBoot,
} from '#/shared/auth/process-policy-binding'
import { notificationEmailWebConfigProblems } from '#/contexts/feed/application/notification-email-web-config'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'
import { createCompositionRuntime } from './composition/runtime'
import { buildIdentityPorts, wireIdentity } from './composition/identity-wiring'
import { wireProperty } from './composition/property-wiring'
import { wirePortal } from './composition/portal-wiring'
import { wireGuest } from './composition/guest-wiring'
import { wireIntegration } from './composition/integration-wiring'
import { buildAiRuntime, wireAi } from './composition/ai-wiring'
import { wireReview } from './composition/review-wiring'
import { wireInbox } from './composition/inbox-wiring'
import { buildContainerCapabilities } from './composition/container-capabilities'
import {
  assertContainerCanBuild,
  closeProcessContainer,
  createContainerDisposer,
  markContainerFailed,
  markContainerReady,
} from './composition/container-lifecycle'
import {
  buildReadAndNotifyContexts,
  notificationEmailAddressKeys,
} from './composition/read-and-notify-contexts'
import { buildOperationalReadout } from './composition/operational-readout'
import { buildGoogleProviderAuthority } from './composition/google-provider-authority'
import {
  createDeferredMemberAuthorityLifecycle,
  createMemberAuthorityLifecycle,
} from './composition/member-authority-lifecycle'
import type { CreateContainerOptions } from './composition/container-options'

export {
  applyProviderEndpointOverrides,
  GOOGLE_PROVIDER_ENDPOINTS,
  type ProviderOverrides,
} from './composition/provider-runtime'

function buildContainer(
  options: CreateContainerOptions | undefined,
  mode: 'required' | 'refusing',
) {
  const runtime = createCompositionRuntime(options)
  const { db, clock, logger, env, redis, providerEndpoints, infra, enableJobs } = runtime
  const identityPorts = buildIdentityPorts(runtime)
  // ARC-03-T9: the Identity/Property/Portal/Inbox member-authority seam.
  // Identity is upstream of the three contexts holding the authorities it
  // releases, so the Identity-owned port is handed over now and its
  // implementation is bound once, by name, after those contexts exist.
  // Requests cannot reach the callback until the container finished composing.
  const memberAuthorityLifecycle = createDeferredMemberAuthorityLifecycle()

  // PRE17A A4: Create outbox repository and register event schemas.
  // The dispatcher validates stored facts before invoking their consumers.
  const outboxRepo = createOutboxRepository(db, clock)
  // ARC-03-T7: the durable consumer registry is CONTAINER-OWNED. It used to be
  // a module-level Map whose duplicate check spanned the whole process, so a
  // second container could not register its consumers at all. Every context
  // registers into this instance; the worker's readiness gate and the
  // dispatcher read the same one.
  const consumerRegistry = createConsumerRegistry()
  registerAllEventSchemas()
  const input = { ...runtime, outboxRepo }

  // ── Context builds (dependency order) ──────────────────────────────

  const identity = wireIdentity(
    input,
    identityPorts,
    memberAuthorityLifecycle,
    () => property,
    () => portal,
  )

  // ARC-03-T10: operators refuse Google; application processes require its substrate.
  const googleProviderAuthority = buildGoogleProviderAuthority({
    db,
    clock,
    logger,
    env,
    mode,
    redis,
    providerEndpoints,
    identity: {
      hasActivePropertyGrant: identity.authority.hasActivePropertyGrant,
    },
    ...(options ? { options } : {}),
  })
  const property = wireProperty(input, identity)
  const portal = wirePortal(input, identity, property, () => reporting)
  const guest = wireGuest(input, identity, portal)
  const integration = wireIntegration(
    input,
    identity,
    property,
    portal,
    googleProviderAuthority,
    () => review,
  )
  const aiRuntime = buildAiRuntime(runtime)
  const review = wireReview(input, identity, property, portal, integration, aiRuntime)
  const ai = wireAi(input, identity, property, portal, review, aiRuntime)
  const inbox = wireInbox(input, identity, property, guest, review, ai)
  // ARC-03-T9: the member-authority seam's ONE implementation, bound now that
  // Property, Portal and Inbox exist. It consumes named context capabilities,
  // never repositories, and Identity received its port long before this line.
  memberAuthorityLifecycle.provide(
    createMemberAuthorityLifecycle({
      clock,
      propertyResponsibility: property.responsibility,
      portalResponsibility: portal.responsibility,
      inboxAssignments: inbox.assignments,
      eligibility: {
        listActiveManagers: identity.publicApi.managerFacts.listActiveManagers,
        getAccessiblePropertyIds: identity.publicApi.people.getAccessiblePropertyIds,
      },
    }),
  )

  // ARC-03-T10: downstream Reporting and Feed are composed as one named
  // group after their upstream dependencies.
  const readAndNotify = buildReadAndNotifyContexts({
    staffScanTargetsEnabled: env.STAFF_SCAN_TARGETS_ENABLED,
    db,
    clock,
    idGen: randomUUID,
    logger,
    outboxRepo,
    jobQueue: infra.jobQueue,
    property,
    portal,
    guest,
    review,
    identity,
    integration,
    inbox,
    reviewServingStats: review.lookups.servingStats,
    ...notificationEmailAddressKeys(env),
  })
  const { reporting, feed } = readAndNotify
  const { notification } = feed
  // The web service's own email seams (the Resend event webhook, one-click
  // unsubscribe) only answer 503 when unconfigured; say so once at boot.
  if (!enableJobs) {
    for (const problem of notificationEmailWebConfigProblems({
      production: env.NODE_ENV === 'production',
      sendEmailEnabled: isCapabilityJobEnabled('notification.send_email'),
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
      unsubscribeKeys: env.NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS,
    })) {
      logger.error({ problem }, 'Notification email is misconfigured on web')
    }
  }

  // ARC-03-T10/T15: the process's operational readout and release seam.
  const operationalReadout = buildOperationalReadout({
    db,
    outboxRepo,
    env,
    clock,
    logger,
    redis,
    enableJobs,
    infra,
    identity: {
      policyStoreVersion: identity.policy.currentVersion,
    },
    notification: {
      readNotificationDeliveryLag: notification.publicApi.readNotificationDeliveryLag,
    },
    guestObservationLoss: guest.observationLoss,
    ...(options ? { overrides: options } : {}),
  })

  return buildContainerCapabilities({
    runtime,
    identityPorts,
    identity,
    property,
    portal,
    guest,
    integration,
    review,
    ai,
    inbox,
    readAndNotify,
    googleProviderAuthority,
    operationalReadout,
    outboxRepo,
    consumerRegistry,
  })
}

export function createContainer(options?: CreateContainerOptions) {
  return buildContainer(options, 'required')
}

export function createOperatorContainerGraph(options?: CreateContainerOptions) {
  return buildContainer(options, 'refusing')
}

type BuiltContainer = ReturnType<typeof createContainer>
export type Container = Omit<BuiltContainer, 'simulationRuntime'>
export type SimulationContainer = BuiltContainer & {
  simulationRuntime: NonNullable<BuiltContainer['simulationRuntime']>
}
/**
 * The process's one complete Application Container claim.
 *
 * BQC-7.1 keeps process-scoped resources behind `Symbol.for` because the
 * production build bundles the composition module twice. The occupancy record
 * must therefore be process-level rather than module-level too.
 */
export type ProcessContainerKind = 'web' | 'worker' | 'operator' | 'simulation'

const PROCESS_CONTAINER_KEY = Symbol.for('repkey.composition.deployable-container')
type ProcessContainerStore = {
  [PROCESS_CONTAINER_KEY]?: Readonly<{ kind: ProcessContainerKind }>
}

function processContainerStore(): ProcessContainerStore {
  return globalThis as ProcessContainerStore
}

export const DUPLICATE_CONTAINER_ERROR =
  '[COMPOSITION] a complete Application Container already exists in this process'

/** Claim this process, refusing a second complete container by name. */
export function claimProcessContainer(kind: ProcessContainerKind): void {
  const store = processContainerStore()
  const existing = store[PROCESS_CONTAINER_KEY]
  if (existing) throw new Error(`${DUPLICATE_CONTAINER_ERROR} (${existing.kind})`)
  store[PROCESS_CONTAINER_KEY] = Object.freeze({ kind })
}

/** Release the process claim so a supervised process may rebuild. */
export function releaseProcessContainer(): void {
  processContainerStore()[PROCESS_CONTAINER_KEY] = undefined
}

// BQC-7.1: the production build bundles this module twice, so the singleton
// and process claim both use `Symbol.for` to stay visible across the copies.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')
type ContainerStore = { [CONTAINER_KEY]?: Container }

function containerStore(): ContainerStore {
  return globalThis as ContainerStore
}

/** The web singleton, claiming the process before it builds the container. */
export function getContainer(): Container {
  const store = containerStore()
  if (store[CONTAINER_KEY]) return store[CONTAINER_KEY]
  assertContainerCanBuild()
  claimProcessContainer('web')
  try {
    const container = (store[CONTAINER_KEY] = createContainer())
    markContainerReady()
    return container
  } catch (error) {
    markContainerFailed(error)
    releaseProcessContainer()
    throw error
  }
}

/**
 * Release the singleton container: its queues, queue connections and provider
 * Redis handle. BullMQ treats the connections it is handed as shared, so they
 * are quit explicitly once the queues detach. Only the getContainer() singleton
 * is affected; a container built through createContainer() (the worker,
 * simulations, tests) owns its own lifecycle.
 *
 * The singleton stays reachable while it releases, so a request already in
 * flight keeps the handles it needs, and a draining process cannot build another
 * afterwards. One release per process: concurrent callers share its promise, and
 * it rejects once everything it could release has been released if any release failed.
 */
export function closeContainer(): Promise<void> {
  return closeProcessContainer(async () => {
    const store = containerStore()
    const container = store[CONTAINER_KEY]
    try {
      await (container?.shutdown ?? createContainerDisposer(container ?? {})).run()
    } finally {
      store[CONTAINER_KEY] = undefined
      releaseProcessContainer()
    }
  })
}

/**
 * ARC-03-T8: make the singleton container's policy trio the process answer.
 *
 * Binding is idempotent for the same container and throws for a different one,
 * so a simulation, an operator command's own policy boot, or a second
 * container can no longer silently take the process over — which is exactly
 * what building a container used to do.
 *
 * Each long-lived process names its installation point: the worker binds the
 * container it builds (src/worker/index.ts), the operator harness binds its
 * minimal policy boot (scripts/ops/operator-command.ts), and the web process
 * binds through the cold-boot fallback registered below.
 */
export function bindProcessPoliciesFromSingleton(): void {
  bindProcessPolicies(getContainer())
}

// Cold-boot fallback for the WEB process — one named registration, no policy
// installation. A policy check can run before any getContainer() call in a
// fresh process (requireExecutionAllowed precedes the server function's own
// getContainer; historically the first dashboard load after a dev-server
// restart failed with "[EXECUTION POLICY] not initialized"), so the first
// policy read binds the root on demand.
//
// WHY it lives here rather than in a process entry file: this is the only
// server-side module loaded in BOTH the vite dev SSR runtime and the built
// server before the first gated request. Nitro plugins do not execute under
// vite dev, and src/start.ts is an import-protection graph entry for the
// client environment where '**/composition.ts' is denied. What changed is
// that the installation itself now goes through the single guarded owner
// (bindProcessPolicies) instead of two raw singleton writes.
registerProcessPolicyColdBoot(bindProcessPoliciesFromSingleton)
