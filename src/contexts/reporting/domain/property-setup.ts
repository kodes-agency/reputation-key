// Per-Property setup — the setup steps derived from current facts.
//
// Pure and content-free: a Property's facts are booleans, one AI state and
// Google's review count, and every status reflects what is true now. Unlike the
// Organization setup checklist there is no monotonic milestone history, so a
// step that stops being true (a disconnected Google binding, an unpublished
// Portal) returns to needing attention.
//
// Seven steps always; an eighth, the Google rating goal (ADR 0067), only where
// a goal can be set: an active Property Google counts ten reviews for, seen by
// a viewer who may set one. It is done when a goal is active or a manager
// chose "Not now", which counts as done the way a deferred AI decision does.

import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import type { PropertyId } from '#/shared/domain/ids'
import { ratingGoalOffered } from './google-numbers'

const PROPERTY_SETUP_STEP_KEYS = [
  'google_linked',
  'reviews_synced',
  'reply_language',
  'ai_decision',
  'responsible_manager',
  'reply_voice',
  'portal_published',
  'rating_goal',
] as const

export type PropertySetupStepKey = (typeof PROPERTY_SETUP_STEP_KEYS)[number]

/**
 * - `complete`: the fact holds.
 * - `pending`: the viewer can finish the step.
 * - `needs_admin`: only an AccountAdmin can finish the step.
 * - `deferred`: the AI decision or the rating goal was consciously postponed
 *   ("Not now"); it counts as decided.
 * - `waiting`: nothing to do but wait for the system (the first review sync).
 */
export type PropertySetupStepStatus =
  'complete' | 'pending' | 'deferred' | 'needs_admin' | 'waiting'

/**
 * Where a step is finished: a Property settings hub section, or a Property page
 * outside the hub (its Portals, its Goals).
 */
export type PropertySetupSection =
  'profile' | 'google' | 'replies' | 'ai' | 'people' | 'targets' | 'portals' | 'goals'

export type PropertySetupStep = Readonly<{
  key: PropertySetupStepKey
  status: PropertySetupStepStatus
  /** Whether the setup questionnaire asks this step; the rest are facts or later nudges. */
  asked: boolean
  /** Where the step is finished; null when there is nothing to edit. */
  section: PropertySetupSection | null
}>

export type PropertySetupMerchantAiState = 'disabled' | 'enabled' | 'revoked'

/** Current, content-free facts about one live Property. */
export type PropertySetupFacts = Readonly<{
  propertyId: PropertyId
  /** `properties.google_binding_state` is `active`. */
  googleBindingActive: boolean
  /** A completed review sync exists for the Property's current source epoch. */
  reviewsSyncedForCurrentSource: boolean
  /** `properties.default_reply_language` is set. */
  replyLanguageChosen: boolean
  /** Merchant AI authorization state; `disabled` when never authorized. */
  merchantAiState: PropertySetupMerchantAiState
  /** A standing "not now" AI decision exists. */
  aiDecisionDeferred: boolean
  /** At least one current Property Responsible Manager. */
  responsibleManagerAssigned: boolean
  /** A reply profile (reply voice) exists. */
  replyVoiceConfigured: boolean
  /** At least one Portal is published with a live publication activation. */
  portalPublished: boolean
  /** `properties.lifecycle_state` is `active`. */
  propertyActive: boolean
  /** Google's review count at the current binding; null when Google sent none. */
  googleReviewCount: number | null
  /** The Property has an active Google rating goal. */
  ratingGoalActive: boolean
  /** A manager chose "Not now" for the Property's Google rating goal. */
  ratingGoalDeferred: boolean
}>

export type PropertySetupViewer = Readonly<{
  role: BetaInteractiveRole
  /**
   * The viewer may set a Google rating goal here (`goal.create`, with `goal.use`
   * on). Without it the rating goal step is not one of theirs to see.
   */
  ratingGoalsEnabled?: boolean
}>

export type PropertySetup = Readonly<{
  propertyId: PropertyId
  steps: readonly PropertySetupStep[]
  /** Steps with status `pending` or `needs_admin`. */
  attentionCount: number
}>

type StepDefinition = Readonly<{
  asked: boolean
  section: PropertySetupSection | null
}>

/** Decision 2: only reply language, the AI decision and the manager are asked. */
const STEP_DEFINITIONS = {
  google_linked: { asked: false, section: 'google' },
  reviews_synced: { asked: false, section: null },
  reply_language: { asked: true, section: 'replies' },
  ai_decision: { asked: true, section: 'ai' },
  responsible_manager: { asked: true, section: 'people' },
  reply_voice: { asked: false, section: 'replies' },
  portal_published: { asked: false, section: 'portals' },
  rating_goal: { asked: false, section: 'goals' },
} as const satisfies Readonly<Record<PropertySetupStepKey, StepDefinition>>

