export { EMAIL_PALETTE, EMAIL_SIGNATURE, EmailLayout } from './layout'
export type { EmailLayoutProps } from './layout'
export { renderEmailDocument } from './render-document'
export type { RenderedEmail } from './render-document'
export { composeText } from './plain-text'
export type { TextBlock } from './plain-text'
export { absoluteUrl, originOf } from './urls'
export { warnOnceOnSenderMisalignment } from './sender-alignment'
export {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from './transactional'
export type { InvitationEmailContent } from './transactional'
