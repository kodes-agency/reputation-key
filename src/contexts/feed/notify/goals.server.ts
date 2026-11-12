import type { ConsumerEvent } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type {
  GoalMetric,
  GoalSubject,
  MonthlyResultNotificationFactsLookup,
} from '#/contexts/reporting/application/public-api'
import {
  organizationId,
  propertyId,
  reviewId,
  unbrand,
  type InboxItemId,
  type UserId,
} from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { ActivePropertyLookup } from '../application/ports/active-property.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationAudience } from '../application/notification-audience'
import {
  goalNoticeScope,
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
  resolveResponsibleRecipients,
} from '../application/responsible-recipients'
import type { NotificationPayload } from '../domain/notification-payload'
import type { NotificationGuestVoiceLine } from '../domain/notification-payload-guest-voice'
import type { NotificationType } from '../domain/notification-types'
import type { InboxFanoutDeps } from './inbox.server'
import { goalMonthMarker } from '../infrastructure/goal-month-marker'
import {
  buildInboxItemPayload,
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from '../infrastructure/notification-payload-facts'
import { deliverNotices, type Notice, type NoticeDeliveryDeps } from './consumers.server'

export const ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER =
  'notification.on-goal-monthly-result-closed' as const
export const ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER =
  'notification.on-goal-monthly-result-revised' as const

export type GoalNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    monthlyResultFacts: MonthlyResultNotificationFactsLookup
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
  }>

type Payload = Readonly<{
  organizationId?: string
  propertyId?: string
  programId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: string
  achieved: boolean | null
  status: 'closed'
}>

type Parsed = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  assignmentId: string
  monthlyResultId: string
  achieved: boolean | null
}>

type RevisedPayload = Readonly<{
  organizationId?: string
  propertyId?: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: 'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'
  achieved: boolean | null
  status: 'closed'
  revisionId: string
  revision: number
  outcomeChanged: boolean
  availabilityChanged: boolean
}>

type ParsedRevision = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: RevisedPayload['evaluationState']
  achieved: boolean | null
  revisionId: string
  revision: number
  outcomeChanged: boolean
  availabilityChanged: boolean
}>

function parse(event: ConsumerEvent): Parsed {
  const payload = validateEventPayload(
    'goal.monthly_result.closed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    (payload.organizationId !== undefined &&
      payload.organizationId !== event.organizationId) ||
    (payload.propertyId !== undefined && payload.propertyId !== event.propertyId)
  ) {
    throw new Error('Goal monthly-result envelope attribution mismatch')
  }
  if (event.propertyId === null) {
    throw new Error('Goal monthly-result envelope is missing property attribution')
  }
  return {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    programId: payload.programId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    achieved: payload.achieved,
  }
}

function parseRevision(event: ConsumerEvent): ParsedRevision {
  const payload = validateEventPayload(
    'goal.monthly_result.revised',
    event.eventVersion,
    event.payload,
  ) as RevisedPayload | undefined
  if (
    !payload ||
    (payload.organizationId !== undefined &&
      payload.organizationId !== event.organizationId) ||
    (payload.propertyId !== undefined && payload.propertyId !== event.propertyId) ||
    event.sourceAggregateId !== payload.monthlyResultId
  ) {
    throw new Error('Goal monthly-result revision envelope attribution mismatch')
  }
  if (event.propertyId === null) {
    throw new Error(
      'Goal monthly-result revision envelope is missing property attribution',
    )
  }
  return {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    programId: payload.programId,
    programVersionId: payload.programVersionId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    evaluationState: payload.evaluationState,
    achieved: payload.achieved,
    revisionId: payload.revisionId,
    revision: payload.revision,
    outcomeChanged: payload.outcomeChanged,
    availabilityChanged: payload.availabilityChanged,
  }
}

/**
 * A corrected month that is no longer eligible has no result to report, which
 * is not the same as missing its target; the copy keeps them apart.
 */
const goalOutcomeOf = (
  payload: Pick<ParsedRevision, 'evaluationState' | 'achieved'>,
): 'met' | 'not_met' | 'unavailable' => {
  if (payload.evaluationState !== 'eligible') return 'unavailable'
  return payload.achieved === true ? 'met' : 'not_met'
}

