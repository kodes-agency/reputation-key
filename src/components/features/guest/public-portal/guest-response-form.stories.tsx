import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
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
  googleReview: { status: 'available' },
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
export const RatingRequiresAChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Submit private rating' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Choose a rating from 1 to 5 stars.',
    )
    expect(canvas.queryByRole('button', { name: 'Continue to Google' })).toBeNull()
  },
}
export const RatingSubmissionLeadsToGoogle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: '4 stars' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Submit private rating' }))
    await expect(
      canvas.findByText('You rated this experience 4/5.'),
    ).resolves.toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue to Google' })).toBeVisible()
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
export const PrivateFeedbackRequiresText: Story = {
  args: { initialResponse: lowRating },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send private feedback' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Write your private feedback before sending it.',
    )
  },
}

const feedbackSpy = fn(async () => ({
  ...lowRating,
  hasPrivateFeedback: true,
  privateFeedbackEligible: false,
  feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
  feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
  feedbackWithdrawalAvailable: true,
}))

export const PrivateFeedbackUsesTheSharedNormalizedDto: Story = {
  args: { initialResponse: lowRating, submitPrivateFeedback: feedbackSpy },
  play: async ({ canvasElement }) => {
    feedbackSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Private feedback'), '  A helpful note.  ')
    await userEvent.click(canvas.getByRole('button', { name: 'Send private feedback' }))
    await waitFor(() =>
      expect(feedbackSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          csrfNonce: baseArgs.csrfNonce,
          text: 'A helpful note.',
          textConsent: true,
        }),
      }),
    )
  },
}

const correctionSpy = fn(
  async ({ data }: Parameters<GuestResponseFormProps['correctResponse']>[0]) => ({
    ...submitted,
    status: 'corrected' as const,
    rating: data.rating,
    correctedAt: '2026-08-09T12:15:00.000Z',
    correctionAvailable: false,
  }),
)

export const RatingCorrectionUsesTheCorrectionCommand: Story = {
  args: { initialResponse: submitted, correctResponse: correctionSpy },
  play: async ({ canvasElement }) => {
    correctionSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Change your private rating' }),
    )
    await userEvent.click(canvas.getByRole('radio', { name: '3 stars' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save rating correction' }))
    await waitFor(() =>
      expect(correctionSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          csrfNonce: baseArgs.csrfNonce,
          rating: 3,
          responseConsent: true,
        }),
      }),
    )
    await expect(
      canvas.findByText('You rated this experience 3/5.'),
    ).resolves.toBeVisible()
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

const rotatedNonce = '00000000-0000-4000-8000-000000000099'
const startNewSpy = fn(async () => ({ csrfNonce: rotatedNonce }))
const rotatedRatingSpy = fn(
  async ({ data }: Parameters<GuestResponseFormProps['submitResponse']>[0]) => ({
    ...submitted,
    rating: data.rating,
  }),
)

export const SharedDeviceUsesTheRotatedNonce: Story = {
  args: {
    initialResponse: submitted,
    startNewResponse: startNewSpy,
    submitResponse: rotatedRatingSpy,
  },
  play: async ({ canvasElement }) => {
    startNewSpy.mockClear()
    rotatedRatingSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start a new response' }))
    await userEvent.click(canvas.getByRole('radio', { name: '4 stars' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Submit private rating' }))
    await waitFor(() =>
      expect(rotatedRatingSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ csrfNonce: rotatedNonce, rating: 4 }),
      }),
    )
  },
}
export const Unavailable: Story = { args: { availability: 'error' } }
