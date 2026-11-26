import type { StaffAccountBindings } from '../build'

const unavailable = async (): Promise<never> => {
  throw new Error('Staff account bindings are unavailable')
}

/** Staff bindings for builds that never reach a staff account operation. */
export const unavailableStaffAccountBindings: StaffAccountBindings = {
  authorizeProperty: unavailable,
  portals: {
    archiveForMemberDeparture: unavailable,
    rename: unavailable,
    check: unavailable,
    create: unavailable,
    issueCode: unavailable,
    publish: unavailable,
    archive: unavailable,
  },
  spendInvitationBudget: unavailable,
  invitationBudget: unavailable,
  deliverAccess: unavailable,
  spendAddressCheckBudget: unavailable,
}
