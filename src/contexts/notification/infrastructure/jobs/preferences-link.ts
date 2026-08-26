// ADR 0046 r.7 — "No marketing content in operational mail. Every
// non-mandatory email links to preferences."
//
// This is a GUARD, not a template convention. A convention is something a
// renderer can quietly stop honouring after a refactor; a guard fails the send.
// The failure mode it prevents is specific and unpleasant: an operational email
// with no way out is what gets a sending domain reported, and the reporter is a
// paying customer who could not find the off switch.
//
// The parameter is a MailClass, not a NotificationCategory, because the
// question these functions answer — "may this recipient unsubscribe from this
// message?" — is a property of the MESSAGE, not of a notification taxonomy. An
// aggregate digest has no category of its own; forcing one into existence just
// so it had a non-mandatory value to pass is what produced the phantom
// `digest_summary` category.
//
// `mandatory` is deliberately exempt in both directions. Account, security and
// legal mail must not advertise an unsubscribe link, because the link would be
// a lie — that mail is not disableable (ADR 0046 default policy table).

import type { NotificationCategory } from '../../domain/types'
import { notificationError } from '../../domain/errors'

/**
 * Whether the recipient is allowed to switch this message off. Two values, and
 * there will never be a third: RFC 8058 has no middle ground.
 */
export type MailClass = 'mandatory' | 'optional'

/** Where preferences live. One constant so the job and the renderer agree. */
export const PREFERENCES_PATH = '/settings/notifications'

/**
 * Only `mandatory` is legally-required mail. Every other category is something
 * the recipient chose to receive and can therefore stop receiving.
 */
export function mailClassForCategory(category: NotificationCategory): MailClass {
  return category === 'mandatory' ? 'mandatory' : 'optional'
}

/** Mandatory mail is exempt: it has no off switch, so it must not offer one. */
export function requiresPreferencesLink(mailClass: MailClass): boolean {
  return mailClass !== 'mandatory'
}

/**
 * RFC 8058 one-click unsubscribe. `List-Unsubscribe-Post` is what makes the
 * mail client's native "Unsubscribe" button appear and act without a round trip
 * through a confirmation page — Gmail and Outlook both weight its presence in
 * bulk-sender reputation.
 *
 * Returns `{}` for mandatory mail, so the caller can spread unconditionally.
 */
export function unsubscribeHeaders(
  mailClass: MailClass,
  oneClickUrl: string,
): Readonly<Record<string, string>> {
  if (!requiresPreferencesLink(mailClass)) return {}
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * Throws when an optional email is about to be dispatched without a usable
 * preferences URL. Returns the URL so call sites read as
 * `assertPreferencesLink(mailClass, url)` in the argument position.
 */
export function assertPreferencesLink(
  mailClass: MailClass,
  preferencesUrl: string,
): string {
  if (!requiresPreferencesLink(mailClass)) return preferencesUrl
  const usable =
    typeof preferencesUrl === 'string' &&
    preferencesUrl.trim() !== '' &&
    /^https?:\/\//.test(preferencesUrl)
  if (!usable) {
    throw notificationError(
      'email_send_failed',
      'ADR 0046 r.7: refusing to send optional email without a preferences link',
      { mailClass, preferencesUrl },
    )
  }
  return preferencesUrl
}
