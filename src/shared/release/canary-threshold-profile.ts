// REL-01 Promotion step 4 — the canary threshold-profile AUTHORITY.
//
// `canary-window-evidence.ts` describes the shape of a canary proof; it cannot
// describe who agreed to it. This module is that missing half, and it exists to
// enforce one rule:
//
//   an observation window nobody ratified is a CLOSED gate, not a short window.
//
// The repository therefore tracks the profile as an authority document with an
// explicit `ratification` discriminator. While the duration is an open
// operating decision (ADR 0059), parsing succeeds but yields NO usable profile,
// so `release:observe-canary` has nothing to bind and refuses to run. There is
// deliberately no default duration and no override flag: a defaulted duration
// is indistinguishable in the emitted artifact from an agreed one, which is
// exactly the fabrication this producer set is built to make impossible.
//
// Ratification is also separated from authorship for the same reason legal
// approval is: the producer of a release gate may not sign its own gate. A
// placeholder approver or a future-dated approval is refused.

import { z } from 'zod/v4'
import {
  CANARY_REQUIRED_SIGNAL_CATEGORIES,
  canaryThresholdProfileSchema,
  CANARY_THRESHOLD_PROFILE_VERSION,
  type CanaryThresholdProfile,
} from './canary-window-evidence'
import {
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
} from './candidate-bound-evidence'

export const CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION =
  'repkey-canary-threshold-profile-authority-1' as const

export const CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH =
  'security/rel-01-canary-threshold-profile.json' as const

export const CANARY_THRESHOLD_DECISION_RECORD_PATH =
  'docs/adr/0059-rel-01-canary-observation-window.md' as const

/**
 * Identities that look like an approval but decide nothing. The list is
 * substring-matched case-insensitively because the failure mode is a document
 * copied forward with its template value left in place, not a hostile approver.
 * `engineering` is included on purpose: the producing role cannot ratify the
 * gate it produces.
 */
const CANARY_PLACEHOLDER_APPROVER_MARKERS = [
  '<',
  '>',
  'tbd',
  'todo',
  'pending',
  'placeholder',
  'unknown',
  'unassigned',
  'example',
  'engineering',
  'n/a',
] as const

/** A JSON pointer segment: no separator, so segments can never overlap. */
const JSON_POINTER_SEGMENT = /^[A-Za-z0-9_.-]+$/u

/**
 * Scanned rather than matched with a nested quantifier. `(\/[^/]+)+` is the
 * classic catastrophic-backtracking shape, and the security control rejects it
 * even where the leading separator makes it unambiguous in practice.
 */
function isJsonPointer(value: string): boolean {
  if (!value.startsWith('/')) return false
  return value
    .slice(1)
    .split('/')
    .every((segment) => JSON_POINTER_SEGMENT.test(segment))
}

const authoritySignalSchema = z
  .object({
    category: z.enum(CANARY_REQUIRED_SIGNAL_CATEGORIES),
    name: z.string().trim().min(1).max(256),
    source: z.enum([
      'application_metrics',
      'external_synthetic',
      'provider_control',
      'railway_platform',
      'sentry',
      'release_controller',
    ]),
    comparator: z.enum(['eq', 'lte', 'gte']),
    threshold: z.number().finite(),
    unit: z.string().trim().min(1).max(64),
    sampleIntervalMs: z.number().int().safe().positive(),
    /**
     * RFC 6901-style pointer into the source response body. It lives on the
     * authority rather than the evidence profile because it is a read
     * instruction, not a threshold; the sampler must not be able to choose it.
     */
    valuePointer: z
      .string()
      .refine(isJsonPointer, 'must be a JSON pointer into the source body'),
  })
  .strict()

const openRatificationSchema = z
  .object({
    state: z.literal('open'),
    /** Every field a ratifying operator must still decide. */
    openDecisions: z.array(z.literal('durationMs')).min(1),
    ratifyingRole: z.literal('operating-owner'),
    note: z.string().trim().min(1).max(1024),
  })
  .strict()

