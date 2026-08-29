import { z } from 'zod/v4'
import {
  canonicalReleaseEvidence,
  parseCanonicalReleaseEvidence,
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'

export const CANARY_WINDOW_EVIDENCE_VERSION = 'repkey-canary-window-1' as const
export const CANARY_THRESHOLD_PROFILE_VERSION =
  'repkey-canary-threshold-profile-1' as const

export const CANARY_REQUIRED_SIGNAL_CATEGORIES = [
  'application_health',
  'error_rate',
  'external_availability',
  'queue_outbox',
  'provider_controls',
  'latency',
  'privacy',
  'platform_recovery',
  'release_drift',
] as const

const signalProfileSchema = z
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
    thresholdAuthoritySha256: releaseEvidenceSha256Schema,
  })
  .strict()

/**
 * Exported so the ratification layer in `canary-threshold-profile.ts` validates
 * a derived profile against the SAME rules Gate F will apply to the embedded
 * copy. A second, looser definition beside this one would let a profile pass
 * ratification and then fail — or worse, pass — under different constraints.
 */
export const canaryThresholdProfileSchema = z
  .object({
    version: z.literal(CANARY_THRESHOLD_PROFILE_VERSION),
    durationMs: z.number().int().safe().positive(),
    approvedBy: releaseEvidenceIdentitySchema,
    approvedAt: releaseEvidenceTimestampSchema,
    decisionRecordSha256: releaseEvidenceSha256Schema,
    signals: z.array(signalProfileSchema).min(CANARY_REQUIRED_SIGNAL_CATEGORIES.length),
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.signals.map(({ name }) => name)
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['signals'],
        message: 'signal names must be unique',
      })
    }
    for (const category of CANARY_REQUIRED_SIGNAL_CATEGORIES) {
      if (!value.signals.some((signal) => signal.category === category)) {
        context.addIssue({
          code: 'custom',
          path: ['signals'],
          message: `missing required canary category ${category}`,
        })
      }
    }
    const sortedNames = [...names].sort((left, right) => left.localeCompare(right))
    if (names.some((name, index) => name !== sortedNames[index])) {
      context.addIssue({
        code: 'custom',
        path: ['signals'],
        message: 'signal profiles must use canonical name order',
      })
    }
    for (const [index, signal] of value.signals.entries()) {
      if (signal.sampleIntervalMs > value.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['signals', index, 'sampleIntervalMs'],
          message: 'sample interval exceeds the approved observation duration',
        })
      }
      const expectedSources = {
        application_health: ['application_metrics', 'external_synthetic'],
        error_rate: ['sentry'],
        external_availability: ['external_synthetic'],
        queue_outbox: ['application_metrics'],
        provider_controls: ['provider_control'],
        latency: ['application_metrics', 'external_synthetic'],
        privacy: ['application_metrics', 'sentry'],
        platform_recovery: ['railway_platform'],
        release_drift: ['release_controller'],
      } as const
      if (
        !(expectedSources[signal.category] as readonly string[]).includes(signal.source)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['signals', index, 'source'],
          message: `source is not authoritative for ${signal.category}`,
        })
      }
    }
  })

const observationSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    expectedSamples: z.number().int().safe().positive(),
    observedSamples: z.number().int().safe().nonnegative(),
    missingSamples: z.number().int().safe().nonnegative(),
    breachCount: z.number().int().safe().nonnegative(),
    firstSampleAt: releaseEvidenceTimestampSchema,
    lastSampleAt: releaseEvidenceTimestampSchema,
    sourceArtifactSha256: releaseEvidenceSha256Schema,
    sampleBindingSha256: releaseEvidenceSha256Schema,
  })
  .strict()

const canaryWindowEvidenceObjectSchema = z
  .object({
    version: z.literal(CANARY_WINDOW_EVIDENCE_VERSION),
    evidenceKind: z.literal('canary-window'),
    candidate: releaseCandidateBindingSchema,
    runId: z.uuid(),
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    capturedAt: releaseEvidenceTimestampSchema,
    profile: canaryThresholdProfileSchema,
    observations: z.array(observationSchema),
    continuity: z
      .object({
        releaseIdentityMismatches: z.number().int().safe().nonnegative(),
        configurationHeadMismatches: z.number().int().safe().nonnegative(),
        observerReadErrors: z.number().int().safe().nonnegative(),
        configurationHeadSha256: releaseEvidenceSha256Schema,
      })
      .strict(),
    attempts: z.literal(1),
    retries: z.literal(0),
    outcome: z.enum(['passed', 'failed']),
    failures: z.array(z.string().trim().min(1).max(1024)),
  })
  .strict()

type CanaryWindowEvidenceShape = z.infer<typeof canaryWindowEvidenceObjectSchema>

