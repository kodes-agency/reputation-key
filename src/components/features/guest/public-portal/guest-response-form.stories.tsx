import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GuestResponseForm } from './guest-response-form'
import type { GuestResponseFormProps } from './guest-response-form'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

const submitted: GuestResponseView = {
  id: '00000000-0000-4000-8000-000000000001',
  responseConsent: true,
  textConsent: true,
  status: 'submitted',
  rating: 5,
  category: null,
  text: 'A thoughtful response.',
  mediaConsent: false,
  submittedAt: '2026-08-09T12:00:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-08-09T13:00:00.000Z',
  deletedAt: null,
}
const corrected: GuestResponseView = {
  ...submitted,
  status: 'corrected',
  rating: 4,
  correctedAt: '2026-08-09T12:20:00.000Z',
}
const withdrawn: GuestResponseView = {
  ...corrected,
  status: 'deleted',
  rating: null,
  text: null,
  deletedAt: '2026-08-09T12:30:00.000Z',
}

const actions: Pick<
  GuestResponseFormProps,
  | 'submitResponse'
  | 'correctResponse'
  | 'withdrawResponse'
  | 'issueMedia'
  | 'confirmMedia'
> = {
  submitResponse: async ({ data }) => ({
    ...submitted,
    rating: data.rating,
    text: data.text,
    mediaConsent: data.mediaConsent,
  }),
  correctResponse: async ({ data }) => ({
    ...corrected,
    rating: data.rating,
    text: data.text,
    mediaConsent: data.mediaConsent,
  }),
  withdrawResponse: async () => withdrawn,
  issueMedia: async ({ data }) => ({
    mediaId: '00000000-0000-4000-8000-000000000002',
    objectKey: 'guest/example.webp',
    uploadUrl: 'https://uploads.invalid/example',
    contentType: data.contentType,
  }),
  confirmMedia: async ({ data }) => ({ mediaId: data.mediaId, status: 'ready' }),
}

const baseArgs: GuestResponseFormProps = {
  token: 'portal-public-token',
  csrfNonce: '00000000-0000-4000-8000-000000000003',
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

export const Loading: Story = { args: { availability: 'loading' } }
export const Available: Story = {}
export const Submitted: Story = { args: { initialResponse: submitted } }
export const Corrected: Story = { args: { initialResponse: corrected } }
export const Withdrawn: Story = { args: { initialResponse: withdrawn } }
export const Error: Story = {
  args: {
    availability: 'error',
    initialMessage: 'Optional feedback could not be loaded.',
  },
}
export const PermissionDenied: Story = {
  args: { availability: 'permission_denied' },
}
export const MediaUnavailable: Story = { args: { mediaEnabled: false } }

// An image the guest's device cannot legally upload is rejected at selection,
// before any network call — the old post-submit check persisted the response first,
// which flipped the form into correcting mode and burned the guest's single
// one-hour correction. The file is an over-limit JPEG rather than a wrong type
// because `userEvent.upload` honours the input's `accept` filter, so a rejected
// MIME type never reaches the change handler in the first place.
export const RejectsOversizeMediaBeforeSubmit: Story = {
  args: { submitResponse: fn(actions.submitResponse) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const oversize = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'holiday.jpg', {
      type: 'image/jpeg',
    })
    await userEvent.upload(canvas.getByLabelText(/choose an optional image/i), oversize)

    await waitFor(() => {
      expect(
        canvas.getByText('Choose a JPEG, PNG, or WebP image up to 10 MiB.'),
      ).toBeInTheDocument()
    })
    expect(args.submitResponse).not.toHaveBeenCalled()
  },
}
