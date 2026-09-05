/**
 * ARC-03 authority for the accuracy of every CONTEXT.md `## Public API`
 * section.
 *
 * The 17-context standards authority already proves that each context
 * document exists and carries the required headings in order. Heading
 * presence says nothing about truth: a document could keep naming a type
 * that was renamed, or an event constructor that was never re-exported, and
 * nothing failed. That is worse than silence, because a consumer plans
 * against a documented interface before discovering it does not exist —
 * exactly the drift found in the Portal and Identity documents.
 *
 * This module owns the reviewed allowlists and the pure comparison rules.
 * The companion test discovers each context's real export surface from
 * `application/public-api.ts` and applies them, so both directions fail
 * closed:
 *
 * - a backticked identifier under `## Public API` must be an export of that
 *   context's public-api.ts, or a reviewed `PROSE_TERMS` entry;
 * - an export of public-api.ts must be named in that section, or a reviewed
 *   `DOCUMENTED_ELSEWHERE` entry.
 *
 * Both allowlists are per-name and carry a reason. A pattern or a
 * per-context waiver would let the next rename hide inside it, which is the
 * failure mode this authority exists to remove.
 */

export type ProseTerm = Readonly<{
  directory: string
  term: string
  reason: string
}>

export type DocumentedElsewhereGroup = Readonly<{
  directory: string
  reason: string
  names: readonly string[]
}>

export type PublicInterfaceViolationKind = 'undeclared_identifier' | 'undocumented_export'

export type PublicInterfaceViolation = Readonly<{
  directory: string
  kind: PublicInterfaceViolationKind
  name: string
  message: string
}>

export type ContextPublicInterfaceInput = Readonly<{
  directory: string
  document: string
  exportedNames: readonly string[]
}>

/**
 * Identifiers a Public API section may name even though public-api.ts does
 * not export them: facade members, build-surface members, internal seams the
 * document deliberately points at, and values quoted as prose. Every entry
 * states why the name is not — and should not become — a module export.
 */
