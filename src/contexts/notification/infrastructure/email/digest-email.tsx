// The daily digest email.
//
// Grouped by property because that is the unit a manager acts on: one property
// is one person's morning. Every row carries its own deep link, so the digest
// is a worklist rather than a "you have updates, go look" nudge — the previous
// version joined its rows with the literal two-character sequence `\n` and had
// no links at all.

import { Heading, Section, Text } from '@react-email/components'
import type { RenderedNotification } from '../../domain/notification-templates'
import { EMAIL_PALETTE, EmailLayout, renderEmailDocument } from '#/shared/email'
import {
  EmailButton,
  EmailHeadline,
  EmailParagraph,
  EmailRule,
  EmailTextLink,
} from '#/shared/email/primitives'
import { toPlainFacts } from './notification-facts'

const { light } = EMAIL_PALETTE

export type DigestEmailItem = Readonly<{
  rendered: RenderedNotification
  actionUrl: string
}>

export type DigestEmailGroup = Readonly<{
  propertyName: string
  items: ReadonlyArray<DigestEmailItem>
}>

export type DigestEmailProps = Readonly<{
  recipientName: string | null
  dateLabel: string
  /** "7 updates across 3 properties" — shared with the subject line. */
  headline: string
  groups: ReadonlyArray<DigestEmailGroup>
  preferencesUrl: string
  /** Absolute inbox URL, or null when no origin could be derived. */
  inboxUrl: string | null
}>

const DigestRow = ({ rendered, actionUrl }: DigestEmailItem) => (
  <Section style={{ padding: '0 0 14px' }}>
    <Heading
      as="h3"
      className="rk-ink"
      style={{
        color: light.textPrimary,
        fontSize: '15px',
        fontWeight: 600,
        lineHeight: 1.35,
        margin: '0 0 2px',
      }}
    >
      {rendered.title}
    </Heading>
    <Text
      className="rk-muted"
      style={{
        color: light.textSecondary,
        fontSize: '13px',
        lineHeight: 1.5,
        margin: '0 0 4px',
      }}
    >
      {toPlainFacts(rendered.summary) === ''
        ? rendered.body
        : toPlainFacts(rendered.summary)}
    </Text>
    <Text style={{ margin: 0 }}>
      <EmailTextLink href={actionUrl}>{rendered.actionLabel}</EmailTextLink>
    </Text>
  </Section>
)

const DigestGroup = ({ propertyName, items }: DigestEmailGroup) => (
  <Section style={{ padding: '0 0 6px' }}>
    <Heading
      as="h2"
      className="rk-muted"
      style={{
        color: light.textSecondary,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        margin: '0 0 10px',
        textTransform: 'uppercase',
      }}
    >
      {propertyName}
    </Heading>
    {items.map((item) => (
      <DigestRow key={item.actionUrl} {...item} />
    ))}
  </Section>
)

const DigestEmail = ({
  recipientName,
  dateLabel,
  headline,
  groups,
  preferencesUrl,
  inboxUrl,
}: DigestEmailProps) => (
  <EmailLayout
    preheader={`${headline} — ${dateLabel}`}
    documentTitle="Your daily digest"
    whyReceived="You received this because your daily email digest is on. It is sent once a day and lists only the facts you need to decide what to open."
    preferencesUrl={preferencesUrl}
  >
    <EmailParagraph>
      {recipientName === null ? 'Hi there,' : `Hi ${recipientName},`}
    </EmailParagraph>
    <EmailHeadline>{headline}</EmailHeadline>
    <Text
      className="rk-muted"
      style={{ color: light.textSecondary, fontSize: '13px', margin: '0 0 20px' }}
    >
      {dateLabel}
    </Text>
    {groups.map((group, index) => (
      <Section key={group.propertyName}>
        {index > 0 && <EmailRule />}
        <DigestGroup {...group} />
      </Section>
    ))}
    {inboxUrl !== null && (
      <Section style={{ padding: '10px 0 0' }}>
        <EmailButton href={inboxUrl}>Open inbox</EmailButton>
      </Section>
    )}
  </EmailLayout>
)

/** JSX-free entry point so `render.ts` can stay a `.ts` module. */
export const renderDigestEmailHtml = (props: DigestEmailProps): string =>
  renderEmailDocument(<DigestEmail {...props} />)
