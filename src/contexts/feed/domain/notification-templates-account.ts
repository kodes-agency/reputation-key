// Feed notification surface — copy for the Organization account notices.
//
// Split out of ./notification-templates.ts, which lists these renderers in its
// table. They are named exports, not one record the table spreads: a spread of
// an imported object moved this whole copy into first paint's chunk (+6 KB
// gzip against a budget with about 100 B to spare). This module is a leaf: it
// imports nothing from that one, so its copy type is restated structurally
// below and the one helper it shares is local.
//
// Every account notice belongs to the Organization, not to a Property, and is
// mandatory, so it has no preferences link and its footer is the only place it
// can say why it arrived. Each one therefore names the Organization (the
// payload's `organizationName`) and, where it is about one, the role. A row
// written before the name was kept renders the plain sentence it always did.
//
// ADR 0046 r.8: no notice names another person. The member hears that an
// Account Admin changed their access, the inviter hears that someone joined:
// the payload has no field a person's name could ride in.
import { SUPPORT_EMAIL } from '#/shared/domain/support-contact'
import type { NotificationMemberRole, NotificationPayload } from './notification-payload'

/** What an account renderer returns; assignable to the templates' own copy type. */
export type AccountNoticeCopy = Readonly<{
  title: string
  body: string
  /** What the in-app row shows under the title; empty when it adds nothing. */
  detail?: string
  actionLabel: string
  summary: string
  whyReceived: string
}>

type AccountNoticeInput = Readonly<{
  title: string
  body: string
  whyReceived: string
  detail?: string
  /** The email facts line. Defaults to the title, in the facts line's case. */
  summary?: string
  actionLabel?: string
}>

/** Joins non-empty facts with a middot for the compact metadata line. */
const facts = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' · ')

/**
 * An account notice: its summary is its title, in the facts line's case, unless
 * it supplies one. Renderers call it rather than being built by it at module
 * load, which would make this module side-effectful and pull it into every
 * chunk that imports the Feed public API.
 */
const accountNotice = ({
  title,
  body,
  whyReceived,
  detail = '',
  summary = title.toLowerCase(),
  actionLabel = 'Review account',
}: AccountNoticeInput): AccountNoticeCopy => ({
  title,
  body,
  detail,
  actionLabel,
  summary,
  whyReceived,
})

/**
 * A notice whose body says what to do about it, so the row shows the body:
 * the reader who lost access needs the next step, not just the headline.
 */
const informativeAccountNotice = (input: AccountNoticeInput): AccountNoticeCopy =>
  accountNotice({ ...input, detail: input.body })

/** The facts line for a notice about an Organization, led by its name. */
const factsAbout = (p: NotificationPayload, fact: string): string | undefined =>
  p.organizationName === undefined ? undefined : facts(p.organizationName, fact)

const MEMBER_ROLE_PHRASES: Readonly<Record<NotificationMemberRole, string>> = {
  account_admin: 'an Account Admin',
  property_manager: 'a Property Manager',
}

export const renderOrganizationAccessGranted = (
  p: NotificationPayload,
): AccountNoticeCopy =>
  accountNotice({
    title:
      p.organizationName === undefined
        ? 'Organization access added'
        : `You joined ${p.organizationName}`,
    body: 'Your account can now access this organization.',
    whyReceived:
      'You received this because your account was given access to an organization on Reputation Key.',
    summary: factsAbout(p, 'access added'),
  })

export const renderOrganizationRoleChanged = (
  p: NotificationPayload,
): AccountNoticeCopy => {
  const roleSentence =
    p.memberRole === undefined
      ? undefined
      : `You are now ${MEMBER_ROLE_PHRASES[p.memberRole]}.`
  return accountNotice({
    title:
      p.organizationName === undefined
        ? 'Organization role updated'
        : `Your role at ${p.organizationName} changed`,
    body: roleSentence ?? 'Your account permissions for this organization were updated.',
    // The role is the news; the title only says that something changed.
    detail: roleSentence ?? '',
    whyReceived:
      'You received this because what your account may do in an organization on Reputation Key changed.',
    summary: factsAbout(p, 'role changed'),
  })
}

/** A member who left is told they left, not that an administrator acted. */
export const renderOrganizationAccessRemoved = (
  p: NotificationPayload,
): AccountNoticeCopy =>
  p.leftOrganization === true
    ? informativeAccountNotice({
        title:
          p.organizationName === undefined
            ? 'You left the organization'
            : `You left ${p.organizationName}`,
        body: 'Your account no longer has access to this organization. To come back, ask an account administrator to invite you again.',
        whyReceived:
          'You received this because you left an organization on Reputation Key.',
        summary: factsAbout(p, 'left'),
      })
    : informativeAccountNotice({
        title:
          p.organizationName === undefined
            ? 'Organization access removed'
            : `Your access to ${p.organizationName} was removed`,
        body: 'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.',
        whyReceived:
          'You received this because your access to an organization on Reputation Key ended.',
        summary: factsAbout(p, 'access removed'),
      })

/**
 * An Account Admin changed which Properties the reader can work. The copy
 * never says which Properties or how many: notices of one type coalesce into
 * one unread row, and Properties is where the current answer is.
 */
export const renderOrganizationPropertyAccessChanged = (
  p: NotificationPayload,
): AccountNoticeCopy =>
  accountNotice({
    title: 'Your property access changed',
    body:
      p.organizationName === undefined
        ? 'Open Properties to see what you can work.'
        : `Your property access at ${p.organizationName} changed. Open Properties to see what you can work.`,
    whyReceived:
      'You received this because an Account Admin changed which properties you can work.',
    summary: facts(p.organizationName ?? '', 'property access changed'),
    actionLabel: 'Open Properties',
  })

/**
 * The inviter hears that an invitation they sent was accepted. The notice never
 * names who accepted it (r.8); Members lists the person and their Properties.
 */
export const renderInvitationAccepted = (p: NotificationPayload): AccountNoticeCopy =>
  accountNotice({
    title: 'An invitation you sent was accepted',
    body:
      p.organizationName === undefined
        ? 'Someone you invited joined. Review their properties in Members.'
        : `Someone you invited joined ${p.organizationName}. Review their properties in Members.`,
    whyReceived:
      'You received this because an invitation you sent on Reputation Key was accepted.',
    summary: facts(p.organizationName ?? '', 'invitation accepted'),
    actionLabel: 'Open Members',
  })

/**
 * LIF-01 program bullet 5. Purge Pending has no timer: support begins the
 * irreversible purge, so deletion can start at any time and only support can
 * cancel it first. The subject leads with "deletion" so a 60-character clip
 * keeps it. No shipped page exposes pending-purge actions; the generic
 * Organization link still opens the profile, and the label says so.
 *
 * "Contact support" is only useful with a channel attached, so the body names
 * the monitored address and the email sets it as its reply-to
 * (`notificationReplyTo`). A reader in a mail client can then answer where
 * they are standing.
 */
export const renderOrganizationPurgePending = (
  p: NotificationPayload,
): AccountNoticeCopy => {
  const body = `The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only Reputation Key support can stop it, before it starts. To stop it, answer this email or write to ${SUPPORT_EMAIL} now.`
  return {
    title: `Final notice: permanent deletion of ${p.organizationName ?? 'this organization'}`,
    body,
    detail: body,
    actionLabel: 'Open profile',
    summary: facts(p.organizationName ?? '', 'permanent deletion pending'),
    whyReceived:
      'You received this because you administer an organization that is scheduled for permanent deletion. It cannot be turned off.',
  }
}
