// The ONE branded email layout for Reputation Key.
//
// Every outbound mail — transactional (verify / reset / invite) and
// notification (urgent / digest) — renders through `EmailLayout`. There is no
// second shell: the previous `emailShell()` template literal existed in two
// byte-identical copies and drifted the moment either was edited.
//
// Email-client constraints this layout is shaped by, none of them negotiable:
//
//   * TABLES, not divs. Outlook 2016-2021 (Word rendering engine) drops
//     `max-width` on block elements; a centred 100% outer table with a fixed
//     inner table is the only layout that survives it.
//   * INLINE styles. Gmail strips <style> for the desktop web client's
//     clipped-message view and several clients strip <head> entirely, so every
//     visual property that matters is inline. The <style> block carries ONLY
//     the dark-mode overrides, which are progressive enhancement by definition.
//   * A PREHEADER. The hidden summary line is what the inbox shows next to the
//     subject. Without it clients scrape the first visible text, which here
//     would be the wordmark — three identical rows in the reader's inbox.
//   * NO IMAGES. Clients block remote images by default, so an image wordmark
//     renders as a broken box on first open. The wordmark is text.
//
// DESIGN.md compliance: flat surfaces (no drop shadows — separation comes from
// the page/surface tonal step and a 1px border), 12px container radius, 6px
// button radius, and the Spectral Violet accent confined to the single CTA
// plus the attention pill (well under the One Accent Rule's 10%).

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'

/**
 * The email colour palette, resolved to literal hex.
 *
 * Email clients cannot read CSS custom properties, so the `oklch()` tokens in
 * `src/styles.css` are resolved to sRGB hex exactly ONCE, here. Nothing else in
 * the email tree may write a colour literal.
 *
 * Source of truth is `src/styles.css` (what the product actually renders), not
 * the hex mirror in DESIGN.md's front matter — that mirror has drifted from the
 * oklch values and is approximately, not exactly, the shipped colour.
 *
 *   light.page              --background        oklch(0.98 0.003 270)
 *   light.surface           --surface / --card  oklch(1    0.003 270)
 *   light.border            --border            oklch(0.9  0.006 270)
 *   light.textPrimary       --text-primary      oklch(0.18 0.008 270)
 *   light.textSecondary     --text-secondary    oklch(0.48 0.01  270)
 *   light.accent            --primary           oklch(0.42 0.18  290)
 *   light.accentForeground  --primary-foreground oklch(1   0.003 270)
 *   light.accentMuted       --accent-muted      oklch(0.93 0.04  290)
 *   dark.*                  the same tokens under `.dark`
 *
 * Contrast, measured against the surface each colour sits on: body 18.8:1,
 * secondary 6.6:1, accent-on-white 9.2:1, accent-on-accentMuted 7.4:1, and in
 * dark mode 15.4 / 7.1 / 5.0:1. Every pairing clears WCAG AA for body text.
 */
export const EMAIL_PALETTE = {
  light: {
    page: '#F7F8FA',
    surface: '#FEFFFF',
    border: '#DCDEE2',
    textPrimary: '#101115',
    textSecondary: '#5B5D63',
    accent: '#512DA6',
    accentForeground: '#FEFFFF',
    accentMuted: '#E7E4FF',
  },
  dark: {
    page: '#06070A',
    surface: '#101116',
    border: '#26292F',
    textPrimary: '#E6E8ED',
    textSecondary: '#9C9EA5',
    accent: '#765AD4',
    accentForeground: '#FEFFFF',
    accentMuted: '#161227',
  },
} as const

/** System stack: webfonts are unreliable in mail clients, so Satoshi is a hint. */
const EMAIL_FONT_STACK =
  "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Brand footer line, rendered in the HTML footer and every plain-text twin. */
export const EMAIL_SIGNATURE = 'Reputation Key · reputationkey.app'

/** Inner content width. 600px is the widest that survives the Outlook pane. */
const CONTENT_WIDTH = 600

const { light, dark } = EMAIL_PALETTE

