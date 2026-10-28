// Inbox context — the list's narrowing predicates that are not plain columns:
// content (rating, search text), review analysis (aspect mentions) and
// priority, plus the AI suggestion each list row shows. Split out of
// inbox.repository.ts when the Priority filter learned the level a person sets
// (ADR 0071), to keep that file within its length ratchet.
//
// Everything here builds a predicate or asks a lookup port; nothing writes, so
// none of it is subject to inbox-status-mirror.guard.test.ts's writer fence.
// The AI ids it receives are unauthorized identifiers: the Inbox's own source
// and Property scopes still limit every row they match (AI CONTEXT).

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { InboxFilters } from '../../application/ports/inbox.repository'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type {
  AiReviewInsightsPort,
  ReviewAttention,
} from '../../application/ports/ai-review-insights.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { propertyId, reviewId } from '#/shared/domain/ids'

export type LookupPorts = Readonly<{
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
  aiInsights?: AiReviewInsightsPort
}>

/**
 * Match source ids with one PostgreSQL array parameter. Content and AI
 * lookups can legitimately return thousands of ids; expanding them through
 * `inArray` would consume one bind parameter per id and eventually exceed the
 * PostgreSQL parameter ceiling.
 */
export function inboxSourceIdMatchesAny(ids: ReadonlyArray<string>): SQL {
  if (ids.length === 0) return sql`false`
  return sql`${inboxItems.sourceId} = ANY(${sql.param(ids.map(String))}::uuid[])`
}

/** Resolve rating/text predicates against each source's owning content store. */
export async function resolveContentNarrowing(
  ports: LookupPorts,
  orgId: OrganizationId,
  filters: InboxFilters,
): Promise<SQL[] | null> {
  if (filters.ratingMin === undefined && filters.ratingMax === undefined && !filters.q) {
    return []
  }
  const contentFilter = {
    ratingMin: filters.ratingMin,
    ratingMax: filters.ratingMax,
    textQuery: filters.q,
  }
  const [reviewIds, feedbackIds] = await Promise.all([
    filters.sourceType === 'feedback'
      ? Promise.resolve([])
      : ports.reviewLookup.findEligibleReviewIds(orgId, contentFilter),
    filters.sourceType === 'review'
      ? Promise.resolve([])
      : ports.feedbackLookup.findEligibleFeedbackIds(orgId, contentFilter),
  ])
  const sourceMatches: SQL[] = []
  if (reviewIds.length > 0) {
    sourceMatches.push(
      and(eq(inboxItems.sourceType, 'review'), inboxSourceIdMatchesAny(reviewIds))!,
    )
  }
  if (feedbackIds.length > 0) {
    sourceMatches.push(
      and(eq(inboxItems.sourceType, 'feedback'), inboxSourceIdMatchesAny(feedbackIds))!,
    )
  }
  if (sourceMatches.length === 0) return null
  return [sourceMatches.length === 1 ? sourceMatches[0]! : or(...sourceMatches)!]
}

type AnalysisScope = Readonly<{
  orgId: OrganizationId
  propertyIds: readonly PropertyId[] | undefined
}>

/**
 * The Priority filter matches the EFFECTIVE level (ADR 0071): the level a
 * person set — on a Review or private feedback alike — or, for a Review with
 * none set, the AI's current suggestion. So a Review the AI calls Urgent and a
 * manager set to Low leaves Urgent and matches Low.
 *
 * Unlike the aspect filter below, an absent AI port or an empty AI answer is
 * not "nothing matches": a person's level is Inbox data, and the set-level
 * branch still holds.
 */
async function resolvePriorityNarrowing(
  ports: LookupPorts,
  scope: AnalysisScope,
  levels: ReadonlyArray<ReviewAttention>,
  sourceType: InboxFilters['sourceType'],
): Promise<SQL> {
  // Feedback is never analysed, so a feedback-only list asks the AI nothing.
  const suggested =
    sourceType === 'feedback'
      ? []
      : ((await ports.aiInsights?.findCurrentReviewIdsByAttention({
          organizationId: scope.orgId,
          propertyIds: scope.propertyIds,
          attention: levels,
        })) ?? [])
  const setLevel = sql`${inboxItems.managerPriority} = ANY(${sql.param([...levels])}::inbox_priority_level[])`
  if (suggested.length === 0) return setLevel
  return or(
    setLevel,
    and(
      isNull(inboxItems.managerPriority),
      eq(inboxItems.sourceType, 'review'),
      inboxSourceIdMatchesAny(suggested),
    ),
  )!
}

