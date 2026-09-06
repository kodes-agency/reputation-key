import { z } from 'zod/v4'
import { isRailwayPitrDatabaseUrl } from '#/shared/config/restore-mode'

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
  // RFC 8058 bearer-capability signing keys shared by the web and worker.
  // Optional at schema level for expand/configure/cutover:
  // optional mail refuses to send and the endpoint returns 503 while absent.
  // Format: active-plus-retained versioned HMAC keys (v2:<64-hex>,v1:<64-hex>).
  NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS:
    process.env.NODE_ENV === 'production'
      ? z.string().max(195).optional()
      : z
          .string()
          .max(195)
          .default(`dev:${'01'.repeat(32)}`),
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
  // Dedicated BullMQ Redis. Required and physically distinct from REDIS_URL
  // by the production web/worker boot guard; dev/test may fall back to one.
  QUEUE_REDIS_URL: z.string().optional(),
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
  // D1 (2026-08-29): PRESENCE alone is also the composition root's
  // deployed-cell signal — applyProviderEndpointOverrides denies the
  // local-sandbox provider profile and every endpoint override on it. Never
  // set this outside a promotion: doing so breaks the local Compose stack,
  // which rehearses the production images against the sandbox on purpose.
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

  // S3-compatible object storage. Beta uses a private Railway bucket; the
  // AWS_S3_* names are retained because the adapter speaks the S3 protocol.
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

  // Error tracking — optional for local/test execution. A deployed production
  // process requires a Germany-ingestion DSN at the monitoring preload
  // boundary (shared/observability/telemetry.ts).
  SENTRY_DSN: z.url().optional(),
  // Optional source-map upload inputs. Railway exposes build variables to the
  // process environment too, but application runtime behavior never depends on
  // these values.
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
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
  // The Google egress runtime runs in THIS process (WP2.1). It used to be two
  // sidecars reached over mTLS, which is why an origin, a server name and a
  // private CA triplet — in two encodings, eight variables in all — used to
  // live here. What remains is what the runtime actually needs: the two HMAC
  // secrets it signs with and the identity its permits are bound to. All three
  // are all-or-none, validated by the composition root.
  GOOGLE_EGRESS_GATEWAY_IDENTITY: z.string().min(1).optional(),
  GOOGLE_ADMISSION_GRANT_HMAC_KEYS: z.string().optional(),
  GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: z.string().optional(),

  // Settlement-receipt and provenance verification keyrings. The transport that
  // used to sit beside them here — gateway origin, server name and three mTLS
  // blobs — went with the sidecars in WP2.3.
  AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON: z.string().max(65_536).optional(),
  AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON: z.string().max(65_536).optional(),
  AI_KEY_INVENTORY_PROFILE: z.enum(['production-v1', 'local-stack-v1']).optional(),
  // Worker-only keyed pseudonym authority for durable AI operation subjects.
  AI_SUBJECT_HMAC_KEYS: z.string().max(195).optional(),

  // WP2.3 — the AI egress gateway and execution admission sidecars used to read
  // these from their own container environments. The collapse puts both in this
  // process, so they become part of the parsed contract rather than raw
  // `process.env` reads inside a bootstrap.
  OPENAI_API_KEY: z.string().min(1).max(512).optional(),
  AI_REQUEST_BINDING_HMAC_KEYS: z.string().max(4_096).optional(),
  AI_SAFETY_IDENTIFIER_HMAC_KEYS: z.string().max(4_096).optional(),
  AI_ADMISSION_ED25519_PRIVATE_KEY_B64: z.string().max(4_096).optional(),
  AI_ADMISSION_ED25519_KID: z.string().max(64).optional(),
  AI_PROVENANCE_ED25519_PRIVATE_KEY_B64: z.string().max(4_096).optional(),
  AI_PROVENANCE_ED25519_KID: z.string().max(64).optional(),
  // Local rehearsal only: sends provider calls to the Compose `ai-provider-stub`
  // instead of api.openai.com. Deliberately a SELECTOR and not a URL — the stub
  // address is compiled into `ai-provider-control/local-provider-fetch.ts`, so no
  // environment value can retarget where the provider key and merchant content
  // go. Refused in a deployed cell (see composition/ai-egress-runtime.ts).
  AI_PROVIDER_LOCAL_STUB: z.enum(['enabled']).optional(),

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
  // goal.use,portal.write,notification.send_email
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
  // REG-04: exact provider restore point bound into the durable recovery
  // generation. Optional at normal boot; ops:restore-verify requires it.
  RESTORE_POINT_AT: z.iso.datetime({ offset: true }).optional(),
  // REG-04: exact Railway PITR sibling selected by the operator. Railway
  // creates `<source>-restored-YYYYMMDD-HHMM`; restore commands bind this
  // name to DATABASE_URL's private Railway hostname and refuse public/source
  // targets. Loopback drills must also name their explicit disposable target.
  RESTORE_DATABASE_SERVICE_NAME: z.string().min(1).optional(),
  // Restore-only, one-shot Review lifecycle recovery authority. These three
  // values are all-or-none and are refused outside RESTORE_MODE=isolated.
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: z
    .string()
    .min(1)
    .max(128 * 1024)
    .optional(),
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON: z
    .string()
    .min(1)
    .max(64 * 1024)
    .optional(),
  // REG-04: permanent serving attestation for a Railway PITR sibling. The
  // isolated verifier prints this exact recovery run/generation pair. Once
  // RESTORE_MODE is removed, web and worker boot query the sibling database
  // and refuse traffic/effects unless the pair names its latest recovery run.
  RECOVERY_CUTOVER_RUN_ID: z.uuid().optional(),
  RECOVERY_CUTOVER_GENERATION: z.coerce.number().int().min(1).optional(),
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

