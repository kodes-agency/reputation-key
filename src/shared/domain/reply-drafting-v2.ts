import { REPLY_BODY_RULES, type ReplyBodyIssueCode } from './reply-body-lint-policy'

export const REPLY_DRAFTING_V2_APOLOGIES = Object.freeze({
  en: Object.freeze([
    "We're sorry",
    "We're so sorry",
    'We apologize',
    "We're truly sorry",
  ]),
  es: Object.freeze(['Sentimos', 'Lamentamos', 'Nos apena', 'Le pedimos disculpas']),
  bg: Object.freeze([
    'Съжаляваме',
    'Искрено съжаляваме',
    'Извиняваме се',
    'Много съжаляваме',
  ]),
})

/**
 * What new drafts start with. The list above stays the stored and database-checked
 * vocabulary; "we apologize" reads as admitting what the guest reports, so no new draft
 * uses it.
 */
export const REPLY_DRAFTING_V2_APOLOGY_STARTS = Object.freeze({
  en: Object.freeze(["We're sorry", "We're so sorry"]),
  es: Object.freeze(['Sentimos', 'Lamentamos', 'Nos apena']),
  bg: Object.freeze(['Съжаляваме', 'Много съжаляваме', 'Искрено съжаляваме']),
})

const APOLOGY_SET = new Set(Object.values(REPLY_DRAFTING_V2_APOLOGIES).flat())

export type ReplyDraftingV2Binding = Readonly<{
  options: Readonly<{
    variation: number
    length: 'standard' | 'short'
    maxWords?: number
    opening: 1 | 2 | 3
    apologyStart: string
  }>
  voiceDigest: string
  generationSeed: string
  parentOperationId: string | null
  rewriteOrdinal: 0 | 1
  rewriteIssues: ReplyBodyIssueCode[]
}>

const SHA = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const keys = (v: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(v).length === expected.length &&
  expected.every((key) => Object.hasOwn(v, key))
const integer = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max

function validOptions(v: unknown): boolean {
  if (!record(v)) return false
  const expected = ['variation', 'length', 'opening', 'apologyStart']
  if (v.maxWords !== undefined) expected.push('maxWords')
  return (
    keys(v, expected) &&
    integer(v.variation, 0, Number.MAX_SAFE_INTEGER) &&
    (v.length === 'standard' || v.length === 'short') &&
    integer(v.opening, 1, 3) &&
    typeof v.apologyStart === 'string' &&
    v.apologyStart.length > 0 &&
    v.apologyStart.length <= 40 &&
    APOLOGY_SET.has(v.apologyStart) &&
    (v.maxWords === undefined || (v.length === 'short' && integer(v.maxWords, 8, 80)))
  )
}

function validIssues(v: unknown): v is ReplyBodyIssueCode[] {
  return (
    Array.isArray(v) &&
    v.length <= Object.keys(REPLY_BODY_RULES).length &&
    v.every(
      (code: unknown) =>
        typeof code === 'string' &&
        Object.hasOwn(REPLY_BODY_RULES, code) &&
        REPLY_BODY_RULES[code as ReplyBodyIssueCode][0] === 'hard',
    )
  )
}

export function isReplyDraftingV2Binding(v: unknown): v is ReplyDraftingV2Binding {
  if (
    !record(v) ||
    !keys(v, [
      'options',
      'voiceDigest',
      'generationSeed',
      'parentOperationId',
      'rewriteOrdinal',
      'rewriteIssues',
    ])
  )
    return false
  if (!validOptions(v.options) || !validIssues(v.rewriteIssues)) return false
  if (
    typeof v.voiceDigest !== 'string' ||
    !SHA.test(v.voiceDigest) ||
    typeof v.generationSeed !== 'string' ||
    !SHA.test(v.generationSeed)
  )
    return false
  if (v.rewriteOrdinal === 0)
    return v.parentOperationId === null && v.rewriteIssues.length === 0
  return (
    v.rewriteOrdinal === 1 &&
    typeof v.parentOperationId === 'string' &&
    UUID.test(v.parentOperationId) &&
    v.rewriteIssues.length > 0
  )
}