type GoalNoticeFacts = Readonly<{
  subject: GoalSubject
  programName: string
  periodMonth: string
  setDuringMonth: boolean
  targetChangedInMonth: boolean
  metric: GoalMetric
  value: number | null
  target: number
  subjectName: string | null
}>

/**
 * What a portal goal's notice states about its month (ADR 0046, amended
 * 2026-10-17): the measure; for a count, the month as it stands and the target
 * it was judged against; and the Portal's or Portal Group's name. An average
 * states no figure: its notice sends the reader to the goal.
 */
const goalNoticeFigures = (facts: GoalNoticeFacts) => {
  const counted = facts.metric !== 'portal_rating_average'
  return {
    goalMeasure: facts.metric,
    ...(counted && facts.value !== null ? { goalCount: facts.value } : {}),
    ...(counted ? { goalTargetCount: facts.target } : {}),
    ...(facts.subjectName === null ? {} : { goalSubjectName: facts.subjectName }),
  }
}

type GoalConsumerName =
  | typeof ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER
  | typeof ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER

/** A fact that can raise no notice: record this consumer's receipt as obsolete. */
const obsolete = (
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
  consumer: GoalConsumerName,
): Promise<ConsumerResult> =>
  deliverNotices(deps, event, consumer, [], { status: 'obsolete' })

/**
 * The Goal notice for each current responsible manager of the Property
 * the goal sits in, whatever its subject (`goalNoticeScope`). Monthly-result
 * facts are system evaluations and carry no synchronous human actor, so
 * current responsibility is the audience authority.
 */
async function goalNotices(
  deps: GoalNotificationConsumerDeps,
  result: Pick<Parsed, 'organizationId' | 'propertyId' | 'monthlyResultId'>,
  facts: GoalNoticeFacts,
  notice: Readonly<{
    type: 'goal.completed' | 'goal.result_revised'
    /**
     * Which way the month stands NOW. A completion is always `met`; a
     * correction says whether the month still is, no longer is, or has no
     * usable result at all.
     */
    outcome: 'met' | 'not_met' | 'unavailable'
    audience: NotificationAudience
  }>,
): Promise<ReadonlyArray<Notice>> {
  const organization = organizationId(result.organizationId)
  const property = propertyId(result.propertyId)
  const recipients = await resolveResponsibleRecipients(
    deps,
    organization,
    goalNoticeScope(result.propertyId),
  )
  // A Goal subject sits inside one Property, the one this fact is filed under.
  const where = await buildPropertyPayload(deps, organization, property)
  // The one marker a Goal notice may carry (ADR 0046): the month's target was
  // changed while it ran, or the goal was set after the month began. Absent
  // when the target stood all month.
  const goalMarker = goalMonthMarker(facts)

  return recipients.map((recipient) => ({
    userId: recipient,
    organizationId: organization,
    propertyId: property,
    type: notice.type,
    resourceType: 'goal' as const,
    resourceId: result.monthlyResultId,
    // Which month, whose goal, and which way it went. Ten sibling results of
    // one Program used to render ten identical rows.
    payload: {
      goalName: facts.programName,
      ...where,
      goalMonth: facts.periodMonth,
      goalSubjectKind: facts.subject.kind,
      goalOutcome: notice.outcome,
      ...goalNoticeFigures(facts),
      ...(goalMarker === null ? {} : { goalMarker }),
    },
    audience: notice.audience,
  }))
}

export async function handleNotificationGoalMonthlyResultClosed(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parse(event)
  const consumer = ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER

  if (payload.achieved !== true) return obsolete(deps, event, consumer)

  const facts = await deps.monthlyResultFacts.findMonthlyResultNotificationFacts({
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
  })
  if (
    !facts ||
    facts.programId !== payload.programId ||
    facts.assignmentId !== payload.assignmentId ||
    facts.monthlyResultId !== payload.monthlyResultId ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== payload.propertyId)
  ) {
    return obsolete(deps, event, consumer)
  }

  const notices = await goalNotices(deps, payload, facts, {
    type: 'goal.completed',
    // The lookup returns nothing unless the month is achieved as it stands.
    outcome: 'met',
    // Delivery rechecks that the month is STILL achieved: a correction
    // may un-achieve it before this job runs.
    audience: {
      kind: 'goal_completion',
      programId: payload.programId,
      assignmentId: payload.assignmentId,
      monthlyResultId: payload.monthlyResultId,
    },
  })
  return deliverNotices(deps, event, consumer, notices)
}

