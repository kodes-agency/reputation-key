// BQC-5.10 — Context acceptance matrix (the executable acceptance checklist).
//
// Mode (phase doc §5.10): this suite PROMOTES the owning BQC-1…4 interface
// pins into the architecture acceptance matrix below. It does NOT implement
// missing product behavior — a failing row returns to its owner and the
// matrix reruns after the owner fix lands (the rerun rule).
//
// The 17 rows ("enabled/limited" = live behind bounded interfaces;
// "default-deny" = denied until promoted through persisted policy, failing
// closed — every default-deny context below is enabled and exercised in the
// closed beta). Reused pins carry the full proof; this file adds NEW pins only
// where no suite held the row.
//
//   #  Context      Verdict          Criterion (phase §5.10)                              Pin
//   1  Identity     enabled/limited  grant/public interface sole access source;           NEW grant sole-access scan (this file);
//                                     owner/session rules deterministic; invitation       content-free-facts register (F2 below)
//                                     content owned
//   2  Property     enabled/limited  lifecycle + processing profile behind command/       cross-context-public-api.test.ts;
//                                     query interfaces                                    NEW properties-table WATCH register
//   3  Integration  enabled/limited  Google adapter behind explicit port; jobs use        provider-target-selection.test.ts
//                                     JobRuntime/ProcessingRouter; no provider
//                                     construction in use cases
//   4  Review       enabled/limited  ReviewSourceLifecycle + atomic command module        atomic-review-outbox.test.ts,
//                                     authoritative                                       source-content-lifecycle, eligible-reads,
//                                                                                         command-stores
//   5  Inbox        enabled/limited  content-free workflow projection + applyOnce;        inbox constructors, inbox-command-store
//                                     source detail via authorized Review lookup          applyOnce, outbox-consumers
//   6  Dashboard    enabled/limited  governed bounded query/cache interface; no raw       attention-eligibility-equivalence,
//                                     expired data or direct DB routes                    read-facade-timeout
//   7  Metric       enabled/limited  idempotent content-free rollup; no review-derived    NEW rollup idempotency integration pin
//                                     staff gamification                                  (metric/.../incremental-rollup-idempotency.test.ts)
//   8  Notification enabled/limited  privacy-filtered in-app delivery; outbound non-auth  dark-capability-enforcement.test.ts,
//                                     email absent/dark                                   dark-context-matrix.test.ts
//   9  Activity     enabled/limited  collaboration facts separated from security audit;   activity-content-safety.test.ts,
//                                     no protected content payloads                       orphan-audit-handlers.test.ts;
//                                                                                         NEW sole-writer scans (this file)
//   10 Staff        enabled/limited  participation interface contains no authorization    NEW no-authZ scan (this file)
//                                     decision
//   11 Team         quarantined      no route/navigation/UI/consumer reachability;         NEW quarantine surface pin (this file),
//                                     retained reconciliation data; hard-denied capability dark-context-matrix, dark-capability-enforcement
//   12 Portal       default-deny     independent read/write/upload policy; no direct      portal-capability-taxonomy.test.ts,
//                                     BullMQ construction from application; public        dark-context-matrix
//                                     edge denied
//   13 Guest        default-deny     no Portal error dependency; public/session/media     dark-context-matrix; NEW no-portal-error
//                                     adapters unregistered/denied                        scan (this file)
//   14 Goal         default-deny     split build logic; injected clock; no active         dark-consumer-gating, dark-context-matrix
//                                     schedules/events
//   15 Badge        default-deny     deterministic evaluation; no active awards/          dark-consumer-gating, dark-context-matrix
//                                     workers/events
//   16 Leaderboard  default-deny     no active recompute/read/export; interface isolated  dark-consumer-gating, dark-context-matrix
//   17 AI           default-deny     no implementation imports/providers/jobs; only       NEW absence pin (this file)
//                                     approved governance interfaces
//
// Registered gaps (findings, NOT blockers — owned, returned to owner, unfixed here):
//   F1  replyRejected.reason → activity detail + notification body (owner: BQC-1)
//   F2  memberInvited.email → activity detail (owner: BQC-1)
//   F3  feedback comment lookup without retention clock (owner: BQC-1)
//   WATCH  properties-table direct reads by portal/badge/leaderboard repositories
//          bypassing property public-api (owners: Property + dark contexts)
//   Metric: isGamificationViolation has no production call-site (owner: Metric)
// Documented exceptions (accepted as-is):
//   identity grant-access-lookup.adapter.ts:30 ambient new Date() (owner: Identity)
//   goal.repository.ts:98 default clock (owner: Goal, dark)
//
// ENV self-sufficiency: several reused pins (dark-context-matrix,
// portal-capability-taxonomy) fail in a bare shell because the unit project
// defaults GOOGLE_CLIENT_ID/SECRET to '' and env validation requires non-empty
// values. This suite deliberately imports only node builtins + vitest, and it
// seeds CI-like dummies up front so no capability assertion can ever be masked
// by a config error instead of failing on the real regression. `||=` keeps real
// CI values; vitest's forks pool isolates the mutation to this file.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

