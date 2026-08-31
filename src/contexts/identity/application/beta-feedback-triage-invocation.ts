import { z } from 'zod/v4'
import {
  betaFeedbackCustomerResponseSchema,
  betaFeedbackDedupeDispositionSchema,
  betaFeedbackOwnerQueueSchema,
  betaFeedbackPrivacyClassSchema,
  betaFeedbackReproductionSchema,
  betaFeedbackSecurityClassSchema,
  betaFeedbackSeveritySchema,
  betaFeedbackTriageStateSchema,
} from '../domain/betaFeedbackTriage'

const safeReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)

const applyInvocationSchema = z
  .object({
    reference: z.uuid(),
    expectedRevision: z.int().min(0),
    toState: betaFeedbackTriageStateSchema,
    severity: betaFeedbackSeveritySchema,
    privacyClass: betaFeedbackPrivacyClassSchema,
    securityClass: betaFeedbackSecurityClassSchema,
    reproduction: betaFeedbackReproductionSchema,
    dedupeDisposition: betaFeedbackDedupeDispositionSchema,
    duplicateOfReference: z.uuid().nullable(),
    ownerQueue: betaFeedbackOwnerQueueSchema,
    ownerId: z.string().trim().min(1).max(255),
    customerResponse: betaFeedbackCustomerResponseSchema,
    engineeringIssueRef: safeReferenceSchema.nullable(),
    transitionId: z.uuid(),
  })
  .strict()

export type BetaFeedbackTriageInvocation =
  | Readonly<{ mode: 'report' }>
  | (Readonly<{ mode: 'apply' }> & z.infer<typeof applyInvocationSchema>)

function optionalReference(value: string | undefined): string | null | undefined {
  return value === 'none' ? null : value
}

export function parseBetaFeedbackTriageInvocation(
  positionals: ReadonlyArray<string>,
): BetaFeedbackTriageInvocation {
  if (positionals.length === 0) return { mode: 'report' }
  if (positionals.length !== 14) {
    throw new Error('beta_feedback_triage_invocation_invalid')
  }

  const [
    reference,
    expectedRevision,
    toState,
    severity,
    privacyClass,
    securityClass,
    reproduction,
    dedupeDisposition,
    duplicateOfReference,
    ownerQueue,
    ownerId,
    customerResponse,
    engineeringIssueRef,
    transitionId,
  ] = positionals
  const parsed = applyInvocationSchema.safeParse({
    reference,
    expectedRevision: Number(expectedRevision),
    toState,
    severity,
    privacyClass,
    securityClass,
    reproduction,
    dedupeDisposition,
    duplicateOfReference: optionalReference(duplicateOfReference),
    ownerQueue,
    ownerId,
    customerResponse,
    engineeringIssueRef: optionalReference(engineeringIssueRef),
    transitionId,
  })
  if (!parsed.success) {
    throw new Error('beta_feedback_triage_invocation_invalid')
  }
  return { mode: 'apply', ...parsed.data }
}