const ratifiedRatificationSchema = z
  .object({
    state: z.literal('ratified'),
    durationMs: z.number().int().safe().positive(),
    approvedBy: releaseEvidenceIdentitySchema,
    approvedAt: releaseEvidenceTimestampSchema,
  })
  .strict()

const canaryThresholdProfileAuthoritySchema = z
  .object({
    version: z.literal(CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION),
    decisionRecord: z.literal(CANARY_THRESHOLD_DECISION_RECORD_PATH),
    decisionRecordSha256: releaseEvidenceSha256Schema,
    ratification: z.discriminatedUnion('state', [
      openRatificationSchema,
      ratifiedRatificationSchema,
    ]),
    // Deliberately `min(1)` rather than `min(9)`: an arity error would mask the
    // useful message. The category refinement below names the exact missing
    // category, and the derived profile is re-checked against the evidence
    // schema, which does enforce the full nine.
    signals: z.array(authoritySignalSchema).min(1),
  })
  .strict()

export type CanaryThresholdProfileAuthority = z.infer<
  typeof canaryThresholdProfileAuthoritySchema
>

export type CanaryThresholdProfileParseResult =
  | Readonly<{
      ok: true
      state: 'open'
      authority: CanaryThresholdProfileAuthority
      openDecisions: readonly string[]
    }>
  | Readonly<{
      ok: true
      state: 'ratified'
      authority: CanaryThresholdProfileAuthority
      profile: CanaryThresholdProfile
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function issueMessages(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0
      ? `${issue.path.join('.')}: ${issue.message}`
      : `canary threshold profile: ${issue.message}`,
  )
}

/**
 * Build the evidence-shaped profile from a ratified authority. Every signal's
 * `thresholdAuthoritySha256` is the decision-record digest because ADR 0059 is
 * the ONLY document that authorises a threshold: a signal sourced elsewhere
 * must be added to the ADR first, which changes the digest and forces
 * re-ratification.
 */
function derivedProfile(
  authority: CanaryThresholdProfileAuthority,
  ratification: z.infer<typeof ratifiedRatificationSchema>,
): CanaryThresholdProfile {
  return {
    version: CANARY_THRESHOLD_PROFILE_VERSION,
    durationMs: ratification.durationMs,
    approvedBy: ratification.approvedBy,
    approvedAt: ratification.approvedAt,
    decisionRecordSha256: authority.decisionRecordSha256,
    signals: authority.signals.map((signal) => ({
      category: signal.category,
      name: signal.name,
      source: signal.source,
      comparator: signal.comparator,
      threshold: signal.threshold,
      unit: signal.unit,
      sampleIntervalMs: signal.sampleIntervalMs,
      thresholdAuthoritySha256: authority.decisionRecordSha256,
    })),
  }
}

/** The read instruction for one signal — source plus body pointer. */
export type CanarySignalReadPlan = Readonly<{
  name: string
  category: (typeof CANARY_REQUIRED_SIGNAL_CATEGORIES)[number]
  source: CanaryThresholdProfileAuthority['signals'][number]['source']
  valuePointer: string
  sampleIntervalMs: number
}>

export function canaryThresholdSignalReadPlan(
  authority: CanaryThresholdProfileAuthority,
): readonly CanarySignalReadPlan[] {
  return authority.signals.map((signal) => ({
    name: signal.name,
    category: signal.category,
    source: signal.source,
    valuePointer: signal.valuePointer,
    sampleIntervalMs: signal.sampleIntervalMs,
  }))
}

/**
 * Signal-shape rules that do not depend on the duration are enforced even while
 * the duration is open, so an open profile is still a reviewed one.
 */
function canarySignalShapeErrors(
  authority: CanaryThresholdProfileAuthority,
): readonly string[] {
  const errors: string[] = []
  const names = authority.signals.map(({ name }) => name)
  if (new Set(names).size !== names.length) {
    errors.push('signals: signal names must be unique')
  }
  const sortedNames = [...names].sort((left, right) => left.localeCompare(right))
  if (names.some((name, index) => name !== sortedNames[index])) {
    errors.push('signals: signal profiles must use canonical name order')
  }
  for (const category of CANARY_REQUIRED_SIGNAL_CATEGORIES) {
    if (!authority.signals.some((signal) => signal.category === category)) {
      errors.push(`signals: missing required canary category ${category}`)
    }
  }
  for (const [index, signal] of authority.signals.entries()) {
    if (!CANARY_AUTHORITATIVE_SOURCES[signal.category].includes(signal.source)) {
      errors.push(
        `signals.${index}.source: source is not authoritative for ${signal.category}`,
      )
    }
  }
  return errors
}

