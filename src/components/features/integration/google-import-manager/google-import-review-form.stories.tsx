import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { GoogleImportReviewForm } from './google-import-review-form'
import { createImportReviewDraft } from './google-import-review-model'

const candidates: readonly ImportCandidateDto[] = [
  {
    candidateId: 'candidate-meridian',
    candidateRef: 'candidate.meridian',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'The Meridian Grand Resort',
    address: '100 Harbor Boulevard, San Francisco, CA',
    primaryCategory: 'Hotel',
    countryCode: 'US',
    eligibility: { kind: 'create' },
  },
  {
    candidateId: 'candidate-relink',
    candidateRef: 'candidate.relink',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'Provider-side name',
    address: 'Unconfirmed provider address',
    primaryCategory: 'Hotel',
    countryCode: 'GB',
    eligibility: {
      kind: 'relink',
      propertyId: '10000000-0000-4000-8000-000000000002' as never,
      profile: {
        name: 'Cedar House London',
        address: '2 High Street, London',
        countryCode: 'GB',
        timezone: 'Europe/London',
        profileVersion: 3,
      },
    },
  },
]

function ReviewHarness({
  pending = false,
  submitError = null,
}: {
  pending?: boolean
  submitError?: string | null
}) {
  const [draft, setDraft] = useState(() =>
    createImportReviewDraft(candidates, 'America/Los_Angeles'),
  )
  const [submitted, setSubmitted] = useState(false)
  return (
    <>
      <GoogleImportReviewForm
        draft={draft}
        onChange={setDraft}
        onBack={() => {}}
        onSubmit={() => setSubmitted(true)}
        isSubmitting={pending}
        submitError={submitError}
      />
      {submitted ? <p role="status">Import submitted</p> : null}
    </>
  )
}

const meta: Meta<typeof GoogleImportReviewForm> = {
  title: 'Integration/GoogleImport/ReviewForm',
  component: GoogleImportReviewForm,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof GoogleImportReviewForm>

export const ConfirmationRequired: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /start import/i }))
    await expect(
      canvas.getByText(/confirm every suggested country and timezone/i),
    ).toBeVisible()
    await expect(canvas.getByText(/confirm us/i)).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const Starting: Story = {
  render: () => <ReviewHarness pending />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /starting import/i })).toBeDisabled()
  },
}

export const StartFailure: Story = {
  render: () => (
    <ReviewHarness submitError="The import request could not be confirmed. Recover it before trying again." />
  ),
}
