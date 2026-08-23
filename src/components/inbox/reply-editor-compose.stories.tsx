// Reply composer stories (draft / empty states).
//
// ReplyCompose takes plain callbacks (not Action objects), so stories inject
// fn() spies. isSaving and the over-limit counter are DIRECT props here — these
// are the authoritative coverage for the pending + validation surfaces that
// ReplyEditorInner derives internally.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ReplyCompose, type ReplySuggestionResult } from './reply-editor-compose'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const onSaveDraft = fn(async (_text: string) => undefined)
const onSubmit = fn(async () => undefined)
const onDelete = fn(async () => undefined)
const SUGGESTED_REPLY =
  'Thank you for the thoughtful review. We are glad you enjoyed your visit.'
const readySuggestion = (): Extract<ReplySuggestionResult, { status: 'ready' }> => ({
  status: 'ready',
  replyText: SUGGESTED_REPLY,
  provenanceToken: 'test-provenance-token',
  expiresAtEpochMillis: Date.now() + 60_000,
  baseReplyStateRevision: 0,
  concreteLanguageTag: 'en-Latn',
})
const onGenerateSuggestion = fn(async () => readySuggestion())
const onGenerateUnavailable = fn(async () => ({
  status: 'unavailable' as const,
  code: 'language_not_supported',
  retryAfterEpochMillis: null,
}))
let resolveDelayedSuggestion: ((result: ReplySuggestionResult) => void) | undefined
const onGenerateDelayed = fn(
  () =>
    new Promise<ReplySuggestionResult>((resolve) => {
      resolveDelayedSuggestion = resolve
    }),
)
const resolveDelayed = (result: ReplySuggestionResult): void => {
  if (!resolveDelayedSuggestion)
    throw new Error('Delayed suggestion request was not started')
  resolveDelayedSuggestion(result)
}

const meta: Meta<typeof ReplyCompose> = {
  title: 'Inbox/ReplyCompose',
  component: ReplyCompose,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: {
    initialText: '',
    initialLanguageTag: null,
    propertyDefaultReplyLanguage: 'en-Latn',
    reviewReplyLanguage: 'tr-Latn-TR',
    isSaving: false,
    onSaveDraft,
    onSubmit,
  },
}
export default meta
type Story = StoryObj<typeof ReplyCompose>

// No existing reply → bare composer (no Delete, no "Draft" badge).
export const NewReply: Story = {}

// Editing an existing draft → Delete affordance + "Draft" badge appear.
export const EditingDraft: Story = {
  args: { initialText: 'Thank you for your feedback!', onDelete },
}

// A mutation is in flight → textarea + every action disabled (isSaving surface).
export const Saving: Story = {
  args: { initialText: 'Thanks!', isSaving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox')).toBeDisabled()
    expect(canvas.getByRole('button', { name: /submitting/i })).toBeDisabled()
  },
}

// Over the 4096-char limit → destructive counter + disabled actions (validation).
export const OverLimit: Story = {
  args: { initialText: 'x'.repeat(5000) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/5000\/4096/)).toHaveClass('text-destructive')
    expect(canvas.getByRole('button', { name: /submit for approval/i })).toBeDisabled()
  },
}

// Type a reply and submit → onSubmit receives the composed text.
export const SubmitFlow: Story = {
  args: { initialText: '' },
  play: async ({ canvasElement }) => {
    onSubmit.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText(/write a reply/i), 'Thanks!')
    await userEvent.click(canvas.getByRole('button', { name: /submit for approval/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  },
}

export const LegacyDraftPersistsDefaultLanguageOnSubmit: Story = {
  args: {
    initialText: 'Thank you for your feedback!',
    initialLanguageTag: null,
    propertyDefaultReplyLanguage: 'bg-Cyrl',
  },
  play: async ({ canvasElement }) => {
    onSaveDraft.mockClear()
    onSubmit.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: /submit for approval/i }))

    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(
        'Thank you for your feedback!',
        undefined,
        'bg-Cyrl',
      ),
    )
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSaveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      onSubmit.mock.invocationCallOrder[0] ?? 0,
    )
  },
}

export const AiSuggestionAdoption: Story = {
  args: { onGenerateSuggestion },
  play: async ({ canvas }) => {
    onGenerateSuggestion.mockClear()
    onSaveDraft.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(SUGGESTED_REPLY))
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(
        SUGGESTED_REPLY,
        'test-provenance-token',
        'en-Latn',
      ),
    )
  },
}

export const UnsupportedLanguage: Story = {
  args: { onGenerateSuggestion: onGenerateUnavailable },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await expect(
      canvas.findByText(/unavailable for this review language/i),
    ).resolves.toBeVisible()
  },
}

export const ManualEditWinsOverDelayedSuggestion: Story = {
  args: { onGenerateSuggestion: onGenerateDelayed },
  play: async ({ canvas }) => {
    resolveDelayedSuggestion = undefined
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await userEvent.type(canvas.getByRole('textbox'), 'Manual draft')
    resolveDelayed(readySuggestion())
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue('Manual draft'))
    expect(canvas.queryByText(/ai-generated suggestion/i)).not.toBeInTheDocument()
  },
}
