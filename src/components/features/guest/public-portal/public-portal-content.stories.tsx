// Public portal content stories — brand-critical guest surface that composes
// StarRating + FeedbackForm over a portal's hero, links, and categories.
// `submitFeedback` / `submitRating` are optional plain async fn props → mockServerFn.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import { PublicPortalContent } from './public-portal-content'
import type { PublicPortalContentProps } from './public-portal-content'

type FeedbackInput = {
  data: {
    portalId: string
    comment: string
    source: ScanSource
    honeypot: string
    submittedAt: number
  }
}
type RatingInput = { data: { portalId: string; value: number; source: ScanSource } }

const portal = {
  id: 'portal-1',
  name: 'Sunset Inn',
  description: 'Guest services & local recommendations',
  organizationName: 'Sunset Hospitality',
  heroImageUrl: null,
  theme: null,
}

const categories = [
  { id: 'cat-1', title: 'Front Desk' },
  { id: 'cat-2', title: 'Dining' },
]
const links = [
  {
    id: 'link-1',
    label: 'Request late checkout',
    url: 'https://example.com/checkout',
    categoryId: 'cat-1',
  },
  {
    id: 'link-2',
    label: 'Breakfast menu',
    url: 'https://example.com/menu',
    categoryId: 'cat-2',
  },
]

const resolvingFeedback = mockServerFn<FeedbackInput, { ok: true }>(async () => ({
  ok: true,
}))
const resolvingRating = mockServerFn<RatingInput, { ok: true }>(async () => ({
  ok: true,
}))

const baseArgs: PublicPortalContentProps = {
  portal,
  categories,
  links,
  source: 'direct',
  submitFeedback: resolvingFeedback,
  submitRating: resolvingRating,
}

const meta: Meta<typeof PublicPortalContent> = {
  title: 'Guest/PublicPortalContent',
  component: PublicPortalContent,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof PublicPortalContent>

// Fresh visit — no rating or feedback submitted yet.
export const Empty: Story = {
  args: baseArgs,
}

// Rating click is in flight (never resolves) → stars stay in submitting state.
export const SubmittingRating: Story = {
  args: {
    ...baseArgs,
    submitRating: mockServerFn<RatingInput, unknown>(
      () => new Promise<unknown>(() => {}),
    ),
  },
}

// Feedback submission is in flight (never resolves) → button shows "Sending...".
export const SubmittingFeedback: Story = {
  args: {
    ...baseArgs,
    submitFeedback: mockServerFn<FeedbackInput, unknown>(
      () => new Promise<unknown>(() => {}),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'Working on it...')
    await userEvent.click(canvas.getByRole('button', { name: /send feedback/i }))
    expect(await canvas.findByRole('button', { name: /sending/i })).toBeInTheDocument()
  },
}

// Full happy path: leave a star rating, then submit feedback.
export const Success: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Star rating — click 5 stars, assert the thank-you confirmation.
    await userEvent.click(canvas.getByRole('radio', { name: /5 stars/i }))
    expect(await canvas.findByText(/thank you for your feedback/i)).toBeInTheDocument()
    // Feedback form — type a comment and submit, assert its thank-you state.
    await userEvent.type(canvas.getByRole('textbox'), 'Wonderful stay!')
    await userEvent.click(canvas.getByRole('button', { name: /send feedback/i }))
    // Two "Thank you for your feedback!" confirmations now exist (rating + form).
    expect(
      canvas.getAllByText(/thank you for your feedback/i).length,
    ).toBeGreaterThanOrEqual(2)
  },
}
