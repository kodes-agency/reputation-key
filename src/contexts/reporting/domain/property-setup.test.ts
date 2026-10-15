import { describe, expect, it } from 'vitest'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { propertyId } from '#/shared/domain/ids'
import {
  derivePropertySetup,
  derivePropertySetupSteps,
  nextPropertySetupStep,
  propertySetupAttentionCount,
  propertySetupCompletedCount,
  type PropertySetupFacts,
  type PropertySetupMerchantAiState,
  type PropertySetupStepKey,
  type PropertySetupStepStatus,
} from './property-setup'

const PROPERTY = propertyId('10000000-0000-4000-8000-00000000a001')
const ROLES: readonly BetaInteractiveRole[] = ['AccountAdmin', 'PropertyManager']
const AI_STATES: readonly PropertySetupMerchantAiState[] = [
  'disabled',
  'enabled',
  'revoked',
]

const BOOLEAN_FACTS = [
  'googleBindingActive',
  'reviewsSyncedForCurrentSource',
  'replyLanguageChosen',
  'aiDecisionDeferred',
  'responsibleManagerAssigned',
  'replyVoiceConfigured',
  'portalPublished',
] as const

function facts(overrides: Partial<PropertySetupFacts> = {}): PropertySetupFacts {
  return {
    propertyId: PROPERTY,
    googleBindingActive: false,
    reviewsSyncedForCurrentSource: false,
    replyLanguageChosen: false,
    merchantAiState: 'disabled',
    aiDecisionDeferred: false,
    responsibleManagerAssigned: false,
    replyVoiceConfigured: false,
    portalPublished: false,
    propertyActive: true,
    googleReviewCount: null,
    ratingGoalSet: false,
    ratingGoalDeferred: false,
    ...overrides,
  }
}

const COMPLETE: PropertySetupFacts = facts({
  googleBindingActive: true,
  reviewsSyncedForCurrentSource: true,
  replyLanguageChosen: true,
  merchantAiState: 'enabled',
  responsibleManagerAssigned: true,
  replyVoiceConfigured: true,
  portalPublished: true,
})

function statuses(
  subject: PropertySetupFacts,
  role: BetaInteractiveRole,
): Readonly<Record<PropertySetupStepKey, PropertySetupStepStatus>> {
  return Object.fromEntries(
    derivePropertySetupSteps(subject, { role }).map((step) => [step.key, step.status]),
  ) as Record<PropertySetupStepKey, PropertySetupStepStatus>
}

/** Every combination of the seven boolean facts and the three AI states. */
function everyFactCombination(): readonly PropertySetupFacts[] {
  const combinations: PropertySetupFacts[] = []
  for (let mask = 0; mask < 2 ** BOOLEAN_FACTS.length; mask += 1) {
    const flags = Object.fromEntries(
      BOOLEAN_FACTS.map((name, bit) => [name, (mask & (1 << bit)) !== 0]),
    ) as Record<(typeof BOOLEAN_FACTS)[number], boolean>
    for (const merchantAiState of AI_STATES) {
      combinations.push(facts({ ...flags, merchantAiState }))
    }
  }
  return combinations
}

/**
 * The agreed step table (plan B1, decisions 1, 2 and 8), spelled as data:
 * when each step is complete, and what it is otherwise for each role. The
 * rating goal step is not one of a viewer's who may not set goals (these
 * viewers); it has a describe of its own below.
 */
const SPEC: Readonly<
  Record<
    Exclude<PropertySetupStepKey, 'rating_goal'>,
    Readonly<{
      complete: (subject: PropertySetupFacts) => boolean
      otherwise: (
        subject: PropertySetupFacts,
      ) => Readonly<Record<BetaInteractiveRole, PropertySetupStepStatus>>
    }>
  >