export const PROSE_TERMS = Object.freeze([
  {
    directory: 'activity',
    term: 'getActivityTimeline',
    reason:
      'Method on the exported `ActivityPublicApi` facade; the facade type, not the method, is the module export.',
  },
  {
    directory: 'activity',
    term: 'listRecentActivity',
    reason:
      'Method on the exported `ActivityPublicApi` facade; the facade type, not the method, is the module export.',
  },
  {
    directory: 'activity',
    term: 'listOperationalActionHistory',
    reason:
      'Method on the exported `ActivityPublicApi` facade; the facade type, not the method, is the module export.',
  },
  {
    directory: 'activity',
    term: 'exportOperationalActionHistory',
    reason:
      'Method on the exported `ActivityPublicApi` facade; the facade type, not the method, is the module export.',
  },
  {
    directory: 'activity',
    term: 'projectRecentActivity',
    reason:
      'Activity-owned worker projection. The interface table records its authorization as system worker only, so it is deliberately absent from the cross-context surface.',
  },
  {
    directory: 'activity',
    term: 'recoverRecentActivity',
    reason:
      'Activity-owned recovery use case, system/operator only and deliberately absent from the cross-context surface.',
  },
  {
    directory: 'activity',
    term: 'getRecentActivityReadiness',
    reason:
      'Activity-owned readiness read, system/operator only and deliberately absent from the cross-context surface.',
  },
  {
    directory: 'activity',
    term: 'redactRecentActivityActorLabels',
    reason:
      'Restricted lifecycle use case; exposing it cross-context would widen an anonymization seam.',
  },
  {
    directory: 'activity',
    term: 'appendOperationalAction',
    reason:
      'Trusted context/worker append seam; Operational Action History is never appended through the public surface.',
  },
  {
    directory: 'goal',
    term: 'findMonthlyResultNotificationFacts',
    reason:
      'Method on the Goal build public API, typed by the exported `MonthlyResultNotificationFactsLookup`; the lookup type, not the method, is the module export.',
  },
  {
    directory: 'goal',
    term: 'findMonthlyResultRevisionNotificationFacts',
    reason:
      'Method on the Goal build public API, typed by the exported `MonthlyResultNotificationFactsLookup`; the lookup type, not the method, is the module export.',
  },
  {
    directory: 'identity',
    term: 'listActiveManagers',
    reason: 'Method on the exported `IdentityManagerFactsPublicApi` facade.',
  },
  {
    directory: 'identity',
    term: 'isCurrentAccountAdmin',
    reason: 'Method on the exported `IdentityAccountAdminAuthorityPublicApi` facade.',
  },
  {
    directory: 'inbox',
    term: 'totalCount',
    reason:
      'Field on the Inbox paginated result shape. The page types are exported; the field name is prose.',
  },
  {
    directory: 'notification',
    term: 'NOTIFICATION_TYPES',
    reason:
      'Named to record a deliberate non-export. Keeping the name here means promoting it to public-api.ts fails this check until the sentence explaining the decision is rewritten.',
  },
  {
    directory: 'notification',
    term: 'parseNotificationPayload',
    reason:
      'Named to record a deliberate non-export: payloads are parsed on the way in, so no consumer needs the parser.',
  },
  {
    directory: 'notification',
    term: 'isEmptyNotificationPayload',
    reason:
      'Named to record a deliberate non-export: every consumer of the guard is inside this context.',
  },
  {
    directory: 'notification',
    term: 'insertNotification',
    reason:
      'Context-internal writer named to explain where an incoming payload is parsed; it is not a cross-context seam.',
  },
  {
    directory: 'notification',
    term: 'publicApi',
    reason:
      'Member of the build.ts surface consumed by Notification server functions; build.ts, not public-api.ts, owns it.',
  },
  {
    directory: 'notification',
    term: 'findById',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'getFeedHead',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'getNotifications',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'markRead',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'markAllRead',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'dismiss',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'getPreferences',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'updatePreference',
    reason:
      'Member of the build.ts publicApi surface consumed by Notification server functions.',
  },
  {
    directory: 'notification',
    term: 'readMissingNotificationCount',
    reason:
      'Bounded operational reader on the build.ts surface, not a cross-context export.',
  },
  {
    directory: 'notification',
    term: 'readNotificationDeliveryLag',
    reason:
      'Bounded operational reader on the build.ts surface, not a cross-context export.',
  },
  {
    directory: 'portal',
    term: 'findGroupForPortal',
    reason: 'Method on the exported `PortalGroupPublicApi` facade.',
  },
  {
    directory: 'property',
    term: 'isPropertyActive',
    reason: 'Method on the exported `PropertyLifecyclePublicApi` facade.',
  },
  {
    directory: 'review',
    term: 'publicApi',
    reason: 'Group on the built Review container rather than a public-api.ts export.',
  },
  {
    directory: 'review',
    term: 'reply',
    reason:
      'Named capability group on the built Review container rather than a public-api.ts export.',
  },
  {
    directory: 'review',
    term: 'syncAdmission',
    reason:
      'Named capability group on the built Review container rather than a public-api.ts export.',
  },
  {
    directory: 'staff',
    term: 'getAccessiblePropertyIds',
    reason: 'Method on the exported `StaffPublicApi` facade.',
  },
  {
    directory: 'staff',
    term: 'getAssignedPortals',
    reason: 'Method on the exported `StaffPublicApi` facade.',
  },
  {
    directory: 'staff',
    term: 'exact',
    reason:
      'Stable outcome literal of the Identity-owned reconciliation seam; a value, not a symbol.',
  },
  {
    directory: 'staff',
    term: 'mappable',
    reason:
      'Stable outcome literal of the Identity-owned reconciliation seam; a value, not a symbol.',
  },
  {
    directory: 'staff',
    term: 'conflict',
    reason:
      'Stable outcome literal of the Identity-owned reconciliation seam; a value, not a symbol.',
  },
  {
    directory: 'staff',
    term: 'orphan',
    reason:
      'Stable outcome literal of the Identity-owned reconciliation seam; a value, not a symbol.',
  },
  {
    directory: 'staff',
    term: 'unsafe',
    reason:
      'Stable outcome literal of the Identity-owned reconciliation seam; a value, not a symbol.',
  },
  {
    directory: 'team',
    term: 'publicApi',
    reason:
      'Field of the empty object build.ts returns during quarantine; Team exposes no active surface.',
  },
] as const satisfies ReadonlyArray<ProseTerm>)

/**
 * Exports whose context document describes the surface in families instead of
 * naming every symbol. These are the documents this authority did not
 * re-enumerate; the list is exhaustive on purpose, so adding an export to one
 * of these contexts fails this check until it is documented or reviewed here.
 */