/** The window must have run for the approved duration, before it was captured. */
function refineCanaryWindowTiming(
  value: CanaryWindowEvidenceShape,
  startedAt: number,
  completedAt: number,
  context: z.RefinementCtx,
): void {
  if (completedAt < startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'completion predates start',
    })
  }
  if (Date.parse(value.capturedAt) < completedAt) {
    context.addIssue({
      code: 'custom',
      path: ['capturedAt'],
      message: 'capture predates completion',
    })
  }
  if (Date.parse(value.profile.approvedAt) > startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['profile', 'approvedAt'],
      message: 'threshold profile approval must not postdate the run start',
    })
  }
  if (completedAt - startedAt < value.profile.durationMs) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'observation ended before the approved canary duration elapsed',
    })
  }
}

/** One observation's sample accounting against the signal profile that ratified it. */
function refineCanaryObservation(
  observation: CanaryWindowEvidenceShape['observations'][number],
  index: number,
  requiredSamples: number,
  window: Readonly<{ startedAt: number; completedAt: number }>,
  context: z.RefinementCtx,
): void {
  if (observation.expectedSamples < requiredSamples) {
    context.addIssue({
      code: 'custom',
      path: ['observations', index, 'expectedSamples'],
      message: 'expected sample count does not cover the approved duration',
    })
  }
  if (
    observation.observedSamples + observation.missingSamples !==
    observation.expectedSamples
  ) {
    context.addIssue({
      code: 'custom',
      path: ['observations', index],
      message: 'observed and missing samples must reconcile to expected samples',
    })
  }
  if (
    Date.parse(observation.firstSampleAt) < window.startedAt ||
    Date.parse(observation.lastSampleAt) > window.completedAt ||
    Date.parse(observation.lastSampleAt) < Date.parse(observation.firstSampleAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['observations', index],
      message: 'sample range must be ordered within the observation window',
    })
  }
}

/** Every ratified signal must have exactly one observation, in profile order. */
function refineCanaryObservations(
  value: CanaryWindowEvidenceShape,
  startedAt: number,
  completedAt: number,
  context: z.RefinementCtx,
): void {
  const profiles = value.profile.signals
  if (value.observations.length !== profiles.length) {
    context.addIssue({
      code: 'custom',
      path: ['observations'],
      message: 'every threshold profile must have exactly one observation',
    })
  }
  for (const [index, profile] of profiles.entries()) {
    const observation = value.observations[index]
    if (!observation || observation.name !== profile.name) {
      context.addIssue({
        code: 'custom',
        path: ['observations', index],
        message: 'observations must match the canonical profile order',
      })
      continue
    }
    refineCanaryObservation(
      observation,
      index,
      Math.ceil(value.profile.durationMs / profile.sampleIntervalMs),
      { startedAt, completedAt },
      context,
    )
  }
}

/** `passed` is only representable when nothing was missed, breached or drifted. */
function isPassingCanaryWindow(value: CanaryWindowEvidenceShape): boolean {
  return (
    value.observations.every(
      ({ missingSamples, breachCount }) => missingSamples === 0 && breachCount === 0,
    ) &&
    value.continuity.releaseIdentityMismatches === 0 &&
    value.continuity.configurationHeadMismatches === 0 &&
    value.continuity.observerReadErrors === 0 &&
    value.failures.length === 0
  )
}

const canaryWindowEvidenceSchema = canaryWindowEvidenceObjectSchema.superRefine(
  (value, context) => {
    const startedAt = Date.parse(value.startedAt)
    const completedAt = Date.parse(value.completedAt)
    refineCanaryWindowTiming(value, startedAt, completedAt, context)
    refineCanaryObservations(value, startedAt, completedAt, context)

    if (value.outcome === 'passed' && !isPassingCanaryWindow(value)) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires complete, breach-free observations',
      })
    }
    if (value.outcome === 'failed' && value.failures.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'failed outcome requires at least one failure',
      })
    }
  },
)

export type CanaryThresholdProfile = z.infer<typeof canaryThresholdProfileSchema>
export type CanaryWindowEvidence = z.infer<typeof canaryWindowEvidenceSchema>

export function canaryWindowDependencyDigests(
  evidence: CanaryWindowEvidence,
): readonly string[] {
  return [
    evidence.profile.decisionRecordSha256,
    ...evidence.profile.signals.map(
      ({ thresholdAuthoritySha256 }) => thresholdAuthoritySha256,
    ),
    ...evidence.observations.flatMap(({ sourceArtifactSha256, sampleBindingSha256 }) => [
      sourceArtifactSha256,
      sampleBindingSha256,
    ]),
    evidence.continuity.configurationHeadSha256,
  ]
}

export function canonicalCanaryWindowEvidence(evidence: CanaryWindowEvidence): string {
  return canonicalReleaseEvidence(evidence)
}

export function parseCanaryWindowEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<CanaryWindowEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: canaryWindowEvidenceSchema,
    label: 'Canary-window evidence',
  })
}
