import {
  PREVIEW_PRIVATE_FEEDBACK_THRESHOLD,
  previewResponseState,
  type GuestPagePreviewState,
} from '../guest-page-preview-state'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import type { ImmersiveResponseViewProps } from './immersive-response-view'

const noop = () => undefined

/**
 * The response view's props for a controlled state, for manager previews and
 * stories. The same states mean the same thing as on the legacy page
 * (`previewResponseState`). Every handler is inert: no session exists and no
 * request is made.
 */
export function immersiveResponseProps(
  state: GuestPagePreviewState,
  options: Readonly<{
    pack: GuestPortalCopyV2
    displayName: string
    privateFeedbackThreshold?: number
  }>,
): ImmersiveResponseViewProps {
  const threshold = options.privateFeedbackThreshold ?? PREVIEW_PRIVATE_FEEDBACK_THRESHOLD
  return {
    pack: options.pack,
    displayName: options.displayName,
    availability: 'available',
    ...previewResponseState(state, threshold),
    pending: false,
    failure: null,
    noteDraft:
      state.kind === 'note-writing' ? { open: true, text: state.draft ?? '' } : undefined,
    onSubmitRating: async () => undefined,
    onSubmitNote: async () => false,
    onGoogleReview: noop,
    onChangeRating: noop,
  }
}
