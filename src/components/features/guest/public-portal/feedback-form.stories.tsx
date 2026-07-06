// Guest feedback form stories. `submitFeedback` is an optional plain async fn
// prop (the component wraps it in `useAction` internally), so stories pass a
// mockServerFn-backed callable — the established pattern for fn-as-prop.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import { FeedbackForm } from './feedback-form'

type FeedbackInput = {
  data: {
    portalId: string
    comment: string
    source: ScanSource
    honeypot: string
    submittedAt: number
  }
}

const meta: Meta<typeof FeedbackForm> = {
  title: 'Guest/FeedbackForm',
  component: FeedbackForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FeedbackForm>

const resolving = mockServerFn<FeedbackInput, { ok: true }>(async () => ({ ok: true }))

export const Idle: Story = {
  args: { portalId: 'portal-1', source: 'direct', submitFeedback: resolving },
  // The submit button stays disabled until a non-empty comment is entered —
  // the form's client-side guard against empty submissions.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submit = canvas.getByRole('button', { name: /send feedback/i })
    expect(submit).toBeDisabled()
    await userEvent.type(canvas.getByRole('textbox'), 'Great service!')
    expect(submit).toBeEnabled()
  },
}

// Never-resolving mock → the button stays in its "Sending..." pending state.
export const Submitting: Story = {
  args: {
    portalId: 'portal-1',
    source: 'direct',
    submitFeedback: mockServerFn<FeedbackInput, unknown>(
      () => new Promise<unknown>(() => {}),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'Holding...')
    await userEvent.click(canvas.getByRole('button', { name: /send feedback/i }))
    expect(await canvas.findByRole('button', { name: /sending/i })).toBeInTheDocument()
  },
}

// Server rejects the submission → inline error message surfaces.
export const SubmissionError: Story = {
  args: {
    portalId: 'portal-1',
    source: 'direct',
    submitFeedback: mockServerFn<FeedbackInput, unknown>(async () => {
      throw new Error('Rate limit exceeded. Try again later.')
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'Hello')
    await userEvent.click(canvas.getByRole('button', { name: /send feedback/i }))
    expect(await canvas.findByText(/rate limit exceeded/i)).toBeInTheDocument()
  },
}

export const Success: Story = {
  args: { portalId: 'portal-1', source: 'direct', submitFeedback: resolving },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'Loved the quick responses!')
    await userEvent.click(canvas.getByRole('button', { name: /send feedback/i }))
    expect(await canvas.findByText(/thank you for your feedback/i)).toBeInTheDocument()
  },
}