export async function handleNotificationGoalMonthlyResultRevised(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parseRevision(event)
  const consumer = ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER
  if (!payload.outcomeChanged && !payload.availabilityChanged) {
    return obsolete(deps, event, consumer)
  }

  const findRevision = deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts
  if (!findRevision) {
    throw new Error('Goal monthly-result revision lookup is unavailable')
  }
  const facts = await findRevision({
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    programId: payload.programId,
    programVersionId: payload.programVersionId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    revisionId: payload.revisionId,
    revision: payload.revision,
  })
  // The facts describe the result's CURRENT head, which may be a later,
  // smaller correction without flags of its own. The notice stands while that
  // head still says what this correction said.
  if (
    !facts ||
    facts.programId !== payload.programId ||
    facts.programVersionId !== payload.programVersionId ||
    facts.assignmentId !== payload.assignmentId ||
    facts.monthlyResultId !== payload.monthlyResultId ||
    facts.revision < payload.revision ||
    facts.evaluationState !== payload.evaluationState ||
    facts.achieved !== payload.achieved ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== payload.propertyId)
  ) {
    return obsolete(deps, event, consumer)
  }

  const notices = await goalNotices(deps, payload, facts, {
    type: 'goal.result_revised',
    outcome: goalOutcomeOf(payload),
    audience: {
      kind: 'goal_result_revision',
      programId: payload.programId,
      programVersionId: payload.programVersionId,
      assignmentId: payload.assignmentId,
      monthlyResultId: payload.monthlyResultId,
      revisionId: payload.revisionId,
      revision: payload.revision,
      evaluationState: payload.evaluationState,
      achieved: payload.achieved,
    },
  })
  return deliverNotices(deps, event, consumer, notices)
}

// The Property Google rating goal notices (ADR 0067 decision 6; ADR 0046,
// amended 2026-10-14). Reporting writes one `goal.rating_goal.transitioned`
// fact per notice; each becomes one notice per current responsible manager of
// the Property, AccountAdmins as the fallback. Never staff. The fact carries
// the Property-level figures the notice states, never a review, a review's
// rating or an average of ratings.

export const ON_RATING_GOAL_TRANSITIONED_CONSUMER =
  'notification.on-rating-goal-transitioned' as const

const RATING_GOAL_EVENT_TYPE = 'goal.rating_goal.transitioned' as const

export type RatingGoalNoticeConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
  }>

type RatingGoalTransition =
  | 'reached'
  | 'google_rating_changed'
  | 'entered_below_pace'
  | 'entered_reviews_too_low'
  | 'keep_dropped_below'

type RatingGoalTransitionedPayload = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  transition: RatingGoalTransition
  mode: 'climb' | 'keep'
  targetTenths: number
  shownTenths: number | null
  previousTenths: number | null
  pacePerWeek: number | null
  /** Absent from a fact written before the pace was kept in tenths. */
  paceTenthsPerWeek?: number | null
  recentPaceTenths: number | null
  paceWindow: 'last_4_weeks' | 'since_set' | 'since_pace_change' | null
}>

const RATING_GOAL_NOTICE_TYPES: Readonly<Record<RatingGoalTransition, NotificationType>> =
  {
    reached: 'goal.rating_reached',
    google_rating_changed: 'goal.rating_changed',
    entered_below_pace: 'goal.rating_below_pace',
    entered_reviews_too_low: 'goal.rating_too_low',
    keep_dropped_below: 'goal.rating_keep_dropped',
  }

function parseRatingGoalTransition(event: ConsumerEvent): RatingGoalTransitionedPayload {
  if (event.eventType !== RATING_GOAL_EVENT_TYPE) {
    throw new Error('Rating goal notice consumer received the wrong event type')
  }
  const payload = validateEventPayload(
    RATING_GOAL_EVENT_TYPE,
    event.eventVersion,
    event.payload,
  ) as RatingGoalTransitionedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Rating goal notice envelope attribution mismatch')
  }
  return payload
}

