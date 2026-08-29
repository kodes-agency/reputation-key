// ARC-03-T14 — the executable allowlist of ambient runtime configuration reads.
//
// Program work item 6: "Inject parsed config, clock, ID generation, Redis, URLs,
// credentials, and discovery interval; ban ambient re-read in use cases/builds
// except at the composition boundary."
//
// A ban that is only written down is a convention. This is the machine-checked
// version: every production file under src/ (and server/) that calls `getEnv(`
// or touches `process.env` must appear below WITH A REASON, and the conformance
// case in runtime-config-injection.test.ts fails on anything undeclared.
//
// Two structural rules, also enforced there:
//   * No entry may live under src/routes/** or src/contexts/**. Those are entry
//     points and context internals; they take configuration from the container
//     or from the ONE request-edge owner
//     (src/shared/config/request-runtime-config.ts).
//   * A `server_plugin` entry may read configuration, but never at MODULE SCOPE:
//     a module-load read binds the plugin to import order, which is exactly what
//     stopped a process fixture from booting one with a fixed environment.

export type AmbientRuntimeReadCategory =
  /** The composition boundary itself — the place allowed to resolve config. */
  | 'composition_boundary'
  /** A process-scoped resource singleton (pool, queue, redis, logger). */
  | 'process_resource'
  /** A process-scoped constant table, pure and stateless. */
  | 'process_constant'
  /** A standalone process entry point with no container (CLI, worker bootstrap). */
  | 'process_entry_point'
  /** A Nitro server plugin. Permitted, but only INSIDE the plugin body. */
  | 'server_plugin'
  /** Ambient value used only as the DEFAULT of an injectable parameter. */
  | 'injectable_default'
  /** Build-time constant replaced by the bundler in the browser bundle. */
  | 'bundler_constant'

export type AmbientRuntimeRead = Readonly<{
  /** Repository-relative path. */
  file: string
  category: AmbientRuntimeReadCategory
  /** WHY this file may read ambient configuration. Not optional. */
  reason: string
}>

