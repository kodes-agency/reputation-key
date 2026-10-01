import type { ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestPortalCopy } from './guest-language-pack'
import type { GuestResponseFormViewProps } from './guest-response-form-view'

/**
 * A controlled state for the guest page, for manager previews and Storybook.
 * The page renders it from static data: no server action is mounted, no session
 * exists and no request is made.
 */
export type GuestPagePreviewState =
  | Readonly<{ kind: 'arrival' }>
  /** Rated, with the Google card. The note card follows the threshold unless pinned. */
  | Readonly<{ kind: 'rated'; rating: number; noteEligible?: boolean }>
  /**
   * A low rating with the private note still to write. The legacy page keeps
   * the note field as the form's own state, so it renders the same markup as an
   * eligible `rated` state: an empty note. The Immersive Hub opens the note and
   * shows `draft` in it (board G06).
   */
  | Readonly<{ kind: 'note-writing'; rating?: number; draft?: string }>
  /** A low rating whose private note has been sent. */
  | Readonly<{ kind: 'done'; rating?: number }>
  /** Rated, but the property has no usable Google review link. */
  | Readonly<{ kind: 'googleUnavailable'; rating?: number; noteEligible?: boolean }>

/** The default the previews and stories use for "a low rating". */
export const PREVIEW_PRIVATE_FEEDBACK_THRESHOLD = 3
const PREVIEW_LOW_RATING = 2
const PREVIEW_HIGH_RATING = 5

// Fixed instants, so a preview reads the same on every machine and in every test.
const SUBMITTED_AT = '2026-01-01T12:00:00.000Z'
const CORRECTION_DEADLINE = '2026-01-01T13:00:00.000Z'
const WITHDRAWAL_DEADLINE = '2026-01-02T12:00:00.000Z'

type ResponseOptions = Readonly<{
  rating: number
  noteEligible: boolean
  noteSent: boolean
}>

function previewResponse({
  rating,
  noteEligible,
  noteSent,
}: ResponseOptions): GuestResponseView {
  return {
    status: 'submitted',
    rating,
    hasPrivateFeedback: noteSent,
    privateFeedbackEligible: noteEligible && !noteSent,
    submittedAt: SUBMITTED_AT,
    correctedAt: null,
    correctionDeadline: CORRECTION_DEADLINE,
    correctionAvailable: true,
    responseWithdrawalDeadline: WITHDRAWAL_DEADLINE,
    responseWithdrawalAvailable: true,
    feedbackSubmittedAt: noteSent ? SUBMITTED_AT : null,
    feedbackWithdrawalDeadline: noteSent ? WITHDRAWAL_DEADLINE : null,
    feedbackWithdrawalAvailable: noteSent,
    feedbackWithdrawnAt: null,
    deletedAt: null,
  }
}

const noop = () => undefined

export type PreviewFormOptions = Readonly<{
  copy: GuestPortalCopy
  privateFeedbackThreshold?: number
  secondaryLinks?: ReactNode
}>

type PreviewResponseState = Readonly<{
  response: GuestResponseView | null
  googleReviewAvailable: boolean
}>

/**
 * The response a preview state stands for, and whether Google can be offered.
 * Shared by the legacy form view and the Immersive Hub's response view, so a
 * state means the same thing on both.
 */
export function previewResponseState(
  state: GuestPagePreviewState,
  threshold: number,
): PreviewResponseState {
  const rated = (rating: number, noteEligible: boolean, noteSent = false) =>
    previewResponse({ rating, noteEligible, noteSent })
  switch (state.kind) {
    case 'arrival':
      return { response: null, googleReviewAvailable: true }
    case 'rated':
      return {
        response: rated(state.rating, state.noteEligible ?? state.rating <= threshold),
        googleReviewAvailable: true,
      }
    case 'note-writing':
      return {
        response: rated(state.rating ?? PREVIEW_LOW_RATING, true),
        googleReviewAvailable: true,
      }
    case 'done':
      return {
        response: rated(state.rating ?? PREVIEW_LOW_RATING, true, true),
        googleReviewAvailable: true,
      }
    case 'googleUnavailable': {
      const rating = state.rating ?? PREVIEW_HIGH_RATING
      return {
        response: rated(rating, state.noteEligible ?? rating <= threshold),
        googleReviewAvailable: false,
      }
    }
  }
}

type PreviewSnapshot = PreviewResponseState & Readonly<{ message: string }>

function previewSnapshot(
  state: GuestPagePreviewState,
  copy: GuestPortalCopy,
  threshold: number,
): PreviewSnapshot {
  return {
    ...previewResponseState(state, threshold),
    message: state.kind === 'done' ? copy.feedbackSent : '',
  }
}

/** The form view's props for a preview state. Every handler is inert. */
export function previewFormViewProps(
  state: GuestPagePreviewState,
  { copy, privateFeedbackThreshold, secondaryLinks }: PreviewFormOptions,
): GuestResponseFormViewProps {
  const threshold = privateFeedbackThreshold ?? PREVIEW_PRIVATE_FEEDBACK_THRESHOLD
  return {
    availability: 'available',
    copy,
    ...previewSnapshot(state, copy, threshold),
    correcting: false,
    pending: false,
    submitRatingMutation: {},
    submitFeedbackMutation: {},
    secondaryLinks,
    onSubmitRating: async () => undefined,
    onSubmitFeedback: async () => false,
    onGoogleReview: noop,
    onStartCorrection: noop,
    onStartNewResponse: noop,
    onWithdrawFeedback: noop,
    onWithdraw: noop,
  }
}
