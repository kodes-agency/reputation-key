import { describe, expect, it } from 'vitest'
import type { PropertySetup } from '#/contexts/reporting/application/public-api'
import { propertyId } from '#/shared/domain/ids'
import {
  completedPropertySetupStepCount,
  firstPropertySetupSection,
  openPropertySetupSteps,
  propertySetupStepLabel,
  propertySetupStepTarget,
} from './property-setup-steps'

const setup = (
  statuses: Partial<
    Record<
      PropertySetup['steps'][number]['key'],
      PropertySetup['steps'][number]['status']
    >
  >,
): PropertySetup => {
  const steps: PropertySetup['steps'] = [
    { key: 'google_linked', status: 'complete', asked: false, section: 'google' },
    { key: 'reviews_synced', status: 'complete', asked: false, section: null },
    { key: 'reply_language', status: 'complete', asked: true, section: 'replies' },
    { key: 'ai_decision', status: 'complete', asked: true, section: 'ai' },
    { key: 'responsible_manager', status: 'complete', asked: true, section: 'people' },
    { key: 'reply_voice', status: 'complete', asked: false, section: 'replies' },
    { key: 'portal_published', status: 'complete', asked: false, section: 'portals' },
  ].map((step) => ({
    ...step,
    status: statuses[step.key as keyof typeof statuses] ?? step.status,
  })) as PropertySetup['steps']
  return {
    propertyId: propertyId('10000000-0000-4000-8000-000000000101'),
    steps,
    attentionCount: steps.filter(
      (s) => s.status === 'pending' || s.status === 'needs_admin',
    ).length,
  }
}

describe('property setup steps', () => {
  it('opens the hub on the first step the viewer can finish', () => {
    expect(
      firstPropertySetupSection(
        setup({ ai_decision: 'needs_admin', responsible_manager: 'pending' }),
      ),
    ).toBe('people')
    expect(firstPropertySetupSection(setup({ reply_language: 'pending' }))).toBe(
      'replies',
    )
  })

  it('does not open the hub on a portal-only gap', () => {
    expect(firstPropertySetupSection(setup({ portal_published: 'pending' }))).toBeNull()
  })

  it('counts a deferred AI decision as done and a sync as open but waiting', () => {
    const current = setup({ ai_decision: 'deferred', reviews_synced: 'waiting' })
    expect(completedPropertySetupStepCount(current)).toBe(6)
    expect(openPropertySetupSteps(current).map((step) => step.key)).toEqual([
      'reviews_synced',
    ])
  })

  it('finishes a step in its settings section, a portal on the portals page', () => {
    const [google, sync, , , manager, , portal] = setup({}).steps
    expect(propertySetupStepTarget(google!)).toBe(
      '/properties/$propertyId/settings/google',
    )
    expect(propertySetupStepTarget(manager!)).toBe(
      '/properties/$propertyId/settings/people',
    )
    expect(propertySetupStepTarget(portal!)).toBe('/properties/$propertyId/portals')
    // The first sync has nothing to edit.
    expect(propertySetupStepTarget(sync!)).toBeNull()
  })

  it('words a waiting sync and an admin-only AI decision for what the viewer can do', () => {
    const current = setup({ ai_decision: 'needs_admin', reviews_synced: 'waiting' })
    const labels = openPropertySetupSteps(current).map(propertySetupStepLabel)
    expect(labels).toEqual(['Reviews are syncing', 'An account admin decides on AI'])
  })
})