/** Decision 8: Google linking and the AI decision stay AccountAdmin work. */
function accountAdminWork(viewer: PropertySetupViewer): PropertySetupStepStatus {
  return viewer.role === 'AccountAdmin' ? 'pending' : 'needs_admin'
}

/** Done when the fact holds; otherwise `otherwise`. */
const doneOr = (
  holds: boolean,
  otherwise: PropertySetupStepStatus,
): PropertySetupStepStatus => (holds ? 'complete' : otherwise)

/** Done when it holds; put off ("Not now") when deferred; otherwise `otherwise`. */
function decided(
  holds: boolean,
  deferred: boolean,
  otherwise: PropertySetupStepStatus,
): PropertySetupStepStatus {
  if (holds) return 'complete'
  return deferred ? 'deferred' : otherwise
}

type StatusRule = (
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
) => PropertySetupStepStatus

/** Each step's status, from the facts and the viewer. */
const STATUS_OF = {
  google_linked: (facts, viewer) =>
    doneOr(facts.googleBindingActive, accountAdminWork(viewer)),
  reviews_synced: (facts) =>
    doneOr(
      facts.reviewsSyncedForCurrentSource,
      facts.googleBindingActive ? 'waiting' : 'pending',
    ),
  reply_language: (facts) => doneOr(facts.replyLanguageChosen, 'pending'),
  ai_decision: (facts, viewer) =>
    decided(
      facts.merchantAiState === 'enabled',
      facts.aiDecisionDeferred,
      accountAdminWork(viewer),
    ),
  responsible_manager: (facts) => doneOr(facts.responsibleManagerAssigned, 'pending'),
  reply_voice: (facts) => doneOr(facts.replyVoiceConfigured, 'pending'),
  portal_published: (facts) => doneOr(facts.portalPublished, 'pending'),
  rating_goal: (facts) =>
    decided(facts.ratingGoalActive, facts.ratingGoalDeferred, 'pending'),
} as const satisfies Readonly<Record<PropertySetupStepKey, StatusRule>>

/**
 * Whether a step is the viewer's to see. The rating goal step is, where a goal
 * can be set or one is already active (it stays counted when Google's count is
 * not read any more).
 */
function stepShown(
  key: PropertySetupStepKey,
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
): boolean {
  if (key !== 'rating_goal') return true
  if (viewer.ratingGoalsEnabled !== true) return false
  return facts.ratingGoalActive || ratingGoalOffered(facts)
}

/** The steps the viewer sees, in setup order: seven, or eight with the rating goal. */
export function derivePropertySetupSteps(
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
): readonly PropertySetupStep[] {
  const shown = PROPERTY_SETUP_STEP_KEYS.filter((key) => stepShown(key, facts, viewer))
  return shown.map((key) =>
    Object.freeze({
      key,
      status: STATUS_OF[key](facts, viewer),
      asked: STEP_DEFINITIONS[key].asked,
      section: STEP_DEFINITIONS[key].section,
    }),
  )
}

/** Steps someone still has to act on; `deferred`, `waiting` and `complete` do not count. */
export function propertySetupAttentionCount(steps: readonly PropertySetupStep[]): number {
  return steps.filter(
    (step) => step.status === 'pending' || step.status === 'needs_admin',
  ).length
}

/** Steps that are done for the viewer: a deferred step ("Not now") counts as decided. */
export function propertySetupCompletedCount(steps: readonly PropertySetupStep[]): number {
  return steps.filter((step) => step.status === 'complete' || step.status === 'deferred')
    .length
}

/**
 * The one step to point a viewer at: their own work where there is somewhere to
 * finish it; else work waiting on an AccountAdmin; else whatever is left — a
 * first sync that cannot start or is running. `null` once nothing is left.
 *
 * A pending step without a section is only ever the first sync while Google is
 * unlinked, which nobody can do directly: linking Google comes first, and for a
 * PropertyManager that link is AccountAdmin work.
 */
export function nextPropertySetupStep(
  steps: readonly PropertySetupStep[],
): PropertySetupStep | null {
  return (
    steps.find((step) => step.status === 'pending' && step.section !== null) ??
    steps.find((step) => step.status === 'needs_admin') ??
    steps.find((step) => step.status === 'pending' || step.status === 'waiting') ??
    null
  )
}

export function derivePropertySetup(
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
): PropertySetup {
  const steps = derivePropertySetupSteps(facts, viewer)
  return Object.freeze({
    propertyId: facts.propertyId,
    steps,
    attentionCount: propertySetupAttentionCount(steps),
  })
}
