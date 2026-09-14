import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiAdmissionLane } from '../../domain/admission-lanes'

export type AiAdmissionClaim =
  | Readonly<{
      ok: true
      admissionId: string
      expiresAtEpochMillis: number
    }>
  | Readonly<{
      ok: false
      /** Our own capacity is in use; nothing was consumed by asking. */
      code: 'admission_busy'
      retryAfterEpochMillis: number
    }>
  | Readonly<{
      ok: false
      /** The admission store could not answer; fail closed. */
      code: 'admission_unavailable'
    }>

/**
 * One atomic admission for a provider-bound AI call. It is taken before the
 * operation's execution attempt is claimed, so a busy answer is never an
 * attempt, and it checks every scope of the lane in one step, so a denial
 * consumes capacity in none of them.
 */
export type AiAdmissionPort = Readonly<{
  acquire(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      lane: AiAdmissionLane
      nowEpochMillis: number
      /** Slots that must remain free in every rate scope after this admission. */
      headroom?: number
    }>,
  ): Promise<AiAdmissionClaim>
  release(input: Readonly<{ admissionId: string }>): Promise<void>
}>