// Dark-mode overrides. Apple Mail, Outlook.com and iOS Mail honour the media
// query; Gmail does not (it force-inverts instead, which the flat palette
// tolerates). `!important` is required to beat the inline light-mode styles.
const DARK_MODE_CSS = `
@media (prefers-color-scheme: dark) {
  .rk-page { background-color: ${dark.page} !important; }
  .rk-card { background-color: ${dark.surface} !important; border-color: ${dark.border} !important; }
  .rk-ink { color: ${dark.textPrimary} !important; }
  .rk-muted { color: ${dark.textSecondary} !important; }
  .rk-rule { border-color: ${dark.border} !important; background-color: ${dark.border} !important; }
  .rk-accent { color: ${dark.accent} !important; }
  .rk-pill { background-color: ${dark.accentMuted} !important; color: ${dark.accent} !important; }
  .rk-btn { background-color: ${dark.accent} !important; color: ${dark.accentForeground} !important; }
}
`

export type EmailLayoutProps = Readonly<{
  /** Inbox preview line. The single highest-leverage string in the email. */
  preheader: string
  /** Document <title>; also the accessible name of the message. */
  documentTitle: string
  children: ReactNode
  /** Footer sentence explaining why this message was sent. Always required. */
  whyReceived: string
  /** Absolute /settings/notifications URL. Omitted for mandatory mail. */
  preferencesUrl?: string
}>

/**
 * The disclosure footer: why this mail was sent, how to change that, and the
 * signature. Its own component because the disclosure is a compliance
 * obligation with its own rules — `preferencesUrl` is absent exactly when the
 * mail is mandatory and there is nothing to opt out of.
 */
const EmailFooter = ({
  whyReceived,
  preferencesUrl,
}: Readonly<{ whyReceived: string; preferencesUrl?: string }>) => (
  <Section style={{ padding: '18px 4px 0' }}>
    <Heading
      as="h2"
      className="rk-muted"
      style={{
        color: light.textSecondary,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        margin: '0 0 6px',
        textTransform: 'uppercase',
      }}
    >
      Why you received this
    </Heading>
    <Text
      className="rk-muted"
      style={{
        color: light.textSecondary,
        fontSize: '13px',
        lineHeight: 1.5,
        margin: 0,
      }}
    >
      {whyReceived}
    </Text>
    {preferencesUrl !== undefined && (
      <Text style={{ fontSize: '13px', lineHeight: 1.5, margin: '10px 0 0' }}>
        <Link
          className="rk-accent"
          href={preferencesUrl}
          style={{ color: light.accent, textDecoration: 'underline' }}
        >
          Manage notification preferences
        </Link>
      </Text>
    )}
    <Text
      className="rk-muted"
      style={{ color: light.textSecondary, fontSize: '12px', margin: '14px 0 0' }}
    >
      {EMAIL_SIGNATURE}
    </Text>
  </Section>
)

/**
 * The branded shell: preheader, wordmark, content slot, footer.
 *
 * Callers own everything between the wordmark and the footer and compose it
 * from the primitives in `./primitives`.
 */
export const EmailLayout = ({
  preheader,
  documentTitle,
  children,
  whyReceived,
  preferencesUrl,
}: EmailLayoutProps) => (
  <Html lang="en" dir="ltr">
    <Head>
      <title>{documentTitle}</title>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      {/* Static, module-owned CSS — no caller input is interpolated. */}
      <style dangerouslySetInnerHTML={{ __html: DARK_MODE_CSS }} />
    </Head>
    <Preview>{preheader}</Preview>
    <Body
      className="rk-page"
      style={{
        backgroundColor: light.page,
        fontFamily: EMAIL_FONT_STACK,
        margin: 0,
        padding: '24px 12px',
      }}
    >
      <Container
        style={{ maxWidth: `${CONTENT_WIDTH}px`, margin: '0 auto', width: '100%' }}
      >
        <Section style={{ padding: '0 4px 12px' }}>
          <Text
            className="rk-ink"
            style={{
              color: light.textPrimary,
              fontSize: '15px',
              fontWeight: 600,
              letterSpacing: '0.01em',
              margin: 0,
            }}
          >
            Reputation Key
          </Text>
        </Section>

        <Section
          className="rk-card"
          style={{
            backgroundColor: light.surface,
            border: `1px solid ${light.border}`,
            borderRadius: '12px',
            padding: '28px 28px 24px',
          }}
        >
          {children}
        </Section>

        <EmailFooter whyReceived={whyReceived} preferencesUrl={preferencesUrl} />
      </Container>
    </Body>
  </Html>
)
