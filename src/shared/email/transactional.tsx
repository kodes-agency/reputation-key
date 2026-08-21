// Transactional (account) email templates: verify, reset, invite.
//
// Deliberately transport-free — `src/shared/auth/emails.ts` owns Resend, this
// module owns markup — so the templates can be previewed in Storybook and
// asserted in unit tests without pulling the mail SDK into the bundle.
//
// All three are MANDATORY mail under ADR 0046: they carry no notification
// preference link because there is no setting that could switch them off. The
// footer still explains why the message arrived.

import { EmailLayout, EMAIL_SIGNATURE } from './layout'
import {
  EmailButton,
  EmailFallbackUrl,
  EmailHeadline,
  EmailMutedParagraph,
  EmailParagraph,
} from './primitives'
import { composeText } from './plain-text'
import { renderEmailDocument, type RenderedEmail } from './render-document'

/** Verify-your-email, sent by Better Auth on sign-up. */
export const renderVerificationEmail = (verifyUrl: string): RenderedEmail => ({
  subject: 'Verify your email — Reputation Key',
  html: renderEmailDocument(
    <EmailLayout
      preheader="Confirm your email address to activate your Reputation Key account."
      documentTitle="Verify your email"
      whyReceived="An account was created with this email address on Reputation Key. If that was not you, no account is active until this link is used."
    >
      <EmailHeadline>Verify your email</EmailHeadline>
      <EmailParagraph>
        Welcome to Reputation Key. Confirm this address to activate your account.
      </EmailParagraph>
      <EmailButton href={verifyUrl}>Verify email</EmailButton>
      <EmailFallbackUrl href={verifyUrl} />
      <EmailMutedParagraph>
        This link expires in 24 hours. If you didn&apos;t create an account, you can
        safely ignore this email.
      </EmailMutedParagraph>
    </EmailLayout>,
  ),
  text: composeText(
    'Verify your email',
    'Welcome to Reputation Key. Confirm this address to activate your account.',
    `Verify email: ${verifyUrl}`,
    'This link expires in 24 hours. If you didn\u2019t create an account, you can safely ignore this email.',
    EMAIL_SIGNATURE,
  ),
})

/** Password reset link, sent by Better Auth on request. */
export const renderPasswordResetEmail = (resetUrl: string): RenderedEmail => ({
  subject: 'Reset your password — Reputation Key',
  html: renderEmailDocument(
    <EmailLayout
      preheader="Set a new Reputation Key password. This link expires in 1 hour."
      documentTitle="Reset your password"
      whyReceived="A password reset was requested for this email address on Reputation Key. Your current password stays valid until a new one is set."
    >
      <EmailHeadline>Reset your password</EmailHeadline>
      <EmailParagraph>We received a request to reset your password.</EmailParagraph>
      <EmailButton href={resetUrl}>Reset password</EmailButton>
      <EmailFallbackUrl href={resetUrl} />
      <EmailMutedParagraph>
        This link expires in 1 hour. If you didn&apos;t request this, you can safely
        ignore this email.
      </EmailMutedParagraph>
    </EmailLayout>,
  ),
  text: composeText(
    'Reset your password',
    'We received a request to reset your password.',
    `Reset password: ${resetUrl}`,
    'This link expires in 1 hour. If you didn\u2019t request this, you can safely ignore this email.',
    EMAIL_SIGNATURE,
  ),
})

export type InvitationEmailContent = Readonly<{
  invitedByUsername: string
  organizationName: string
  inviteLink: string
}>

/** Organization invitation. */
export const renderInvitationEmail = ({
  invitedByUsername,
  organizationName,
  inviteLink,
}: InvitationEmailContent): RenderedEmail => ({
  subject: `${invitedByUsername} invited you to join ${organizationName}`,
  html: renderEmailDocument(
    <EmailLayout
      preheader={`${invitedByUsername} invited you to ${organizationName} on Reputation Key.`}
      documentTitle="You have been invited"
      whyReceived={`${invitedByUsername} invited this address to ${organizationName} on Reputation Key. The invitation expires in 7 days.`}
    >
      <EmailHeadline>Join {organizationName}</EmailHeadline>
      <EmailParagraph>
        <strong>{invitedByUsername}</strong> invited you to join{' '}
        <strong>{organizationName}</strong> on Reputation Key.
      </EmailParagraph>
      <EmailButton href={inviteLink}>Accept invitation</EmailButton>
      <EmailFallbackUrl href={inviteLink} />
      <EmailMutedParagraph>
        This invitation expires in 7 days. If you don&apos;t have an account yet,
        you&apos;ll be guided to create one after opening the link. If you weren&apos;t
        expecting this invitation, you can safely ignore this email.
      </EmailMutedParagraph>
    </EmailLayout>,
  ),
  text: composeText(
    `Join ${organizationName}`,
    `${invitedByUsername} invited you to join ${organizationName} on Reputation Key.`,
    `Accept invitation: ${inviteLink}`,
    'This invitation expires in 7 days. If you don\u2019t have an account yet, you\u2019ll be guided to create one after opening the link. If you weren\u2019t expecting this invitation, you can safely ignore this email.',
    EMAIL_SIGNATURE,
  ),
})