process.env.GOOGLE_CLIENT_ID ||= 'ci-placeholder'
process.env.GOOGLE_CLIENT_SECRET ||= 'ci-placeholder'

const ROOT = process.cwd()

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full))
    } else {
      out.push(full)
    }
  }
  return out
}

/** Recursively list production .ts files under dir (tests excluded). */
function walkSource(dir: string): string[] {
  return walkFiles(dir).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  )
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

/**
 * Strip line and block comments so scans target CODE, not prose. Comments
 * legitimately name the very primitives being scanned for — they cannot execute.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function strippedSource(path: string): string {
  return stripComments(readFileSync(join(ROOT, path), 'utf-8'))
}

/** All production sources, comment-stripped, with repo-relative paths. */
const SOURCES = walkSource(join(ROOT, 'src'))
  .filter((f) => !rel(f).startsWith('src/shared/testing/'))
  .map((f) => ({ path: rel(f), body: stripComments(readFileSync(f, 'utf-8')) }))

/** Production files matching pattern, minus the allowed predicate's passes. */
function offendersMatching(
  pattern: RegExp,
  isAllowed: (path: string) => boolean,
): string[] {
  return SOURCES.filter(({ path, body }) => !isAllowed(path) && pattern.test(body)).map(
    ({ path }) => path,
  )
}

/** Reused pins the matrix references (full proof lives in these suites). */
const REUSED_PINS: Readonly<Record<string, string>> = {
  providerTargetSelection: 'src/shared/architecture/provider-target-selection.test.ts',
  atomicReviewOutbox: 'src/shared/architecture/atomic-review-outbox.test.ts',
  sourceContentLifecycle:
    'src/contexts/review/application/source-content-lifecycle.test.ts',
  eligibleReads: 'src/contexts/review/application/eligible-reads.test.ts',
  reviewCommandStore: 'src/contexts/review/infrastructure/review-command-store.test.ts',
  replyCommandStore: 'src/contexts/review/infrastructure/reply-command-store.test.ts',
  inboxConstructors: 'src/contexts/inbox/domain/constructors.test.ts',
  inboxCommandStore: 'src/contexts/inbox/infrastructure/inbox-command-store.test.ts',
  inboxOutboxConsumers: 'src/contexts/inbox/infrastructure/outbox-consumers.test.ts',
  attentionEligibilityEquivalence:
    'src/contexts/dashboard/infrastructure/repositories/attention-eligibility-equivalence.test.ts',
  readFacadeTimeout:
    'src/contexts/dashboard/infrastructure/repositories/read-facade-timeout.test.ts',
  darkCapabilityEnforcement: 'src/shared/auth/dark-capability-enforcement.test.ts',
  darkContextMatrix: 'src/shared/auth/dark-context-matrix.test.ts',
  portalCapabilityTaxonomy: 'src/shared/auth/portal-capability-taxonomy.test.ts',
  activityContentSafety:
    'src/contexts/activity/infrastructure/event-handlers/activity-content-safety.test.ts',
  orphanAuditHandlers:
    'src/contexts/activity/infrastructure/event-handlers/orphan-audit-handlers.test.ts',
  darkConsumerGating: 'src/shared/architecture/dark-consumer-gating.test.ts',
  contentFreeFacts: 'src/shared/architecture/content-free-facts.test.ts',
  crossContextPublicApi: 'src/shared/architecture/cross-context-public-api.test.ts',
  metricRollupIdempotency:
    'src/contexts/metric/infrastructure/repositories/incremental-rollup-idempotency.test.ts',
}

