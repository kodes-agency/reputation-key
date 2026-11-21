/** Content-free observations. A terminal result is delivered separately, after settlement. */
export type ReplyDraftingProgress =
  | Readonly<{
      step: 'reading'
      reviewTextDigest?: string
      frame?: Readonly<{ prefix: string; suffix: string }>
    }>
  | Readonly<{ step: 'thinking' | 'writing' | 'checking' }>
  | Readonly<{ step: 'answering'; sentenceNumbers: readonly number[] }>
  | Readonly<{ step: 'rewording'; ordinal: 1 }>

export type ReplyDraftingProgressSink = (event: ReplyDraftingProgress) => void

/** Delivery failures must never change provider accounting or trigger another call. */
export function reportReplyProgress(
  sink: ReplyDraftingProgressSink | undefined,
  event: ReplyDraftingProgress,
): void {
  try {
    sink?.(event)
  } catch {
    // The browser may already have gone away.
  }
}
