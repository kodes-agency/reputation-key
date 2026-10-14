import type {
  PropertySetup,
  PropertySetupSection,
  PropertySetupStep,
  PropertySetupStepKey,
} from '#/contexts/reporting/application/public-api'
import { RATING_GOAL_ARRIVAL_SEARCH } from '#/components/goals/rating-goal-arrival-search'
import type { PropertySettingsSectionKey } from './property-settings-sections'

const STEP_LABEL: Readonly<Record<PropertySetupStepKey, string>> = {
  google_linked: 'Link the Google Business Profile',
  reviews_synced: 'Sync Google reviews',
  reply_language: 'Choose a reply language',
  ai_decision: 'Decide on AI',
  responsible_manager: 'Assign a responsible manager',
  reply_voice: 'Set the reply voice',
  portal_published: 'Publish a portal',
  rating_goal: 'Set a Google rating goal',
}

export function propertySetupStepLabel(step: PropertySetupStep): string {
  if (step.key === 'reviews_synced' && step.status === 'waiting') {
    return 'Reviews are syncing'
  }
  if (step.key === 'ai_decision' && step.status === 'needs_admin') {
    return 'An account admin decides on AI'
  }
  return STEP_LABEL[step.key]
}

/**
 * Whether AI is on for the property, read from the setup step that tracks it, so
 * a role that cannot read the AI authorization itself (a PropertyManager) still
 * sees the state. A deferred, revoked or undecided step is off. `undefined`
 * until setup is available.
 */
export function propertyAiIsOn(setup: PropertySetup | undefined): boolean | undefined {
  const step = setup?.steps.find((candidate) => candidate.key === 'ai_decision')
  return step === undefined ? undefined : step.status === 'complete'
}

/** Steps the viewer should see as open work, in setup order. */
export function openPropertySetupSteps(
  setup: PropertySetup,
): ReadonlyArray<PropertySetupStep> {
  return setup.steps.filter(
    (step) =>
      step.status === 'pending' ||
      step.status === 'needs_admin' ||
      step.status === 'waiting',
  )
}

export function completedPropertySetupStepCount(setup: PropertySetup): number {
  return setup.steps.filter(
    (step) => step.status === 'complete' || step.status === 'deferred',
  ).length
}

/**
 * Where the hub should open while setup is unfinished: the section of the
 * first step the viewer can act on. Portals and Goals live outside the hub, so
 * a gap only there still opens on Profile.
 */
export function firstPropertySetupSection(
  setup: PropertySetup,
): PropertySettingsSectionKey | null {
  const step = setup.steps.find(
    (candidate) =>
      candidate.status === 'pending' &&
      candidate.section !== null &&
      candidate.section !== 'portals' &&
      candidate.section !== 'goals',
  )
  return (step?.section as PropertySettingsSectionKey | undefined) ?? null
}

/** Sections that are Property pages of their own, outside the settings hub. */
type PageSection = Extract<PropertySetupSection, 'portals' | 'goals'>

export type PropertySetupStepTarget =
  | `/properties/$propertyId/${PageSection}`
  | `/properties/$propertyId/settings/${Exclude<PropertySetupSection, PageSection>}`

/**
 * The page that finishes a step: its settings section, or the Portals or Goals
 * page, which live outside the hub (the Goals page opens the rating goal wizard
 * on arrival, `propertySetupStepSearch`). `null` for a step with nothing to
 * edit (the first review sync).
 */
export function propertySetupStepTarget(
  step: PropertySetupStep,
): PropertySetupStepTarget | null {
  if (step.section === null) return null
  if (step.section === 'portals') return '/properties/$propertyId/portals'
  if (step.section === 'goals') return '/properties/$propertyId/goals'
  return `/properties/$propertyId/settings/${step.section}`
}

/**
 * What a step's link carries: the rating goal step opens its wizard on arrival
 * at the Goals page, one click as the Overview's prompt is. No other step does.
 */
export function propertySetupStepSearch(
  step: PropertySetupStep,
): typeof RATING_GOAL_ARRIVAL_SEARCH | undefined {
  return step.key === 'rating_goal' ? RATING_GOAL_ARRIVAL_SEARCH : undefined
}

/**
 * Whether a manager chose "Not now" for the Google rating goal: the Overview's
 * prompt then says nothing. `undefined` until setup is available; false where
 * the step is open, done, or not the viewer's.
 */
export function ratingGoalNotNowChosen(
  setup: PropertySetup | undefined,
): boolean | undefined {
  if (setup === undefined) return undefined
  return setup.steps.some(
    (step) => step.key === 'rating_goal' && step.status === 'deferred',
  )
}