export const AMBIENT_RUNTIME_READ_AUTHORITY: readonly AmbientRuntimeRead[] = [
  {
    file: 'src/composition.ts',
    category: 'composition_boundary',
    reason:
      'The Application Container is where configuration is resolved. The only ambient read left is the process environment handed to sidecar provider runtimes, and it is overridable via options.runtimeEnvironment.',
  },
  {
    file: 'src/shared/config/request-runtime-config.ts',
    category: 'composition_boundary',
    reason:
      'The ONE owner of configuration for HTTP entry points, which are reached by the framework rather than composed and therefore hold no container. Reads inside the call, never at module load.',
  },
  {
    file: 'src/worker/index.ts',
    category: 'process_entry_point',
    reason:
      'The worker process entry point resolves configuration once before building its Application Container.',
  },
  {
    file: 'src/shared/auth/auth-cli.ts',
    category: 'process_entry_point',
    reason:
      'Standalone better-auth CLI entry point. It never runs inside an application process and has no container to take configuration from.',
  },
  {
    file: 'src/shared/db/pool.ts',
    category: 'process_resource',
    reason:
      'Process-scoped PostgreSQL pool. BQC-7.1: the production build bundles this module twice, so one process-level binding is required — a per-container pool would recreate the duplicate-pool defect.',
  },
  {
    file: 'src/shared/cache/redis.ts',
    category: 'process_resource',
    reason:
      'Process-scoped Redis connection, same duplicate-bundle rationale as the pool.',
  },
  {
    file: 'src/shared/jobs/queue.ts',
    category: 'process_resource',
    reason:
      'Process-scoped BullMQ queue connections. Each queue holds a dedicated Redis connection; per-container queues would multiply them.',
  },
  {
    file: 'src/shared/jobs/redis-runtime.ts',
    category: 'process_resource',
    reason: 'Job Redis runtime verification for the process-scoped queue connections.',
  },
  {
    file: 'src/shared/jobs/worker.ts',
    category: 'process_resource',
    reason: 'BullMQ worker connection settings for the process-scoped queue runtime.',
  },
  {
    file: 'src/shared/observability/logger.ts',
    category: 'process_resource',
    reason:
      'Process-scoped logger. Logging must work before, during and after container construction, including while construction is failing.',
  },
  {
    file: 'src/shared/auth/auth.ts',
    category: 'process_resource',
    reason:
      'The better-auth instance is a process singleton by construction. ARC-03-T13 put its session operations behind an Identity-owned port so nothing else calls it directly.',
  },
  {
    file: 'src/shared/auth/beta-capabilities.ts',
    category: 'process_constant',
    reason:
      'Capability posture. BLOCKED_CAPABILITIES and the RESTORE_ISOLATED_STORE precedence must stay byte-identical — every dark capability depends on it — so this file is deliberately frozen rather than refactored.',
  },
  {
    file: 'src/shared/auth/emails.ts',
    category: 'process_constant',
    reason:
      'Transactional email sender configuration, resolved once for the process-scoped provider client.',
  },
  {
    file: 'src/shared/auth/tenant-resolver.ts',
    category: 'process_constant',
    reason:
      'Tenant resolution runs inside request middleware that predates any container lookup on a cold boot.',
  },
  {
    file: 'src/shared/security/client-ip.ts',
    category: 'process_constant',
    reason:
      'Trusted-proxy configuration for the request edge, evaluated before any container is reachable.',
  },
  {
    file: 'src/shared/security/security-headers.ts',
    category: 'injectable_default',
    reason:
      'ARC-03-T14 gave getSecurityHeaders an explicit `env` argument. The single remaining ambient read is the documented fallback for the Nitro response hook, which runs outside every container.',
  },
  {
    file: 'src/shared/rate-limit/middleware.ts',
    category: 'injectable_default',
    reason:
      'Ambient NODE_ENV is only the DEFAULT of the injectable `failClosed` option; callers that know their posture pass it explicitly.',
  },
  {
    file: 'src/shared/health/operations-snapshot.ts',
    category: 'injectable_default',
    reason:
      'Ambient value backs an optional parameter of the operational read; the container passes its own configuration.',
  },
  {
    file: 'src/shared/outbox/cutover-flags.ts',
    category: 'injectable_default',
    reason:
      'process.env appears only as the default value of the injectable `env` parameter.',
  },
  {
    file: 'src/shared/observability/telemetry.ts',
    category: 'injectable_default',
    reason:
      'process.env appears only as the default value of the injectable observability environment parameter.',
  },
  {
    file: 'src/shared/release/railway-project-service-isolation.ts',
    category: 'injectable_default',
    reason:
      'process.env appears only as the default value of the injectable `environment` parameter for release checks.',
  },
  {
    file: 'src/components/hooks/web-vitals.ts',
    category: 'bundler_constant',
    reason:
      'process.env.NODE_ENV in a browser module is replaced by the bundler at build time; there is no runtime process to read.',
  },
  {
    file: 'server/plugins/request-guard.ts',
    category: 'server_plugin',
    reason:
      'Body-size and cell guard for the request edge. Nitro plugins boot before any Application Container exists; the read happens inside the plugin body.',
  },
  {
    file: 'server/plugins/production-secret-guard.ts',
    category: 'server_plugin',
    reason:
      'Refuses to boot a production server with missing or placeholder secrets. It must run before anything else can observe configuration.',
  },
  {
    file: 'server/plugins/release-identity-guard.ts',
    category: 'server_plugin',
    reason:
      'Refuses to boot a server whose release identity is absent or inconsistent, before any container is built.',
  },
  {
    file: 'server/plugins/redis-runtime-guard.ts',
    category: 'server_plugin',
    reason:
      'Verifies the Redis runtime posture at server boot, before the first request can reach a container.',
  },
  {
    file: 'server/plugins/restore-mode-guard.ts',
    category: 'server_plugin',
    reason:
      'Enforces restore-isolation posture at server boot; it gates every request and therefore cannot depend on a container.',
  },
] as const

/**
 * Import-time initialisation that is NOT an ambient configuration read and is
 * therefore deliberately absent from the authority above, but still needs a
 * recorded decision: these modules build a pure, stateless table at import time.
 * They hold no runtime state, so a second container in the same process cannot
 * observe a different one.
 */
export const PROCESS_SCOPED_IMPORT_TIME_TABLES: readonly AmbientRuntimeRead[] = [
  {
    file: 'src/shared/auth/permissions.ts',
    category: 'process_constant',
    reason:
      'initPermissionTable() runs at import time by design and is pure; the module comment explicitly warns against moving it into a bootstrap() call. It reads no environment.',
  },
] as const

const BY_FILE: ReadonlyMap<string, AmbientRuntimeRead> = new Map(
  AMBIENT_RUNTIME_READ_AUTHORITY.map((entry) => [entry.file, entry]),
)

export function isAmbientRuntimeReadDeclared(file: string): boolean {
  return BY_FILE.has(file)
}

/** Prefixes whose files may never appear in the authority. */
export const AMBIENT_RUNTIME_READ_FORBIDDEN_PREFIXES = [
  'src/routes/',
  'src/contexts/',
] as const