> = {
  google_linked: {
    complete: (subject) => subject.googleBindingActive,
    otherwise: () => ({ AccountAdmin: 'pending', PropertyManager: 'needs_admin' }),
  },
  reviews_synced: {
    complete: (subject) => subject.reviewsSyncedForCurrentSource,
    otherwise: (subject) =>
      subject.googleBindingActive
        ? { AccountAdmin: 'waiting', PropertyManager: 'waiting' }
        : { AccountAdmin: 'pending', PropertyManager: 'pending' },
  },
  reply_language: {
    complete: (subject) => subject.replyLanguageChosen,
    otherwise: () => ({ AccountAdmin: 'pending', PropertyManager: 'pending' }),
  },
  ai_decision: {
    complete: (subject) => subject.merchantAiState === 'enabled',
    otherwise: (subject) =>
      subject.aiDecisionDeferred
        ? { AccountAdmin: 'deferred', PropertyManager: 'deferred' }
        : { AccountAdmin: 'pending', PropertyManager: 'needs_admin' },
  },
  responsible_manager: {
    complete: (subject) => subject.responsibleManagerAssigned,
    otherwise: () => ({ AccountAdmin: 'pending', PropertyManager: 'pending' }),
  },
  reply_voice: {
    complete: (subject) => subject.replyVoiceConfigured,
    otherwise: () => ({ AccountAdmin: 'pending', PropertyManager: 'pending' }),
  },
  portal_published: {
    complete: (subject) => subject.portalPublished,
    otherwise: () => ({ AccountAdmin: 'pending', PropertyManager: 'pending' }),
  },
}

describe('derivePropertySetupSteps', () => {
  it('lists the seven steps in setup order with their questionnaire and section metadata', () => {
    expect(
      derivePropertySetupSteps(facts(), { role: 'AccountAdmin' }).map(
        ({ key, asked, section }) => ({ key, asked, section }),
      ),
    ).toEqual([
      { key: 'google_linked', asked: false, section: 'google' },
      { key: 'reviews_synced', asked: false, section: null },
      { key: 'reply_language', asked: true, section: 'replies' },
      { key: 'ai_decision', asked: true, section: 'ai' },
      { key: 'responsible_manager', asked: true, section: 'people' },
      { key: 'reply_voice', asked: false, section: 'replies' },
      { key: 'portal_published', asked: false, section: 'portals' },
    ])
  })

  it('completes every step of a fully configured Property for either role', () => {
    for (const role of ROLES) {
      const setup = derivePropertySetup(COMPLETE, { role })

      expect(setup.steps.every((step) => step.status === 'complete')).toBe(true)
      expect(setup).toMatchObject({ propertyId: PROPERTY, attentionCount: 0 })
    }
  })

  it('leaves every step of an untouched Property to an AccountAdmin', () => {
    expect(statuses(facts(), 'AccountAdmin')).toEqual({
      google_linked: 'pending',
      reviews_synced: 'pending',
      reply_language: 'pending',
      ai_decision: 'pending',
      responsible_manager: 'pending',
      reply_voice: 'pending',
      portal_published: 'pending',
    })
    expect(derivePropertySetup(facts(), { role: 'AccountAdmin' }).attentionCount).toBe(7)
  })

  it('shows a PropertyManager that Google and the AI decision need an AccountAdmin', () => {
    expect(statuses(facts(), 'PropertyManager')).toEqual({
      google_linked: 'needs_admin',
      reviews_synced: 'pending',
      reply_language: 'pending',
      ai_decision: 'needs_admin',
      responsible_manager: 'pending',
      reply_voice: 'pending',
      portal_published: 'pending',
    })
    expect(derivePropertySetup(facts(), { role: 'PropertyManager' }).attentionCount).toBe(
      7,
    )
  })

  it('waits for the first review sync once Google is linked, without asking for attention', () => {
    const linked = facts({ googleBindingActive: true })

    for (const role of ROLES) {
      expect(statuses(linked, role)).toMatchObject({
        google_linked: 'complete',
        reviews_synced: 'waiting',
      })
      expect(derivePropertySetup(linked, { role }).attentionCount).toBe(5)
    }
  })

  it('counts a deferred AI decision as decided for either role', () => {
    for (const merchantAiState of ['disabled', 'revoked'] as const) {
      const deferred = facts({ merchantAiState, aiDecisionDeferred: true })

      expect(statuses(deferred, 'AccountAdmin').ai_decision).toBe('deferred')
      expect(statuses(deferred, 'PropertyManager').ai_decision).toBe('deferred')
      expect(
        derivePropertySetup(deferred, { role: 'PropertyManager' }).attentionCount,
      ).toBe(6)
    }
  })

  it('treats a revoked authorization without a deferral as undecided', () => {
    const revoked = facts({ merchantAiState: 'revoked' })

    expect(statuses(revoked, 'AccountAdmin').ai_decision).toBe('pending')
    expect(statuses(revoked, 'PropertyManager').ai_decision).toBe('needs_admin')
  })

  it('lets an enabled authorization complete the decision even beside a stale deferral', () => {
    const enabled = facts({ merchantAiState: 'enabled', aiDecisionDeferred: true })

    expect(statuses(enabled, 'PropertyManager').ai_decision).toBe('complete')
  })

  it('matches the agreed step table for every fact combination and viewer', () => {
    const combinations = everyFactCombination()
    expect(combinations).toHaveLength(2 ** BOOLEAN_FACTS.length * AI_STATES.length)

    for (const subject of combinations) {
      for (const role of ROLES) {
        const setup = derivePropertySetup(subject, { role })
        const expected = Object.fromEntries(
          Object.entries(SPEC).map(([key, rule]) => [
            key,
            rule.complete(subject) ? 'complete' : rule.otherwise(subject)[role],
          ]),
        )

        expect(statuses(subject, role)).toEqual(expected)
        expect(setup.attentionCount).toBe(
          Object.values(expected).filter(
            (status) => status === 'pending' || status === 'needs_admin',
          ).length,
        )
      }
    }
  })
})

