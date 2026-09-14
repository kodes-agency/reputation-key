import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { Button } from '#/components/ui/button'
import { GoogleImportReviewForm } from './google-import-review-form'
import {
  createImportReviewDraft,
  type ImportReviewDraft,
} from './google-import-review-model'
import { useGoogleImportReviewForm } from './use-google-import'

const candidates: readonly ImportCandidateDto[] = [
  {
    candidateId: 'candidate-meridian',
    candidateRef: 'candidate.meridian',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'The Meridian Grand Resort',
    address: '100 Harbor Boulevard, San Francisco, CA',
    primaryCategory: 'Hotel',
    // The United States spans several zones, so this row starts flagged.
    countryCode: 'US',
    eligibility: { kind: 'create' },
  },
  {
    candidateId: 'candidate-juniper',
    candidateRef: 'candidate.juniper',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'Juniper Street Café',
    address: '14 Rue de Rivoli, Paris',
    primaryCategory: 'Cafe',
    countryCode: 'FR',
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

const flaggedDraft = (): ImportReviewDraft => createImportReviewDraft(candidates)

const completeDraft = (): ImportReviewDraft => {
  const draft = flaggedDraft()
  return {
    ...draft,
    items: draft.items.map((item, index) =>
      index === 0 ? { ...item, timezone: 'America/Los_Angeles' } : item,
    ),
  }
}

function ReviewHarness({
  initialDraft = flaggedDraft,
  pending = false,
  submitError = null,
}: {
  initialDraft?: () => ImportReviewDraft
  pending?: boolean
  submitError?: string | null
}) {
  const [draft] = useState(initialDraft)
  const [submitted, setSubmitted] = useState<ImportReviewDraft | null>(null)
  const [reviewing, setReviewing] = useState(true)
  const form = useGoogleImportReviewForm({
    initialDraft: draft,
    onSubmit: (value) => setSubmitted(value),
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
      {submitted ? (
        <p role="status" aria-label="Submission">
          Import submitted with {submitted.items.map((item) => item.timezone).join(', ')}
        </p>
      ) : null}
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

/** A multi-zone country leaves its row empty and flagged; nothing can start. */
export const NeedsTimezone: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 of 3 properties needs attention')).toBeVisible()
    await expect(canvas.getByText('Choose a timezone.')).toBeVisible()
    await expect(
      canvas.getByRole('combobox', { name: /timezone, row 1/i }),
    ).toHaveAttribute('aria-invalid', 'true')
    // France has one zone: derived, not guessed from the browser.
    await expect(
      canvas.getByRole('combobox', { name: /timezone, row 2/i }),
    ).toHaveTextContent('Europe/Paris')
    await expect(canvas.getByRole('button', { name: /start import/i })).toBeDisabled()
    await expect(
      canvas.getByText(/fix the flagged row to start the import/i),
    ).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

/** Picking the zone clears the flag, in the row and in the summary. */
export const PickingTheTimezoneClearsTheFlag: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('combobox', { name: /timezone, row 1/i }))
    await userEvent.click(body.getByRole('option', { name: 'America/Los_Angeles' }))
    await expect(canvas.getByText('3 properties ready to import')).toBeVisible()
    await expect(canvas.queryByText('Choose a timezone.')).toBeNull()
    await expect(canvas.getByRole('button', { name: /start import/i })).toBeEnabled()
  },
}

export const AcknowledgementRequired: Story = {
  render: () => <ReviewHarness initialDraft={completeDraft} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /start import/i }))
    await expect(
      canvas.getByText('Confirm that you have checked these details.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('status', { name: 'Submission' })).toBeNull()
  },
}

export const AcknowledgedSubmissionUsesFormValues: Story = {
  render: () => <ReviewHarness initialDraft={completeDraft} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('checkbox', { name: /i have checked these details/i }),
    )
    await userEvent.click(canvas.getByRole('button', { name: /start import/i }))
    await expect(canvas.getByRole('status', { name: 'Submission' })).toHaveTextContent(
      'America/Los_Angeles, Europe/Paris, Europe/London',
    )
  },
}

export const DraftSurvivesBackNavigation: Story = {
  render: () => <ReviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getAllByRole('textbox', { name: /property name/i })[0]!
    await userEvent.clear(name)
    // Paste is a real full-field edit but dispatches one input event; typing
    // every keystroke re-renders the controlled table and can exhaust the story
    // budget under suite load. Draft retention depends on the value only.
    await userEvent.paste('Meridian Airport Hotel')
    await userEvent.click(canvas.getByRole('button', { name: /back to locations/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: /return to current review/i }),
    )
    await expect(
      canvas.getAllByRole('textbox', { name: /property name/i })[0],
    ).toHaveValue('Meridian Airport Hotel')
  },
}

export const Starting: Story = {
  render: () => <ReviewHarness initialDraft={completeDraft} pending />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /starting import/i })).toBeDisabled()
  },
}

export const StartFailure: Story = {
  render: () => (
    <ReviewHarness
      initialDraft={completeDraft}
      submitError="The import request could not be confirmed. Recover it before trying again."
    />
  ),
}

/**
 * At phone width the table reflows into one block per property, so every control
 * must name its own column and row. This runner compiles no Tailwind, so the
 * reflow itself is verified in a real browser; here the labels are the gate.
 */
export const PhoneWidth: Story = {
  render: () => <ReviewHarness />,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const row of [1, 2, 3]) {
      await expect(
        canvas.getByRole('textbox', { name: `Property name, row ${row}` }),
      ).toBeInTheDocument()
      await expect(
        canvas.getByRole('textbox', { name: `Address, row ${row}` }),
      ).toBeInTheDocument()
      await expect(
        canvas.getByRole('combobox', { name: `Timezone, row ${row}` }),
      ).toBeInTheDocument()
    }
    await expect(
      canvas.getByRole('combobox', { name: 'Country, row 1' }),
    ).toHaveTextContent('United States (US)')
    // A linked property keeps its country; there is nothing to choose.
    await expect(canvas.queryByRole('combobox', { name: 'Country, row 3' })).toBeNull()
    await expect(canvas.getByRole('button', { name: /start import/i })).toBeDisabled()
  },
}
