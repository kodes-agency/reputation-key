import { describe, expect, it } from 'vitest'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { propertyId } from '#/shared/domain/ids'
import {
  derivePropertySetup,
  derivePropertySetupSteps,
  propertySetupAttentionCount,
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
 * when each step is complete, and what it is otherwise for each role.
 */
const SPEC: Readonly<
  Record<
    PropertySetupStepKey,
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
