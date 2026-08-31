import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { Button } from '#/components/ui/button'
import { GoogleImportReviewForm } from './google-import-review-form'
import { createImportReviewDraft } from './google-import-review-model'
import { useGoogleImportReviewForm } from './use-google-import-review-form'

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
  const [draft] = useState(() =>
    createImportReviewDraft(candidates, 'America/Los_Angeles'),
  )
  const [submitted, setSubmitted] = useState(false)
  const [reviewing, setReviewing] = useState(true)
  const form = useGoogleImportReviewForm({
    initialDraft: draft,
    onSubmit: () => setSubmitted(true),
  })
  return (
    <>
      {reviewing ? (
        <GoogleImportReviewForm
          form={form}
          onBack={() => setReviewing(false)}
          isSubmitting={pending}
          submitError={submitError}
        />
      ) : (
        <Button type="button" onClick={() => setReviewing(true)}>
          Return to current review
        </Button>
      )}
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

export const ConfirmedSubmissionUsesFormValues: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: /confirm us/i }))
    await userEvent.click(
      canvas.getByRole('checkbox', { name: /confirm america\/los_angeles/i }),
    )
    await userEvent.click(
      canvas.getByRole('checkbox', { name: /confirm europe\/london/i }),
    )
    await userEvent.click(canvas.getByRole('button', { name: /start import/i }))
    await expect(canvas.getByRole('status')).toHaveTextContent(/import submitted/i)
  },
}

export const DraftSurvivesBackNavigation: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getAllByRole('textbox', { name: /property name/i })[0]!
    await userEvent.clear(name)
    // `delay: null` types synchronously. The default awaits a macrotask between
    // keystrokes, and this field is controlled — 22 characters means 22 awaited
    // re-renders of the whole review form. Under CI load that is what pushed
    // this story past the 15s budget while the assertion below never changed.
    // Every keystroke event is still dispatched, which is the part the draft
    // retention under test actually depends on.
    await userEvent.type(name, 'Meridian Airport Hotel', { delay: null })
    await userEvent.click(canvas.getByRole('button', { name: /back to locations/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: /return to current review/i }),
    )
    await expect(
      canvas.getAllByRole('textbox', { name: /property name/i })[0],
    ).toHaveValue('Meridian Airport Hotel')
  },
}

export const StartFailure: Story = {
  render: () => (
    <ReviewHarness submitError="The import request could not be confirmed. Recover it before trying again." />
  ),
}
