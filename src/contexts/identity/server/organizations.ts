// Barrel file — re-exports all organization server functions.
// Consumers import from '#/contexts/identity/server/organizations' as before.

export { identityErrorStatus } from './organizations.shared'

export {
  getActiveOrganization,
  listMembers,
  listUserOrganizations,
} from './organizations.query'

export { inviteMember, updateMemberRole, removeMember } from './organizations.members'

export {
  acceptInvitation,
  cancelInvitation,
  resendInvitation,
  listInvitations,
} from './organizations.invitations'

export {
  registerMember,
  registerUserAndOrg,
  signInUser,
  setActiveOrganization,
  listUserInvitations,
} from './organizations.registration'

export { updateOrganization } from './organizations.update'

export {
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
  requestAvatarUpload,
  finalizeAvatarUpload,
} from './organizations.upload'