/**
 * Whether a production auth origin is safe to put session cookies on.
 *
 * HTTPS everywhere it can be reached over a network — that is the whole point
 * of the check below. The exception is a LOOPBACK origin, and it is not a
 * loosening: traffic to 127.0.0.1 / [::1] / localhost never leaves the machine,
 * so there is no plaintext transport to protect. Browsers reason the same way,
 * treating loopback as a potentially-trustworthy origin (W3C Secure Contexts)
 * and honouring `Secure` cookies on it.
 *
 * Without this, the local Compose stack cannot exist: it runs the PRODUCTION
 * images (`NODE_ENV=production` is baked into them) against
 * `http://127.0.0.1:3000`, because terminating TLS in front of a loopback
 * rehearsal buys nothing. The e2e stack refused to seed for exactly this
 * reason. A deployed cell is unaffected — its origin is a public hostname, and
 * a public hostname on `http:` is still refused.
 */
function isSecureAuthOrigin(origin: URL): boolean {
  if (origin.protocol === 'https:') return true
  if (origin.protocol !== 'http:') return false
  const host = origin.hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.localhost')
  )
}

const envSchema = baseEnvSchema.superRefine((env, context) => {
  // A production auth origin controls trusted-origin checks, callback URLs,
  // and the Secure attribute on session cookies. Refuse the deployment before
  // either web or worker starts if a configuration mistake would make those
  // cookies eligible for plaintext transport.
  if (
    env.NODE_ENV === 'production' &&
    !isSecureAuthOrigin(new URL(env.BETTER_AUTH_URL))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['BETTER_AUTH_URL'],
      message: 'Production BETTER_AUTH_URL must use HTTPS',
    })
  }
  if (
    (env.RECOVERY_CUTOVER_RUN_ID === undefined) !==
    (env.RECOVERY_CUTOVER_GENERATION === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['RECOVERY_CUTOVER_RUN_ID'],
      message: 'Recovery cutover run ID and generation must be configured together',
    })
  }
  const reviewRecoveryApprovalConfigured = [
    env.REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON,
    env.REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256,
    env.REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON,
  ].filter((value) => value !== undefined).length
  if (reviewRecoveryApprovalConfigured !== 0 && reviewRecoveryApprovalConfigured !== 3) {
    context.addIssue({
      code: 'custom',
      path: ['REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON'],
      message:
        'Review lifecycle recovery approval bundle, digest, and public keys must be configured together',
    })
  } else if (reviewRecoveryApprovalConfigured === 3 && env.RESTORE_MODE !== 'isolated') {
    context.addIssue({
      code: 'custom',
      path: ['REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON'],
      message:
        'Review lifecycle recovery approval authority is allowed only in restore-isolated mode',
    })
  }
  if (
    env.RESTORE_MODE !== 'isolated' &&
    isRailwayPitrDatabaseUrl(env.DATABASE_URL) &&
    (env.RECOVERY_CUTOVER_RUN_ID === undefined ||
      env.RECOVERY_CUTOVER_GENERATION === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['RECOVERY_CUTOVER_RUN_ID'],
      message:
        'A Railway PITR sibling may serve only with its recovery cutover run ID and generation',
    })
  }
})

export type Env = z.infer<typeof envSchema>

let _env: Env | undefined

export function parseEnvironment(
  input: NodeJS.ProcessEnv | Record<string, unknown>,
): Env {
  const parsed = envSchema.safeParse(input)
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    // Startup-time assertion (not domain/application logic).
    // Plain Error is acceptable here — tagged errors are for domain and application layers.
    throw new Error(`[CONFIG] Invalid environment variables:\n${errors}`)
  }
  return parsed.data
}

export function getEnv(): Env {
  if (!_env) {
    _env = parseEnvironment(process.env)
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