describe('propertySetupAttentionCount', () => {
  it('counts only steps someone still has to act on', () => {
    const step = (status: PropertySetupStepStatus) =>
      ({ key: 'reply_voice', status, asked: false, section: 'replies' }) as const

    expect(
      propertySetupAttentionCount([
        step('complete'),
        step('pending'),
        step('deferred'),
        step('needs_admin'),
        step('waiting'),
      ]),
    ).toBe(2)
    expect(propertySetupAttentionCount([])).toBe(0)
  })
})

describe('propertySetupCompletedCount', () => {
  it('counts a deferred decision as done, and nothing still open', () => {
    const step = (status: PropertySetupStepStatus) =>
      ({ key: 'ai_decision', status, asked: true, section: 'ai' }) as const

    expect(
      propertySetupCompletedCount([
        step('complete'),
        step('deferred'),
        step('pending'),
        step('needs_admin'),
        step('waiting'),
      ]),
    ).toBe(2)
    expect(
      propertySetupCompletedCount(
        derivePropertySetupSteps(COMPLETE, { role: 'PropertyManager' }),
      ),
    ).toBe(7)
  })
})

describe('nextPropertySetupStep', () => {
  it('is nothing once every step is done', () => {
    expect(
      nextPropertySetupStep(derivePropertySetupSteps(COMPLETE, { role: 'AccountAdmin' })),
    ).toBeNull()
  })

  it('offers an AccountAdmin the first step, which they can finish', () => {
    expect(
      nextPropertySetupStep(derivePropertySetupSteps(facts(), { role: 'AccountAdmin' })),
    ).toMatchObject({ key: 'google_linked', status: 'pending', section: 'google' })
  })

  it('prefers a PropertyManager’s own work over steps they cannot finish', () => {
    // Google needs an admin, and the first sync has no section to open.
    expect(
      nextPropertySetupStep(
        derivePropertySetupSteps(facts(), { role: 'PropertyManager' }),
      ),
    ).toMatchObject({ key: 'reply_language', status: 'pending', section: 'replies' })
  })

  it('falls back to a step waiting on an admin when nothing is the viewer’s to do', () => {
    const onlyAdminWork = facts({
      reviewsSyncedForCurrentSource: true,
      replyLanguageChosen: true,
      responsibleManagerAssigned: true,
      replyVoiceConfigured: true,
      portalPublished: true,
    })

    expect(
      nextPropertySetupStep(
        derivePropertySetupSteps(onlyAdminWork, { role: 'PropertyManager' }),
      ),
    ).toMatchObject({ key: 'google_linked', status: 'needs_admin' })
  })

  it('names the admin’s Google link, not the sync it blocks, when that is all that is left', () => {
    const blockedOnGoogle = facts({
      replyLanguageChosen: true,
      merchantAiState: 'enabled',
      responsibleManagerAssigned: true,
      replyVoiceConfigured: true,
      portalPublished: true,
    })

    expect(
      nextPropertySetupStep(
        derivePropertySetupSteps(blockedOnGoogle, { role: 'PropertyManager' }),
      ),
    ).toMatchObject({ key: 'google_linked', status: 'needs_admin' })
  })

  it('names the sync while it is the only thing left, so the list can say so', () => {
    const syncing = facts({
      googleBindingActive: true,
      replyLanguageChosen: true,
      merchantAiState: 'enabled',
      responsibleManagerAssigned: true,
      replyVoiceConfigured: true,
      portalPublished: true,
    })

    expect(
      nextPropertySetupStep(derivePropertySetupSteps(syncing, { role: 'AccountAdmin' })),
    ).toMatchObject({ key: 'reviews_synced', status: 'waiting', section: null })
  })
})

