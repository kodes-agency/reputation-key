// Reply composer stories (draft / empty states).
//
// ReplyCompose takes plain callbacks (not Action objects), so stories inject
// fn() spies. isSaving and the over-limit counter are DIRECT props here — these
// are the authoritative coverage for the pending + validation surfaces that
// ReplyEditor derives internally.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { ReplyCompose, type ReplySuggestionResult } from './reply-editor-compose'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'

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
  languageSource: 'explicit',
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
const BULGARIAN_TEMPLATE =
  'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.'
const localTemplateSuggestion = (
  reason: 'language_undetermined' | 'no_review_text',
): Extract<ReplySuggestionResult, { status: 'fallback' }> => ({
  status: 'fallback',
  kind: 'local_safe_template',
  reason,
  languageSource: 'explicit',
  replyText: BULGARIAN_TEMPLATE,
  concreteLanguageTag: 'bg-Cyrl-BG',
})
const onGenerateNoTextTemplate = fn(async () => localTemplateSuggestion('no_review_text'))
const onGenerateShortTemplate = fn(async () =>
  localTemplateSuggestion('language_undetermined'),
)
const noLibraryTemplates = (): ReplyTemplateListResult => ({
  profile: null,
  groups: [],
  recommendedTemplateId: null,
})
const onListNoTextTemplate = fn(async () => noLibraryTemplates())
const onListShortTemplate = fn(async () => noLibraryTemplates())
const onListTemplates = fn(async () => noLibraryTemplates())
const onLoadTemplate = fn(async (templateId: string) => ({
  text: 'Library template',
  replyLanguageTag: 'en-Latn',
  templateId,
  templateVersion: 1,
}))
const LIBRARY_TEMPLATE_ID = '73000000-0000-4000-8000-000000000001'
const LIBRARY_REPLY =
  'Dear {guest_name},\n\nThank you for sharing your experience.\n\nWarm regards,\nHotel Team'
const onListLibraryTemplates = fn(async (): Promise<ReplyTemplateListResult> => ({
  profile: {
    greeting: 'Dear {guest_name},',
    signOffPositive: 'Warm regards,\nHotel Team',
    signOffNegative: 'Sincerely,\nGuest Relations',
    emojiAllowed: false,
    escalationContact: 'care@example.test',
    version: 2,
  },
  groups: [
    {
      languageGroup: 'en-Latn',
      templates: [
        {
          id: LIBRARY_TEMPLATE_ID,
          title: 'Guest appreciation',
          aspect: null,
          openLabel: null,
          languageTag: 'en-Latn',
          version: 3,
        },
      ],
    },
  ],
  recommendedTemplateId: LIBRARY_TEMPLATE_ID,
}))
const onLoadLibraryTemplate = fn(async (templateId: string) => ({
  text: LIBRARY_REPLY,
  replyLanguageTag: 'en-Latn-US',
  templateId,
  templateVersion: 3,
}))
const onGenerateMissingTemplateLanguage = fn(
  async (): Promise<ReplySuggestionResult> => ({
    status: 'unavailable',
    code: 'target_language_unavailable',
    retryAfterEpochMillis: null,
  }),
)
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

async function expectDisabledAutomaticDetection(
  canvasElement: HTMLElement,
  optionName: RegExp,
  propertyDefaultSelected: boolean,
): Promise<void> {
  const canvas = within(canvasElement)
  const languageSelect = canvas.getByRole('combobox', { name: 'Reply language' })
  if (propertyDefaultSelected) {
    expect(languageSelect).toHaveTextContent(/Bulgarian\s*·\s*Property default/i)
  }
  await userEvent.click(languageSelect)
  const autoDetect = await screen.findByRole('option', { name: optionName })
  expect(autoDetect).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Escape}')
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
    reviewLanguageReadiness: 'detectable',
    isSaving: false,
    onSaveDraft,
    onSubmit,
    onGenerateSuggestion,
    onListTemplates,
    onLoadTemplate,
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

