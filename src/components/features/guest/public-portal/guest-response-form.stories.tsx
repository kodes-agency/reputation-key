import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { GuestResponseForm } from './guest-response-form'
import type { GuestResponseFormProps } from './guest-response-form'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

const submitted: GuestResponseView = {
  status: 'submitted',
  rating: 5,
  hasPrivateFeedback: false,
  privateFeedbackEligible: false,
  submittedAt: '2026-08-09T12:00:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-08-09T13:00:00.000Z',
  correctionAvailable: true,
  responseWithdrawalDeadline: '2026-08-10T12:00:00.000Z',
  responseWithdrawalAvailable: true,
  feedbackSubmittedAt: null,
  feedbackWithdrawalDeadline: null,
  feedbackWithdrawalAvailable: false,
  feedbackWithdrawnAt: null,
  deletedAt: null,
}

const lowRating: GuestResponseView = {
  ...submitted,
  rating: 2,
  privateFeedbackEligible: true,
}

const actions: Pick<
  GuestResponseFormProps,
  | 'submitResponse'
  | 'correctResponse'
  | 'startNewResponse'
  | 'submitPrivateFeedback'
  | 'selectGoogleReview'
  | 'withdrawResponse'
  | 'withdrawPrivateFeedback'
> = {
  submitResponse: async ({ data }) => ({
    ...submitted,
    rating: data.rating,
    privateFeedbackEligible: data.rating <= 3,
  }),
  correctResponse: async ({ data }) => ({
    ...submitted,
    status: 'corrected',
    rating: data.rating,
    privateFeedbackEligible: data.rating <= 3,
    correctedAt: '2026-08-09T12:15:00.000Z',
    correctionAvailable: false,
  }),
  startNewResponse: async () => ({
    csrfNonce: '00000000-0000-4000-8000-000000000099',
  }),
  submitPrivateFeedback: async () => ({
    ...lowRating,
    hasPrivateFeedback: true,
    privateFeedbackEligible: false,
    feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
    feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
    feedbackWithdrawalAvailable: true,
  }),
  selectGoogleReview: async () => ({ url: 'https://www.google.com/' }),
  withdrawResponse: async () => ({
    ...submitted,
    status: 'deleted',
    rating: null,
    responseWithdrawalAvailable: false,
    deletedAt: '2026-08-09T12:30:00.000Z',
  }),
  withdrawPrivateFeedback: async () => ({
    ...lowRating,
    hasPrivateFeedback: false,
    privateFeedbackEligible: false,
    feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
    feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: '2026-08-09T12:30:00.000Z',
  }),
}

const baseArgs: GuestResponseFormProps = {
  token: 'portal-public-token',
  csrfNonce: '00000000-0000-4000-8000-000000000003',
  googleReview: { status: 'available', uri: 'https://www.google.com/' },
  initialResponse: null,
  ...actions,
}

const meta: Meta<typeof GuestResponseForm> = {
  title: 'Features/Guest/GuestResponseForm',
  component: GuestResponseForm,
  args: baseArgs,
}
export default meta

type Story = StoryObj<typeof GuestResponseForm>

export const RatingFirst: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Submit private rating' }),
    ).toHaveAttribute('data-slot', 'button')
  },
}
export const Loading: Story = { args: { availability: 'loading' } }
export const HighRatingGoogleNext: Story = {
  args: { initialResponse: submitted },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Continue to Google' })).toBeVisible()
    expect(canvas.queryByLabelText('Private feedback')).toBeNull()
  },
}
export const LowRatingGoogleThenPrivateFeedback: Story = {
  args: { initialResponse: lowRating },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const google = canvas.getByRole('button', { name: 'Continue to Google' })
    const feedback = canvas.getByLabelText('Private feedback')
    await expect(google).toBeVisible()
    await expect(google).toHaveAttribute('data-slot', 'button')
    await expect(feedback).toBeVisible()
    await expect(feedback).toHaveAttribute('data-slot', 'textarea')
    expect(
      google.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}
export const GoogleUnavailableKeepsPrivateFeedback: Story = {
  args: {
    initialResponse: lowRating,
    googleReview: { status: 'unavailable' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google review link unavailable')).toBeVisible()
    await expect(canvas.getByLabelText('Private feedback')).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Continue to Google' })).toBeNull()
  },
}
export const FeedbackReceipt: Story = {
  args: {
    initialResponse: {
      ...lowRating,
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
      feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
      feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
      feedbackWithdrawalAvailable: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Withdraw only my private feedback' }),
    )
    await expect(
      canvas.getAllByText(
        'Your private feedback was withdrawn. Your private rating remains saved.',
      )[0],
    ).toBeVisible()
    await expect(canvas.getByText('You rated this experience 2/5.')).toBeVisible()
  },
}
export const SharedDeviceStartsFresh: Story = {
  args: { initialResponse: submitted },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start a new response' }))
    await expect(
      canvas.getByRole('button', { name: 'Submit private rating' }),
    ).toBeVisible()
    await expect(
      canvas.getByText('Ready for another response. The earlier response remains saved.'),
    ).toBeVisible()
    expect(canvas.queryByText('You rated this experience 5/5.')).toBeNull()
  },
}
export const Unavailable: Story = { args: { availability: 'error' } }
