import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import type { RenderReplyResult } from '#/shared/reply-library/render-reply'
import type { ReplyFrameBand } from '#/shared/domain/reply-frame'

/** Band recording switches with v2; B1 preserves the served template metadata too. */
export function templateFrameChoices(
  choices: RenderReplyResult['choices'],
  ratingBand: ReplyFrameBand,
) {
  return getAiRuntimeCapability('reply_drafting').operationProfileVersion ===
    'reply-suggestion-v2'
    ? { ...choices, ratingBand }
    : choices
}