/** The figures the notice states, as the payload allowlist names them. */
function ratingGoalFigures(fact: RatingGoalTransitionedPayload): NotificationPayload {
  const figures: Readonly<Record<string, number | string | null>> = {
    ratingShownTenths: fact.shownTenths,
    ratingPreviousTenths: fact.previousTenths,
    ratingTargetTenths: fact.targetTenths,
    ratingGoalMode: fact.mode,
    ratingPacePerWeek: fact.pacePerWeek,
    ratingPaceTenthsPerWeek: fact.paceTenthsPerWeek ?? null,
    ratingRecentPaceTenths: fact.recentPaceTenths,
    ratingPaceWindow: fact.paceWindow,
  }
  return Object.fromEntries(
    Object.entries(figures).filter(([, value]) => value !== null),
  ) as NotificationPayload
}

export async function handleRatingGoalTransitioned(
  deps: RatingGoalNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const fact = parseRatingGoalTransition(event)
  const organization = organizationId(fact.organizationId)
  const property = propertyId(fact.propertyId)
  // A system evaluation with no human actor: current responsibility for the
  // Property is the audience authority, and delivery asks it again.
  const scope = { kind: 'property', propertyId: fact.propertyId } as const
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)
  const where = await buildPropertyPayload(deps, organization, property)
  const payload = { ...where, ...ratingGoalFigures(fact) }

  return deliverNotices(
    deps,
    event,
    ON_RATING_GOAL_TRANSITIONED_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: organization,
      propertyId: property,
      type: RATING_GOAL_NOTICE_TYPES[fact.transition],
      // One row per (reader, type, goal): a later change of the same kind
      // meets the reader's unread row (ADR 0046 r.2).
      resourceType: 'goal' as const,
      resourceId: fact.goalId,
      payload,
      audience: { kind: 'responsible_scope', scope },
    })),
  )
}

// The Urgent alert (v3 contract decision 10; ADR 0046, amended 2026-10-30).
// A review analysis v3 that finds a review Urgent writes one identifier-only
// fact per review revision (`ai.review_analysis.urgent_detected`). It becomes
// the one notice an AI finding may start, "An urgent review needs you", to the
// managers who receive this Property's review notifications. The notice never
// carries the reason, the topic, the stars or a word of the review (ADR 0046
// r.8), and the route writes nothing in the Inbox.
//
// It stays silent for a review nobody can still act on: the item is gone, is
// closed, has moved to a later revision, arrived as imported Google history, or
// has waited longer than a week. A review the Inbox has not projected yet is
// waited for, by throwing so the dispatch retries, up to
// `PROJECTION_HORIZON_MS`, and then dropped as obsolete.

export const ON_AI_REVIEW_URGENT_DETECTED_CONSUMER =
  'notification.on-ai-review-urgent-detected' as const

const URGENT_EVENT_TYPE = 'ai.review_analysis.urgent_detected' as const

/** How long the alert waits for the Inbox to project the review it is about. */
export const PROJECTION_HORIZON_MS = 15 * 60_000

/** A review that has waited longer than this is not news; see the route's header. */
export const FRESHNESS_HORIZON_MS = 7 * 24 * 3_600_000

export type AiUrgentReviewNoticeConsumerDeps = InboxFanoutDeps & NoticeDeliveryDeps

type UrgentDetectedPayload = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  occurredAt: string
}>

function parseUrgentDetected(event: ConsumerEvent): UrgentDetectedPayload {
  if (event.eventType !== URGENT_EVENT_TYPE) {
    throw new Error('Urgent alert consumer received the wrong event type')
  }
  const payload = validateEventPayload(
    URGENT_EVENT_TYPE,
    event.eventVersion,
    event.payload,
  ) as UrgentDetectedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Urgent alert envelope attribution mismatch')
  }
  return payload
}

/**
 * The Inbox has not caught up with this revision: the item is not there yet, or still
 * stands at an earlier revision. The projection is asynchronous and usually done long
 * before a provider answers, so this is rare; the dispatch retries by the throw.
 */
