import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  clearRecordedErrors,
  rememberRecordedError,
} from '#/shared/observability/recorded-browser-errors'
import { BetaFeedbackLauncher } from './beta-feedback-launcher'
import type {
  ListMyBetaFeedback,
  MyBetaFeedbackItem,
  SubmitBetaFeedback,
} from './beta-feedback-form-context'

const RECORDED_ERROR = 'abcdef0123456789abcdef0123456789'

const successfulSubmission: SubmitBetaFeedback = async () => ({
  reference: '0123456789abcdef0123456789abcdef',
})

const reports: ReadonlyArray<MyBetaFeedbackItem> = [
  {
    reference: '00000000-0000-4000-8000-000000000001',
    feedbackType: 'bug',
    impactCode: 'cannot_complete',
    routeKey: 'properties.property.reviews',
    deliveryState: 'delivered',
    triageState: 'accepted',
    engineeringIssueRef: '472',
    createdAt: new Date('2026-09-15T09:30:00.000Z'),
    updatedAt: new Date('2026-09-16T11:00:00.000Z'),
  },
  {
    reference: '00000000-0000-4000-8000-000000000002',
    feedbackType: 'suggestion',
    impactCode: 'helpful',
    routeKey: 'inbox',
    deliveryState: 'delivered',
    triageState: 'new',
    engineeringIssueRef: null,
    createdAt: new Date('2026-09-17T14:05:00.000Z'),
    updatedAt: new Date('2026-09-17T14:05:00.000Z'),
  },
  {
    reference: '00000000-0000-4000-8000-000000000003',
    feedbackType: 'bug',
    impactCode: 'small_issue',
    routeKey: 'settings.ai',
    deliveryState: 'failed',
    triageState: 'new',
    engineeringIssueRef: null,
    createdAt: new Date('2026-09-12T08:00:00.000Z'),
    updatedAt: new Date('2026-09-12T08:00:00.000Z'),
  },
]

const listFeedback: ListMyBetaFeedback = async () => reports

const feedbackSpy = fn()
const submitFeedback: SubmitBetaFeedback = async (input) => {
  feedbackSpy(input)
  return { reference: 'fedcba9876543210fedcba9876543210' }
}

const meta: Meta<typeof BetaFeedbackLauncher> = {
  title: 'Beta Feedback/Launcher',
  component: BetaFeedbackLauncher,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof BetaFeedbackLauncher>

async function openFeedbackDialog(
  canvasElement: HTMLElement,
  routePath: string,
  recordedError?: string,
) {
  window.history.replaceState({}, '', routePath)
  feedbackSpy.mockClear()
  clearRecordedErrors()
  if (recordedError) rememberRecordedError(recordedError)

  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /report a problem/i }))
  const view = within(within(document.body).getByRole('dialog'))
  // The body is code-split, so it arrives after the dialog frame does.
  await view.findByRole('radiogroup', { name: /what would you like to tell us/i })
  return view
}

/** Open the reports panel; every reports story starts the same way. */
async function openReportsPanel(canvasElement: HTMLElement) {
  const view = await openFeedbackDialog(canvasElement, '/inbox')
  await userEvent.click(view.getByRole('tab', { name: /your reports/i }))
  return view
}

/** The single argument every submitting story asserts on. */
function submittedData(): Record<string, unknown> {
  const call = feedbackSpy.mock.calls[0]?.[0] as { data: Record<string, unknown> }
  return call.data
}

export const Default: Story = {
  args: { submitFeedback: successfulSubmission, listFeedback },
}

export const PrivacyAndValidation: Story = {
  args: { submitFeedback: successfulSubmission },
  play: async ({ canvasElement }) => {
    const view = await openFeedbackDialog(canvasElement, '/dashboard')

    expect(view.getByText(/only the text you enter/i)).toBeInTheDocument()
    // Without a list seam there is no second panel to switch to.
    expect(view.queryByRole('tab')).toBeNull()
    // No error was recorded, so there is none to offer to attach.
    expect(view.queryByRole('checkbox', { name: /attach it to this report/i })).toBeNull()

    await userEvent.click(view.getByRole('button', { name: /send report/i }))
    expect(await view.findByText(/please describe what happened/i)).toBeInTheDocument()
  },
}

