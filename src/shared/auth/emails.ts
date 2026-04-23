// Email sending via Resend
import { Resend } from 'resend'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

let _resend: Resend | undefined

// ── Tagged errors ────────────────────────────────────────────────────

import { createErrorFactory } from '#/shared/domain/errors'

const emailError = createErrorFactory('EmailError')

// EmailError type is inferred from emailError — no explicit alias needed.
// Consumers can use ReturnType<typeof emailError> if needed.

// ── Resend client ────────────────────────────────────────────────────

export function getResend(): Resend {
  if (!_resend) {
    const env = getEnv()
    _resend = new Resend(env.RESEND_API_KEY)
  }
  return _resend
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const logger = getLogger()
  const resend = getResend()

  const { error } = await resend.emails.send({
    from: 'Reputation Key <info@kodes.agency>',
    to,
    subject,
    html,
  })

  if (error) {
    logger.error({ error, to }, `Failed to send email: ${subject}`)
    throw emailError('send_failed', `Failed to send email: ${error.message}`, {
      to,
      subject,
    })
  }

  logger.info({ to, subject }, 'Email sent')
}

/** Send email verification link */
export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Verify your email — Reputation Key',
    html: verificationEmailHtml(url),
  })
}

/** Send password reset link */
export async function sendResetPasswordEmail(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Reset your password — Reputation Key',
    html: resetPasswordEmailHtml(url),
  })
}

// ─── Email HTML templates ─────────────────────────────────────────────

function emailShell(innerHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #4fb8b2, #2f6a4a); padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 20px; font-weight: 600; }
    .body { padding: 32px 24px; }
    .body p { color: #333; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .button { display: inline-block; background: #4fb8b2; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0 24px; }
    .footer { padding: 16px 24px; text-align: center; color: #999; font-size: 13px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reputation Key</h1>
    </div>
    <div class="body">${innerHtml}</div>
  </div>
</body>
</html>`
}

function verificationEmailHtml(verificationUrl: string): string {
  return emailShell(`
      <p>Welcome! Please verify your email address to get started.</p>
      <a href="${verificationUrl}" class="button">Verify Email</a>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>This link expires in 24 hours.</p>
`)
}

function resetPasswordEmailHtml(resetUrl: string): string {
  return emailShell(`
      <p>We received a request to reset your password.</p>
      <a href="${resetUrl}" class="button">Reset Password</a>
      <p>If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>This link expires in 1 hour.</p>
`)
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
  await sendEmail({
    to: params.email,
    subject: `${params.invitedByUsername} invited you to join ${params.organizationName}`,
    html: invitationEmailHtml(params),
  })
}

function invitationEmailHtml(params: InvitationEmailParams): string {
  return emailShell(`
      <p><strong>${params.invitedByUsername}</strong> has invited you to join <strong>${params.organizationName}</strong> on Reputation Key.</p>
      <a href="${params.inviteLink}" class="button">Accept Invitation</a>
      <p>If you don't have an account yet, you'll be able to create one after clicking the link above.</p>
      <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>This invitation expires in 7 days.</p>
`)
}
