import { z } from 'zod/v4'
import { DATA_CELL_IDS } from '#/shared/domain/data-cell-catalogue'

const baseEnvSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database — Railway PostgreSQL
  DATABASE_URL: z.url(),
  DATABASE_URL_POOLER: z.url().optional(),

  // Auth — Better Auth
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .regex(/[a-zA-Z0-9]/, 'Must contain alphanumeric characters'),
  BETTER_AUTH_URL: z.url(),

  // Email — Resend
  RESEND_API_KEY: z.string().min(1),
  // BQC-6.7: operator sandbox seam for identity mail — optional Resend API
  // endpoint override (same pattern as the GBP_*_BASE_URL overrides below).
  // Legitimate use: point a sandbox/e2e deployment at a mail stub instead of
  // production Resend. ABSENT = the SDK default (https://api.resend.com),
  // byte-identical to the pre-seam behavior. The app still runs its REAL
  // Resend client against whatever this points at (no fake injection).
  RESEND_BASE_URL: z.url().optional(),
  // ADR 0046 r.6: Svix signing secret for the Resend event webhook
  // (/api/webhooks/resend/events), which is what makes `delivered`,
  // `bounced` and `complained` reachable at all. OPTIONAL in the schema on
  // purpose — same fail-closed-at-the-route posture as OPS_METRICS_TOKEN:
  // absent env → the route answers 503 `webhook_disabled` instead of
  // crashing boot, so a deployment without Resend webhooks configured still
  // starts. Format is Resend's `whsec_<base64>`; the verifier strips the
  // prefix and base64-decodes the remainder as the HMAC-SHA256 key.
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  // RFC 5322 From header for every outbound message. Defaulted, not required,
  // so no deployment breaks on the upgrade — the default is the value that was
  // previously hardcoded in shared/auth/emails.ts.
  //
  // OPS DEBT: the product domain is reputationkey.app but the sender is
  // kodes.agency. SPF/DKIM/DMARC are aligned for the sending domain, not for
  // the brand the reader sees, which costs deliverability and reads as a
  // phishing tell. Fix by verifying reputationkey.app in Resend and setting
  // this to `Reputation Key <notifications@reputationkey.app>`.
  // While the two diverge, the first outbound message in each process logs one
  // warn naming both domains (shared/email/sender-alignment.ts) — the drift is
  // otherwise completely silent. A sending SUBDOMAIN of the app domain counts
  // as aligned (DMARC relaxed alignment) and stays quiet.
  EMAIL_FROM: z.string().min(3).default('Reputation Key <info@kodes.agency>'),

  // Redis — Upstash / Railway Redis
  REDIS_URL: z.string().optional(),
  // Dedicated non-persistent Redis for provider Content and short-lived
  // authorization records. Production composition requires a distinct TLS URL.
  PROVIDER_EPHEMERAL_REDIS_URL: z.string().optional(),
  // Optional private CA scoped only to the provider-Redis TLS client.
  PROVIDER_EPHEMERAL_REDIS_CA_PEM: z.string().min(1).optional(),

  // BQC-7.2: operator token gating /api/health/metrics (private ops
  // diagnostics). Optional in the SCHEMA on purpose — the fail-closed posture
  // lives at the route: absent env → the endpoint 404s (stays dark) instead
  // of crashing boot. Operationally REQUIRED in production (Railway service
  // variable). Generate: openssl rand -hex 32
  OPS_METRICS_TOKEN: z.string().min(32).optional(),

  // BQC-7.3 (release.sha): deploy identity for boot logs + the ops snapshot.
  // RELEASE_SHA wins; Railway injects RAILWAY_GIT_COMMIT_SHA at build time.
  // Both optional — local/dev boots report 'unknown'.
  RELEASE_SHA: z.string().min(1).optional(),
  // REG-03: digest of the canonical, Sigstore-verified promotion manifest.
  // Optional during local development and the pre-promotion compatibility
  // window; every digest-promoted Railway service receives the exact value.
  RELEASE_MANIFEST_SHA256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().min(1).optional(),
  // Revision baked into Docker images through SOURCE_REVISION. Production
  // startup rejects a concrete RELEASE_SHA that names a different candidate.
  IMAGE_SOURCE_REVISION: z.string().min(1).optional(),

  // BQC-7.4: optional operator webhook for alert dispatch (the alert
  // routing wiring point — e.g. an incident-management inbound hook).
  // ABSENT = log-only dispatch: the schema-conformant error-level ALERT log
  // line is the always-on durable signal; the webhook is best-effort on top
  // (3s timeout, fire-and-log-on-failure, never throws into the evaluator).
  ALERT_WEBHOOK_URL: z.url().optional(),

  // BQC-7.5: named-operator allowlist for operator commands (scripts/ops/*).
  // Comma-separated operator identities (e.g. emails). The ExecutionPolicy
  // operator branch fails closed when an operator id is absent from this
  // list (operator_not_registered); absent/empty env = NO operator command
  // evaluates allow. Every invocation still needs --operator <id> matching
  // an entry here.
  OPS_OPERATOR_IDENTITIES: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Storage — AWS S3
  AWS_S3_ACCESS_KEY: z.string().min(1).optional(),
  AWS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_S3_BUCKET_NAME: z.string().min(1).optional(),
  AWS_S3_REGION: z.string().min(1).optional(),
  // Optional S3-compatible endpoint split for local object storage. Object
  // operations use the private endpoint; browser upload signatures use the
  // loopback-reachable endpoint. Unset preserves AWS endpoint discovery.
  S3_INTERNAL_ENDPOINT: z.url().optional(),
  S3_PRESIGN_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value?.toLowerCase() === 'true'),

  // Error tracking — Sentry (optional, Phase 22 for full integration)
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Guest sessions — required in production, dev-only default for convenience
  GUEST_SESSION_SALT:
    process.env.NODE_ENV === 'production'
      ? z.string().min(16)
      : z.string().min(16).default('dev-only-salt-not-for-production'),

  // Public Portal capability tokens — keyed lookup digest, independent from auth/session keys.
  PORTAL_TOKEN_HASH_SECRET:
    process.env.NODE_ENV === 'production'
      ? z.string().min(32)
      : z.string().min(32).default('dev-only-portal-token-secret-32b'),
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Token encryption (32-byte hex key for AES-256-GCM)
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/, 'Must be 64 hex characters (32 bytes)'),

  // OAuth state signing secret — dedicated key, independent of ENCRYPTION_KEY
  OAUTH_STATE_SECRET: z
    .string()
    .min(32)
    .regex(/^[a-f0-9]+$/, 'Must be hex characters'),
  // Versioned, audience-separated HMAC keyrings. First entry is active;
  // retained entries verify only. Format: v2:<64-hex>,v1:<64-hex>.
  GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS: z.string().optional(),
  GOOGLE_SESSION_BINDING_HMAC_KEYS: z.string().optional(),
  GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS: z.string().optional(),
  GOOGLE_REPLAY_HMAC_KEYS: z.string().optional(),
  // Review-provider correlation key material is worker-only. The sealed
  // contract migrator receives the same versions through a distinct one-run
  // variable so no normal process can accidentally select migrator authority.
  // Format: key-version:<exactly 64 lowercase hex>[,...], at most two entries.
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: z.string().max(195).optional(),
  REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: z.string().max(195).optional(),
  // Runtime-isolation declaration plus independent control-plane live-probe
  // evidence. Protected production issuance requires exact, fresh parity.
  GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON: z.string().optional(),
  GOOGLE_CONTROL_PLANE_POLICY_GENERATION: z.string().min(1).optional(),
  // Strict capability-keyed runtime bindings for the currently deployed
  // Google Content approval. Required whenever a protected capability is enabled.
  GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON: z.string().optional(),
  GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON: z
    .string()
    .max(100 * 1024)
    .optional(),
  // App/worker -> Google egress gateway. All six values are an all-or-none
  // protected transport configuration validated by the composition root.
  GOOGLE_EGRESS_GATEWAY_ORIGIN: z.string().url().optional(),
  GOOGLE_EGRESS_GATEWAY_SERVER_NAME: z.string().min(1).optional(),
  GOOGLE_INTERNAL_MTLS_CA_PATH: z.string().min(1).optional(),
  GOOGLE_INTERNAL_MTLS_CERT_PATH: z.string().min(1).optional(),
  GOOGLE_INTERNAL_MTLS_KEY_PATH: z.string().min(1).optional(),
  // Railway and other variable-only runtimes cannot mount secret files. The
  // base64 triplet is the no-disk equivalent of the legacy path triplet above.
  // Composition accepts exactly one complete triplet and rejects partial or
  // mixed configuration. The path form remains during the deployment
  // expand/cutover window and can be contracted after every environment has
  // moved to the variable-only form.
  GOOGLE_INTERNAL_MTLS_CA_B64: z.string().min(1).optional(),
  GOOGLE_INTERNAL_MTLS_CERT_B64: z.string().min(1).optional(),
  GOOGLE_INTERNAL_MTLS_KEY_B64: z.string().min(1).optional(),
  GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: z.string().optional(),
  // Explicit operator opt-out for UNGOVERNED direct Google provider egress.
  // The review adapter falls back to a direct `fetch` whenever the egress
  // executor is absent — which happens merely by leaving the six values above
  // unset — and that path bypasses admission, quota control, credential
  // binding and mTLS. Absent (the default) means PRODUCTION REFUSES the
  // fallback with a config error naming the missing fields; development and
  // test are unaffected either way. Set to 'true' only for a production
  // deployment that knowingly runs without the gateway.
  GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === 'true'),

  // Web/worker -> AI egress gateway. All transport and settlement-verification
  // values are configured together; composition rejects partial configuration.
  AI_EGRESS_GATEWAY_ORIGIN: z.string().url().optional(),
  AI_EGRESS_GATEWAY_SERVER_NAME: z.string().min(1).optional(),
  AI_INTERNAL_MTLS_CA_B64: z.string().min(1).optional(),
  AI_INTERNAL_MTLS_CERT_B64: z.string().min(1).optional(),
  AI_INTERNAL_MTLS_KEY_B64: z.string().min(1).optional(),
  AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON: z.string().max(65_536).optional(),
  AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON: z.string().max(65_536).optional(),
  AI_KEY_INVENTORY_PROFILE: z.enum(['production-v1', 'local-stack-v1']).optional(),
  // Worker-only keyed pseudonym authority for durable AI operation subjects.
  AI_SUBJECT_HMAC_KEYS: z.string().max(195).optional(),

  // Google Pub/Sub webhook audience verification (optional — defaults to /webhooks/gbp path)
  GBP_PUBSUB_AUDIENCE: z.string().optional(),
  // GBP Pub/Sub notification lifecycle (ADR-deferred item #2). One shared topic; empty
  // = notifications disabled (manage-notifications no-ops). `business.manage` covers
  // updateNotificationSetting; topic/subscription/grant are GCP infra, not app code.
  GBP_PUBSUB_TOPIC: z.string().optional().default(''),
  // Comma-separated GBP notification types to subscribe to (default: NEW_REVIEW only).
  GBP_PUBSUB_NOTIFICATION_TYPES: z.string().default('NEW_REVIEW'),
  // Service-account email Google Pub/Sub signs its push JWT with (the
  // subscription's OIDC push identity). When SET, the webhook additionally
  // requires the verified `email` claim to equal it, so a Google-issued token
  // from any OTHER project/service account is rejected 401 instead of being
  // accepted on audience alone. Leave UNSET and the pushing identity is
  // unpinned: any Google-issued OIDC token carrying our audience is accepted
  // (the webhook warns once per process about exactly this).
  GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: z.string().optional(),
  // Per-property minimum interval (minutes) between new-review discovery
  // polls. The discover-new-reviews sweep FIRES every 15 minutes on the
  // background queue; this is how long an individual connected property
  // waits before it is polled again, so it — not the firing cadence — is the
  // knob that trades review freshness against GBP quota. Default 15.
  REVIEW_DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // Dynamic Access Control — Stage 1 safety gate (ADR 0001).
  // 'true' enables the custom-role model (Stage 2 dynamic resolver). Absent or any
  // other value = false. Parsed as string→bool to avoid z.coerce.boolean()'s
  // Boolean("false") === true pitfall.
  ENABLE_CUSTOM_ROLES: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === 'true'),
  // B0.6: Require email verification. In production, defaults to true.
  // In development/test, defaults to false for convenience.
  EMAIL_VERIFICATION_REQUIRED:
    process.env.NODE_ENV === 'production'
      ? z
          .string()
          .optional()
          .transform((v) => v !== 'false')
      : z
          .string()
          .optional()
          .transform((v) => v === 'true'),
  // ── BETA-0 safety envelope controls ────────────────────────────────
  // Capability kill switch (BQC-0.4): '1'/'true'/'all' disables ALL
  // capabilities; a comma-separated list disables exactly those capabilities
  // (e.g. property.connect_gbp,property.publish_reply stops Google
  // sync/import/publish). Empty/absent = none off.
  BETA_CAPABILITIES_OFF: z.string().optional(),
  // Allowlist of org slugs/IDs permitted in the beta cohort (B0.5/B0.6).
  // Empty/absent = all verified orgs admitted.
  BETA_ALLOWLIST_ORGS: z.string().optional(),
  // Comma-separated non-core capabilities forced globally ON (E2E/CI only).
  // Must never enable blocked capabilities. Example:
  // identity.register,organization.create,team.use
  // BQC-0.3: non-empty values refuse process startup unless NODE_ENV=test or
  // BETA_E2E_EXECUTION_IDENTITY is set (see capability-boot-guard.ts).
  BETA_E2E_GLOBAL_CAPABILITIES: z.string().optional(),
  // Explicit test/CI execution identity that authorizes the E2E capability
  // override above (e.g. 'playwright-e2e'). Meaningless in production — the
  // boot guard never requires it and production must never set it.
  BETA_E2E_EXECUTION_IDENTITY: z.string().optional(),
  // Review §5.1 / BQC-6.8 — TEST-ONLY. Stands BOTH auth brute-force layers
  // down: the shared Redis limiter on the /api/auth/* catch-all
  // (routes/api/auth/$.ts) and better-auth's own limiter (shared/auth/auth.ts).
  // '1' is the ONLY accepted value, so a near-miss ('0', 'true', 'yes') refuses
  // boot here instead of silently disabling auth rate limiting; and the bypass
  // additionally requires the same execution identity as the capability
  // override above, with startup refused without one (see
  // isE2ERateLimitBypassAuthorized / assertE2ERateLimitBypassIdentity in
  // shared/auth/beta-capabilities.ts). The Playwright stack sets E2E=1
  // (compose.local.yml); production must never set it.
  E2E: z.literal('1').optional(),
  // BQR-0: Outbox relay/dispatcher containment. The outbox path has known
  // defects (non-atomic emit, relay/dispatcher envelope mismatch, empty
  // consumer registry). Must NOT process real work until BQR-2 fixes them.
  // Default: false (safe). Set to 'true' only in controlled test environments.
  OUTBOX_DISPATCHER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === 'true'),
  // Org slugs/IDs suspended from the beta (B0.5 operator controls).
  BETA_SUSPENDED_ORGS: z.string().optional(),
  // Deployed request-edge contract. Production defaults to Railway's documented
  // X-Real-IP edge headers; local/test defaults to trusting no forwarding header.
  TRUSTED_PROXY_MODE: z
    .enum(['direct', 'railway-edge', 'xff'])
    .default(process.env.NODE_ENV === 'production' ? 'railway-edge' : 'direct'),
  // XFF mode only: number of trusted reverse proxies and maximum accepted chain.
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).default(1),
  TRUSTED_PROXY_MAX_HOPS: z.coerce.number().int().min(1).max(32).default(8),
  // BQC-7.6: maximum accepted request body size in bytes (declared
  // content-length), enforced by the request-guard nitro plugin before
  // routing. Default 1 MiB — the largest legitimate payloads (portal image
  // uploads go through presigned S3 URLs, not this server).
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1).default(1_048_576),
  // REG-01: the stable Data Cell this process belongs to. Catalogue admission,
  // not this variable, decides whether that cell may accept work. Unknown cell
  // names fail environment parsing; known wrong-cell work fails at the shared
  // execution, repository, queue, provider, and storage boundaries.
  PROCESSING_CELL: z.enum(DATA_CELL_IDS).default('us'),
  // BQC-7.1: worker graceful-shutdown drain budget (ms). BullMQ worker.close()
  // resolves only when in-flight jobs finish — a hung job would otherwise hang
  // the deploy window until the platform's SIGKILL. On budget expiry the
  // worker logs the stuck resources and exits 1 (unclean stop is recorded).
  // Must stay below Railway's drainingSeconds (30s, railway.worker.json).
  DRAIN_BUDGET_MS: z.coerce.number().int().min(1000).default(25_000),
  // BQC-7.8: isolated restore mode — restore drills ONLY, never set in
  // normal service. The ONLY accepted non-empty value is 'isolated' (any
  // other value fails boot). In restore-isolated mode: the web process boots
  // with every capability evaluation denying fail-closed (the beta-capabilities
  // seam — reads stay up for verification) and the worker refuses to boot
  // (no schedules/consumers/relay). Cutover = unset this and redeploy.
  // See docs/operations/backup-and-lifecycle.md.
  RESTORE_MODE: z.literal('isolated').optional(),
  // REG-01: immutable logical cell recorded by the backup/restore selection.
  // Required in restore-isolated mode and must equal PROCESSING_CELL; a backup
  // from another cell may only be inspected in a separately declared target.
  RESTORE_SOURCE_CELL: z.enum(DATA_CELL_IDS).optional(),
  // REG-04: exact provider restore point bound into the durable recovery
  // generation. Optional at normal boot; ops:restore-verify requires it.
  RESTORE_POINT_AT: z.iso.datetime({ offset: true }).optional(),
  // REG-04: exact Railway PITR sibling selected by the operator. Railway
  // creates `<source>-restored-YYYYMMDD-HHMM`; restore commands bind this
  // name to DATABASE_URL's private Railway hostname and refuse public/source
  // targets. Not needed for loopback drills.
  RESTORE_DATABASE_SERVICE_NAME: z.string().min(1).optional(),
  // Railway-provided deployment identity. Optional for local/dev; the restore
  // target guard requires all three for a non-loopback PITR verifier.
  RAILWAY_PROJECT_ID: z.string().min(1).optional(),
  RAILWAY_ENVIRONMENT_ID: z.string().min(1).optional(),
  RAILWAY_ENVIRONMENT_NAME: z.string().min(1).optional(),
  // BQC-7.8: dead-letter quarantine entry TTL (days). The quarantine queue
  // has no consumer by design — without a TTL, redacted envelopes accumulate
  // forever. The quarantine-ttl-sweep job (daily) removes entries older than
  // this via job.remove() (never obliterate/clean), one content-free log line
  // + a retention_runs evidence row (subject 'quarantine.ttl') per run. The
  // 24h queue.quarantine-growth alert (operator redrive SLA) is orthogonal
  // and unchanged — the TTL is the last-resort bound, not the SLA.
  QUARANTINE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  // ── BQC-6.5: operator sandbox seam (optional provider endpoint overrides) ──
  // Explicit per-endpoint overrides applied ONCE at container build on top of
  // the cell's approved provider endpoints (composition.ts
  // applyProviderEndpointOverrides). Legitimate operator use: point a sandbox
  // deployment at a provider stub/sandbox instead of production Google. Every
  // override ABSENT = the approved 'gbp-default' endpoints, byte-identical to
  // the pre-seam behavior. These are endpoint URLs only — the app still runs
  // its REAL adapters against whatever they point at (no fake injection).
  GOOGLE_PROVIDER_ENDPOINT_PROFILE: z
    .enum(['production-fixed', 'local-sandbox'])
    .default('production-fixed'),
  GBP_ACCOUNT_MANAGEMENT_BASE_URL: z.url().optional(),
  GBP_API_BASE_URL: z.url().optional(),
  GBP_PERFORMANCE_BASE_URL: z.url().optional(),
  GBP_REVIEWS_API_BASE_URL: z.url().optional(),
  GBP_NOTIFICATIONS_API_BASE_URL: z.url().optional(),
  GOOGLE_OAUTH_TOKEN_URL: z.url().optional(),
  GOOGLE_OAUTH_JWKS_URL: z.url().optional(),
  GOOGLE_OAUTH_REVOKE_URL: z.url().optional(),
})