/** A ratified profile needs a real approver and an approval that already happened. */
function canaryRatificationErrors(
  ratification: Readonly<{ approvedBy: string; approvedAt: string }>,
  now: number,
): readonly string[] {
  const errors: string[] = []
  const lowered = ratification.approvedBy.toLowerCase()
  if (CANARY_PLACEHOLDER_APPROVER_MARKERS.some((marker) => lowered.includes(marker))) {
    errors.push(
      `ratification.approvedBy: ${ratification.approvedBy} is a placeholder identity, not a ratifying operating owner`,
    )
  }
  if (Date.parse(ratification.approvedAt) > now) {
    errors.push('ratification.approvedAt: must not be dated in the future')
  }
  return errors
}

/**
 * Parse the tracked authority document.
 *
 * `options.decisionRecordSha256`, when supplied, is the digest the caller
 * actually read from disk. Passing it turns a silent ADR edit into a refusal
 * rather than a profile that claims an authority it no longer matches. The
 * observer CLI always supplies it.
 */
export function parseCanaryThresholdProfile(
  content: string,
  options: Readonly<{ now?: string; decisionRecordSha256?: string }> = {},
): CanaryThresholdProfileParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['canary threshold profile: is not valid JSON'] }
  }

  const parsed = canaryThresholdProfileAuthoritySchema.safeParse(value)
  if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) }
  const authority = parsed.data

  const errors: string[] = []
  if (
    options.decisionRecordSha256 !== undefined &&
    options.decisionRecordSha256 !== authority.decisionRecordSha256
  ) {
    errors.push(
      `decisionRecordSha256: decision record ${authority.decisionRecord} no longer matches the ratified profile`,
    )
  }

  errors.push(...canarySignalShapeErrors(authority))

  if (authority.ratification.state === 'open') {
    if (errors.length > 0) return { ok: false, errors }
    return {
      ok: true,
      state: 'open',
      authority,
      openDecisions: authority.ratification.openDecisions,
    }
  }

  const ratification = authority.ratification
  errors.push(
    ...canaryRatificationErrors(
      ratification,
      Date.parse(options.now ?? new Date().toISOString()),
    ),
  )

  const profile = canaryThresholdProfileSchema.safeParse(
    derivedProfile(authority, ratification),
  )
  if (!profile.success) errors.push(...issueMessages(profile.error))
  if (errors.length > 0 || !profile.success) return { ok: false, errors }

  return { ok: true, state: 'ratified', authority, profile: profile.data }
}

/**
 * The per-category source allow-list, duplicated from the evidence schema so an
 * OPEN profile is checked too. Both copies are asserted equivalent by the
 * ratified-path parse, which validates the derived profile through the evidence
 * schema itself.
 */
const CANARY_AUTHORITATIVE_SOURCES: Readonly<
  Record<(typeof CANARY_REQUIRED_SIGNAL_CATEGORIES)[number], readonly string[]>
> = {
  application_health: ['application_metrics', 'external_synthetic'],
  error_rate: ['sentry'],
  external_availability: ['external_synthetic'],
  queue_outbox: ['application_metrics'],
  provider_controls: ['provider_control'],
  latency: ['application_metrics', 'external_synthetic'],
  privacy: ['application_metrics', 'sentry'],
  platform_recovery: ['railway_platform'],
  release_drift: ['release_controller'],
}

/** The exact on-disk serialization of the tracked authority document. */
export function canaryThresholdProfileAuthorityJson(
  authority: CanaryThresholdProfileAuthority,
): string {
  return `${JSON.stringify(authority, null, 2)}\n`
}
