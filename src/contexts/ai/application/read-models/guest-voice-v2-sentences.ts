import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsScope,
} from '../ports/ai-guest-voice-facts.port'
import { mentionRefKey } from '../ports/ai-guest-voice-facts.port'
import type { EvidenceSlot } from './guest-voice-v2-evidence'
/** The sentences each candidate cites; a candidate whose are not stored cannot be underlined. */
export async function withSentences(
  facts: AiGuestVoiceFactsPort,
  scope: GuestVoiceFactsScope,
  slots: readonly EvidenceSlot[],
): Promise<readonly EvidenceSlot[]> {
  const refs = slots.flatMap((slot) =>
    slot.candidates.map((candidate) => ({
      reviewId: candidate.reviewId,
      sourceRevision: candidate.sourceRevision,
      analysisSequence: candidate.analysisSequence,
      mentionOrdinal: candidate.mentionOrdinal,
    })),
  )
  const sentences = await facts.readMentionSentences(scope, refs)
  return slots.map((slot) => ({
    ...slot,
    candidates: slot.candidates
      .map((candidate) => ({
        ...candidate,
        sentenceNumbers: sentences.get(mentionRefKey(candidate)) ?? [],
      }))
      .filter((candidate) => candidate.sentenceNumbers.length > 0),
  }))
}
