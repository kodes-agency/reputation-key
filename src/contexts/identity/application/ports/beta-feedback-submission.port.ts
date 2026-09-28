// Identity beta feedback — the request path's ports.
//
// A report writes one content-free triage row, hands the report to
// monitoring, then settles the row's delivery state; a reporter reads back
// only their own rows. The operator triage workflow (transition, queue,
// layout reads) stays on the repository and never reaches a request.

import type { MaskedLayout } from '#/shared/beta-feedback-layout'
import type {
  BetaFeedbackInput,
  BetaFeedbackReportView,
  BetaFeedbackRouteKey,
  BetaFeedbackViewport,
} from '#/shared/beta-feedback-contract'
import type { Role } from '#/shared/domain/roles'
import type { BetaFeedbackTriageSnapshot } from '../../domain/betaFeedbackTriage'

export type PreparedBetaFeedbackTriage = Readonly<{
  reference: string
  organizationPseudonym: string
  actorPseudonym: string
  feedbackType: 'bug' | 'suggestion'
  impactCode:
    | 'cannot_complete'
    | 'workaround_available'
    | 'small_issue'
    | 'important'
    | 'helpful'
    | 'nice_to_have'
  routeKey: BetaFeedbackRouteKey
  viewport: BetaFeedbackViewport
  reporterRole: 'AccountAdmin' | 'PropertyManager' | 'Member'
  clientErrorEventId: string | null
  attachmentKind: 'none' | 'masked_layout_v1'
  attachmentCapturedAt: Date | null
  attachmentExpiresAt: Date | null
  /** Present exactly when attachmentKind is masked_layout_v1. */
  maskedLayout: MaskedLayout | null
  now: Date
}>

export type BetaFeedbackTriageRecord = BetaFeedbackTriageSnapshot &
  Readonly<{
    organizationPseudonym: string
    actorPseudonym: string
    feedbackType: 'bug' | 'suggestion'
    impactCode: PreparedBetaFeedbackTriage['impactCode']
    routeKey: BetaFeedbackRouteKey
    viewport: BetaFeedbackViewport
    reporterRole: PreparedBetaFeedbackTriage['reporterRole']
    clientErrorEventId: string | null
    deliveryFailureCode: string | null
    providerReference: string | null
    attachmentKind: 'none' | 'masked_layout_v1'
    attachmentCapturedAt: Date | null
    attachmentExpiresAt: Date | null
    createdAt: Date
    updatedAt: Date
  }>

export type BetaFeedbackReporterItem = BetaFeedbackReportView

/** The triage store operations a reporter's request may reach. */
export type BetaFeedbackSubmissionStore = Readonly<{
  /** The row and its optional masked layout commit together. */
  prepare: (input: PreparedBetaFeedbackTriage) => Promise<BetaFeedbackTriageRecord>
  /** Settles a prepared row once, fenced on its expected revision. */
  markDelivered: (
    input: Readonly<{
      reference: string
      providerReference: string
      expectedRevision: number
      now: Date
    }>,
  ) => Promise<BetaFeedbackTriageRecord>
  /** Settles a prepared row once, fenced on its expected revision. */
  markFailed: (
    input: Readonly<{
      reference: string
      failureCode: string
      expectedRevision: number
      now: Date
    }>,
  ) => Promise<BetaFeedbackTriageRecord>
  /** Scoped by the actor pseudonym: it cannot express another reporter. */
  listForActor: (
    actorPseudonym: string,
    limit?: number,
  ) => Promise<readonly BetaFeedbackReporterItem[]>
}>

/** The authenticated reporter, as the request boundary resolved them. */
export type BetaFeedbackActor = Readonly<{
  userId: string
  organizationId: string
  role: Role
}>

export type BetaFeedbackDeliveryResult =
  | Readonly<{ status: 'delivered'; providerReference: string }>
  | Readonly<{
      status: 'failed'
      failureCode: 'monitoring_unavailable' | 'monitoring_invalid_reference'
    }>

/** Hands one prepared report to monitoring; it never throws for an outage. */
export type BetaFeedbackDelivery = (
  input: Readonly<{
    data: BetaFeedbackInput
    actor: BetaFeedbackActor
    hmacSecret: string
    reference: string
  }>,
) => BetaFeedbackDeliveryResult
