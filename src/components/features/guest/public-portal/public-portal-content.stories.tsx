import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PublicPortalContent } from './public-portal-content'
import type { PublicPortalContentProps } from './public-portal-content'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

const portal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'The Harbor Hotel',
  description: 'Thank you for visiting.',
  organizationName: 'Harbor Hospitality',
  heroImageUrl: null,
  theme: { primaryColor: '#4f46e5', backgroundColor: '#ffffff', textColor: '#111827' },
}
const categories = [{ id: '00000000-0000-4000-8000-000000000010', title: 'Useful links' }]
const links = [
  {
    id: '00000000-0000-4000-8000-000000000021',
    label: 'Hotel website',
    url: 'https://example.com/',
    categoryId: categories[0].id,
  },
]
const reviewGateway = {
  privateFeedbackThreshold: 3,
  googleReview: { status: 'available' as const, uri: 'https://www.google.com/' },
}
const submitted: GuestResponseView = {
  status: 'submitted',
  rating: 2,
  hasPrivateFeedback: false,
  privateFeedbackEligible: true,
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

const responseForm: NonNullable<PublicPortalContentProps['responseForm']> = {
  csrfNonce: '00000000-0000-4000-8000-000000000040',
  initialResponse: null,
  submitResponse: async ({ data }) => ({
    ...submitted,
    rating: data.rating,
    privateFeedbackEligible: data.rating <= 3,
  }),
  correctResponse: async ({ data }) => ({
    ...submitted,
    status: 'corrected',
    rating: data.rating,
    correctedAt: '2026-08-09T12:15:00.000Z',
    correctionAvailable: false,
  }),
  startNewResponse: async () => ({
    csrfNonce: '00000000-0000-4000-8000-000000000099',
  }),
  submitPrivateFeedback: async () => ({
    ...submitted,
    hasPrivateFeedback: true,
    privateFeedbackEligible: false,
    feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
    feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
    feedbackWithdrawalAvailable: true,
  }),
  selectGoogleReview: async () => ({ url: reviewGateway.googleReview.uri }),
  withdrawResponse: async () => ({
    ...submitted,
    status: 'deleted',
    rating: null,
    responseWithdrawalAvailable: false,
    deletedAt: '2026-08-09T12:30:00.000Z',
  }),
  withdrawPrivateFeedback: async () => ({
    ...submitted,
    hasPrivateFeedback: false,
    privateFeedbackEligible: false,
    feedbackSubmittedAt: '2026-08-09T12:05:00.000Z',
    feedbackWithdrawalDeadline: '2026-08-10T12:05:00.000Z',
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: '2026-08-09T12:30:00.000Z',
  }),
}

const baseArgs: PublicPortalContentProps = {
  token: 'portal-public-token',
  portal,
  categories,
  links,
  reviewGateway,
  responseForm,
}

const meta: Meta<typeof PublicPortalContent> = {
  title: 'Features/Guest/PublicPortalContent',
  component: PublicPortalContent,
  args: baseArgs,
}
export default meta

type Story = StoryObj<typeof PublicPortalContent>

export const RatingFirstWithSecondaryLinks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Submit private rating' }),
    ).toBeVisible()
    expect(canvas.queryByRole('navigation', { name: 'More links' })).toBeNull()
  },
}
export const GoogleBeforeEligibleFeedback: Story = {
  args: { responseForm: { ...responseForm, initialResponse: submitted } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const google = canvas.getByRole('button', { name: 'Continue to Google' })
    const feedback = canvas.getByLabelText('Private feedback')
    const links = canvas.getByRole('navigation', { name: 'More links' })
    await expect(google).toBeVisible()
    await expect(feedback).toBeVisible()
    await expect(links).toBeVisible()
    expect(
      google.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      feedback.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}
export const DegradedGoogleKeepsGatewayAndSecondaryLinks: Story = {
  args: {
    reviewGateway: {
      privateFeedbackThreshold: 3,
      googleReview: { status: 'unavailable' },
    },
    responseForm: { ...responseForm, initialResponse: submitted },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google review link unavailable')).toBeVisible()
    await expect(canvas.getByLabelText('Private feedback')).toBeVisible()
    await expect(canvas.getByRole('navigation', { name: 'More links' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Continue to Google' })).toBeNull()
  },
}
export const NoSecondaryLinks: Story = { args: { categories: [], links: [] } }
export const ManagerPreview: Story = {
  args: { token: undefined, responseForm: undefined },
}
export const MissingPublicGatewayFailsClosed: Story = {
  args: { reviewGateway: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Review gateway temporarily unavailable')).toBeVisible()
    expect(canvas.queryByRole('navigation', { name: 'More links' })).toBeNull()
  },
}
export const BulgarianRatingFirst: Story = {
  args: {
    portal: {
      ...portal,
      name: 'Разкажете ни за престоя си',
      description: 'Вашето мнение е важно.',
      organizationName: 'Хотел Пристанище',
    },
    localization: {
      selectedLocale: 'bg',
      primaryLocale: 'en',
      availableLocales: ['en', 'bg'],
      languagePackVersion: 'guest-ui-bg-v1',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Изпрати непубличната оценка' }),
    ).toBeVisible()
    await expect(canvas.getByRole('navigation', { name: 'Език' })).toBeVisible()
  },
}
export const DarkPalette: Story = {
  args: {
    portal: {
      ...portal,
      theme: {
        primaryColor: '#a5b4fc',
        backgroundColor: '#111827',
        textColor: '#f9fafb',
      },
    },
  },
}
