import {
  useReplyDraftSession,
  useDraftSessionSnapshot,
} from './reply-draft-session-context'
import { Fragment, type ReactNode } from 'react'
import { cn } from '#/lib/utils'
import type { MentionSense } from './review-cause-view'
import { evidenceSegments, type ReviewEvidence } from './review-evidence-view'

// The underline is the highlight; its colour only says which way the guest was speaking
// (the chips say it in words). A sentence an address was about also takes a tint.
const UNDERLINE: Readonly<Record<MentionSense, string>> = {
  complaint: 'decoration-negative',
  praise: 'decoration-positive',
  neutral: 'decoration-muted-foreground',
}

/**
 * A review's words, with the sentences its reading cites underlined. The words are the
 * guest's own and are drawn as they are; only a text equal to the one the reading was read
 * from is marked, so a translation or a review edited since is printed plain.
 */
export function ReviewProse({
  text,
  evidence,
}: Readonly<{ text: string; evidence: ReviewEvidence | null }>): ReactNode {
  const context = useReplyDraftSession()
  const draft = useDraftSessionSnapshot(context?.session)
  const drafting =
    draft.visible &&
    context?.original === text &&
    context.originalDigest !== null &&
    context.originalDigest === draft.reviewTextDigest
      ? draft.sentences
      : []
  const currentEvidence = evidence?.original === text ? evidence : null
  if (!currentEvidence && drafting.length === 0) return text
  return evidenceSegments(
    text,
    currentEvidence?.mentions ?? [],
    currentEvidence?.matched ?? new Set(),
    drafting,
  ).map((segment, index) =>
    segment.cited === null ? (
      <Fragment key={index}>{segment.text}</Fragment>
    ) : (
      <mark
        key={index}
        className={cn(
          'bg-transparent text-inherit underline decoration-2 underline-offset-4',
          UNDERLINE[segment.cited.sense],
          segment.cited.matched && 'bg-accent text-accent-foreground',
          segment.cited.drafting &&
            'rounded-sm bg-accent text-accent-foreground transition-colors duration-500 motion-reduce:transition-none',
        )}
      >
        {segment.text}
      </mark>
    ),
  )
}
