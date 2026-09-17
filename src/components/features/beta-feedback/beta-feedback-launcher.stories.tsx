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

const meta: Meta<typeof BetaFeedbackLauncher> = {
  title: 'Beta Feedback/Launcher',
  component: BetaFeedbackLauncher,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof BetaFeedbackLauncher>

async function openFeedbackDialog(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /report a problem/i }))
  return within(within(document.body).getByRole('dialog'))
}

export const Default: Story = {
  args: { submitFeedback: successfulSubmission, listFeedback },
}

export const PrivacyAndValidation: Story = {
  args: { submitFeedback: successfulSubmission },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/dashboard')
    clearRecordedErrors()
    const view = await openFeedbackDialog(canvasElement)

    expect(view.getByText(/only the text you enter/i)).toBeInTheDocument()
    // Without a list seam there is no second panel to switch to.
    expect(view.queryByRole('tab')).toBeNull()
    // No error was recorded, so nothing is offered to attach.
    expect(view.queryByRole('checkbox')).toBeNull()

    await userEvent.click(view.getByRole('button', { name: /send report/i }))
    expect(await view.findByText(/please describe what happened/i)).toBeInTheDocument()
  },
}

const feedbackSpy = fn()
const submitFeedback: SubmitBetaFeedback = async (input) => {
  feedbackSpy(input)
  return { reference: 'fedcba9876543210fedcba9876543210' }
}

export const SuggestionReceipt: Story = {
  args: { submitFeedback },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/dashboard')
    feedbackSpy.mockClear()
    clearRecordedErrors()
    const view = await openFeedbackDialog(canvasElement)

    await userEvent.click(view.getByRole('radio', { name: /i have an idea/i }))
    await userEvent.type(
      view.getByLabelText(/what would make your work easier/i),
      'Keep the inbox filter when I return from a review.',
    )
    // Impact swaps to the suggestion scale with the type.
    await userEvent.click(view.getByRole('radio', { name: /would save me time/i }))
    await userEvent.click(view.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(feedbackSpy).toHaveBeenCalledTimes(1))
    expect(feedbackSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'suggestion',
        impact: 'helpful',
        message: 'Keep the inbox filter when I return from a review.',
        clientErrorEventId: null,
      }),
    })
    expect(await view.findByText(/thanks — we received it/i)).toBeInTheDocument()
    expect(view.getByText('fedcba9876543210fedcba9876543210')).toBeInTheDocument()
  },
}

export const GuidedBugWithRecordedError: Story = {
  args: { submitFeedback },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/properties/private-property-id/reviews')
    feedbackSpy.mockClear()
    clearRecordedErrors()
    rememberRecordedError(RECORDED_ERROR)
    const view = await openFeedbackDialog(canvasElement)

    expect(view.getByText(/recorded an error while you were here/i)).toBeInTheDocument()
    await userEvent.click(view.getByRole('checkbox'))

    await userEvent.type(view.getByLabelText(/what were you doing/i), 'Opening Reviews')
    await userEvent.type(view.getByLabelText(/what happened/i), 'The page stayed empty')
    await userEvent.type(
      view.getByLabelText(/what did you expect/i),
      'The reviews should have appeared',
    )
    await userEvent.click(view.getByRole('radio', { name: /could not finish/i }))
    await userEvent.click(view.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(feedbackSpy).toHaveBeenCalledTimes(1))
    const sent = feedbackSpy.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(sent.data.kind).toBe('bug')
    expect(sent.data.impact).toBe('cannot_complete')
    expect(sent.data.clientErrorEventId).toBe(RECORDED_ERROR)
    // The guided answers arrive as one labelled body, not three fields.
    expect(sent.data.message).toBe(
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
    window.history.replaceState({}, '', '/inbox')
    clearRecordedErrors()
    const view = await openFeedbackDialog(canvasElement)

    await userEvent.click(view.getByRole('tab', { name: /your reports/i }))

    expect(await view.findByText(/accepted/i)).toBeInTheDocument()
    expect(view.getByText(/tracked as #472/i)).toBeInTheDocument()
    expect(view.getByText(/not sent/i)).toBeInTheDocument()
    expect(view.getByText('Properties · Property · Reviews')).toBeInTheDocument()
    // Internal triage vocabulary must never reach the reporter.
    expect(view.queryByText(/severity/i)).toBeNull()
    expect(view.queryByText(/security/i)).toBeNull()
  },
}
