// BQC-4.3 — provider target selection + control-plane content-safety guards.
//
// Phase BQC-4 §4.3 + ADR 0048/0031: region-specific provider adapters are
// selected only by ProcessingTarget (the router's CELL_TARGETS carry a logical
// provider REFERENCE; the composition root maps it to construction config).
// These static scans prove the two no-fallback properties the runtime tests
// cannot see:
//
//   1. Google/GBP endpoint URLs exist ONLY in the composition provider
//      mapping (providerConfigFor) — no context adapter hardcodes a Google
//      URL, so no adapter can silently call an alternate endpoint/region.
//   2. No adapter carries a fallback identifier or a second endpoint
//      constant — provider unavailability must surface as
//      retry/degraded/blocked (3.3/3.6/3.7), never another-region execution.
//   3. Each provider adapter factory has exactly ONE construction site.
//   4. The global observability surface (health routes + health-metrics +
//      queue-depth + worker-heartbeat) never touches content columns.
//   5. The activity context never reads content-bearing event fields
//      (activity_log stays identifier/subject refs — ADR 0045).
//
// Runtime halves of these proofs live in:
//   - src/composition.test.ts (providerConfigFor fails closed)
//   - src/shared/observability/health-metrics.test.ts (marker-content proof)
//   - src/contexts/activity/infrastructure/event-handlers/activity-content-safety.test.ts

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Recursively list .ts files under dir, excluding test files. */
function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkSource(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

/**
 * Strip line and block comments so scans target CODE, not prose. Comments
 * documenting the no-fallback/content-safety policy legitimately use words
 * like 'fallback' or 'payload' — they cannot execute.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const ALL_SOURCE = walkSource(SRC).filter(
  // Test fakes/fixtures legitimately cite Google scope URLs; they never
  // construct production adapters.
  (f) => !rel(f).startsWith('src/shared/testing/'),
)

const GOOGLE_HOST = /googleapis\.com/

describe('BQC-4.3: Google endpoint URLs live only in the composition provider mapping', () => {
  it('no source file outside the approved exceptions contains a Google endpoint URL', () => {
    const APPROVED_EXCEPTIONS = new Set([
      // The providerConfigFor mapping itself — the ONE place endpoint URLs exist.
      'src/composition.ts',
      // OAuth SCOPE identifiers (https://www.googleapis.com/auth/...) — permission
      // grant names, not endpoints an adapter could fall back to.
      'src/contexts/integration/application/use-cases/get-google-auth-url.ts',
      // JWKS URI for INBOUND Pub/Sub webhook signature verification — not
      // outbound provider execution; shared/auth cannot import the composition
      // root (zone boundary), documented in the data-flow map.
      'src/shared/auth/pubsub-jwt.verifier.ts',
    ])

    const offenders = ALL_SOURCE.filter((f) => GOOGLE_HOST.test(readFileSync(f, 'utf-8')))
      .map(rel)
      .filter((path) => !APPROVED_EXCEPTIONS.has(path))

    expect(offenders, `Google endpoint URLs outside composition: ${offenders}`).toEqual(
      [],
    )
  })

  it('the composition mapping really contains the GBP/Google endpoint URLs (guard is not vacuous)', () => {
    const composition = readFileSync(join(SRC, 'composition.ts'), 'utf-8')
    expect(composition).toContain(
      'https://mybusinessbusinessinformation.googleapis.com/v1',
    )
    expect(composition).toContain('https://mybusiness.googleapis.com/v4')
    expect(composition).toContain('https://mybusinessnotifications.googleapis.com/v1')
    expect(composition).toContain('https://oauth2.googleapis.com/token')
  })
})

describe('BQC-4.3: provider adapters carry no hardcoded URL and no fallback path', () => {
  const adapterFiles = walkSource(join(SRC, 'contexts'))
    .filter((f) => rel(f).includes('/infrastructure/adapters/'))
    .filter((f) => rel(f).startsWith('src/contexts/integration/'))

  it('finds the integration adapter files (guard is not vacuous)', () => {
    const names = adapterFiles.map(rel)
    expect(names).toContain(
      'src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts',
    )
    expect(names).toContain(
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
    )
    expect(names).toContain(
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
    )
    expect(names).toContain(
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
    )
  })

  it('no integration adapter contains a Google URL, a fallback identifier, or an alternate-endpoint constant', () => {
    const ALTERNATE_ENDPOINT =
      /\b(ALT|ALTERNATE|SECONDARY|BACKUP|FALLBACK)_[A-Z0-9_]*(URL|BASE|ENDPOINT)/
    const violations: string[] = []
    for (const file of adapterFiles) {
      const body = stripComments(readFileSync(file, 'utf-8'))
      if (GOOGLE_HOST.test(body)) violations.push(`${rel(file)}: hardcoded Google URL`)
      if (/fallback/i.test(body)) violations.push(`${rel(file)}: 'fallback' identifier`)
      if (ALTERNATE_ENDPOINT.test(body))
        violations.push(`${rel(file)}: alternate-endpoint constant`)
    }
    expect(violations).toEqual([])
  })

  it('no adapter catches a provider error and retries against a second endpoint (single base URL per adapter)', () => {
    // Post-4.3 adapters receive exactly one base URL via construction config;
    // a second https:// literal in an adapter file is the signature of an
    // endpoint switch.
    const violations: string[] = []
    for (const file of adapterFiles) {
      const body = stripComments(readFileSync(file, 'utf-8'))
      const urls = body.match(/https:\/\/[^\s'"`]+/g) ?? []
      if (urls.length > 0)
        violations.push(
          `${rel(file)}: ${urls.length} hardcoded URL(s): ${urls.join(', ')}`,
        )
    }
    expect(violations).toEqual([])
  })
})

describe('BQC-4.3: exactly one provider construction site per adapter factory', () => {
  const FACTORIES: ReadonlyArray<readonly [string, string]> = [
    ['createGbpApiAdapter', 'src/contexts/integration/build.ts'],
    // BQC-5.2: the integration build module owns the adapter (was composition).
    ['createGoogleReviewApiAdapter', 'src/contexts/integration/build.ts'],
    ['createMyBusinessNotificationsAdapter', 'src/contexts/integration/build.ts'],
    ['createGoogleOAuthAdapter', 'src/contexts/integration/build.ts'],
  ]

  it.each(FACTORIES)('%s is constructed exactly once, in %s', (factory, expectedFile) => {
    // `factory(` — matches call sites only: the definition is `factory = (` and
    // imports carry no paren.
    const callPattern = new RegExp(`\\b${factory}\\(`, 'g')
    const callSites = ALL_SOURCE.filter((f) =>
      callPattern.test(readFileSync(f, 'utf-8')),
    ).map(rel)
    expect(callSites).toEqual([expectedFile])
  })
})

describe('BQC-4.3: the global observability surface never touches content columns', () => {
  // Content-bearing column identifiers that must never appear on the health /
  // metrics surface. Word-bounded to avoid matching aggregate aliases.
  const CONTENT_COLUMNS =
    /\b(payload|reviewText|replyText|noteText|reviewerName|reviewerProfilePhotoUrl|googleAttribution|comment|text)\b/

  it('health route files select no content columns and import no schema tables', () => {
    const healthRoutes = walkSource(join(SRC, 'routes', 'api', 'health'))
    expect(healthRoutes.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of healthRoutes) {
      const body = stripComments(readFileSync(file, 'utf-8'))
      if (CONTENT_COLUMNS.test(body))
        violations.push(`${rel(file)}: content column reference`)
      if (/#\/shared\/db\/schema\//.test(body))
        violations.push(`${rel(file)}: direct schema import`)
    }
    expect(violations).toEqual([])
  })

  it('health-metrics, queue-depth, and worker-heartbeat read counts/ages only', () => {
    const observabilityFiles = [
      'src/shared/observability/health-metrics.ts',
      'src/shared/health/queue-depth.ts',
      'src/shared/health/worker-heartbeat.ts',
    ]
    const violations: string[] = []
    for (const path of observabilityFiles) {
      const body = stripComments(readFileSync(join(ROOT, path), 'utf-8'))
      if (CONTENT_COLUMNS.test(body)) violations.push(`${path}: content column reference`)
    }
    expect(violations).toEqual([])
  })
})

describe('BQC-4.3: the activity context never reads content-bearing event fields', () => {
  it('no activity source file accesses review/reply/note content fields', () => {
    const activitySource = walkSource(join(SRC, 'contexts', 'activity'))
    expect(activitySource.length).toBeGreaterThan(0)
    const CONTENT_FIELD_ACCESS =
      /\bevent\.(text|reviewText|replyText|comment|noteText|reviewerName|reviewerProfilePhotoUrl|snippet|feedback)\b/
    const offenders = activitySource
      .filter((f) => CONTENT_FIELD_ACCESS.test(readFileSync(f, 'utf-8')))
      .map(rel)
    expect(offenders).toEqual([])
  })
})
