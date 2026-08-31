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
    window.history.replaceState({}, '', '/home')
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')

    expect(
      within(dialog).getByText(/suggestions are always text-only/i),
    ).toBeInTheDocument()
    const createPreview = within(dialog).getByRole('button', {
      name: /create preview/i,
    })
    expect(createPreview).toBeDisabled()
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /include a masked layout preview/i }),
    )
    await userEvent.click(createPreview)
    expect(
      within(dialog).getByRole('img', { name: /masked layout preview/i }),
    ).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: /remove preview/i }))
    expect(
      within(dialog).queryByRole('img', { name: /masked layout preview/i }),
    ).toBeNull()

    await userEvent.click(
      within(dialog).getByRole('button', { name: /send bug report/i }),
    )
    expect(
      await within(dialog).findAllByText(/please add at least 3 characters/i),
    ).toHaveLength(2)
  },
}

const bugSpy = fn()
const submitBug: SubmitBetaFeedback = async (input) => {
  bugSpy(input)
  return { reference: '00000000-0000-4000-8000-0000000000f1' }
}

export const ConsentedBugPreview: Story = {
  args: { submitFeedback: submitBug },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/home')
    bugSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    let dialog = within(document.body).getByRole('dialog')
    let view = within(dialog)

    await userEvent.click(
      view.getByRole('checkbox', { name: /include a masked layout preview/i }),
    )
    await userEvent.click(view.getByRole('button', { name: /create preview/i }))
    expect(view.getByRole('img', { name: /masked layout preview/i })).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'Cancel' }))

    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    dialog = within(document.body).getByRole('dialog')
    view = within(dialog)
    expect(view.queryByRole('img', { name: /masked layout preview/i })).toBeNull()
    expect(
      view.getByRole('checkbox', { name: /include a masked layout preview/i }),
    ).not.toBeChecked()

    await userEvent.type(view.getByLabelText(/short title/i), 'Layout shifted')
    await userEvent.type(
      view.getByLabelText(/what did you expect/i),
      'The controls should stay aligned.',
    )
    await userEvent.type(
      view.getByLabelText(/what happened instead/i),
      'The controls moved below the summary.',
    )
    await userEvent.click(
      view.getByRole('checkbox', { name: /include a masked layout preview/i }),
    )
    await userEvent.click(view.getByRole('button', { name: /create preview/i }))
    await userEvent.click(view.getByRole('button', { name: /send bug report/i }))

    await waitFor(() => expect(bugSpy).toHaveBeenCalledTimes(1))
    expect(bugSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'bug',
        title: 'Layout shifted',
        attachment: expect.objectContaining({
          profile: 'masked-layout-v1',
          consented: true,
        }),
      }),
    })
  },
}

export const SwitchingFeedbackTypeDiscardsPreview: Story = {
  args: { submitFeedback: successfulSubmission },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/home')
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')
    const view = within(dialog)

    await userEvent.click(
      view.getByRole('checkbox', { name: /include a masked layout preview/i }),
    )
    await userEvent.click(view.getByRole('button', { name: /create preview/i }))
    expect(view.getByRole('img', { name: /masked layout preview/i })).toBeVisible()

    await userEvent.click(view.getByRole('tab', { name: /make a suggestion/i }))
    await userEvent.click(view.getByRole('tab', { name: /report a bug/i }))
    expect(view.queryByRole('img', { name: /masked layout preview/i })).toBeNull()
    expect(
      view.getByRole('checkbox', { name: /include a masked layout preview/i }),
    ).not.toBeChecked()
  },
}

const sensitiveRouteBugSpy = fn()
const submitSensitiveRouteBug: SubmitBetaFeedback = async (input) => {
  sensitiveRouteBugSpy(input)
  return { reference: '00000000-0000-4000-8000-0000000000f2' }
}

export const SensitiveRouteRemainsTextOnly: Story = {
  args: { submitFeedback: submitSensitiveRouteBug },
  play: async ({ canvasElement }) => {
    window.history.replaceState({}, '', '/inbox')
    sensitiveRouteBugSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = await within(document.body).findByRole('dialog')
    const view = within(dialog)

    expect(view.queryByRole('checkbox', { name: /masked layout preview/i })).toBeNull()
    // The dialog mounts through Radix's entry animation, which starts at
    // opacity 0 — sampling the first frame reads as "not visible".
    await waitFor(() =>
      expect(view.getByText(/visual preview is unavailable on this page/i)).toBeVisible(),
    )
    await userEvent.type(view.getByLabelText(/short title/i), 'Inbox controls shifted')
    await userEvent.type(
      view.getByLabelText(/what did you expect/i),
      'The controls should remain aligned.',
    )
    await userEvent.type(
      view.getByLabelText(/what happened instead/i),
      'The controls moved below the list.',
    )
    await userEvent.click(view.getByRole('button', { name: /send bug report/i }))

    await waitFor(() => expect(sensitiveRouteBugSpy).toHaveBeenCalledTimes(1))
    expect(sensitiveRouteBugSpy.mock.calls[0]?.[0]).not.toHaveProperty('data.attachment')
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
    window.history.replaceState({}, '', '/home')
    suggestionSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send beta feedback/i }))
    const dialog = within(document.body).getByRole('dialog')
    const view = within(dialog)

    await userEvent.click(view.getByRole('tab', { name: /make a suggestion/i }))
    expect(view.queryByRole('checkbox', { name: /masked layout preview/i })).toBeNull()
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
