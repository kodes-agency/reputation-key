export const AI_LOCK_ORDER_VERSION = 'ai-lock-order-v1' as const
export const AI_ADVISORY_LOCK_SEED_V1 = 5_928_232_768_719_372_617n
export const AI_ADVISORY_SCOPE_ENCODING_VERSION = 'ai-admission-scope-v1' as const

export const AI_ADVISORY_DOMAINS = Object.freeze([
  'release-run',
  'erasure-owner',
  'provider-source',
  'provider-snapshot',
  'property-event',
  'reply-adoption',
  'provider-rate',
  'deployment-concurrency',
  'organization-concurrency',
  'property-concurrency',
  'operation-attempt',
  'canary-release',
] as const)

export type AiAdvisoryDomain = (typeof AI_ADVISORY_DOMAINS)[number]

export const AI_ROW_LOCK_RANKS = Object.freeze({
  release: 1,
  executionControl: 2,
  providerCircuit: 3,
  readBarrier: 4,
  canaryAuthorization: 5,
  organizationLifecycle: 6,
  propertySource: 7,
  merchantAuthorization: 8,
  providerSubjectKeyVersion: 9,
  providerSnapshotRun: 10,
  providerSubject: 11,
  providerDeletionCandidateOrMember: 12,
  reviewSourceHeadOrRow: 13,
  reviewEventCursor: 14,
  reply: 15,
  operation: 16,
  quotaOrVolume: 17,
  costHead: 18,
  costReservation: 19,
  executionPermit: 20,
  aggregateOrResult: 21,
  lifecycleOrAudit: 22,
} as const)

export type AiRowLockRank = (typeof AI_ROW_LOCK_RANKS)[keyof typeof AI_ROW_LOCK_RANKS]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const UUID_SHAPE =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u
const SHA = /^[0-9a-f]{40}$/u
const UNSIGNED = /^(0|[1-9][0-9]*)$/u
const TOKEN = /^[a-z][a-z0-9._-]{0,99}$/u
const canonicalTextEncoder = new TextEncoder()
const OWNER_KIND = /^(organization|property|actor)$/u

declare const advisoryScopeBrand: unique symbol
export type AiAdvisoryScope = string & { readonly [advisoryScopeBrand]: true }

function invalid(message: string): never {
  throw new TypeError(`Invalid ${AI_LOCK_ORDER_VERSION} value: ${message}`)
}

function expectPart(
  raw: string | number | undefined,
  pattern: RegExp,
  field: string,
): string {
  if (raw === undefined) invalid(field)
  if (typeof raw === 'number' && (!Number.isSafeInteger(raw) || raw < 0)) {
    invalid(field)
  }
  const value = String(raw)
  if (!pattern.test(value)) invalid(field)
  return value
}

function expectOrganizationScopePart(
  raw: string | number | undefined,
  field: string,
): string {
  const value = String(raw ?? '')
  if (UUID.test(value)) return value
  if (UUID_SHAPE.test(value) || !SAFE_SCOPE_ID.test(value)) invalid(field)
  return value
}

export function createAiAdvisoryScope(
  domain: AiAdvisoryDomain,
  parts: ReadonlyArray<string | number>,
): AiAdvisoryScope {
  const values = [...parts]
  switch (domain) {
    case 'release-run':
    case 'canary-release':
      if (values.length !== 2) invalid(`${domain} arity`)
      expectPart(values[0], SHA, `${domain} release SHA`)
      expectPart(values[1], TOKEN, `${domain} profile`)
      break
    case 'erasure-owner':
      if (values.length !== 2) invalid('erasure-owner arity')
      expectPart(values[0], OWNER_KIND, 'erasure owner kind')
      expectPart(values[1], UUID, 'erasure owner UUID')
      break
    case 'provider-source':
      if (values.length !== 3) invalid('provider-source arity')
      expectOrganizationScopePart(values[0], 'provider-source organization identifier')
      expectPart(values[1], UUID, 'provider-source property UUID')
      expectPart(values[2], UNSIGNED, 'provider-source epoch')
      break
    case 'provider-snapshot':
    case 'reply-adoption':
      if (values.length !== 1) invalid(`${domain} arity`)
      expectPart(values[0], UUID, `${domain} UUID`)
      break
    case 'property-event':
      if (values.length !== 4) invalid('property-event arity')
      expectOrganizationScopePart(values[0], 'property-event organization identifier')
      expectPart(values[1], UUID, 'property-event property UUID')
      expectPart(values[2], UNSIGNED, 'property-event source epoch')
      expectPart(values[3], UNSIGNED, 'property-event analysis epoch')
      break
    case 'provider-rate':
    case 'deployment-concurrency':
      if (values.length !== 2) invalid(`${domain} arity`)
      expectPart(values[0], TOKEN, `${domain} profile`)
      expectPart(values[1], TOKEN, `${domain} operation kind`)
      break
    case 'organization-concurrency':
    case 'property-concurrency':
      if (values.length !== 2) invalid(`${domain} arity`)
      expectPart(values[0], UUID, `${domain} owner UUID`)
      expectPart(values[1], TOKEN, `${domain} operation kind`)
      break
    case 'operation-attempt':
      if (values.length !== 2) invalid('operation-attempt arity')
      expectPart(values[0], UUID, 'operation-attempt UUID')
      expectPart(values[1], UNSIGNED, 'operation-attempt number')
      break
  }
  const scope = `${domain}|${values.map(String).join('|')}`
  if (!/^[\x20-\x7E]+$/u.test(scope)) invalid('scope bytes')
  return scope as AiAdvisoryScope
}

/**
 * Exact text passed to PostgreSQL `hashtextextended` by
 * `ai_advisory_lock_key_v1`. Hashing stays in PostgreSQL so application and
 * security-definer roots cannot drift across PostgreSQL hash implementations.
 */
export function encodeAiAdvisoryScopeKeyInput(scope: AiAdvisoryScope): string {
  return `${AI_ADVISORY_SCOPE_ENCODING_VERSION}|${scope.length}:${scope}`
}

export function sortAndDedupeAiAdvisoryKeys(
  keys: ReadonlyArray<bigint>,
): ReadonlyArray<bigint> {
  const unique = [...new Set(keys)]
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return Object.freeze(unique)
}

function compareCanonicalBytes(left: string, right: string): number {
  const leftBytes = canonicalTextEncoder.encode(left)
  const rightBytes = canonicalTextEncoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const delta = leftBytes[index]! - rightBytes[index]!
    if (delta !== 0) return delta
  }
  return leftBytes.length - rightBytes.length
}

export type AiRowLock = Readonly<{
  rank: AiRowLockRank
  primaryKey: string
}>

export function assertAiRowLockOrder(locks: ReadonlyArray<AiRowLock>): void {
  let previous: AiRowLock | undefined
  const seen = new Set<string>()
  for (const lock of locks) {
    if (!Number.isInteger(lock.rank) || lock.rank < 1 || lock.rank > 22) {
      invalid('row rank')
    }
    if (lock.primaryKey.length === 0 || lock.primaryKey.includes('\0')) {
      invalid('row primary key')
    }
    const identity = `${lock.rank}\0${lock.primaryKey}`
    if (seen.has(identity)) invalid('duplicate row lock')
    if (
      previous &&
      (lock.rank < previous.rank ||
        (lock.rank === previous.rank &&
          compareCanonicalBytes(lock.primaryKey, previous.primaryKey) <= 0))
    ) {
      invalid('descending row lock')
    }
    seen.add(identity)
    previous = lock
  }
}
