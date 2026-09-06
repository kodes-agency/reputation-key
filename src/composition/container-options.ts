// Composition — the Application Container's construction options.
//
// ARC-03-T10/T15: every option is an INJECTION POINT, and the set of them is
// the honest answer to "what can a process choose about its container". Naming
// the type here keeps that answer readable instead of burying it in a 50-line
// inline object literal at the top of createContainer.
//
// Absent option = the production default. Present option = a deliberate,
// deterministic substitution (simulations, tests, process fixtures).

import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import type { Env } from '#/shared/config/env'
import type { Clock } from '#/shared/domain/clock'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { RequestContextPort } from '#/contexts/identity/application/ports/request-context.port'
import type { AuthSessionPort } from '#/contexts/identity/application/ports/auth-session.port'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { sendInvitationEmail } from '#/shared/auth/emails'
import type { IdentityOrganizationLifecycleComposition } from '#/contexts/identity/build'
import type { ProviderOverrides } from './provider-runtime'

export type CreateContainerOptions = {
  enableJobs?: boolean
  /** Testing/simulation-only mutation surface. Normal application containers
   * omit it entirely so production code cannot acquire repository writes. */
  exposeSimulationRuntime?: true
  /** Override the database connection (simulations, per-test isolation). */
  db?: Database
  /** Override the PostgreSQL session pool used by advisory-lock and COPY-style
   * infrastructure that cannot run through the Drizzle connection facade. */
  pool?: Pool
  /** Override Redis. Supplying the key with `undefined` explicitly disables
   * ambient Redis for deterministic simulations and process fixtures. */
  redis?: Redis
  /** Override env (simulations against throwaway config). */
  env?: Env
  /** ARC-03-T14: override the raw process environment handed to in-process
   * provider runtimes (deterministic process fixtures inject a fixed set). */
  runtimeEnvironment?: NodeJS.ProcessEnv
  /** Override the clock (fast-forward time in tests/simulations). ADR 0017. */
  clock?: Clock
  /** Override the job queue (simulations inject an in-memory queue). */
  queue?: Queue
  /** Override the background queue (simulations inject an in-memory queue). */
  backgroundQueue?: Queue
  /** Override the ops domain-events read handle (simulations/tests inject an
   * in-memory queue — the real one opens a dedicated Redis connection). */
  opsDomainEventsQueue?: Queue
  /** Override the ops background read handle. The web process needs this
   * read-only handle without gaining scheduler/worker authority. */
  opsBackgroundQueue?: Queue
  /** Override the ops quarantine read handle (same rationale). */
  opsQuarantineQueue?: Queue
  /** Override the identity port (simulations use the in-memory identity fake). */
  identityPort?: IdentityPort
  /** ARC-03-T13: override the ambient request context (worker and fixture
   * processes have no server request; simulations inject fixed headers). */
  requestContext?: RequestContextPort
  /** ARC-03-T13: override the authenticated session provider. */
  authSession?: AuthSessionPort
  /** Dedicated non-persistent provider store override for simulations/tests. */
  providerEphemeralStore?: ProviderEphemeralStore
  /** Override the email sender (simulations capture emails instead of sending). */
  email?: typeof sendInvitationEmail
  /** Override external provider adapters (BQC-6.1: deterministic Google/GBP/
   * storage by injection — simulations/tests never hit the network). */
  providers?: ProviderOverrides
  /**
   * Reviewed Organization lifecycle/export contributors. Production leaves
   * this absent until every owning context has explicit retention semantics;
   * a partial set remains visible in readiness but cannot execute.
   */
  organizationLifecycle?: IdentityOrganizationLifecycleComposition
}