export const UnfilledTemplateSlotBlocksSubmit: Story = {
  args: {
    initialText: 'Dear {guest_name},\n\nThank you for your visit.',
    initialLanguageTag: 'en-Latn',
  },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('textbox')).toHaveValue(
      'Dear {guest_name},\n\nThank you for your visit.',
    )
    expect(
      canvas.getByText(
        'Fill every template placeholder before publishing: {guest_name}.',
      ),
    ).toBeVisible()
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

export const LocalSafeMenuUsesCataloguePath: Story = {
  args: { onGenerateSuggestion: onGenerateFallback },
  play: async ({ canvas }) => {
    onGenerateFallback.mockClear()

    await userEvent.click(
      canvas.getByRole('button', { name: /choose a reply template/i }),
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Local safe template' }),
    )

    await waitFor(() =>
      expect(onGenerateFallback).toHaveBeenCalledWith(
        'professional',
        { kind: 'property_default' },
        true,
      ),
    )
    await expect(canvas.findByText('Local safe starting point')).resolves.toBeVisible()
  },
}

export const AiDetectsMissingReviewLanguage: Story = {
  tags: ['ai-language-regression'],
  args: {
    initialText: 'Thank you for sharing your experience.',
    propertyDefaultReplyLanguage: null,
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'detectable',
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
    reviewLanguageReadiness: 'detectable',
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

export const RatingOnlyUsesPropertyTemplate: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl-BG',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'no_review_text',
    onGenerateSuggestion: onGenerateNoTextTemplate,
    onListTemplates: onListNoTextTemplate,
  },
  play: async ({ canvasElement }) => {
    onListNoTextTemplate.mockClear()
    onGenerateNoTextTemplate.mockClear()
    onSaveDraft.mockClear()
    const canvas = within(canvasElement)
    await expectDisabledAutomaticDetection(
      canvasElement,
      /Review language · Detect automatically — This review has no text to detect\./i,
      true,
    )

    const templateButton = canvas.getByRole('button', { name: /load template/i })
    expect(templateButton).toBeEnabled()
    expect(canvas.getByRole('button', { name: /draft with ai/i })).toBeDisabled()
    await userEvent.click(templateButton)
    await waitFor(() =>
      expect(onListNoTextTemplate).toHaveBeenCalledWith({
        kind: 'property_default',
      }),
    )
    await expect(
      canvas.findByText(
        'This review has no text — template loaded in Bulgarian (property default).',
      ),
    ).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox')).toHaveValue(BULGARIAN_TEMPLATE),
    )
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(
        BULGARIAN_TEMPLATE,
        undefined,
        'bg-Cyrl-BG',
      ),
    )
    expect(onGenerateNoTextTemplate).toHaveBeenCalledWith(
      'professional',
      { kind: 'property_default' },
      true,
    )
  },
}

export const ShortReviewUsesPropertyTemplate: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl-BG',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'insufficient_language_evidence',
    onGenerateSuggestion: onGenerateShortTemplate,
    onListTemplates: onListShortTemplate,
  },
  play: async ({ canvasElement }) => {
    onListShortTemplate.mockClear()
    onGenerateShortTemplate.mockClear()
    const canvas = within(canvasElement)
    await expectDisabledAutomaticDetection(
      canvasElement,
      /Review language · Detect automatically — This review is too short to detect its language\./i,
      true,
    )

    await userEvent.click(canvas.getByRole('button', { name: /load template/i }))
    await waitFor(() =>
      expect(onListShortTemplate).toHaveBeenCalledWith({
        kind: 'property_default',
      }),
    )
    expect(onGenerateShortTemplate).toHaveBeenCalledWith(
      'professional',
      { kind: 'property_default' },
      true,
    )
    await expect(
      canvas.findByText(
        "Review language couldn't be detected — template loaded in Bulgarian (property default).",
      ),
    ).resolves.toBeVisible()
  },
}

