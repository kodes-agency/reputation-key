import type {
  PropertySetup,
  PropertySetupStep,
  PropertySetupStepKey,
} from '#/contexts/reporting/application/public-api'
import type { PropertySettingsSectionKey } from './property-settings-sections'

const STEP_LABEL: Readonly<Record<PropertySetupStepKey, string>> = {
  google_linked: 'Link the Google Business Profile',
  reviews_synced: 'Sync Google reviews',
  reply_language: 'Choose a reply language',
  ai_decision: 'Decide on AI',
  responsible_manager: 'Assign a responsible manager',
  reply_voice: 'Set the reply voice',
  portal_published: 'Publish a portal',
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
 * first step the viewer can act on. Portals live outside the hub, so a
 * portal-only gap still opens on Profile.
 */
export function firstPropertySetupSection(
  setup: PropertySetup,
): PropertySettingsSectionKey | null {
  const step = setup.steps.find(
    (candidate) =>
      candidate.status === 'pending' &&
      candidate.section !== null &&
      candidate.section !== 'portals',
  )
  return (step?.section as PropertySettingsSectionKey | undefined) ?? null
}