const envSchema = baseEnvSchema.superRefine((env, context) => {
  // A production auth origin controls trusted-origin checks, callback URLs,
  // and the Secure attribute on session cookies. Refuse the deployment before
  // either web or worker starts if a configuration mistake would make those
  // cookies eligible for plaintext transport.
  if (
    env.NODE_ENV === 'production' &&
    new URL(env.BETTER_AUTH_URL).protocol !== 'https:'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['BETTER_AUTH_URL'],
      message: 'Production BETTER_AUTH_URL must use HTTPS',
    })
  }
  if (env.RESTORE_MODE === 'isolated' && !env.RESTORE_SOURCE_CELL) {
    context.addIssue({
      code: 'custom',
      path: ['RESTORE_SOURCE_CELL'],
      message: 'Restore-isolated mode requires the backup source Data Cell',
    })
  } else if (
    env.RESTORE_MODE === 'isolated' &&
    env.RESTORE_SOURCE_CELL !== env.PROCESSING_CELL
  ) {
    context.addIssue({
      code: 'custom',
      path: ['RESTORE_SOURCE_CELL'],
      message: 'Restore source Data Cell must match PROCESSING_CELL',
    })
  }
})

export type Env = z.infer<typeof envSchema>

let _env: Env | undefined

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env)
    if (!parsed.success) {
      const errors = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      // Startup-time assertion (not domain/application logic).
      // Plain Error is acceptable here — tagged errors are for domain and application layers.
      throw new Error(`[CONFIG] Invalid environment variables:\n${errors}`)
    }
    _env = parsed.data
  }
  return _env
}

/** Reset cached env — useful for tests */
export function resetEnv(): void {
  _env = undefined
}

/**
 * BQC-7.3 (release.sha): the deploy identity — RELEASE_SHA, else Railway's
 * injected commit SHA, else 'unknown'. Logged at boot and exposed in the
 * OperationsSnapshot.
 */
export function getReleaseSha(env: Env = getEnv()): string {
  return env.RELEASE_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown'
}
