import { z } from 'zod/v4'
import { identityError } from './errors'

export const betaFeedbackTriageStateSchema = z.enum([
  'new',
  'screened',
  'reproducing',
  'accepted',
  'declined',
  'resolved',
])
export const betaFeedbackSeveritySchema = z.enum(['unclassified', 'P0', 'P1', 'P2', 'P3'])
export const betaFeedbackPrivacyClassSchema = z.enum([
  'pending',
  'clear',
  'restricted',
  'escalated',
])
export const betaFeedbackSecurityClassSchema = z.enum([
  'pending',
  'none',
  'suspected',
  'confirmed',
])
export const betaFeedbackReproductionSchema = z.enum([
  'pending',
  'reproduced',
  'not_reproduced',
  'not_applicable',
])
export const betaFeedbackDedupeDispositionSchema = z.enum([
  'pending',
  'unique',
  'duplicate',
])
export const betaFeedbackOwnerQueueSchema = z.enum([
  'beta_support',
  'privacy',
  'security',
  'engineering',
])
export const betaFeedbackCustomerResponseSchema = z.enum([
  'pending',
  'not_required',
  'sent',
])

const pseudonymSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const safeReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)

const betaFeedbackTriageTransitionSchema = z
  .object({
    expectedRevision: z.int().min(0),
    toState: betaFeedbackTriageStateSchema,
    severity: betaFeedbackSeveritySchema,
    privacyClass: betaFeedbackPrivacyClassSchema,
    securityClass: betaFeedbackSecurityClassSchema,
    reproduction: betaFeedbackReproductionSchema,
    dedupeDisposition: betaFeedbackDedupeDispositionSchema,
    duplicateOfReference: z.uuid().nullable(),
    ownerQueue: betaFeedbackOwnerQueueSchema,
    ownerPseudonym: pseudonymSchema.nullable(),
    customerResponse: betaFeedbackCustomerResponseSchema,
    engineeringIssueRef: safeReferenceSchema.nullable(),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    supportEvidenceRef: safeReferenceSchema,
  })
  .strict()

export type BetaFeedbackTriageTransition = z.infer<
  typeof betaFeedbackTriageTransitionSchema
>
export type BetaFeedbackTriageState = z.infer<typeof betaFeedbackTriageStateSchema>

export type BetaFeedbackTriageSnapshot = Readonly<{
  reference: string
  deliveryState: 'prepared' | 'delivered' | 'failed'
  triageState: BetaFeedbackTriageState
  severity: z.infer<typeof betaFeedbackSeveritySchema>
  privacyClass: z.infer<typeof betaFeedbackPrivacyClassSchema>
  securityClass: z.infer<typeof betaFeedbackSecurityClassSchema>
  reproduction: z.infer<typeof betaFeedbackReproductionSchema>
  dedupeDisposition: z.infer<typeof betaFeedbackDedupeDispositionSchema>
  duplicateOfReference: string | null
  ownerQueue: z.infer<typeof betaFeedbackOwnerQueueSchema>
  ownerPseudonym: string | null
  customerResponse: z.infer<typeof betaFeedbackCustomerResponseSchema>
  engineeringIssueRef: string | null
  revision: number
}>

const TRANSITIONS: Readonly<
  Record<BetaFeedbackTriageState, ReadonlySet<BetaFeedbackTriageState>>
> = {
  new: new Set(['screened']),
  screened: new Set(['screened', 'reproducing', 'accepted', 'declined']),
  reproducing: new Set(['screened', 'reproducing', 'accepted', 'declined']),
  accepted: new Set(['accepted', 'reproducing', 'resolved']),
  declined: new Set(['screened', 'declined', 'resolved']),
  resolved: new Set(['screened', 'resolved']),
}

const COMPLETED_CLASSIFICATION_STATES = new Set<BetaFeedbackTriageState>([
  'screened',
  'reproducing',
  'accepted',
  'declined',
  'resolved',
])
const DECISION_STATES = new Set<BetaFeedbackTriageState>([
  'accepted',
  'declined',
  'resolved',
])

/** Pure state-machine guard used by both repository and operator tooling. */
export function assertBetaFeedbackTriageTransition(
  current: BetaFeedbackTriageSnapshot,
  transitionInput: BetaFeedbackTriageTransition,
): BetaFeedbackTriageSnapshot {
  const transition = betaFeedbackTriageTransitionSchema.parse(transitionInput)
  if (current.deliveryState !== 'delivered') {
    throw identityError(
      'feedback_triage_invalid',
      'Only delivered feedback can enter triage',
    )
  }
  if (transition.expectedRevision !== current.revision) {
    throw identityError(
      'feedback_triage_invalid',
      'Beta feedback triage revision is stale',
    )
  }
  if (!TRANSITIONS[current.triageState].has(transition.toState)) {
    throw identityError(
      'feedback_triage_invalid',
      `Invalid beta feedback triage transition: ${current.triageState} -> ${transition.toState}`,
    )
  }
  if (
    transition.dedupeDisposition === 'duplicate' &&
    (transition.duplicateOfReference === null ||
      transition.duplicateOfReference === current.reference)
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'A duplicate must link a different feedback reference',
    )
  }
  if (
    transition.dedupeDisposition !== 'duplicate' &&
    transition.duplicateOfReference !== null
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'Only a duplicate may carry a duplicate feedback reference',
    )
  }
  if (COMPLETED_CLASSIFICATION_STATES.has(transition.toState)) {
    if (
      transition.severity === 'unclassified' ||
      transition.privacyClass === 'pending' ||
      transition.securityClass === 'pending'
    ) {
      throw identityError(
        'feedback_triage_invalid',
        'Screened feedback requires severity, privacy and security classification',
      )
    }
    if (!transition.ownerPseudonym) {
      throw identityError(
        'feedback_triage_invalid',
        'Screened feedback requires a named triage owner',
      )
    }
  }
  if (
    (transition.securityClass === 'suspected' ||
      transition.securityClass === 'confirmed') &&
    transition.ownerQueue !== 'security'
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'Suspected or confirmed security feedback requires the security queue',
    )
  }
  if (
    transition.privacyClass === 'escalated' &&
    transition.ownerQueue !== 'privacy' &&
    transition.ownerQueue !== 'security'
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'Escalated privacy feedback requires the privacy or security queue',
    )
  }
  if (
    DECISION_STATES.has(transition.toState) &&
    (transition.reproduction === 'pending' || transition.dedupeDisposition === 'pending')
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'A triage decision requires reproduction and dedupe outcomes',
    )
  }
  if (
    transition.engineeringIssueRef !== null &&
    transition.toState !== 'accepted' &&
    transition.toState !== 'resolved'
  ) {
    throw identityError(
      'feedback_triage_invalid',
      'An engineering issue may be linked only after acceptance',
    )
  }
  if (transition.toState === 'resolved' && transition.customerResponse === 'pending') {
    throw identityError(
      'feedback_triage_invalid',
      'Resolved feedback requires a customer response disposition',
    )
  }

  return {
    reference: current.reference,
    deliveryState: current.deliveryState,
    triageState: transition.toState,
    severity: transition.severity,
    privacyClass: transition.privacyClass,
    securityClass: transition.securityClass,
    reproduction: transition.reproduction,
    dedupeDisposition: transition.dedupeDisposition,
    duplicateOfReference: transition.duplicateOfReference,
    ownerQueue: transition.ownerQueue,
    ownerPseudonym: transition.ownerPseudonym,
    customerResponse: transition.customerResponse,
    engineeringIssueRef: transition.engineeringIssueRef,
    revision: current.revision + 1,
  }
}