export const SuggestionReceipt: Story = {
  args: { submitFeedback },
  play: async ({ canvasElement }) => {
    const view = await openFeedbackDialog(canvasElement, '/dashboard')

    await userEvent.click(view.getByRole('radio', { name: /i have an idea/i }))
    await userEvent.type(
      view.getByLabelText(/what would make your work easier/i),
      'Keep the inbox filter when I return from a review.',
    )
    // Impact swaps to the suggestion scale with the type.
    await userEvent.click(view.getByRole('radio', { name: /would save me time/i }))
    await userEvent.click(view.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(feedbackSpy).toHaveBeenCalledTimes(1))
    expect(submittedData()).toMatchObject({
      kind: 'suggestion',
      impact: 'helpful',
      message: 'Keep the inbox filter when I return from a review.',
      clientErrorEventId: null,
    })
    expect(await view.findByText(/thanks — we received it/i)).toBeInTheDocument()
    expect(view.getByText('fedcba9876543210fedcba9876543210')).toBeInTheDocument()
  },
}

export const GuidedBugWithRecordedError: Story = {
  args: { submitFeedback },
  play: async ({ canvasElement }) => {
    const view = await openFeedbackDialog(
      canvasElement,
      '/properties/private-property-id/reviews',
      RECORDED_ERROR,
    )

    expect(view.getByText(/recorded an error while you were here/i)).toBeInTheDocument()
    await userEvent.click(
      view.getByRole('checkbox', { name: /attach it to this report/i }),
    )

    await userEvent.type(view.getByLabelText(/what were you doing/i), 'Opening Reviews')
    await userEvent.type(view.getByLabelText(/what happened/i), 'The page stayed empty')
    await userEvent.type(
      view.getByLabelText(/what did you expect/i),
      'The reviews should have appeared',
    )
    await userEvent.click(view.getByRole('radio', { name: /could not finish/i }))
    await userEvent.click(view.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(feedbackSpy).toHaveBeenCalledTimes(1))
    expect(submittedData()).toMatchObject({
      kind: 'bug',
      impact: 'cannot_complete',
      clientErrorEventId: RECORDED_ERROR,
    })
    // The guided answers arrive as one labelled body, not three fields.
    expect(submittedData().message).toBe(
      [
        'What I was doing:\nOpening Reviews',
        'What happened:\nThe page stayed empty',
        'What I expected:\nThe reviews should have appeared',
      ].join('\n\n'),
    )
  },
}

export const YourReports: Story = {
  args: { submitFeedback: successfulSubmission, listFeedback },
  play: async ({ canvasElement }) => {
    const view = await openReportsPanel(canvasElement)

    expect(await view.findByText(/accepted/i)).toBeInTheDocument()
    // A plain issue number opens the public tracker in a new tab.
    const issue = view.getByRole('link', { name: /#472/i })
    expect(issue).toHaveAttribute(
      'href',
      'https://github.com/kodes-agency/reputation-key/issues/472',
    )
    expect(issue).toHaveAttribute('target', '_blank')
    expect(issue).toHaveAttribute('rel', 'noopener noreferrer')
    expect(view.getByText(/not sent/i)).toBeInTheDocument()
    expect(view.getByText('Properties · Property · Reviews')).toBeInTheDocument()
    // Internal triage vocabulary must never reach the reporter.
    expect(view.queryByText(/severity/i)).toBeNull()
    expect(view.queryByText(/security/i)).toBeNull()
  },
}

// The product ships dark-first; the status tones carry their own light values,
// so they need their own contrast proof (see .storybook/preview.tsx).
export const YourReportsLight: Story = {
  args: { submitFeedback: successfulSubmission, listFeedback },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const view = await openReportsPanel(canvasElement)

    expect(await view.findByText(/this is going to be worked on/i)).toBeInTheDocument()
  },
}