export const DOCUMENTED_ELSEWHERE = Object.freeze([
  {
    directory: 'ai',
    reason:
      'AI CONTEXT.md documents presentation read shapes, on-demand Reply Drafting inputs/results and identifier-only events as families instead of name by name. The exhaustive list lives here so a new AI export fails this check until it is documented or reviewed.',
    names: [
      'AiCategoryCount',
      'AiEvent',
      'AiPropertyTrendGenerationRequested',
      'AiReviewAnalysisBackfillRequested',
      'AiSentimentDay',
      'AiTrendReportRead',
      'GenerateReplySuggestionInput',
      'GenerateReplySuggestionResult',
    ],
  },
  {
    directory: 'dashboard',
    reason:
      'Dashboard CONTEXT.md enumerates its shared dashboard read models; these Google Performance catalogues and specialized Performance/Portal evidence contracts are documented by family instead.',
    names: [
      'GOOGLE_PERFORMANCE_ERROR_CODES',
      'GooglePerformanceErrorCode',
      'PROPERTY_PERFORMANCE_PRESETS',
      'PerformanceAvailability',
      'PerformanceMetricValue',
      'PerformanceSeries',
      'PortalMetricEvidence',
      'PropertyGooglePerformanceReportV1',
      'PropertyGooglePerformanceResultV1',
      'PropertyPerformancePreset',
      'isGooglePerformanceErrorCode',
      'isPropertyPerformancePreset',
    ],
  },
  {
    directory: 'inbox',
    reason:
      'Inbox CONTEXT.md documents feedback handling, response targets and handling cycles as families rather than name by name.',
    names: [
      'FeedbackHandlingCommandResult',
      'FeedbackHandlingState',
      'GoogleReviewTargetAnalytics',
      'InboxBulkAssignmentCompleted',
      'InboxHandlingCycleClosed',
      'InboxHandlingCycleOpened',
      'InboxHandlingCycleReopened',
      'InboxItemDetailResult',
      'InboxItemEscalationResolved',
      'InboxPublicApi',
      'InboxResponseTargetPolicyChanged',
      'InboxResponseTargetReminderDue',
      'InboxReviewAnalysis',
      'ManualReopenReason',
      'PrivateFeedbackHandlingOutcome',
      'PrivateFeedbackTargetAnalytics',
      'ResponseTargetPolicySettings',
      'ResponseTargetPolicyWriteResult',
      'ResponseTargetView',
      'ReviewCategory',
      'canonicalInboxHandlingCutoverReport',
    ],
  },
  {
    directory: 'integration',
    reason:
      'Integration CONTEXT.md documents its surface as five contract families rather than name by name.',
    names: [
      'GBP_IMPORT_ITEM_STATUSES',
      'GOOGLE_PERFORMANCE_CATALOG_VERSION',
      'GOOGLE_PERFORMANCE_DAILY_METRICS',
      'GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS',
      'GOOGLE_PROPERTY_IMPORT_ITEM_JOB',
      'GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION',
      'GOOGLE_PROVIDER_ROUTE_KEYS',
      'GbpImportItemStatus',
      'GoogleAuthUrlInput',
      'GoogleConnectionDto',
      'GoogleConnectionStatus',
      'GoogleImportViewCompletion',
      'GoogleProviderRouteKey',
      'GoogleReplyPublicationContentAuthorizer',
      'GoogleReviewPushNotificationKind',
      'GoogleReviewSyncContentAuthorizer',
      'IMPORT_OUTCOME_CODES',
      'IMPORT_PARENT_STATUSES',
      'ImportAccountDto',
      'ImportAccountPageDto',
      'ImportCandidateDto',
      'ImportCandidatePageDto',
      'ImportOutcomeCode',
      'ImportParentStatus',
      'ImportProgressDto',
      'ImportProgressItemDto',
      'IntegrationGoogleAccountConnected',
      'IntegrationGoogleAccountDisconnected',
      'IntegrationGoogleAccountReauthorizationRequired',
      'IntegrationGoogleConnectionVisibilityChanged',
      'MAX_GOOGLE_PERFORMANCE_DAILY_VALUE',
      'MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES',
      'StartPropertyImportItemInput',
      'contentExpiryDelayMs',
      'createGoogleImportContentLifecycle',
      'isGooglePerformanceDailyMetric',
    ],
  },
  {
    directory: 'property',
    reason:
      'Property CONTEXT.md enumerates the current facades and Google binding contract; these lifecycle events, region guards and import builders are documented elsewhere in the context.',
    names: [
      'PropertyArchived',
      'PropertyCreated',
      'PropertyDeleted',
      'PropertyProcessingScopePublicApi',
      'PropertyResponsibilityNeeded',
      'PropertyRestored',
      'PropertyUpdated',
      'ROUTING_POLICY_VERSION',
      'assertRegionResolved',
      'buildGoogleImportedProperty',
      'isRegionProcessable',
    ],
  },
  {
    directory: 'staff',
    reason:
      'Staff CONTEXT.md documents the three read seams consumers may use and deliberately leaves the rest of the barrel unadvertised.',
    names: [
      'StaffAssigned',
      'StaffParticipation',
      'StaffPortalEntry',
      'StaffPublicApi',
      'StaffUnassigned',
    ],
  },
] as const satisfies ReadonlyArray<DocumentedElsewhereGroup>)

