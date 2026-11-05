import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import { assertReviewProviderSubjectKeysConfigured } from '#/shared/config/provider-config-guards'
import { configureReviewProviderSubjectWriterKeys } from '#/contexts/review/application/provider-subject-keyring'
import { readFileSync } from 'node:fs'
import { validateGoogleRuntimeIsolationReadiness } from '#/shared/auth/google-runtime-isolation'
import {
  applyProviderEndpointOverrides,
  GOOGLE_PROVIDER_ENDPOINTS,
} from './provider-runtime'
import { buildInfrastructure } from './infrastructure'
import type { CreateContainerOptions } from './container-options'
import type { OutboxRepository } from '#/shared/outbox'

// fallow-ignore-next-line complexity
export function createCompositionRuntime(options: CreateContainerOptions | undefined) {
  const { enableJobs = false } = options ?? {}
  const db = options?.db ?? getDb()
  const pool = options?.pool ?? getPool()
  const logger = getLogger()
  const redis = options && 'redis' in options ? options.redis : getRedis()
  const clock = options?.clock ?? (() => new Date())
  const env = options?.env ?? getEnv()
  if (
    env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS !== undefined ||
    (!enableJobs && env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS !== undefined)
  ) {
    throw new Error('config_invalid')
  }
  // Fail CLOSED at boot, not once per job: a production worker without the
  // subject keyring fails 100% of review syncs at acquireDeriver() with an
  // opaque `config_invalid`, surfacing only after three retries in
  // quarantine. This names the variable and refuses to build the container.
  // No-op outside production and for non-job processes.
  assertReviewProviderSubjectKeysConfigured(env, enableJobs)
  const reviewProviderSubjectKeyring = configureReviewProviderSubjectWriterKeys({
    writerEnabled: enableJobs,
    production: env.NODE_ENV === 'production',
    raw: env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS,
  })

  // BQC-7.3 (release.sha): deploy identity at boot — one line per container
  // build (singleton in prod; simulations/tests build per scenario).
  logger.info({ releaseSha: getReleaseSha(env) }, 'composition root boot')

  // BQC-4.3: Google's approved endpoints, resolved ONCE at boot. BQC-6.5:
  // explicit operator env overrides (sandbox seam) applied once here; all
  // absent = byte-identical passthrough.
  const providerEndpoints = applyProviderEndpointOverrides(GOOGLE_PROVIDER_ENDPOINTS, env)
  const runtimeIsolationConfigured =
    env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON !== undefined ||
    env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION !== undefined
  if (env.NODE_ENV === 'production' && runtimeIsolationConfigured) {
    if (
      !env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON ||
      !env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION
    ) {
      throw new Error(
        'Configured Google runtime isolation requires a profile and live attestation',
      )
    }
    const expectedGoogleOrigins = [
      ...new Set(
        Object.values(providerEndpoints).map((endpoint) => new URL(endpoint).origin),
      ),
    ]
    validateGoogleRuntimeIsolationReadiness({
      profileRaw: env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON,
      attestationRaw: readFileSync('/run/repkey/google-egress-attestation.json', 'utf8'),
      expectedControlPlanePolicyGeneration: env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION,
      expectedGoogleOrigins,
      expectedTargetEnvironment:
        env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
          ? 'local_sandbox'
          : 'production',
      now: clock(),
    })
  }

  // Infrastructure
  const infra = buildInfrastructure({
    redis,
    enableJobs,
    queue: options?.queue,
    backgroundQueue: options?.backgroundQueue,
    domainEventsQueue: options?.opsDomainEventsQueue,
  })

  return {
    options,
    enableJobs,
    db,
    pool,
    logger,
    redis,
    clock,
    env,
    reviewProviderSubjectKeyring,
    providerEndpoints,
    infra,
  }
}

export type CompositionRuntime = ReturnType<typeof createCompositionRuntime>
export type ContextWiringInput = CompositionRuntime & { outboxRepo: OutboxRepository }
