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

export const DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION =
  'repkey-deployed-critical-journeys-1' as const

/** Read-only deployed probes; historical evidence identifiers remain unchanged. */
export const DEPLOYED_CRITICAL_JOURNEY_SPEC =
  'e2e/deployed/closed-beta-deployed-probes.spec.ts' as const

const testCaseSchema = z
  .object({
    testId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(512),
    outcome: z.enum(['passed', 'failed', 'timed_out', 'interrupted']),
    durationMs: z.number().int().safe().nonnegative(),
  })
  .strict()

const deployedCriticalJourneyEvidenceSchema = z
  .object({
    version: z.literal(DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION),
    evidenceKind: z.literal('deployed-critical-journeys'),
    candidate: releaseCandidateBindingSchema,
    runId: z.uuid(),
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    capturedAt: releaseEvidenceTimestampSchema,
    authorization: z
      .object({
        syntheticOrganizationId: z.uuid(),
        authorizationArtifactSha256: releaseEvidenceSha256Schema,
        approvedBy: releaseEvidenceIdentitySchema,
        approvedAt: releaseEvidenceTimestampSchema,
        expiresAt: releaseEvidenceTimestampSchema,
        permittedTestIds: z.array(z.string().trim().min(1).max(512)).min(1),
      })
      .strict(),
    runner: z
      .object({
        kind: z.literal('playwright'),
        specPath: z.literal(DEPLOYED_CRITICAL_JOURNEY_SPEC),
        specSha256: releaseEvidenceSha256Schema,
        playwrightConfigSha256: releaseEvidenceSha256Schema,
        packageVersion: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .refine(
            (value) =>
              value.split('.').length >= 3 &&
              [...value].every((character) =>
                '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-'.includes(
                  character,
                ),
              ),
            'must be a bounded package version',
          ),
        project: z.string().trim().min(1).max(128),
        browserName: z.enum(['chromium', 'firefox', 'webkit']),
        browserVersion: z.string().trim().min(1).max(128),
        attempts: z.literal(1),
        retries: z.literal(0),
        workers: z.literal(1),
      })
      .strict(),
    results: z.array(testCaseSchema).min(1),
    cleanup: z
      .object({
        attempted: z.literal(true),
        completed: z.boolean(),
        orphanedSyntheticResources: z.number().int().safe().nonnegative(),
        reportSha256: releaseEvidenceSha256Schema,
      })
      .strict(),
    redaction: z
      .object({
        reportSha256: releaseEvidenceSha256Schema,
        prohibitedFieldOccurrences: z.number().int().safe().nonnegative(),
        unexpectedExternalRequests: z.number().int().safe().nonnegative(),
      })
      .strict(),
    outcome: z.enum(['passed', 'failed']),
    failures: z.array(z.string().trim().min(1).max(1024)),
  })
  .strict()
  .superRefine((value, context) => {
    const startedAt = Date.parse(value.startedAt)
    const completedAt = Date.parse(value.completedAt)
    const capturedAt = Date.parse(value.capturedAt)
    if (completedAt < startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completion predates start',
      })
    }
    if (capturedAt < completedAt) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture predates completion',
      })
    }
    if (
      Date.parse(value.authorization.approvedAt) > startedAt ||
      Date.parse(value.authorization.expiresAt) < completedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization'],
        message: 'authorization must cover the complete journey run',
      })
    }

    const permitted = value.authorization.permittedTestIds
    const observed = value.results.map(({ testId }) => testId)
    if (new Set(permitted).size !== permitted.length) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'permittedTestIds'],
        message: 'permitted test ids must be unique',
      })
    }
    if (new Set(observed).size !== observed.length) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'result test ids must be unique',
      })
    }
    if (
      permitted.length !== observed.length ||
      permitted.some((testId, index) => observed[index] !== testId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'results must match the exact authorized test id order',
      })
    }

    const passing =
      value.results.every(({ outcome }) => outcome === 'passed') &&
      value.cleanup.completed &&
      value.cleanup.orphanedSyntheticResources === 0 &&
      value.redaction.prohibitedFieldOccurrences === 0 &&
      value.redaction.unexpectedExternalRequests === 0 &&
      value.failures.length === 0
    if (value.outcome === 'passed' && !passing) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires all tests, cleanup, and redaction checks',
      })
    }
    if (value.outcome === 'failed' && value.failures.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'failed outcome requires at least one failure',
      })
    }
  })

export type DeployedCriticalJourneyEvidence = z.infer<
  typeof deployedCriticalJourneyEvidenceSchema
>

export function deployedCriticalJourneyDependencyDigests(
  evidence: DeployedCriticalJourneyEvidence,
): readonly string[] {
  return [
    evidence.authorization.authorizationArtifactSha256,
    evidence.runner.specSha256,
    evidence.runner.playwrightConfigSha256,
    evidence.cleanup.reportSha256,
    evidence.redaction.reportSha256,
  ]
}

export function canonicalDeployedCriticalJourneyEvidence(
  evidence: DeployedCriticalJourneyEvidence,
): string {
  return canonicalReleaseEvidence(evidence)
}

export function parseDeployedCriticalJourneyEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<DeployedCriticalJourneyEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: deployedCriticalJourneyEvidenceSchema,
    label: 'Deployed read-only probe evidence',
  })
}
