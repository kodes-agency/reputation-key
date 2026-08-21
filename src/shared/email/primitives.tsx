// Content primitives for the email layout.
//
// Split from `layout.tsx` so the shell stays readable and so the palette has a
// single owner: everything here reads `EMAIL_PALETTE.light` for its inline
// styles and tags itself with the `rk-*` class the shell's dark-mode media
// query targets. No component in this file may introduce a colour literal.

import { Button, Heading, Hr, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { EMAIL_PALETTE } from './layout'

const { light } = EMAIL_PALETTE

/** Page headline. Exactly one per email — it is the document's `h1`. */
export const EmailHeadline = ({ children }: Readonly<{ children: ReactNode }>) => (
  <Heading
    as="h1"
    className="rk-ink"
    style={{
      color: light.textPrimary,
      fontSize: '21px',
      fontWeight: 600,
      lineHeight: 1.25,
      margin: '0 0 12px',
    }}
  >
    {children}
  </Heading>
)

/** Body paragraph. */
export const EmailParagraph = ({ children }: Readonly<{ children: ReactNode }>) => (
  <Text
    className="rk-ink"
    style={{
      color: light.textPrimary,
      fontSize: '15px',
      lineHeight: 1.55,
      margin: '0 0 16px',
    }}
  >
    {children}
  </Text>
)

/** Secondary line — metadata, expiry notes, reassurance copy. */
export const EmailMutedParagraph = ({ children }: Readonly<{ children: ReactNode }>) => (
  <Text
    className="rk-muted"
    style={{
      color: light.textSecondary,
      fontSize: '13px',
      lineHeight: 1.5,
      margin: '0 0 12px',
    }}
  >
    {children}
  </Text>
)

/**
 * Small "Needs attention" marker for urgent mail.
 *
 * A pill rather than a red banner: DESIGN.md forbids the side-stripe accent and
 * the palette reserves Signal Red for destructive actions, not for urgency.
 */
export const EmailPill = ({ children }: Readonly<{ children: ReactNode }>) => (
  <Text style={{ margin: '0 0 14px' }}>
    <span
      className="rk-pill"
      style={{
        backgroundColor: light.accentMuted,
        borderRadius: '9999px',
        color: light.accent,
        display: 'inline-block',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        padding: '3px 10px',
      }}
    >
      {children}
    </span>
  </Text>
)

/** The single primary action. One per email — never two competing buttons. */
export const EmailButton = ({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) => (
  <Button
    className="rk-btn"
    href={href}
    style={{
      backgroundColor: light.accent,
      borderRadius: '6px',
      color: light.accentForeground,
      display: 'inline-block',
      fontSize: '14px',
      fontWeight: 600,
      padding: '11px 22px',
      textDecoration: 'none',
    }}
  >
    {children}
  </Button>
)

/** Inline text link, e.g. a digest row's own action. */
export const EmailTextLink = ({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) => (
  <Link
    className="rk-accent"
    href={href}
    style={{
      color: light.accent,
      fontSize: '13px',
      fontWeight: 600,
      textDecoration: 'underline',
    }}
  >
    {children}
  </Link>
)

/** Hairline separator between content blocks. */
export const EmailRule = () => (
  <Hr
    className="rk-rule"
    style={{ border: 'none', borderTop: `1px solid ${light.border}`, margin: '20px 0' }}
  />
)

/** The bare URL echoed under a CTA, for clients that swallow the button. */
export const EmailFallbackUrl = ({ href }: Readonly<{ href: string }>) => (
  <Text
    className="rk-muted"
    style={{
      color: light.textSecondary,
      fontSize: '12px',
      lineHeight: 1.5,
      margin: '14px 0 0',
      wordBreak: 'break-all',
    }}
  >
    Or paste this link into your browser:{' '}
    <Link className="rk-accent" href={href} style={{ color: light.accent }}>
      {href}
    </Link>
  </Text>
)
