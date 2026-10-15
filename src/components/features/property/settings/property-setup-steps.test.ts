import { describe, expect, it } from 'vitest'
import type { PropertySetup } from '#/contexts/reporting/application/public-api'
import { propertyId } from '#/shared/domain/ids'
import {
  completedPropertySetupStepCount,
  firstPropertySetupSection,
  openPropertySetupSteps,
  propertyAiIsOn,
  propertySetupStepLabel,
  propertySetupStepSearch,
  propertySetupStepTarget,
  ratingGoalNotNowChosen,
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

  it('sends the Google rating goal step to the Goals page, never into the hub', () => {
    // Arrange
    const goal = {
      key: 'rating_goal',
      status: 'pending',
      asked: false,
      section: 'goals',
    } as const
    const withGoal: PropertySetup = { ...setup({}), steps: [...setup({}).steps, goal] }

    // Act / Assert
    expect(propertySetupStepTarget(goal)).toBe('/properties/$propertyId/goals')
    expect(propertySetupStepLabel(goal)).toBe('Set a Google rating goal')
    expect(firstPropertySetupSection(withGoal)).toBeNull()
    expect(completedPropertySetupStepCount(withGoal)).toBe(7)
    expect(
      completedPropertySetupStepCount({
        ...withGoal,
        steps: [...setup({}).steps, { ...goal, status: 'deferred' }],
      }),
    ).toBe(8)
  })

  it('opens the rating goal wizard on arrival at the Goals page, and no other step', () => {
    // Arrange
    const goal = {
      key: 'rating_goal',
      status: 'pending',
      asked: false,
      section: 'goals',
    } as const
    const [google, , , , , , portal] = setup({}).steps

    // Act / Assert
    expect(propertySetupStepSearch(goal)).toEqual({ start: 'rating-goal' })
    expect(propertySetupStepSearch(google!)).toBeUndefined()
    expect(propertySetupStepSearch(portal!)).toBeUndefined()
  })

  it('words a waiting sync and an admin-only AI decision for what the viewer can do', () => {
    const current = setup({ ai_decision: 'needs_admin', reviews_synced: 'waiting' })
    const labels = openPropertySetupSteps(current).map(propertySetupStepLabel)
    expect(labels).toEqual(['Reviews are syncing', 'An account admin decides on AI'])
  })
})

// A PropertyManager cannot read the AI authorization (an AccountAdmin decides it),
// but the setup they already load carries one step for it, and only `complete`
// means AI is on: a deferred or revoked decision, or none yet, is off.
describe('propertyAiIsOn', () => {
  it('is on only when the AI decision step is complete', () => {
    expect(propertyAiIsOn(setup({ ai_decision: 'complete' }))).toBe(true)
  })

  it.each(['needs_admin', 'pending', 'deferred'] as const)(
    'is off while the AI decision step is %s',
    (status) => {
      expect(propertyAiIsOn(setup({ ai_decision: status }))).toBe(false)
    },
  )

  it('is unknown until setup is available', () => {
    expect(propertyAiIsOn(undefined)).toBeUndefined()
  })
})

// The Overview's one-line prompt honours the strip's "Not now" (orchestrator call,
// PR 4 review): it reads the choice from the setup the Overview already loads.
describe('ratingGoalNotNowChosen', () => {
  const goal = (status: 'pending' | 'deferred' | 'complete') =>
    ({
      ...setup({}),
      steps: [
        ...setup({}).steps,
        { key: 'rating_goal', status, asked: false, section: 'goals' },
      ],
    }) as PropertySetup

  it('is true once a manager chose "Not now" for the rating goal step', () => {
    expect(ratingGoalNotNowChosen(goal('deferred'))).toBe(true)
  })

  it('is false while the step is open, done, or not the viewer’s', () => {
    expect(ratingGoalNotNowChosen(goal('pending'))).toBe(false)
    expect(ratingGoalNotNowChosen(goal('complete'))).toBe(false)
    expect(ratingGoalNotNowChosen(setup({}))).toBe(false)
  })

  it('is unknown until setup is available', () => {
    expect(ratingGoalNotNowChosen(undefined)).toBeUndefined()
  })
})
