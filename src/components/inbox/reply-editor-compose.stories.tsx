// Reply composer stories (draft / empty states).
//
// ReplyCompose takes plain callbacks (not Action objects), so stories inject
// fn() spies. isSaving and the over-limit counter are DIRECT props here — these
// are the authoritative coverage for the pending + validation surfaces that
// ReplyEditorInner derives internally.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { ReplyCompose, type ReplySuggestionResult } from './reply-editor-compose'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const onSaveDraft = fn(async (_text: string) => undefined)
const onSubmit = fn(async () => undefined)
const onDelete = fn(async () => undefined)
const SUGGESTED_REPLY =
  'Thank you for the thoughtful review. We are glad you enjoyed your visit.'
const FALLBACK_REPLY =
  'Thank you for sharing your feedback. We appreciate the opportunity to listen.'
const readySuggestion = (): Extract<ReplySuggestionResult, { status: 'ready' }> => ({
  status: 'ready',
  profileVersion: 'reply-draft-v2',
  replyText: SUGGESTED_REPLY,
  provenanceToken: 'test-provenance-token',
  expiresAtEpochMillis: Date.now() + 60_000,
  baseReplyStateRevision: 0,
  concreteLanguageTag: 'en-Latn',
})
const onGenerateSuggestion = fn(async () => readySuggestion())
const onGenerateFallback = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'fallback',
  kind: 'local_safe_template',
  reason: 'provider_or_output_unavailable',
  replyText: FALLBACK_REPLY,
  concreteLanguageTag: 'en-Latn',
}))
const onGenerateDetectedSuggestion = fn(async () => ({
  ...readySuggestion(),
  concreteLanguageTag: 'en-Latn',
}))
const onGenerateUnavailable = fn(async (): Promise<ReplySuggestionResult> => ({
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
    propertyId: '10000000-0000-4000-8000-000000000101',
    initialText: '',
    initialLanguageTag: null,
    propertyDefaultReplyLanguage: 'en-Latn',
    reviewReplyLanguage: 'en-Latn-US',
    canDetectReviewLanguage: true,
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
    await expect(canvas.findByText(SUGGESTED_REPLY)).resolves.toBeVisible()
    expect(canvas.getByRole('textbox')).not.toHaveValue(SUGGESTED_REPLY)
    expect(onSaveDraft).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
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

export const LocalFallbackRequiresAdoption: Story = {
  args: { onGenerateSuggestion: onGenerateFallback },
  play: async ({ canvas }) => {
    onGenerateFallback.mockClear()
    onSaveDraft.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await expect(canvas.findByText('Local safe starting point')).resolves.toBeVisible()
    expect(canvas.getByRole('textbox')).not.toHaveValue(FALLBACK_REPLY)
    expect(onSaveDraft).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))

    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(FALLBACK_REPLY))
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(FALLBACK_REPLY, undefined, 'en-Latn'),
    )
  },
}

export const AiDetectsMissingReviewLanguage: Story = {
  tags: ['ai-language-regression'],
  args: {
    initialText: 'Thank you for sharing your experience.',
    propertyDefaultReplyLanguage: null,
    reviewReplyLanguage: null,
    canDetectReviewLanguage: true,
    onGenerateSuggestion: onGenerateDetectedSuggestion,
  },
  play: async ({ canvas }) => {
    onGenerateDetectedSuggestion.mockClear()
    onSaveDraft.mockClear()

    expect(canvas.getByRole('combobox', { name: 'Reply language' })).toHaveTextContent(
      /Review language\s*·\s*Detect automatically/i,
    )
    expect(canvas.getByRole('link', { name: /set property language/i })).toHaveAttribute(
      'href',
      expect.stringContaining('propertyId=10000000-0000-4000-8000-000000000101'),
    )
    const aiButton = canvas.getByRole('button', { name: /draft with ai/i })
    expect(aiButton).toBeEnabled()
    await userEvent.click(aiButton)

    await waitFor(() =>
      expect(onGenerateDetectedSuggestion).toHaveBeenCalledWith('professional', {
        kind: 'review_language',
      }),
    )
    expect(onSaveDraft).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(
        SUGGESTED_REPLY,
        'test-provenance-token',
        'en-Latn',
      ),
    )
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Reply language' })).toHaveTextContent(
        /English\s*·\s*Review language/i,
      ),
    )

    await userEvent.click(canvas.getByRole('button', { name: /^undo$/i }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox')).toHaveValue(
        'Thank you for sharing your experience.',
      ),
    )
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenLastCalledWith(
        'Thank you for sharing your experience.',
        undefined,
        'en-Latn',
      ),
    )
    expect(canvas.getByRole('combobox', { name: 'Reply language' })).toHaveTextContent(
      /English\s*·\s*Review language/i,
    )
  },
}

export const ChooseReviewLanguageWhenMetadataIsMissing: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl',
    reviewReplyLanguage: null,
    canDetectReviewLanguage: true,
    onGenerateSuggestion: onGenerateDetectedSuggestion,
  },
  play: async ({ canvas }) => {
    onGenerateDetectedSuggestion.mockClear()
    const languageSelect = canvas.getByRole('combobox', { name: 'Reply language' })

    expect(languageSelect).toHaveTextContent(/Bulgarian\s*·\s*Property default/i)
    await userEvent.click(languageSelect)
    await userEvent.click(
      await screen.findByRole('option', {
        name: /Review language · Detect automatically/i,
      }),
    )
    expect(languageSelect).toHaveTextContent(
      /Review language\s*·\s*Detect automatically/i,
    )
    const languageContainer = languageSelect.closest('[data-slot="reply-language"]')
    if (!languageContainer) throw new Error('Reply language container was not rendered')
    await waitFor(() => expect(languageContainer).not.toHaveAttribute('aria-hidden'))

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await waitFor(() =>
      expect(onGenerateDetectedSuggestion).toHaveBeenCalledWith('professional', {
        kind: 'review_language',
      }),
    )
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await waitFor(() =>
      expect(languageSelect).toHaveTextContent(/English\s*·\s*Review language/i),
    )
  },
}

export const RatingOnlyAiUnavailable: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: null,
    reviewReplyLanguage: null,
    canDetectReviewLanguage: false,
    onGenerateSuggestion: onGenerateDetectedSuggestion,
  },
  play: async ({ canvas }) => {
    const aiButton = canvas.getByRole('button', { name: /draft with ai/i })

    expect(aiButton).toBeDisabled()
    expect(
      canvas.getAllByText(/AI drafting needs written review text/i),
    ).not.toHaveLength(0)
    expect(
      canvas.getByText(/AI remains unavailable because this review has no text/i),
    ).toBeVisible()
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
