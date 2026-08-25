import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GuestResponseForm } from './guest-response-form'
import type { GuestResponseFormProps } from './guest-response-form'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

const submitted: GuestResponseView = {
  id: '00000000-0000-4000-8000-000000000001',
  responseConsent: true,
  textConsent: false,
  status: 'submitted',
  rating: 5,
  category: null,
  hasPrivateFeedback: false,
  privateFeedbackEligible: false,
  mediaConsent: false,
  submittedAt: '2026-08-09T12:00:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-08-09T13:00:00.000Z',
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
  | 'submitPrivateFeedback'
  | 'selectGoogleReview'
  | 'withdrawResponse'
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
  }),
  submitPrivateFeedback: async () => ({
    ...lowRating,
    hasPrivateFeedback: true,
    privateFeedbackEligible: false,
    textConsent: true,
  }),
  selectGoogleReview: async () => ({ url: 'https://www.google.com/' }),
  withdrawResponse: async () => ({
    ...submitted,
    status: 'deleted',
    rating: null,
    deletedAt: '2026-08-09T12:30:00.000Z',
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

export const RatingFirst: Story = {}
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
    await expect(feedback).toBeVisible()
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
      textConsent: true,
    },
  },
}
export const Unavailable: Story = { args: { availability: 'error' } }
