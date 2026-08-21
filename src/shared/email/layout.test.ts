// Contract tests for the ONE email layout and the three transactional emails
// that render through it.
import { describe, expect, it } from 'vitest'
import { EMAIL_PALETTE, EMAIL_SIGNATURE } from './layout'
import { composeText, textFacts } from './plain-text'
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from './transactional'

const VERIFY_URL = 'https://app.test/verify-email?token=tok-1'
const RESET_URL = 'https://app.test/reset-password?token=tok-2'

const paletteHexes = new Set(
  [...Object.values(EMAIL_PALETTE.light), ...Object.values(EMAIL_PALETTE.dark)].map(
    (hex) => hex.toUpperCase(),
  ),
)

describe('email document shell', () => {
  const { html } = renderVerificationEmail(VERIFY_URL)

  it('is a complete XHTML document with a language', () => {
    expect(
      html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'),
    ).toBe(true)
    expect(html).toContain('lang="en"')
  })

  it('declares support for both colour schemes and ships the dark overrides', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>')
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark"/>')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain(`background-color: ${EMAIL_PALETTE.dark.page}`)
  })

  it('emits a hidden preheader — the inbox preview line', () => {
    expect(html).toContain('data-skip-in-text="true"')
    expect(html).toContain(
      'Confirm your email address to activate your Reputation Key account.',
    )
  })

  it('lays out in tables, not divs, so Outlook keeps the 600px column', () => {
    expect(html).toContain('role="presentation"')
    expect(html).toContain('max-width:600px')
  })

  it('is flat: no drop-shadow elevation and no radius above 12px', () => {
    expect(html).not.toContain('box-shadow')
    expect(html).toMatch(/border-radius:(6px|12px|9999px)/)
    expect(html).not.toMatch(/border-radius:(1[3-9]|[2-9]\d)px/)
  })

  it('uses no colour literal outside the single exported palette', () => {
    const used = new Set(
      (html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((hex) => hex.toUpperCase()),
    )
    expect([...used].filter((hex) => !paletteHexes.has(hex))).toEqual([])
  })

  it('carries no remote image that a client would block', () => {
    expect(html).not.toContain('<img')
  })
})

describe('renderVerificationEmail', () => {
  const email = renderVerificationEmail(VERIFY_URL)

  it('keeps the established subject', () => {
    expect(email.subject).toBe('Verify your email — Reputation Key')
  })

  it('puts the action URL in BOTH parts', () => {
    expect(email.html).toContain(`href="${VERIFY_URL}"`)
    expect(email.text).toContain(VERIFY_URL)
  })

  it('keeps the expiry and reassurance copy', () => {
    expect(email.html).toContain('This link expires in 24 hours.')
    expect(email.text).toContain('This link expires in 24 hours.')
    expect(email.text).toContain('you can safely ignore this email')
  })

  it('is mandatory mail: it explains why but offers no preference link', () => {
    expect(email.html).toContain('Why you received this')
    expect(email.html).not.toContain('Manage notification preferences')
  })

  it('signs the plain-text twin', () => {
    expect(email.text).toContain(EMAIL_SIGNATURE)
    expect(email.text.endsWith('\n')).toBe(true)
  })
})

describe('renderPasswordResetEmail', () => {
  const email = renderPasswordResetEmail(RESET_URL)

  it('keeps the established subject and expiry', () => {
    expect(email.subject).toBe('Reset your password — Reputation Key')
    expect(email.text).toContain('This link expires in 1 hour.')
  })

  it('puts the action URL in BOTH parts', () => {
    expect(email.html).toContain(`href="${RESET_URL}"`)
    expect(email.text).toContain(RESET_URL)
  })
})

describe('renderInvitationEmail', () => {
  const email = renderInvitationEmail({
    invitedByUsername: 'Ada Lovelace',
    organizationName: 'Riverside & Co',
    inviteLink: 'https://app.test/accept-invitation?id=inv-1',
  })

  it('keeps the established subject', () => {
    expect(email.subject).toBe('Ada Lovelace invited you to join Riverside & Co')
  })

  it('puts the invite link in BOTH parts', () => {
    expect(email.html).toContain('href="https://app.test/accept-invitation?id=inv-1"')
    expect(email.text).toContain('https://app.test/accept-invitation?id=inv-1')
  })

  it('HTML-escapes an organization name carrying markup', () => {
    const hostile = renderInvitationEmail({
      invitedByUsername: 'Mallory',
      organizationName: '<script>alert(1)</script>',
      inviteLink: 'https://app.test/accept-invitation?id=inv-2',
    })
    expect(hostile.html).not.toContain('<script>')
    expect(hostile.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('composeText', () => {
  it('separates blocks with real newlines, never the two characters \\ and n', () => {
    const text = composeText('One', 'Two')
    expect(text).toBe('One\n\nTwo\n')
    expect(text).not.toContain('\\n')
  })

  it('drops empty and falsy blocks instead of leaving a gap', () => {
    expect(composeText('One', '', null, undefined, false, '   ', 'Two')).toBe(
      'One\n\nTwo\n',
    )
  })

  it('collapses over-long newline runs and returns empty for no content', () => {
    expect(composeText('One\n\n\n\nTwo')).toBe('One\n\nTwo\n')
    expect(composeText(null, '')).toBe('')
  })

  it('joins facts with the same middot the HTML part uses', () => {
    expect(textFacts('Riverside Hotel', '', '2/5 review')).toBe(
      'Riverside Hotel · 2/5 review',
    )
  })
})
