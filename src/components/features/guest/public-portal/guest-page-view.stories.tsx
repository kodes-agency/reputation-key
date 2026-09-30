import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { GuestPagePreviewState } from './guest-page-preview-state'
import { GuestPageView, type GuestPageViewProps } from './guest-page-view'
import { PortalSecondaryLinks } from './portal-secondary-links'

const portal = {
  name: 'The Harbor Hotel',
  description: 'Thank you for visiting.',
  organizationName: 'Harbor Hospitality',
  heroImageUrl: null,
  theme: { primaryColor: '#4f46e5', backgroundColor: '#ffffff', textColor: '#111827' },
}

const secondaryLinks = (
  <PortalSecondaryLinks
    organizationName={portal.organizationName}
    categories={[{ id: 'useful', title: 'Useful links' }]}
    links={[
      {
        id: 'website',
        label: 'Hotel website',
        url: 'https://example.com/',
        categoryId: 'useful',
      },
    ]}
  />
)

/** A phone frame with a fixed height: the view must fill it, not the viewport. */
const PhoneFrame: Decorator = (Story) => (
  <div
    data-testid="phone-frame"
    className="mx-auto h-[720px] w-[390px] overflow-y-auto rounded-3xl border"
  >
    <Story />
  </div>
)

const meta: Meta<typeof GuestPageView> = {
  title: 'Features/Guest/GuestPageView',
  component: GuestPageView,
  decorators: [PhoneFrame],
  args: {
    portal,
    height: 'container',
    body: { kind: 'preview', previewState: { kind: 'arrival' }, secondaryLinks },
  } satisfies GuestPageViewProps,
}
export default meta

type Story = StoryObj<typeof GuestPageView>

const previewBody = (previewState: GuestPagePreviewState) =>
  ({ kind: 'preview', previewState, secondaryLinks }) as const

export const Arrival: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Submit private rating' }),
    ).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Continue to Google' })).toBeNull()
  },
}

export const RatedFive: Story = {
  args: { body: previewBody({ kind: 'rated', rating: 5 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Continue to Google' })).toBeVisible()
    expect(canvas.queryByLabelText('Private feedback')).toBeNull()
  },
}

export const RatedTwoWithNote: Story = {
  args: { body: previewBody({ kind: 'rated', rating: 2 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const google = canvas.getByRole('button', { name: 'Continue to Google' })
    const note = canvas.getByLabelText('Private feedback')
    await expect(google).toBeVisible()
    expect(
      google.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

export const NoteWriting: Story = {
  args: { body: previewBody({ kind: 'note-writing' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Private feedback')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue to Google' })).toBeVisible()
  },
}

export const Done: Story = {
  args: { body: previewBody({ kind: 'done' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Your private feedback was sent to the property team.', {
        selector: 'p[aria-live]',
      }),
    ).toBeVisible()
    expect(canvas.queryByLabelText('Private feedback')).toBeNull()
  },
}

export const GoogleUnavailable: Story = {
  args: { body: previewBody({ kind: 'googleUnavailable' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google review link unavailable')).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Continue to Google' })).toBeNull()
  },
}

export const ManagerSketch: Story = {
  args: { body: { kind: 'manager', secondaryLinks } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('navigation', { name: 'More links' })).toBeVisible()
  },
}

export const FillsItsFrame: Story = {
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByTestId('phone-frame')
    const page = frame.firstElementChild as HTMLElement
    expect(page.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      frame.getBoundingClientRect().height - 2,
    )
  },
}
