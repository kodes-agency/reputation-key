// Production placeholder-secret boot guard (BQC-7.6).
//
// Test/CI environments boot on a canonical placeholder secret family
// (src/shared/testing/test-environment.ts, the CI workflow env blocks,
// .env.example examples). If any of those values leak into a PRODUCTION
// deployment, the deployment is running on public knowledge — every
// signed/encrypted artifact it produces is forgeable. This guard refuses to
// boot in that state.
//
// Scope: NODE_ENV === 'production' only. Development/test keep placeholders
// (the canonical test env IS the placeholder family — the guard would
// otherwise make every test runner red).
//
// Wired at both process boot paths:
//   - web: server/plugins/production-secret-guard.ts (nitro plugin, first in
//     the vite.config.ts plugins array — throws during plugin init, so the
//     server never accepts traffic).
//   - worker: src/worker/index.ts, next to the capability boot guard.
//
// Detection: exact match against the known family + substring markers +
// low-entropy heuristics. The thrown error names offending FIELDS only —
// never the matched values (the failure must be safe to paste into a ticket).

/** Exact known placeholder/test values (test env builder, CI, .env.example). */
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  // CI workflow env blocks (.github/workflows/ci.yml, simulation.yml)
  'test-secret-at-least-32-characters-long-for-ci',
  'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
  'aabbccddaabbccddaabbccddaabbccdd',
  're_ci_test_key_placeholder',
  // Canonical test environment (src/shared/testing/test-environment.ts)
  'test-test-test-test-test-test-test-test',
  're_test_key_for_testing_only',
  're_test_key',
  'ci-placeholder-client-id',
  'ci-placeholder-client-secret',
  'ci-placeholder',
  'e2e-ops-metrics-token-0123456789abcdef',
  // .env.example documented examples
  'replace-me-with-a-long-random-secret-min-32-chars',
  'xxxxxxxx.apps.googleusercontent.com',
  'GOCSPX-xxxxxxxxxxxxxxxxxxxx',
  'dev-only-salt-not-for-production',
])

/** Substring markers — catch variants of the documented placeholder shapes. */
const PLACEHOLDER_MARKERS = [
  'placeholder',
  'test-secret',
  'test-test-test',
  're_test_key',
  'dev-only',
  'replace-me',
] as const

/** Secret-bearing env fields the guard inspects (names only ever logged). */
const SECRET_FIELDS = [
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ENCRYPTION_KEY',
  'OAUTH_STATE_SECRET',
  'GUEST_SESSION_SALT',
  'REVIEW_PROVIDER_SUBJECT_HMAC_KEYS',
  'REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS',
  'NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS',
  'OPS_METRICS_TOKEN',
] as const

export type ProductionSecretsEnv = Readonly<{
  NODE_ENV?: string
}> &
  Readonly<Partial<Record<(typeof SECRET_FIELDS)[number], string>>>

/** True when a value matches the placeholder/test family. */
function isPlaceholderSecret(value: string): boolean {
  if (KNOWN_PLACEHOLDERS.has(value)) return true
  const lower = value.toLowerCase()
  if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) return true
  // Low-entropy: one repeated character ('aaaa…', '0000…') or a short unit
  // repeated 4+ times ('abab…', 'aabbccdd…' — the .env.example / test-env /
  // CI filler shapes). Periodic repetition never occurs in real secrets.
  if (/^(.{1,8})\1{3,}$/.test(value)) return true
  return false
}

/**
 * Names of secret fields whose values match the placeholder/test family.
 * Field names only — values never leave this function.
 */
export function findPlaceholderSecrets(env: ProductionSecretsEnv): string[] {
  const flagged: string[] = []
  for (const field of SECRET_FIELDS) {
    const value = env[field]
    if (value === undefined) continue
    const candidates =
      field.endsWith('_HMAC_KEYS') ||
      field === 'REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS'
        ? value.split(',').map((entry) => entry.slice(entry.indexOf(':') + 1))
        : [value]
    if (candidates.some(isPlaceholderSecret)) flagged.push(field)
  }
  return flagged
}

/**
 * Refuse to boot a production process carrying placeholder/test secrets.
 * No-op outside production. Throws one error naming every offending field.
 */
export function assertProductionSecrets(env: ProductionSecretsEnv): void {
  if (env.NODE_ENV !== 'production') return
  const flagged = findPlaceholderSecrets(env)
  if (flagged.length === 0) return
  throw new Error(
    `[CONFIG] Production boot refused — ${flagged.length} secret(s) match known ` +
      `placeholder/test values: ${flagged.join(', ')}. ` +
      'Generate real secrets (openssl rand -hex 32) and set them as deployment ' +
      'variables. See docs/operations/runbooks.md (security posture).',
  )
}