describe('the Google rating goal step', () => {
  const offered = facts({ ...COMPLETE, googleReviewCount: 812 })
  const goalViewer = (role: BetaInteractiveRole) => ({ role, ratingGoalsEnabled: true })
  const ratingGoalStep = (subject: PropertySetupFacts, role: BetaInteractiveRole) =>
    derivePropertySetupSteps(subject, goalViewer(role)).find(
      (step) => step.key === 'rating_goal',
    )

  it('comes last, as an eighth step that opens the Goals page', () => {
    // Act
    const steps = derivePropertySetupSteps(offered, goalViewer('AccountAdmin'))

    // Assert
    expect(steps).toHaveLength(8)
    expect(steps.at(-1)).toEqual({
      key: 'rating_goal',
      status: 'pending',
      asked: false,
      section: 'goals',
    })
  })

  it('is open work for either role until a goal is set', () => {
    for (const role of ROLES) {
      // Act
      const setup = derivePropertySetup(offered, goalViewer(role))

      // Assert
      expect(ratingGoalStep(offered, role)?.status).toBe('pending')
      expect(setup.attentionCount).toBe(1)
      expect(nextPropertySetupStep(setup.steps)).toMatchObject({ key: 'rating_goal' })
    }
  })

  it('is done once a goal is set, and stays done after it is reached or a manager ends it', () => {
    // Arrange: the repository counts an active goal, one reached, and one a manager ended.
    const withGoal = facts({ ...offered, ratingGoalSet: true })

    // Act
    const steps = derivePropertySetupSteps(withGoal, goalViewer('PropertyManager'))

    // Assert
    expect(ratingGoalStep(withGoal, 'PropertyManager')?.status).toBe('complete')
    expect(propertySetupCompletedCount(steps)).toBe(8)
    expect(nextPropertySetupStep(steps)).toBeNull()
  })

  it('counts "Not now" as done, so it never nags', () => {
    // Arrange
    const notNow = facts({ ...offered, ratingGoalDeferred: true })

    // Act
    const setup = derivePropertySetup(notNow, goalViewer('AccountAdmin'))

    // Assert
    expect(ratingGoalStep(notNow, 'AccountAdmin')?.status).toBe('deferred')
    expect(propertySetupCompletedCount(setup.steps)).toBe(8)
    expect(setup.attentionCount).toBe(0)
  })

  it('lets an active goal complete the step even beside an earlier "Not now"', () => {
    // Arrange
    const both = facts({ ...offered, ratingGoalSet: true, ratingGoalDeferred: true })

    // Act / Assert
    expect(ratingGoalStep(both, 'AccountAdmin')?.status).toBe('complete')
  })

  it('is hidden below ten Google reviews, without Google’s numbers, or off an active Property', () => {
    const hidden = [
      facts({ ...COMPLETE, googleReviewCount: 9 }),
      facts({ ...COMPLETE, googleReviewCount: null }),
      facts({ ...COMPLETE, googleReviewCount: 812, propertyActive: false }),
    ]

    for (const subject of hidden) {
      // Act
      const steps = derivePropertySetupSteps(subject, goalViewer('AccountAdmin'))

      // Assert
      expect(steps.map((step) => step.key)).not.toContain('rating_goal')
      expect(steps).toHaveLength(7)
    }
  })

  it('is hidden from a viewer who cannot set rating goals here', () => {
    // Act
    const steps = derivePropertySetupSteps(offered, {
      role: 'AccountAdmin',
      ratingGoalsEnabled: false,
    })

    // Assert
    expect(steps.map((step) => step.key)).not.toContain('rating_goal')
  })

  it('keeps a set goal counted when Google’s count is not read any more', () => {
    // Arrange
    const withGoal = facts({
      ...COMPLETE,
      googleReviewCount: null,
      ratingGoalSet: true,
    })

    // Act / Assert
    expect(ratingGoalStep(withGoal, 'AccountAdmin')?.status).toBe('complete')
  })

  it('is hidden off an active Property even when a goal was set there', () => {
    // Arrange: suspending a Property does not end its goal.
    const suspended = facts({
      ...offered,
      propertyActive: false,
      ratingGoalSet: true,
      ratingGoalDeferred: true,
    })

    // Act
    const steps = derivePropertySetupSteps(suspended, goalViewer('AccountAdmin'))

    // Assert
    expect(steps.map((step) => step.key)).not.toContain('rating_goal')
    expect(propertySetupCompletedCount(steps)).toBe(7)
  })
})
