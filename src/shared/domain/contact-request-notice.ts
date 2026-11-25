// The Privacy Notice versions in force that cover contact requests.
//
// A Portal publication may offer contact requests only under one of these: it
// pins the notice's id, version, digest and the locale it was shown in, and the
// snapshot's evidence check refuses a switched-on publication without them.
// The list stays empty until a Privacy Notice version that covers contact
// requests is published; adding that version's entry is part of that launch.

import type { GuestLocale } from './guest-locale'

export type ContactRequestNotice = Readonly<{
  noticeId: string
  noticeVersion: string
  /** SHA-256 of the notice text as served, lower-case hex. */
  noticeDigest: string
  /** The languages the notice is published in; the first is the fallback. */
  locales: readonly [GuestLocale, ...GuestLocale[]]
}>

/** Oldest first; the last entry is the notice a publication pins. */
export const CONTACT_REQUEST_NOTICES_IN_FORCE: readonly ContactRequestNotice[] = []

/** What a publication pins from the notice: the columns the evidence check reads. */
export type ContactNoticeEvidence = Readonly<{
  noticeId: string
  noticeVersion: string
  noticeDigest: string
  noticeLocale: GuestLocale
}>

/**
 * The evidence for a Portal whose primary language is `locale`: the newest
 * notice in force, in that language when it has one, else in its fallback.
 * Null while no notice in force covers contact requests.
 */
export function contactNoticeEvidenceFor(
  locale: GuestLocale,
  notices: readonly ContactRequestNotice[] = CONTACT_REQUEST_NOTICES_IN_FORCE,
): ContactNoticeEvidence | null {
  const notice = notices.at(-1)
  if (notice === undefined) return null
  return {
    noticeId: notice.noticeId,
    noticeVersion: notice.noticeVersion,
    noticeDigest: notice.noticeDigest,
    noticeLocale: notice.locales.includes(locale) ? locale : notice.locales[0],
  }
}
