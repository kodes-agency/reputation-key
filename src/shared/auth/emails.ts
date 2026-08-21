// Transactional email transport (Resend).
//
// TRANSPORT ONLY. Markup lives in `#/shared/email/transactional`, which is
// SDK-free so the templates can be previewed in Storybook and asserted in unit
// tests. This module previously carried a second, byte-identical copy of the
// `emailShell()` template literal; both copies are gone and there is exactly
// one layout in the repo.
import { Resend } from 'resend'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { maskEmail } from '#/shared/observability/pii'
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
  warnOnceOnSenderMisalignment,
  type RenderedEmail,
} from '#/shared/email'

let _resend: Resend | undefined

// ── Tagged errors ────────────────────────────────────────────────────

import { createErrorFactory } from '#/shared/domain/errors'

const emailError = createErrorFactory('EmailError')

// Thrown as a tagged EmailError; nothing outside this module catches it by type.

// ── Resend client ────────────────────────────────────────────────────

// Exported for tests (the seam's default-vs-override contract is pinned in
// emails.test.ts); production callers use the send* functions below.
export function getResend(): Resend {
  if (!_resend) {
    const env = getEnv()
    // RESEND_BASE_URL is the optional sandbox seam (see env.ts). Absent → the
    // SDK's default base URL — byte-identical to the pre-seam construction.
    _resend = env.RESEND_BASE_URL
      ? new Resend(env.RESEND_API_KEY, { baseUrl: env.RESEND_BASE_URL })
      : new Resend(env.RESEND_API_KEY)
  }
  return _resend
}

/** Reset cached client — useful for tests (pair with resetEnv). */
export function resetEmailClient(): void {
  _resend = undefined
}

/**
 * Send a rendered email.
 *
 * `text` is always sent alongside `html`: an HTML-only transactional message
 * scores badly with spam filters and is unreadable in a text-only client.
 *
 * The sender-domain check runs here rather than at boot because there is no
 * shared boot hook — the web process builds its container in composition.ts
 * and the worker in bootstrap.ts. First send is the earliest point both reach,
 * and the check latches once per process (see shared/email/sender-alignment).
 */
async function sendEmail(
  to: string,
  { subject, html, text }: RenderedEmail,
): Promise<void> {
  const logger = getLogger()
  const resend = getResend()
  const env = getEnv()

  warnOnceOnSenderMisalignment(env.EMAIL_FROM, env.BETTER_AUTH_URL, (fields, message) =>
    logger.warn(fields, message),
  )

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  })

  if (error) {
    logger.error(
      { error, toPrefix: maskEmail(to), subject },
      `Failed to send email: ${subject}`,
    )
    throw emailError('send_failed', `Failed to send email: ${error.message}`, {
      to,
      subject,
    })
  }

  logger.info({ toPrefix: maskEmail(to), subject }, 'Email sent')
}

/** Send password reset link */
export async function sendResetPasswordEmail(to: string, url: string): Promise<void> {
  await sendEmail(to, renderPasswordResetEmail(url))
}

/** Send email verification link */
export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendEmail(to, renderVerificationEmail(url))
}

// ─── Organization Invitation Email ────────────────────────────────────

export type InvitationEmailParams = Readonly<{
  email: string
  invitedByUsername: string
  organizationName: string
  inviteLink: string
}>

/** Send organization invitation email */
export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  await sendEmail(params.email, renderInvitationEmail(params))
}
