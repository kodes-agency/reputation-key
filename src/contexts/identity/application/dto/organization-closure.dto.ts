// LIF-01-T17 — Closure Center request/response shapes.
//
// The Closure Center is authenticated and READ-ONLY apart from the four
// closure-lifecycle commands below. Program bullet 8 forbids introducing a
// fresh-password or MFA requirement, so nothing here carries a second factor,
// a step-up nonce or a re-authentication challenge: typed confirmation plus
// the current AccountAdmin session is the whole gate, and the authority is
// re-checked under lock inside the command store.

import { z } from 'zod/v4'
import {
  ORGANIZATION_CLOSURE_CANCEL_REASON_CODES,
  ORGANIZATION_CLOSURE_REQUEST_REASON_CODES,
  ORGANIZATION_LIFECYCLE_STATES,
  ORGANIZATION_REACTIVATION_ACKNOWLEDGEMENTS,
  ORGANIZATION_REACTIVATION_CHECKS,
} from '../../domain/organization-lifecycle'

/** Content-free support/evidence identifier, same grammar as the column. */
const evidenceRefSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/u, 'Use a content-free reference')

const reasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)

/**
 * The exact sentence an AccountAdmin must type. Deliberately not a password:
 * it proves intent, not identity, and it is checked server-side so a client
 * cannot skip it.
 */
export const closureConfirmationPhrase = (organizationName: string): string =>
  `CLOSE ${organizationName}`

export const requestOrganizationClosureInputSchema = z.object({
  reasonCode: z.enum(ORGANIZATION_CLOSURE_REQUEST_REASON_CODES),
  supportEvidenceRef: evidenceRefSchema,
  /** Must equal `closureConfirmationPhrase(organization.name)`. */
  typedConfirmation: z.string().min(1),
})
export type RequestOrganizationClosureDto = z.infer<
  typeof requestOrganizationClosureInputSchema
>

export const cancelOrganizationClosureInputSchema = z.object({
  reasonCode: z.enum(ORGANIZATION_CLOSURE_CANCEL_REASON_CODES),
  supportEvidenceRef: evidenceRefSchema,
})
export type CancelOrganizationClosureDto = z.infer<
  typeof cancelOrganizationClosureInputSchema
>

export const reactivateOrganizationInputSchema = z.object({
  acknowledgements: z
    .array(
      z.object({
        id: z.enum(ORGANIZATION_REACTIVATION_ACKNOWLEDGEMENTS),
        reasonCode: reasonCodeSchema,
      }),
    )
    .min(ORGANIZATION_REACTIVATION_ACKNOWLEDGEMENTS.length),
})
export type ReactivateOrganizationDto = z.infer<typeof reactivateOrganizationInputSchema>

export const organizationExportRetrievalInputSchema = z.object({
  requestId: z.uuid(),
})
export type OrganizationExportRetrievalDto = z.infer<
  typeof organizationExportRetrievalInputSchema
>

export const downloadOrganizationExportInputSchema = z.object({
  requestId: z.uuid(),
  token: z.string().min(1).max(512),
})
export type DownloadOrganizationExportDto = z.infer<
  typeof downloadOrganizationExportInputSchema
>

/**
 * What the Closure Center is allowed to show.
 *
 * Object keys, retrieval token digests and support evidence references are
 * deliberately absent: they are storage and operator control-plane material,
 * and a tenant surface that leaked them would hand out a second way to reach
 * the archive. Checksums and coverage ARE shown — they are how a tenant
 * verifies the archive they downloaded is the one this system built.
 */
export type OrganizationExportView = Readonly<{
  requestId: string
  state:
    | 'requested'
    | 'generating'
    | 'egress_pending'
    | 'ready'
    | 'retrieval_issued'
    | 'retrieved'
    | 'delete_pending'
    | 'deleted'
    | 'failed'
  asOf: string
  objectExpiresAt: string
  retrievalExpiresAt: string | null
  archiveSha256: string | null
  coverageSha256: string | null
  lastErrorCode: string | null
}>

export type ClosureCenterView = Readonly<{
  organizationName: string
  /** IANA zone the deadline is rendered in. Beta is one US Data Cell. */
  timezone: string
  state: (typeof ORGANIZATION_LIFECYCLE_STATES)[number]
  revision: number
  closureRequestedAt: string | null
  recoverableUntil: string | null
  irreversibleAt: string | null
  closedAt: string | null
  reactivationRequired: boolean
  /**
   * Whether this deployment can accept a closure request at all. False when no
   * reactivation command is composed: requesting a closure would then suspend
   * the Organization with no way back, so the command refuses. Server-computed
   * so the UI states the refusal instead of arming a button that can only 403.
   */
  closureRequestAvailable: boolean
  /** Server-computed so a client clock cannot re-open a closed window. */
  cancellable: boolean
  confirmationPhrase: string
  reactivationChecks: ReadonlyArray<
    Readonly<{
      id: (typeof ORGANIZATION_REACTIVATION_CHECKS)[number]
      satisfied: boolean
      detailCode: string
    }>
  >
  export: OrganizationExportView | null
}>