/**
 * WATCH register (owner: Property) — the sanctioned dark-context direct
 * readers of the properties table. These bypass property public-api; they are
 * a registered gap, not a violation today. Any NEW direct reader fails the
 * matrix; a reader fixed to go through the public-api must be removed here
 * (stale entries fail too — the rerun rule).
 */
export const PROPERTY_TABLE_WATCH_REGISTER: Readonly<Record<string, string>> = {
  'src/contexts/team/infrastructure/repositories/reconcile-people-team.repository.ts':
    'WATCH (owner Property): bounded people/team migration reconciliation reads property ownership directly',
  'src/contexts/badge/infrastructure/repositories/badge.repository.ts':
    'WATCH (owner Property): dark-context direct properties-table read bypassing property public-api',
  'src/contexts/leaderboard/infrastructure/repositories/leaderboard.repository.ts':
    'WATCH (owner Property): dark-context direct properties-table read bypassing property public-api',
}

const DARK_CONTEXT_DIRS = ['team', 'portal', 'guest', 'goal', 'badge', 'leaderboard']

const GRANT_TABLE_ACCESS =
  /property_access_grant\b|\bpropertyAccessGrant\b|property-access-grant\.repository/
const PROPERTIES_TABLE_ACCESS =
  /\b(?:from|innerJoin|leftJoin|rightJoin|fullJoin|join|insert|update|delete)\s*\(\s*properties\b|\b(?:FROM|JOIN|UPDATE|INTO)\s+properties\b/i
const ACTIVITY_LOG_WRITE =
  /\.\s*(?:insert|update|delete)\s*\(\s*activityLog\b|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+activity_log\b/i
const POLICY_AUDIT_WRITE =
  /\.\s*(?:insert|update|delete)\s*\(\s*policyDecisionAudit\b|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+policy_decision_audit\b/i
const AUTHZ_PRIMITIVES =
  /\bcan\s*\(|\bcanForContext\b|\bscopeForPermission\b|'(?:AccountAdmin|Staff)'/

describe('BQC-5.10 context acceptance matrix — reused pin files are present', () => {
  it.each(Object.entries(REUSED_PINS))('%s pin exists (%s)', (_name, path) => {
    expect(existsSync(join(ROOT, path)), `missing pin file: ${path}`).toBe(true)
  })
})

describe('row 1 — Identity (enabled/limited): property_access_grant sole access source', () => {
  it('no production file outside identity/** and shared/db/schema/** touches the grant table or its repository', () => {
    const offenders = offendersMatching(
      GRANT_TABLE_ACCESS,
      (p) =>
        p.startsWith('src/contexts/identity/') || p.startsWith('src/shared/db/schema/'),
    )
    expect(
      offenders,
      'grant-table access outside identity:\n' + offenders.join('\n'),
    ).toEqual([])
  })

  it('the sanctioned adapter-port path still reads the grant repository (guard is not vacuous)', () => {
    const adapter = strippedSource(
      'src/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter.ts',
    )
    expect(adapter).toContain('property-access-grant.repository')
  })
})

describe('row 2 — Property (enabled/limited): properties-table cross-context reads are a registered WATCH', () => {
  it('dark-context direct properties readers are exactly the sanctioned register', () => {
    const readers = offendersMatching(PROPERTIES_TABLE_ACCESS, (p) => {
      const ctx = /^src\/contexts\/([^/]+)\//.exec(p)?.[1]
      return !ctx || !DARK_CONTEXT_DIRS.includes(ctx)
    })
    expect(
      readers.sort(),
      'new dark-context properties-table reader (or stale register entry) — see PROPERTY_TABLE_WATCH_REGISTER',
    ).toEqual(Object.keys(PROPERTY_TABLE_WATCH_REGISTER).sort())
  })
})

describe('row 3 — Integration (enabled/limited): adapters behind ports, jobs on JobRuntime/ProcessingRouter', () => {
  it('the composition provider mapping and the integration adapter factories still exist', () => {
    expect(strippedSource('src/composition.ts')).toContain('providerConfigFor(')
    const build = strippedSource('src/contexts/integration/build.ts')
    expect(build).toContain('createGbpApiAdapter(')
    expect(build).toContain('createGoogleReviewApiAdapter(')
  })
})

describe('row 4 — Review (enabled/limited): ReviewSourceLifecycle + atomic command module authoritative', () => {
  it('the lifecycle and atomic command-store sources the pins exercise still exist', () => {
    for (const path of [
      'src/contexts/review/application/source-content-lifecycle.ts',
      'src/contexts/review/application/eligible-reads.ts',
      'src/contexts/review/infrastructure/review-command-store.ts',
      'src/contexts/review/infrastructure/reply-command-store.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `missing source under pin: ${path}`).toBe(true)
    }
  })
})

describe('row 5 — Inbox (enabled/limited): content-free projection + applyOnce; detail via authorized Review lookup', () => {
  it('the command-store port exposes applyOnce and detail enrichment uses the review lookup port', () => {
    expect(
      strippedSource('src/contexts/inbox/application/ports/inbox-command-store.port.ts'),
    ).toContain('applySourceCreatedOnce')
    expect(
      strippedSource(
        'src/contexts/inbox/infrastructure/repositories/inbox.repository.ts',
      ),
    ).toContain('reviewLookup.getReviewSnippetById')
  })
})

describe('row 6 — Dashboard (enabled/limited): governed bounded query/cache interface', () => {
  it('the read facade the dashboard pins exercise still exists', () => {
    expect(
      existsSync(join(ROOT, 'src/contexts/dashboard/infrastructure/read-facade.ts')),
    ).toBe(true)
  })
})

describe('row 7 — Metric (enabled/limited): idempotent content-free rollup; no staff gamification', () => {
  it('registered gap: isGamificationViolation still has no production call-site (owner: Metric)', () => {
    const callers = offendersMatching(
      /\bisGamificationViolation\b/,
      (p) => p === 'src/contexts/metric/domain/metric-registry.ts',
    )
    expect(
      callers,
      'isGamificationViolation gained a production call-site — owner must update this matrix row (rerun rule):\n' +
        callers.join('\n'),
    ).toEqual([])
  })
})

describe('row 8 — Notification (enabled/limited): in-app delivery; outbound non-auth email dark', () => {
  it('the worker still schedules the email jobs only behind notification.send_email', () => {
    expect(strippedSource('src/worker/index.ts')).toContain(
      `capability: 'notification.send_email'`,
    )
  })
})

describe('row 9 — Activity (enabled/limited): collaboration facts and security audit have sole writers', () => {
  // Retention sweep deletes via generic table-name config (no activity-specific
  // writer); the scans target write patterns, not the config string.
  it('only the activity drizzle repository writes activity_log', () => {
    expect(offendersMatching(ACTIVITY_LOG_WRITE, () => false)).toEqual([
      'src/contexts/activity/infrastructure/activity-repository.drizzle.ts',
    ])
  })

  it('only the identity audit repository writes policy_decision_audit', () => {
    expect(offendersMatching(POLICY_AUDIT_WRITE, () => false)).toEqual([
      'src/contexts/identity/infrastructure/repositories/policy-decision-audit.repository.ts',
    ])
  })
})

describe('row 10 — Staff (enabled/limited): participation interface carries no authorization decision', () => {
  const PARTICIPATION_SURFACES = [
    'src/contexts/staff/domain/staff-participation.ts',
    'src/contexts/staff/application/public-api.ts',
  ]

  it('participation domain + staff public-api contain no authZ primitives or role literals', () => {
    const offenders = PARTICIPATION_SURFACES.filter((p) =>
      AUTHZ_PRIMITIVES.test(strippedSource(p)),
    )
    expect(
      offenders,
      'authorization primitives on the staff participation surface:\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('guard is not vacuous — the participation surface exists and defines the lifecycle', () => {
    const domain = strippedSource(PARTICIPATION_SURFACES[0])
    expect(domain).toContain('StaffParticipation')
    expect(domain).toContain('archive')
  })
})

describe('row 11 — Team (quarantined): no executable beta product surface', () => {
  const REMOVED_TEAM_SURFACES = [
    'src/routes/_authenticated/team.tsx',
    'src/routes/_authenticated/properties/$propertyId/teams/index.tsx',
    'src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx',
    'src/routes/_authenticated/properties/$propertyId/teams/$teamId/index.tsx',
    'src/routes/_authenticated/properties/$propertyId/teams/$teamId/members.tsx',
  ]

  it('has no route, navigation, UI bundle, or active consumer reachability', () => {
    const existing = REMOVED_TEAM_SURFACES.filter((path) => existsSync(join(ROOT, path)))
    expect(existing, `reachable Team surfaces:\n${existing.join('\n')}`).toEqual([])

    const navigation = [
      strippedSource('src/components/layout/staff-nav-items.tsx'),
      strippedSource('src/components/layout/staff-sidebar.tsx'),
    ].join('\n')
    expect(navigation).not.toMatch(/['"]\/team(?:['"/])/)

    const teamUiFiles = existsSync(join(ROOT, 'src/components/features/team'))
      ? walkFiles(join(ROOT, 'src/components/features/team'))
      : []
    expect(
      teamUiFiles.map(rel),
      `bundled Team UI:\n${teamUiFiles.map(rel).join('\n')}`,
    ).toEqual([])

    const activityHandlers = strippedSource(
      'src/contexts/activity/infrastructure/event-handlers/index.ts',
    )
    expect(activityHandlers).not.toMatch(/team\.(?:created|updated|deleted)/)
    expect(activityHandlers).not.toMatch(/onTeam(?:Created|Updated|Deleted)/)
  })

  it('retains reconciliation evidence behind an unconditionally blocked capability', () => {
    expect(
      existsSync(
        join(
          ROOT,
          'src/contexts/team/infrastructure/repositories/reconcile-people-team.repository.ts',
        ),
      ),
    ).toBe(true)

    const capabilities = strippedSource('src/shared/auth/beta-capabilities.ts')
    expect(capabilities).toContain(`'team.use'`)
    expect(capabilities).toMatch(/BLOCKED_CAPABILITIES[\s\S]*'team\.use'/)
  })
})

describe('row 12 — Portal (controlled beta): independent scoped edge capabilities', () => {
  it('Portal edge capabilities remain declared', () => {
    const caps = strippedSource('src/shared/auth/beta-capabilities.ts')
    for (const cap of ['portal.read', 'portal.write', 'portal.upload']) {
      expect(caps, `missing Portal capability '${cap}'`).toContain(`'${cap}'`)
    }
  })
})

describe('row 13 — Guest (controlled beta): no Portal error dependency', () => {
  it('guest production sources reference no Portal error surface', () => {
    const offenders = offendersMatching(
      /\bPortalError\b|\bisPortalError\b/,
      (p) => !p.startsWith('src/contexts/guest/'),
    )
    expect(offenders, 'guest depends on portal errors:\n' + offenders.join('\n')).toEqual(
      [],
    )
  })
})

describe('row 14 — Goal (controlled beta): governed jobs stay registered and gated', () => {
  it('goal.use remains declared and gates the governed Goal job family', () => {
    expect(strippedSource('src/shared/auth/beta-capabilities.ts')).toContain(`'goal.use'`)
    expect(strippedSource('src/shared/governance/event-job-catalogue.ts')).toContain(
      `capability: 'goal.use'`,
    )
  })
})

describe('row 15 — Badge (controlled beta): governed evaluation and gated jobs', () => {
  it('badge.use remains declared and gates the governed Badge job family', () => {
    expect(strippedSource('src/shared/auth/beta-capabilities.ts')).toContain(
      `'badge.use'`,
    )
    expect(strippedSource('src/shared/governance/event-job-catalogue.ts')).toContain(
      `capability: 'badge.use'`,
    )
  })
})

describe('row 16 — Leaderboard (controlled beta): bounded recompute and gated reads', () => {
  it('leaderboard.use remains declared and gates its recurring reconciliation', () => {
    expect(strippedSource('src/shared/auth/beta-capabilities.ts')).toContain(
      `'leaderboard.use'`,
    )
    expect(strippedSource('src/worker/index.ts')).toContain(
      `capability: 'leaderboard.use'`,
    )
  })
})

describe('row 17 — AI (private-beta foundation): closed policy and durable operation seams', () => {
  it('owns a pure closed policy and strict runtime binding parser', () => {
    const rules = strippedSource('src/contexts/ai/domain/rules.ts')
    expect(rules).toContain('parseAiPrivateBetaPolicy')
    expect(rules).toContain('parseAiExecutionBinding')
    expect(rules).toContain('parseAiCanaryExecutionBinding')
  })

  it('pins the provider SDK to the separately isolated AI gateway slice', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.openai).toBe('7.4.0')
    const OTHER_AI_SDK =
      /anthropic|langchain|@google-ai|@aws-sdk\/client-bedrock|cohere|mistral/i
    const unexpectedDependencies = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).filter((dependency) => OTHER_AI_SDK.test(dependency))
    expect(unexpectedDependencies).toEqual([])

    const productionSources = [
      ...walkSource(join(ROOT, 'src')),
      ...walkSource(join(ROOT, 'services')),
    ]
    const openAiImport =
      /(?:from|import\()\s*['"]openai(?:\/[^'"]*)?['"]|require\(['"]openai/u
    const wrongOwners = productionSources
      .filter((file) => openAiImport.test(stripComments(readFileSync(file, 'utf-8'))))
      .map(rel)
      .filter((file) => !file.startsWith('services/ai-egress-gateway/'))
    expect(
      wrongOwners,
      'openai@7.4.0 imports belong exclusively to services/ai-egress-gateway:\n' +
        wrongOwners.join('\n'),
    ).toEqual([])
  })

  it('retains the approved governance capability surface', () => {
    const caps = strippedSource('src/shared/auth/beta-capabilities.ts')
    for (const cap of ['ai.analyze', 'ai.generate_reply', 'ai.detect_trends']) {
      expect(caps, `missing governance capability '${cap}'`).toContain(`'${cap}'`)
    }
  })
})

describe('registered BQC-1 gaps F1–F3 keep their register entries (rerun rule)', () => {
  it('F1 + F2 stay in the content-free facts register with their BQC-1 justification', () => {
    const facts = readFileSync(join(ROOT, REUSED_PINS.contentFreeFacts), 'utf-8')
    expect(facts, 'F1 fixed? update this matrix row and rerun').toMatch(
      /'ReviewReplyRejected\.reason':\s*'BQC-1 gap/,
    )
    expect(facts, 'F2 fixed? update this matrix row and rerun').toMatch(
      /'IdentityMemberInvited\.email':\s*'BQC-1 gap/,
    )
  })

  it('F3: the inbox feedback comment lookup still lacks a retention clock', () => {
    const adapter = strippedSource(
      'src/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter.ts',
    )
    expect(
      adapter,
      'guard is not vacuous — the lookup still returns the comment',
    ).toContain('comment')
    expect(
      adapter,
      'F3 fixed (retention clock added)? update this matrix row and rerun',
    ).not.toMatch(/expires|retention/i)
  })
})
