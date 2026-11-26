export { EMAIL_PALETTE, EMAIL_SIGNATURE, EmailLayout } from './layout'
export { renderEmailDocument } from './render-document'
export type { RenderedEmail } from './render-document'
export { composeText } from './plain-text'
export { absoluteUrl, originOf } from './urls'
export { warnOnceOnSenderMisalignment } from './sender-alignment'
export {
  renderInvitationEmail,
  renderStaffCodeReadyEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from './transactional'