/**
 * Aspect and polarity resolve to the Review ids whose CURRENT analysis holds a
 * matching mention, through the AI context's gated projection. They describe a
 * Review's words, so they never match feedback, and an absent AI port or an
 * empty id set is "no review matches", NEVER "no filter": treating it as the
 * latter would show the entire inbox while the UI claimed a filter was applied.
 * Returns `null` to mean "stop, nothing can match".
 */
async function resolveAspectNarrowing(
  ports: LookupPorts,
  scope: AnalysisScope,
  filters: InboxFilters,
): Promise<SQL[] | null> {
  const reviewIds = await ports.aiInsights?.findCurrentReviewIdsByAspect({
    organizationId: scope.orgId,
    propertyIds: scope.propertyIds,
    aspects: filters.aspect,
    polarities: filters.polarity,
  })
  if (reviewIds === undefined || reviewIds.length === 0) return null
  return [eq(inboxItems.sourceType, 'review'), inboxSourceIdMatchesAny(reviewIds)]
}

/**
 * The analysis-derived narrowing for the item list: priority and aspect
 * mentions. Neither the AI suggestion nor a mention is a column on
 * `inbox_items`; each active filter asks the AI context, in parallel, and
 * contributes its own predicate. Aspect and polarity constrain the same
 * mention; priority intersects that result. Returns `null` to mean "stop,
 * nothing can match". List and count share it (ADR 0057 decision 6).
 */
export async function resolveAnalysisNarrowing(
  ports: LookupPorts,
  orgId: OrganizationId,
  filters: InboxFilters,
): Promise<SQL[] | null> {
  const wantsAspect = Boolean(filters.aspect?.length || filters.polarity?.length)
  const levels = filters.attention ?? []
  if (levels.length === 0 && !wantsAspect) return []
  const scope: AnalysisScope = {
    orgId,
    propertyIds:
      filters.propertyIds ?? (filters.propertyId ? [filters.propertyId] : undefined),
  }
  const [priority, aspect] = await Promise.all([
    levels.length > 0
      ? resolvePriorityNarrowing(ports, scope, levels, filters.sourceType)
      : null,
    wantsAspect ? resolveAspectNarrowing(ports, scope, filters) : [],
  ])
  if (aspect === null) return null
  return priority === null ? aspect : [priority, ...aspect]
}

type ListRow = Readonly<{
  sourceType: 'review' | 'feedback'
  sourceId: string
  managerPriority: string | null
}>

/** The two suggestions a list row prints; Medium and Low are silent there. */
type RowSuggestion = 'urgent' | 'high'

/**
 * The AI suggestion each Review row on the page shows (ADR 0071): `urgent` or
 * `high`, else nothing. Only rows with no level a person set are asked about —
 * a set level wins, so its suggestion would never be shown. Two page-bounded
 * calls through the same AI id gate the filter uses.
 */
export async function findSuggestedRowLevels(
  ports: LookupPorts,
  rows: ReadonlyArray<ListRow>,
  propertyIds: ReadonlyArray<string>,
  orgId: OrganizationId,
): Promise<ReadonlyMap<string, RowSuggestion>> {
  const reviewIds = rows
    .filter((row) => row.sourceType === 'review' && row.managerPriority === null)
    .map((row) => reviewId(row.sourceId))
  const levels = new Map<string, RowSuggestion>()
  const ai = ports.aiInsights
  if (!ai || reviewIds.length === 0) return levels
  const ask = (attention: RowSuggestion) =>
    ai.findCurrentReviewIdsByAttention({
      organizationId: orgId,
      propertyIds: propertyIds.map(propertyId),
      reviewIds,
      attention: [attention],
    })
  const [urgent, high] = await Promise.all([ask('urgent'), ask('high')])
  // Only ids it was asked about: an answer can never put a suggestion on a row
  // whose level a person set.
  const asked = new Set<string>(reviewIds)
  for (const id of high) if (asked.has(id)) levels.set(id, 'high')
  for (const id of urgent) if (asked.has(id)) levels.set(id, 'urgent')
  return levels
}
