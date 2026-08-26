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
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')

    expect(
      within(dialog).getByText(/does not attach a screenshot, replay, page content/i),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /upload|attach/i })).toBeNull()

    await userEvent.click(
      within(dialog).getByRole('button', { name: /send bug report/i }),
    )
    expect(
      await within(dialog).findAllByText(/please add at least 3 characters/i),
    ).toHaveLength(2)
  },
}

const suggestionSpy = fn()
const submitSuggestion: SubmitBetaFeedback = async (input) => {
  suggestionSpy(input)
  return { reference: 'fedcba9876543210fedcba9876543210' }
}

export const SuggestionReceipt: Story = {
  args: { submitFeedback: submitSuggestion },
  play: async ({ canvasElement }) => {
    suggestionSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')
    const view = within(dialog)

    await userEvent.click(view.getByRole('tab', { name: /make a suggestion/i }))
    await userEvent.type(view.getByLabelText(/short title/i), 'Keep my filter')
    await userEvent.type(
      view.getByLabelText(/what would you like to be able to do/i),
      'Keep the inbox filter when I return from a review.',
    )
    await userEvent.click(view.getByRole('button', { name: /send suggestion/i }))

    await waitFor(() => expect(suggestionSpy).toHaveBeenCalledTimes(1))
    expect(suggestionSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'suggestion',
        title: 'Keep my filter',
        desiredOutcome: 'Keep the inbox filter when I return from a review.',
        importance: 'helpful',
      }),
    })
    expect(suggestionSpy.mock.calls[0]?.[0]).not.toHaveProperty('data.screenshot')
    expect(suggestionSpy.mock.calls[0]?.[0]).not.toHaveProperty('data.replayId')
    expect(await view.findByText(/thanks — we received it/i)).toBeInTheDocument()
    expect(view.getByText('fedcba9876543210fedcba9876543210')).toBeInTheDocument()
  },
}
