import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { PublicPortalContent } from './public-portal-content'
import type { PublicPortalContentProps } from './public-portal-content'

const portal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'The Harbor Hotel',
  description: 'Thank you for visiting. Choose any destination below.',
  organizationName: 'Harbor Hospitality',
  heroImageUrl: null,
  theme: { primaryColor: '#4f46e5', backgroundColor: '#ffffff', textColor: '#111827' },
}
const categories = [
  { id: '00000000-0000-4000-8000-000000000010', title: 'Share your experience' },
]
const links = [
  {
    id: '00000000-0000-4000-8000-000000000020',
    label: 'Google',
    url: 'https://www.google.com/',
    categoryId: categories[0].id,
  },
  {
    id: '00000000-0000-4000-8000-000000000021',
    label: 'Tripadvisor',
    url: 'https://www.tripadvisor.com/',
    categoryId: categories[0].id,
  },
]
const submitted: GuestResponseView = {
  id: '00000000-0000-4000-8000-000000000030',
  responseConsent: true,
  textConsent: false,
  status: 'submitted',
  rating: 5,
  category: null,
  text: null,
  mediaConsent: false,
  submittedAt: '2026-08-09T12:00:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-08-09T13:00:00.000Z',
  deletedAt: null,
}
const deleted: GuestResponseView = {
  ...submitted,
  status: 'deleted',
  rating: null,
  deletedAt: '2026-08-09T12:30:00.000Z',
}

const responseForm: NonNullable<PublicPortalContentProps['responseForm']> = {
  csrfNonce: '00000000-0000-4000-8000-000000000040',
  initialResponse: null,
  submitResponse: async ({ data }) => ({
    ...submitted,
    rating: data.rating,
    text: data.text,
    mediaConsent: data.mediaConsent,
  }),
  correctResponse: async ({ data }) => ({
    ...submitted,
    status: 'corrected',
    rating: data.rating,
    text: data.text,
    mediaConsent: data.mediaConsent,
    correctedAt: '2026-08-09T12:15:00.000Z',
  }),
  withdrawResponse: async () => deleted,
  issueMedia: async ({ data }) => ({
    mediaId: '00000000-0000-4000-8000-000000000050',
    objectKey: 'guest/example.webp',
    uploadUrl: 'https://uploads.invalid/example',
    contentType: data.contentType,
  }),
  confirmMedia: async ({ data }) => ({ mediaId: data.mediaId, status: 'ready' }),
}

const baseArgs: PublicPortalContentProps = {
  token: 'portal-public-token',
  portal,
  categories,
  links,
  responseForm,
}

const meta: Meta<typeof PublicPortalContent> = {
  title: 'Features/Guest/PublicPortalContent',
  component: PublicPortalContent,
  args: baseArgs,
}
export default meta

type Story = StoryObj<typeof PublicPortalContent>

export const Empty: Story = {}

// The Dark palette has to actually render dark. All three saved colours reach
// the page, so background, text and accent all change together.
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

// The Brand palette — a third genuinely distinct accent, not a copy of Light.
export const BrandPalette: Story = {
  args: {
    portal: {
      ...portal,
      theme: {
        primaryColor: '#b45309',
        backgroundColor: '#fffbeb',
        textColor: '#1c1917',
      },
    },
  },
}

// --portal-primary used to be assigned and never read, so a manager's accent
// was invisible. Category headings and destination rules consume it now.
export const AccentIsConsumed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Share your experience' }),
    ).toHaveAttribute('style', expect.stringContaining('--portal-primary'))
    await expect(canvas.getByRole('link', { name: 'Google' })).toHaveAttribute(
      'style',
      expect.stringContaining('--portal-primary'),
    )
  },
}

// Every category used to render null when it had no links, leaving a published
// portal with removed destinations as a bare title and nothing else.
export const NoDestinations: Story = {
  args: { categories: [], links: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no review destinations yet/i)).toBeVisible()
    await expect(
      canvas.queryByRole('navigation', { name: 'Review destinations' }),
    ).toBeNull()
  },
}

export const CorrectionAvailable: Story = {
  args: {
    responseForm: { ...responseForm, initialResponse: submitted },
  },
}

export const Withdrawn: Story = {
  args: {
    responseForm: { ...responseForm, initialResponse: deleted },
  },
}

export const DestinationsRemainInvariant: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const before = canvas.getAllByRole('link').map((link) => link.textContent)
    await userEvent.click(canvas.getByRole('radio', { name: '5 stars' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /share this rating/i }))
    const after = canvas.getAllByRole('link').map((link) => link.textContent)
    await expect(after).toEqual(before)
    await expect(canvas.getByRole('link', { name: 'Google' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Tripadvisor' })).toBeVisible()
  },
}