function projectionPending(
  deps: AiUrgentReviewNoticeConsumerDeps,
  fact: UrgentDetectedPayload,
): boolean {
  return deps.clock().getTime() - Date.parse(fact.occurredAt) < PROJECTION_HORIZON_MS
}

/** Whether the item is still the unhandled review this alert is about. */
async function alertIsCurrent(
  deps: AiUrgentReviewNoticeConsumerDeps,
  fact: UrgentDetectedPayload,
  item: InboxItemId,
): Promise<'current' | 'stale' | 'pending'> {
  const org = organizationId(fact.organizationId)
  const facts = await deps.inboxItemLookup.findHandlingCycleNotificationFacts(item, org)
  if (
    facts === null ||
    facts.sourceType !== 'review' ||
    facts.sourceId !== fact.reviewId ||
    facts.propertyId !== fact.propertyId ||
    facts.status !== 'open'
  ) {
    return 'stale'
  }
  if (facts.currentSourceRevision < fact.sourceRevision) return 'pending'
  if (facts.currentSourceRevision > fact.sourceRevision) return 'stale'
  if (await deps.inboxItemLookup.isHistoricalOnboardingItem(item, org)) return 'stale'
  const waitingSince = await deps.inboxItemLookup.findWaitingSince(item, org)
  return waitingSince !== null &&
    deps.clock().getTime() - waitingSince.getTime() > FRESHNESS_HORIZON_MS
    ? 'stale'
    : 'current'
}

export async function handleAiReviewUrgentDetected(
  deps: AiUrgentReviewNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const fact = parseUrgentDetected(event)
  const org = organizationId(fact.organizationId)
  const obsoleteReceipt = () =>
    deliverNotices(deps, event, ON_AI_REVIEW_URGENT_DETECTED_CONSUMER, [], {
      status: 'obsolete',
    })

  const item = await deps.inboxItemLookup.findInboxItemByReviewId(
    reviewId(fact.reviewId),
    org,
  )
  const state = item === null ? 'pending' : await alertIsCurrent(deps, fact, item)
  if (item === null || state === 'pending') {
    if (projectionPending(deps, fact)) {
      throw new Error('Urgent alert waits for the Inbox to project the review')
    }
    return obsoleteReceipt()
  }
  if (state === 'stale') return obsoleteReceipt()

  const facts = await deps.inboxItemLookup.findInboxItemFacts(item, org)
  if (facts === null) return obsoleteReceipt()
  const recipients = await resolveInboxResponsibleRecipients(deps, org, facts)
  if (recipients.length === 0) {
    deps.logger.warn('urgent alert: no recipients found')
    return obsoleteReceipt()
  }

  // The Property and how long the item has waited; the payload allowlist admits no more.
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: item,
    orgId: org,
    measureWait: true,
  })
  const audience = inboxNotificationAudience(facts)
  return deliverNotices(
    deps,
    event,
    ON_AI_REVIEW_URGENT_DETECTED_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: org,
      propertyId: propertyId(fact.propertyId),
      type: 'review.ai_urgent_detected' as const,
      resourceType: 'inbox_item' as const,
      resourceId: unbrand(item),
      payload,
      audience,
    })),
  )
}

// The Monday email (v3 contract decision 11; ADR 0046, amended 2026-10-30).
// The AI context records one governed fact per Property per Monday it has
// something to say, `ai.guest_voice_summary.ready`. It becomes one notice per
// manager who may use the Property; the reader's own preferences decide the
// rest (the category is `guest_voice`, opt-in on both channels).
//
// Recipients are asked broadly, because consent is the preference and not this
// list: every AccountAdmin and PropertyManager of the Organization who is still
// eligible for the Property (`property_operator`, re-read at delivery). The
// notice carries only what the fact carried, minus the issue's id (ADR 0046
// r.8; ADR 0031). Each Monday is a row of its own.

export const ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER =
  'notification.on-ai-guest-voice-summary-ready' as const

const GUEST_VOICE_EVENT_TYPE = 'ai.guest_voice_summary.ready' as const

export type AiGuestVoiceSummaryNoticeConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    userLookup: Pick<UserLookupPort, 'findByRole'>
    responsibleManagers: Pick<ResponsibleManagerLookupPort, 'isEligibleForProperty'>
    activeProperty: ActivePropertyLookup
  }>

type SummaryFactLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  topic: NotificationGuestVoiceLine['topic']
  issueId: string | null
  reviewCount: number
  textReviewCount: number
  upTo: number | null
  change: 'rising' | 'falling' | null
  polarity: 'complaint' | 'praise' | null
}>

type SummaryReadyPayload = Readonly<{
  organizationId: string
  propertyId: string
  summaryKind: 'weekly' | 'monthly'
  localDate: string
  window: '30d' | '90d' | '180d' | '365d'
  startLocalDate: string
  endLocalDate: string
  lines: readonly SummaryFactLine[]
  occurredAt: string
}>

function parseSummaryReady(event: ConsumerEvent): SummaryReadyPayload {
  if (event.eventType !== GUEST_VOICE_EVENT_TYPE) {
    throw new Error('Guest voice summary consumer received the wrong event type')
  }
  const payload = validateEventPayload(
    GUEST_VOICE_EVENT_TYPE,
    event.eventVersion,
    event.payload,
  ) as SummaryReadyPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Guest voice summary envelope attribution mismatch')
  }
  return payload
}

/** The line as the notice states it: the fact's, in hundredths of a star, with no issue id. */
function summaryLineOf(line: SummaryFactLine): NotificationGuestVoiceLine {
  return {
    kind: line.kind,
    topic: line.topic,
    reviewCount: line.reviewCount,
    textReviewCount: line.textReviewCount,
    ...(line.upTo === null ? {} : { upToHundredths: Math.round(line.upTo * 100) }),
    ...(line.change === null ? {} : { change: line.change }),
    ...(line.polarity === null ? {} : { polarity: line.polarity }),
  }
}

/**
 * The managers who may be told: every AccountAdmin and PropertyManager of the
 * Organization who is eligible for the Property now. Their preferences, not this list,
 * say whether they asked.
 */
async function managersOfProperty(
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
  org: ReturnType<typeof organizationId>,
  property: ReturnType<typeof propertyId>,
): Promise<readonly UserId[]> {
  const [admins, managers] = await Promise.all([
    deps.userLookup.findByRole(org, 'AccountAdmin'),
    deps.userLookup.findByRole(org, 'PropertyManager'),
  ])
  const candidates = [...new Set([...admins, ...managers])]
  const eligible = await Promise.all(
    candidates.map((user) =>
      deps.responsibleManagers.isEligibleForProperty(org, property, user),
    ),
  )
  return candidates.filter((_user, index) => eligible[index] === true)
}

/** One unread-key per Property and Monday: last week's unread row never swallows this week's email. */
export const guestVoiceSummaryResourceId = (
  property: string,
  localDate: string,
): string => `${property}:${localDate}`

export async function handleAiGuestVoiceSummaryReady(
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const fact = parseSummaryReady(event)
  const org = organizationId(fact.organizationId)
  const property = propertyId(fact.propertyId)
  const obsoleteReceipt = () =>
    deliverNotices(deps, event, ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER, [], {
      status: 'obsolete',
    })

  // An archived Property sends nothing: the summary is for a Property people work.
  if (!(await deps.activeProperty(org, property))) return obsoleteReceipt()
  const recipients = await managersOfProperty(deps, org, property)
  if (recipients.length === 0) return obsoleteReceipt()

  const where = await buildPropertyPayload(deps, org, property)
  const payload: NotificationPayload = {
    ...where,
    guestVoiceKind: fact.summaryKind,
    guestVoiceWindow: fact.window,
    guestVoiceLines: fact.lines.map(summaryLineOf),
  }
  return deliverNotices(
    deps,
    event,
    ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: org,
      propertyId: property,
      type: 'guest_voice.summary' as const,
      resourceType: 'property' as const,
      resourceId: guestVoiceSummaryResourceId(fact.propertyId, fact.localDate),
      payload,
      audience: { kind: 'property_operator' as const },
    })),
  )
}