export const LibraryTemplateLoadsAsManualDraft: Story = {
  args: {
    propertyDefaultReplyLanguage: 'en-Latn-US',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'no_review_text',
    onListTemplates: onListLibraryTemplates,
    onLoadTemplate: onLoadLibraryTemplate,
  },
  play: async ({ canvas }) => {
    onListLibraryTemplates.mockClear()
    onLoadLibraryTemplate.mockClear()
    onSaveDraft.mockClear()

    expect(canvas.getByRole('button', { name: /load template/i })).toBeEnabled()
    expect(canvas.getByRole('button', { name: /draft with ai/i })).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: /choose a reply template/i }),
    )
    await expect(
      screen.findByRole('menuitem', { name: 'Guest appreciation' }),
    ).resolves.toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Local safe template' })).toBeVisible()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: /load template/i }))

    await waitFor(() =>
      expect(onLoadLibraryTemplate).toHaveBeenCalledWith(LIBRARY_TEMPLATE_ID, {
        kind: 'property_default',
      }),
    )
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(LIBRARY_REPLY))
    expect(canvas.getByText('Template loaded: Guest appreciation')).toBeVisible()
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(LIBRARY_REPLY, undefined, 'en-Latn-US'),
    )
  },
}

export const ShortReviewNeedsPropertyLanguage: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: null,
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'insufficient_language_evidence',
    onGenerateSuggestion: onGenerateMissingTemplateLanguage,
    onListTemplates: fn(async () => noLibraryTemplates()),
  },
  play: async ({ canvasElement }) => {
    onGenerateMissingTemplateLanguage.mockClear()
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(
        'This review is too short to detect its language. Set a property default to load a local template.',
      ),
    ).toBeVisible()
    await expectDisabledAutomaticDetection(
      canvasElement,
      /Review language · Detect automatically — This review is too short to detect its language\./i,
      false,
    )

    const templateButton = canvas.getByRole('button', { name: /load template/i })
    expect(templateButton).toBeEnabled()
    await userEvent.click(templateButton)
    await waitFor(() =>
      expect(
        canvas.getByText(
          'Set a property default reply language in property settings before loading a template.',
        ),
      ).toBeVisible(),
    )
    expect(onGenerateMissingTemplateLanguage).toHaveBeenCalledWith(
      'professional',
      { kind: 'review_language' },
      true,
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

const onGenerateNotAuthorized = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'unavailable',
  code: 'not_authorized',
  retryAfterEpochMillis: null,
})).mockName('onGenerateNotAuthorized')

export const AiRepliesNotEnabled: Story = {
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateNotAuthorized,
  },
  play: async ({ canvas }) => {
    onGenerateNotAuthorized.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await waitFor(() =>
      expect(
        canvas.getByText(/AI reply drafting is not enabled for this property/i),
      ).toBeVisible(),
    )
    const link = canvas.getByRole('link', { name: /enable ai replies/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('/settings/ai'))
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('propertyId=10000000-0000-4000-8000-000000000101'),
    )
  },
}

// An imported property has no Portal brand profile yet, so the drafting route
// refuses with `brand_profile_unavailable`. Property settings owns the field
// that clears it even when the Property has no Portals, so the refusal must
// point there instead of dead-ending on the empty Portal list.
const onGenerateBrandRefusal = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'unavailable',
  code: 'brand_profile_unavailable',
  retryAfterEpochMillis: null,
})).mockName('onGenerateBrandRefusal')

export const PublicDisplayNameMissing: Story = {
  decorators: [withRole('AccountAdmin')],
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateBrandRefusal,
  },
  play: async ({ canvas }) => {
    onGenerateBrandRefusal.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await waitFor(() =>
      expect(
        canvas.getByText(/reply suggestions need this property's public display name/i),
      ).toBeVisible(),
    )
    expect(
      canvas.getByRole('link', { name: /set the public display name/i }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining(
        '/properties/10000000-0000-4000-8000-000000000101/settings',
      ),
    )
  },
}

// A PropertyManager can draft with AI but cannot set the brand profile
// (`portal.admin` is AccountAdmin-only), so the refusal points at the person
// who can instead of a link that would refuse.
export const PublicDisplayNameMissingForManager: Story = {
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateBrandRefusal,
  },
  play: async ({ canvas }) => {
    onGenerateBrandRefusal.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await waitFor(() =>
      expect(
        canvas.getByText(/ask an account admin to set this property/i),
      ).toBeVisible(),
    )
    expect(
      canvas.queryByRole('link', { name: /set the public display name/i }),
    ).toBeNull()
  },
}
