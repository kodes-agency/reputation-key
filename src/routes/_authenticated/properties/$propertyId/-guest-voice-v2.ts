// Which Guest voice a Property is drawn: 2.0 where its reviews have a v3 analysis, today's
// page everywhere else. The server decides (`getGuestVoiceV2Fn`); the route only reads
// what it answered. A Property that answers anything but a page, whether it has no v3
// analysis, AI is off, or the analysis is not ready, is drawn as it has always been, and
// today's page says what it always said about those states.
import type {
  GuestVoiceV2Read,
  GuestVoiceV2Response,
} from '#/contexts/ai/application/public-api'
import type { GuestVoiceV2View } from '#/components/features/property/guest-voice/guest-voice-v2-body'

/** What the server function answers: the page, or why today's page is the one to draw. */
export type GuestVoiceV2Answer =
  Exclude<GuestVoiceV2Response, Readonly<{ status: 'drafted' }>> | GuestVoiceV2Read

/** The Guest voice 2.0 page in an answer, or null when today's page is the one to draw. */
export function guestVoiceV2PageOf(
  answer: GuestVoiceV2Answer | undefined,
): GuestVoiceV2Read | null {
  if (answer === undefined) return null
  return answer.status === 'ready' || answer.status === 'not_enough_reviews'
    ? answer
    : null
}

/**
 * The drawer of an issue is the next slice's (4.3): it needs its own read. Until it lands
 * no issue is open and naming one opens nothing, so the page offers no door to an empty
 * drawer; the figures, the quotes and the way into the Inbox are all there.
 */
export function guestVoiceV2View(read: GuestVoiceV2Read): GuestVoiceV2View {
  return {
    read,
    openIssueId: null,
    onOpenIssueChange: () => undefined,
    drawer: { status: 'pending' },
  }
}
