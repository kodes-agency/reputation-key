import type { CurrentMerchantAiCapability } from '#/contexts/identity/application/public-api'
import { suggestedReplyLanguageForCountry } from '#/shared/country-reply-language'

/**
 * What the "Set up properties" step knows about one Property the import
 * produced: only the facts its three questions (decision 2) depend on.
 */
export type SetupPropertyFacts = Readonly<{
  propertyId: string
  propertyName: string
  countryCode: string | null
  /** The confirmed default reply language, or null when none is set yet. */
  replyLanguage: string | null
  /** AI is enabled or consciously deferred: the AI decision is made. */
  aiDecided: boolean
  managerIds: readonly string[]
  eligibleManagerIds: readonly string[]
}>

/** Reply language: every property's suggestion, or languages the merchant picked. */
export type LanguageAnswer =
  | Readonly<{ kind: 'suggested' }>
  | Readonly<{
      kind: 'chosen'
      applyToAll: boolean
      language: string
      /** Per-property picks, used when `applyToAll` is off. */
      overrides: Readonly<Record<string, string>>
    }>

export type ManagerAnswer = Readonly<{
  applyToAll: boolean
  managerIds: readonly string[]
  /** Per-property picks, used when `applyToAll` is off. */
  overrides: Readonly<Record<string, readonly string[]>>
}>

export type AiAnswer =
  | Readonly<{
      kind: 'enable'
      capabilities: readonly CurrentMerchantAiCapability[]
      applyToAll: boolean
      /** With `applyToAll` off: properties answered "not now" individually. */
      excluded: readonly string[]
    }>
  | Readonly<{ kind: 'defer' }>

/** A skipped question is null: its step stays pending on every property. */
export type SetupAnswers = Readonly<{
  language: LanguageAnswer | null
  managers: ManagerAnswer | null
  ai: AiAnswer | null
}>

export type PropertySetupPlan = Readonly<{
  propertyId: string
  propertyName: string
  /** Null writes nothing: already set, or the question was skipped. */
  language: string | null
  managerIds: readonly string[] | null
  ai: 'enable' | 'defer' | null
}>

export type SetupPlan = Readonly<{
  properties: readonly PropertySetupPlan[]
  /** The capability set of the one consent ceremony; empty when nothing enables. */
  aiCapabilities: readonly CurrentMerchantAiCapability[]
}>

export function propertiesAskedLanguage(
  facts: readonly SetupPropertyFacts[],
): readonly SetupPropertyFacts[] {
  return facts.filter((property) => property.replyLanguage === null)
}

/** A property with no eligible manager cannot be answered here. */
export function propertiesAskedManagers(
  facts: readonly SetupPropertyFacts[],
): readonly SetupPropertyFacts[] {
  return facts.filter(
    (property) =>
      property.managerIds.length === 0 && property.eligibleManagerIds.length > 0,
  )
}

export function propertiesAskedAi(
  facts: readonly SetupPropertyFacts[],
): readonly SetupPropertyFacts[] {
  return facts.filter((property) => !property.aiDecided)
}

export function suggestedLanguageFor(property: SetupPropertyFacts): string {
  return suggestedReplyLanguageForCountry(property.countryCode)
}

/** Managers eligible for every property, in the order of the first one. */
export function managersEligibleForAll(
  properties: readonly SetupPropertyFacts[],
): readonly string[] {
  const [first, ...rest] = properties
  if (!first) return []
  return first.eligibleManagerIds.filter((userId) =>
    rest.every((property) => property.eligibleManagerIds.includes(userId)),
  )
}

/** Decision 2: the importing admin is the default manager where eligible. */
export function defaultManagerIds(
  properties: readonly SetupPropertyFacts[],
  viewerUserId: string,
): readonly string[] {
  return managersEligibleForAll(properties).includes(viewerUserId) ? [viewerUserId] : []
}

export function initialSetupAnswers(
  facts: readonly SetupPropertyFacts[],
  viewerUserId: string,
): SetupAnswers {
  const managerProperties = propertiesAskedManagers(facts)
  const managerIds = defaultManagerIds(managerProperties, viewerUserId)
  return {
    language: propertiesAskedLanguage(facts).length > 0 ? { kind: 'suggested' } : null,
    managers:
      managerProperties.length > 0 && managerIds.length > 0
        ? { applyToAll: true, managerIds, overrides: {} }
        : null,
    ai: null,
  }
}

function plannedLanguage(
  property: SetupPropertyFacts,
  answer: LanguageAnswer | null,
): string | null {
  if (answer === null || property.replyLanguage !== null) return null
  if (answer.kind === 'suggested') return suggestedLanguageFor(property)
  if (answer.applyToAll) return answer.language
  return answer.overrides[property.propertyId] ?? answer.language
}

function plannedManagers(
  property: SetupPropertyFacts,
  answer: ManagerAnswer | null,
): readonly string[] | null {
  if (answer === null || property.managerIds.length > 0) return null
  const picked = answer.applyToAll
    ? answer.managerIds
    : (answer.overrides[property.propertyId] ?? answer.managerIds)
  const eligible = picked.filter((userId) => property.eligibleManagerIds.includes(userId))
  return eligible.length > 0 ? eligible : null
}

function plannedAi(
  property: SetupPropertyFacts,
  answer: AiAnswer | null,
): 'enable' | 'defer' | null {
  if (answer === null || property.aiDecided) return null
  if (answer.kind === 'defer') return 'defer'
  if (answer.capabilities.length === 0) return null
  return !answer.applyToAll && answer.excluded.includes(property.propertyId)
    ? 'defer'
    : 'enable'
}

/** Resolve the answers into the writes each property receives. */
export function buildSetupPlan(
  facts: readonly SetupPropertyFacts[],
  answers: SetupAnswers,
): SetupPlan {
  const properties = facts.map((property) => ({
    propertyId: property.propertyId,
    propertyName: property.propertyName,
    language: plannedLanguage(property, answers.language),
    managerIds: plannedManagers(property, answers.managers),
    ai: plannedAi(property, answers.ai),
  }))
  const enables = properties.some((property) => property.ai === 'enable')
  return {
    properties,
    aiCapabilities:
      enables && answers.ai?.kind === 'enable' ? answers.ai.capabilities : [],
  }
}

/** Names of the properties the consent ceremony covers, in import order. */
export function aiEnabledPropertyNames(plan: SetupPlan): readonly string[] {
  return plan.properties
    .filter((property) => property.ai === 'enable')
    .map((property) => property.propertyName)
}

/**
 * Keep a capability selection coherent: property trends are built from review
 * analysis, so choosing trends adds analysis and dropping analysis drops trends
 * (the same rule the property AI settings apply).
 */
export function toggleAiCapability(
  current: readonly CurrentMerchantAiCapability[],
  capability: CurrentMerchantAiCapability,
  checked: boolean,
  order: readonly CurrentMerchantAiCapability[],
): readonly CurrentMerchantAiCapability[] {
  const next = new Set(current)
  if (checked) {
    next.add(capability)
    if (capability === 'property_trends') next.add('review_analysis')
  } else {
    next.delete(capability)
    if (capability === 'review_analysis') next.delete('property_trends')
  }
  return order.filter((candidate) => next.has(candidate))
}