const PUBLIC_API_HEADING_LINE = /^## Public API\s*$/mu
const NEXT_SECTION = /^##\s/mu
const CODE_SPAN = /`([^`\n]+)`/gu
const TRAILING_CALL = /\([^)]*\)$/u
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

/** Returns the `## Public API` body, or '' when the document has no such section. */
export function extractPublicApiSection(document: string): string {
  const heading = PUBLIC_API_HEADING_LINE.exec(document)
  if (heading == null) return ''

  const rest = document.slice(heading.index + heading[0].length)
  const next = rest.search(NEXT_SECTION)
  return next < 0 ? rest : rest.slice(0, next)
}

/**
 * Backticked spans that claim to be a symbol. A span carrying a path, a
 * member access, or a capability string is prose about a location rather than
 * a declaration, so only bare identifiers — optionally written with a call
 * signature — are treated as claims this authority must verify.
 */
export function listDeclaredIdentifiers(section: string): readonly string[] {
  const declared = new Set<string>()

  for (const [, span] of section.matchAll(CODE_SPAN)) {
    const candidate = (span ?? '').trim().replace(TRAILING_CALL, '')
    if (BARE_IDENTIFIER.test(candidate)) declared.add(candidate)
  }

  return [...declared].sort()
}

function isIdentifierChar(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character)
}

/**
 * Whole-identifier containment, scanned rather than compiled. An exported name
 * may contain regular-expression metacharacters, so building a pattern from it
 * would both trip the non-literal-RegExp control and silently mismatch.
 */
function mentions(section: string, name: string): boolean {
  if (name === '') return false
  for (let at = section.indexOf(name); at !== -1; at = section.indexOf(name, at + 1)) {
    const before = at === 0 ? undefined : section[at - 1]
    const after = section[at + name.length]
    if (!isIdentifierChar(before) && !isIdentifierChar(after)) return true
  }
  return false
}

export function auditContextPublicInterface(
  input: ContextPublicInterfaceInput,
): readonly PublicInterfaceViolation[] {
  const section = extractPublicApiSection(input.document)
  const exported = new Set(input.exportedNames)
  const prose = new Set<string>(
    PROSE_TERMS.filter(({ directory }) => directory === input.directory).map(
      ({ term }) => term,
    ),
  )
  const reviewed = new Set<string>(
    DOCUMENTED_ELSEWHERE.filter(({ directory }) => directory === input.directory).flatMap(
      ({ names }) => names,
    ),
  )

  const undeclared = listDeclaredIdentifiers(section)
    .filter((name) => !exported.has(name) && !prose.has(name))
    .map((name) => ({
      directory: input.directory,
      kind: 'undeclared_identifier' as const,
      name,
      message: `${input.directory}/CONTEXT.md documents \`${name}\`, which application/public-api.ts does not export`,
    }))

  const undocumented = input.exportedNames
    .filter((name) => !mentions(section, name) && !reviewed.has(name))
    .map((name) => ({
      directory: input.directory,
      kind: 'undocumented_export' as const,
      name,
      message: `${input.directory}/application/public-api.ts exports \`${name}\`, which the Public API section never names`,
    }))

  return Object.freeze([...undeclared, ...undocumented])
}
