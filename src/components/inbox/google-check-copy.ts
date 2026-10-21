// What "Check on Google" says (the menu action, and the automatic check on
// return from "Open on Google").
//
// The server answers with a verdict only (`InboxGoogleCheckOutcome`); the words
// are here. A check the manager asked for always answers, in a toast. The
// automatic check on return speaks only when it finds the reply: a manager who
// came back from Google and is told "no reply yet" three times in ten minutes,
// for a check they did not ask for, is being nagged.

import type { InboxGoogleCheckOutcome } from '#/contexts/inbox/application/public-api'

export const GOOGLE_CHECK_COPY = {
  action: 'Check on Google',
  actionHint: 'Look for a reply on Google now.',
  pending: 'Checking Google…',
  replyFound: 'Google shows a reply. Closing this item.',
  /** The item is not open, so nothing is closing: say only what Google shows. */
  replyFoundOnClosedItem: 'Google shows a reply.',
  replyFoundOnReturn: 'Google shows your reply. Closing this item.',
  noReply: 'Google shows no reply yet.',
  unavailable: "Couldn't check Google right now. Try again in a minute.",
  notCheckable: "RepKey can't check this review on Google.",
} as const

/** Who started the check: the manager's click, or the return from Google. */
export type GoogleCheckSource = 'manual' | 'return'

export type GoogleCheckSay = Readonly<{
  tone: 'success' | 'info' | 'error'
  message: string
}>

export function sayGoogleCheck(
  outcome: InboxGoogleCheckOutcome,
  source: GoogleCheckSource,
  itemIsOpen = true,
): GoogleCheckSay | null {
  if (outcome === 'reply_found') {
    if (!itemIsOpen) {
      return { tone: 'success', message: GOOGLE_CHECK_COPY.replyFoundOnClosedItem }
    }
    return {
      tone: 'success',
      message:
        source === 'manual'
          ? GOOGLE_CHECK_COPY.replyFound
          : GOOGLE_CHECK_COPY.replyFoundOnReturn,
    }
  }
  if (source === 'return') return null
  switch (outcome) {
    case 'no_reply':
      return { tone: 'info', message: GOOGLE_CHECK_COPY.noReply }
    case 'unavailable':
      return { tone: 'error', message: GOOGLE_CHECK_COPY.unavailable }
    case 'rate_limited':
      return { tone: 'info', message: GOOGLE_CHECK_COPY.unavailable }
    case 'not_checkable':
      return { tone: 'info', message: GOOGLE_CHECK_COPY.notCheckable }
  }
}
