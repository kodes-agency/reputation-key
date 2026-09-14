// Per-Property setup — the seven setup steps derived from current facts.
//
// Pure and content-free: a Property's facts are booleans and one AI state, and
// every status reflects what is true now. Unlike the Organization setup
// checklist there is no monotonic milestone history, so a step that stops
// being true (a disconnected Google binding, an unpublished Portal) returns to
// needing attention.

import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import type { PropertyId } from '#/shared/domain/ids'

export const PROPERTY_SETUP_STEP_KEYS = [
  'google_linked',
  'reviews_synced',
  'reply_language',
  'ai_decision',
  'responsible_manager',
  'reply_voice',
  'portal_published',
] as const

export type PropertySetupStepKey = (typeof PROPERTY_SETUP_STEP_KEYS)[number]

/**
 * - `complete`: the fact holds.
 * - `pending`: the viewer can finish the step.
 * - `needs_admin`: only an AccountAdmin can finish the step.
 * - `deferred`: the AI decision was consciously postponed; it counts as decided.
 * - `waiting`: nothing to do but wait for the system (the first review sync).
 */
export type PropertySetupStepStatus =
  'complete' | 'pending' | 'deferred' | 'needs_admin' | 'waiting'

/** Property settings hub section that finishes a step. */
export type PropertySetupSection =
  'profile' | 'google' | 'replies' | 'ai' | 'people' | 'targets' | 'portals'

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
}>

export type PropertySetupViewer = Readonly<{ role: BetaInteractiveRole }>

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
} as const satisfies Readonly<Record<PropertySetupStepKey, StepDefinition>>

/** Decision 8: Google linking and the AI decision stay AccountAdmin work. */
function accountAdminWork(viewer: PropertySetupViewer): PropertySetupStepStatus {
  return viewer.role === 'AccountAdmin' ? 'pending' : 'needs_admin'
}

function statusOf(
  key: PropertySetupStepKey,
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
): PropertySetupStepStatus {
  switch (key) {
    case 'google_linked':
      return facts.googleBindingActive ? 'complete' : accountAdminWork(viewer)
    case 'reviews_synced':
      if (facts.reviewsSyncedForCurrentSource) return 'complete'
      return facts.googleBindingActive ? 'waiting' : 'pending'
    case 'reply_language':
      return facts.replyLanguageChosen ? 'complete' : 'pending'
    case 'ai_decision':
      if (facts.merchantAiState === 'enabled') return 'complete'
      return facts.aiDecisionDeferred ? 'deferred' : accountAdminWork(viewer)
    case 'responsible_manager':
      return facts.responsibleManagerAssigned ? 'complete' : 'pending'
    case 'reply_voice':
      return facts.replyVoiceConfigured ? 'complete' : 'pending'
    case 'portal_published':
      return facts.portalPublished ? 'complete' : 'pending'
  }
}

/** The seven steps, in setup order, for one viewer. */
export function derivePropertySetupSteps(
  facts: PropertySetupFacts,
  viewer: PropertySetupViewer,
): readonly PropertySetupStep[] {
  return PROPERTY_SETUP_STEP_KEYS.map((key) =>
    Object.freeze({
      key,
      status: statusOf(key, facts, viewer),
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
