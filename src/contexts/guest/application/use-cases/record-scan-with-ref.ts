import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
import type { StaffId } from '#/shared/domain/ids'
import { staffId } from '#/shared/domain/ids'
import type { RecordScanDeps, RecordScanInput } from './record-scan'
import { recordScan } from './record-scan'

export type RecordScanWithRefDeps = Readonly<{
  staffRepo: StaffAssignmentRepository
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
        resolvedStaffId = staffId(assignment.userId as string)
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
