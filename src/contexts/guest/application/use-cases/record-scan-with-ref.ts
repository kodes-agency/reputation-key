import type { StaffId, OrganizationId } from '#/shared/domain/ids'
import type { RecordScanDeps, RecordScanInput } from './record-scan'
import { recordScan } from './record-scan'
import { staffId } from '#/shared/domain/ids'

/**
 * Local port for referral code resolution.
 * Decouples guest context from staff context internals.
 * The staff context's StaffAssignmentRepository satisfies this interface.
 */
export type ReferralCodeResolver = Readonly<{
  findByReferralCode(
    organizationId: OrganizationId,
    referralCode: string,
  ): Promise<{ userId: string } | null>
}>

export type RecordScanWithRefDeps = Readonly<{
  staffRepo: ReferralCodeResolver
  guestRepo: RecordScanDeps['guestRepo']
  events: RecordScanDeps['events']
  idGen: RecordScanDeps['idGen']
  clock: RecordScanDeps['clock']
}>

export type RecordScanWithRefInput = Readonly<
  Omit<RecordScanInput, 'staffId'> & {
    referralCode: string | null
  }
>

export const recordScanWithRef =
  (deps: RecordScanWithRefDeps) =>
  async (input: RecordScanWithRefInput): Promise<void> => {
    let resolvedStaffId: StaffId | null = null

    if (input.referralCode) {
      const assignment = await deps.staffRepo.findByReferralCode(
        input.organizationId,
        input.referralCode,
      )
      if (assignment) {
        resolvedStaffId = staffId(assignment.userId)
      }
    }

    const innerScan = recordScan({
      guestRepo: deps.guestRepo,
      events: deps.events,
      idGen: deps.idGen,
      clock: deps.clock,
    })

    return innerScan({
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      source: input.source,
      sessionId: input.sessionId,
      ipHash: input.ipHash,
      staffId: resolvedStaffId,
    })
  }
