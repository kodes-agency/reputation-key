import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { BetaFeedbackLauncher } from './beta-feedback-launcher'
import type { SubmitBetaFeedback } from './beta-feedback-form-context'

const successfulSubmission: SubmitBetaFeedback = async () => ({
  reference: '0123456789abcdef0123456789abcdef',
})

const meta: Meta<typeof BetaFeedbackLauncher> = {
  title: 'Beta Feedback/Launcher',
  component: BetaFeedbackLauncher,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof BetaFeedbackLauncher>

export const Default: Story = {
  args: { submitFeedback: successfulSubmission },
}

export const PrivacyAndValidation: Story = {
  args: { submitFeedback: successfulSubmission },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/dashboard')
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')
    const view = within(dialog)

    expect(view.getByText(/only the text you enter/i)).toBeInTheDocument()
    expect(view.queryByRole('tab')).toBeNull()
    expect(view.queryByRole('checkbox')).toBeNull()
    await userEvent.click(view.getByRole('button', { name: /send feedback/i }))
    expect(
      await view.findByText(/please add at least 3 characters/i),
    ).toBeInTheDocument()
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
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')
    const view = within(dialog)

    await userEvent.click(view.getByRole('combobox', { name: /feedback type/i }))
    await userEvent.click(within(document.body).getByRole('option', { name: /suggestion/i }))
    await userEvent.type(
      view.getByLabelText(/your feedback/i),
      'Keep the inbox filter when I return from a review.',
    )
    await userEvent.click(view.getByRole('button', { name: /send feedback/i }))

    await waitFor(() => expect(feedbackSpy).toHaveBeenCalledTimes(1))
    expect(feedbackSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'suggestion',
        message: 'Keep the inbox filter when I return from a review.',
      }),
    })
    expect(await view.findByText(/thanks — we received it/i)).toBeInTheDocument()
    expect(view.getByText('fedcba9876543210fedcba9876543210')).toBeInTheDocument()
  },
}
