import { describe, expect, it } from 'vitest'
import {
  aiEnabledPropertyNames,
  buildSetupPlan,
  defaultManagerIds,
  initialSetupAnswers,
  managersEligibleForAll,
  propertiesAskedAi,
  propertiesAskedLanguage,
  propertiesAskedManagers,
  toggleAiCapability,
  type SetupPropertyFacts,
} from './setup-plan'

const ADMIN = 'user-admin'
const MANAGER = 'user-manager'

function property(
  overrides: Partial<SetupPropertyFacts> & { propertyId: string },
): SetupPropertyFacts {
  return {
    propertyName: `Property ${overrides.propertyId}`,
    countryCode: 'DE',
    replyLanguage: null,
    aiDecided: false,
    managerIds: [],
    eligibleManagerIds: [ADMIN, MANAGER],
    ...overrides,
  }
}

const berlin = property({ propertyId: 'berlin', propertyName: 'Hotel Berlin' })
const lisbon = property({
  propertyId: 'lisbon',
  propertyName: 'Casa Lisboa',
  countryCode: 'PT',
})
const athens = property({
  propertyId: 'athens',
  propertyName: 'Athens Rooms',
  countryCode: 'GR',
})

describe('which properties each question asks', () => {
  it('asks only the steps a property has not completed', () => {
    const configured = property({
      propertyId: 'configured',
      replyLanguage: 'en-Latn',
      aiDecided: true,
      managerIds: [MANAGER],
    })
    const facts = [berlin, configured]

    expect(propertiesAskedLanguage(facts)).toEqual([berlin])
    expect(propertiesAskedManagers(facts)).toEqual([berlin])
    expect(propertiesAskedAi(facts)).toEqual([berlin])
  })

  it('does not ask for a manager where nobody is eligible', () => {
    const orphan = property({ propertyId: 'orphan', eligibleManagerIds: [] })
    expect(propertiesAskedManagers([orphan])).toEqual([])
  })
})

describe('default answers', () => {
  it('suggests each property its country language and the importing admin as manager', () => {
    const answers = initialSetupAnswers([berlin, lisbon], ADMIN)

    expect(answers.language).toEqual({ kind: 'suggested' })
    expect(answers.managers).toEqual({
      applyToAll: true,
      managerIds: [ADMIN],
      overrides: {},
    })
    expect(answers.ai).toBeNull()
  })

  it('leaves the manager unanswered when the admin is not eligible everywhere', () => {
    const restricted = property({
      propertyId: 'restricted',
      eligibleManagerIds: [MANAGER],
    })

    expect(managersEligibleForAll([berlin, restricted])).toEqual([MANAGER])
    expect(defaultManagerIds([berlin, restricted], ADMIN)).toEqual([])
    expect(initialSetupAnswers([berlin, restricted], ADMIN).managers).toBeNull()
  })
})

describe('building the setup plan', () => {
  it('writes suggested languages, one manager set, and one AI ceremony', () => {
    const plan = buildSetupPlan([berlin, lisbon, athens], {
      language: { kind: 'suggested' },
      managers: { applyToAll: true, managerIds: [ADMIN], overrides: {} },
      ai: {
        kind: 'enable',
        capabilities: ['review_analysis', 'reply_drafting'],
        applyToAll: true,
        excluded: [],
      },
    })

    expect(
      plan.properties.map(({ propertyId, language }) => [propertyId, language]),
    ).toEqual([
      ['berlin', 'de-Latn'],
      ['lisbon', 'pt-Latn'],
      ['athens', 'en-Latn'],
    ])
    expect(plan.properties.every((entry) => entry.managerIds?.join() === ADMIN)).toBe(
      true,
    )
    expect(plan.properties.every((entry) => entry.ai === 'enable')).toBe(true)
    expect(plan.aiCapabilities).toEqual(['review_analysis', 'reply_drafting'])
    expect(aiEnabledPropertyNames(plan)).toEqual([
      'Hotel Berlin',
      'Casa Lisboa',
      'Athens Rooms',
    ])
  })

  it('applies per-property overrides when an answer is not applied to all', () => {
    const plan = buildSetupPlan([berlin, lisbon], {
      language: {
        kind: 'chosen',
        applyToAll: false,
        language: 'en-Latn',
        overrides: { lisbon: 'es-Latn' },
      },
      managers: {
        applyToAll: false,
        managerIds: [ADMIN],
        overrides: { lisbon: [MANAGER] },
      },
      ai: {
        kind: 'enable',
        capabilities: ['review_analysis'],
        applyToAll: false,
        excluded: ['lisbon'],
      },
    })

    expect(plan.properties).toEqual([
      {
        propertyId: 'berlin',
        propertyName: 'Hotel Berlin',
        language: 'en-Latn',
        managerIds: [ADMIN],
        ai: 'enable',
      },
      {
        propertyId: 'lisbon',
        propertyName: 'Casa Lisboa',
        language: 'es-Latn',
        managerIds: [MANAGER],
        ai: 'defer',
      },
    ])
  })

  it('ignores overrides while an answer applies to all', () => {
    const plan = buildSetupPlan([lisbon], {
      language: {
        kind: 'chosen',
        applyToAll: true,
        language: 'fr-Latn',
        overrides: { lisbon: 'es-Latn' },
      },
      managers: null,
      ai: {
        kind: 'enable',
        capabilities: ['reply_drafting'],
        applyToAll: true,
        excluded: ['lisbon'],
      },
    })

    expect(plan.properties[0]).toMatchObject({ language: 'fr-Latn', ai: 'enable' })
  })

  it('writes nothing for a skipped question or a step that is already complete', () => {
    const configured = property({
      propertyId: 'configured',
      replyLanguage: 'en-Latn',
      aiDecided: true,
      managerIds: [MANAGER],
    })
    const plan = buildSetupPlan([berlin, configured], {
      language: { kind: 'suggested' },
      managers: null,
      ai: { kind: 'defer' },
    })

    expect(plan.properties).toEqual([
      {
        propertyId: 'berlin',
        propertyName: 'Hotel Berlin',
        language: 'de-Latn',
        managerIds: null,
        ai: 'defer',
      },
      {
        propertyId: 'configured',
        propertyName: 'Property configured',
        language: null,
        managerIds: null,
        ai: null,
      },
    ])
    expect(plan.aiCapabilities).toEqual([])
  })

  it('drops managers a property cannot take and writes nothing when none are left', () => {
    const restricted = property({
      propertyId: 'restricted',
      eligibleManagerIds: [MANAGER],
    })
    const plan = buildSetupPlan([berlin, restricted], {
      language: null,
      managers: { applyToAll: true, managerIds: [ADMIN], overrides: {} },
      ai: null,
    })

    expect(plan.properties.map((entry) => entry.managerIds)).toEqual([[ADMIN], null])
  })

  it('enables nothing when no capability is chosen', () => {
    const plan = buildSetupPlan([berlin], {
      language: null,
      managers: null,
      ai: { kind: 'enable', capabilities: [], applyToAll: true, excluded: [] },
    })

    expect(plan.properties[0]?.ai).toBeNull()
    expect(plan.aiCapabilities).toEqual([])
  })
})

describe('AI capability selection', () => {
  const order = ['review_analysis', 'reply_drafting', 'property_trends'] as const

  it('adds review analysis with trends and drops trends with review analysis', () => {
    expect(toggleAiCapability([], 'property_trends', true, order)).toEqual([
      'review_analysis',
      'property_trends',
    ])
    expect(toggleAiCapability(order, 'review_analysis', false, order)).toEqual([
      'reply_drafting',
    ])
  })
})
