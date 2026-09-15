// Reply composer stories (draft / empty states).
//
// ReplyCompose takes plain callbacks (not Action objects), so stories inject
// fn() spies. isSaving and the over-limit counter are DIRECT props here — these
// are the authoritative coverage for the pending + validation surfaces that
// ReplyEditor derives internally.
//
// Plan v2.1 PR 4 (rows 14, 17, 18). `ReplyCompose` is the dock's TEXT and FOOT
// rows now, rendered here without the dock around them (the region and its
// head are `reply-composer.stories.tsx` / `composer-dock.stories.tsx`). The
// reply language is no longer a combobox: it is the `Write in` group inside
// `Draft with AI ▾` and the `Templates in` switch inside `Template ▾`, and the
// language an assist action actually used is printed by the result tag at the
// top of the text (`AI draft · English`, `Template · <title> · English`).
// Every language assertion below therefore OPENS a menu — a story that only
// checked the old combobox was gone would pass with the language deleted.
//
// Reply language stays inside those two assist menus; it is not repeated as a
// separate control beside them. The stories at the end of this file pin the
// review's other findings in the real composer: a regenerate that does not
// commit its language, Undo restoring provenance, the caret after `Use draft`,
// the template menu's loading state surviving a switch back, and a detected
// review language surviving a template load.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ReplyCompose, type ReplySuggestionResult } from './reply-editor-compose'
import type { ReplyLanguageTarget } from './reply-language-options'
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
  reason: 'template_requested',
  languageSource: 'explicit',
  replyText: FALLBACK_REPLY,
  concreteLanguageTag: 'en-Latn',
}))
const onGenerateNotPersonalized = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'fallback',
  kind: 'local_safe_template',
  reason: 'language_not_personalized',
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
/** Answers in the language of the target it was asked for (row 18's regenerate). */
const onGenerateByTarget = fn(
  async (_tone: string, target: ReplyLanguageTarget): Promise<ReplySuggestionResult> => ({
    ...readySuggestion(),
    replyText: target.kind === 'property_default' ? BULGARIAN_TEMPLATE : SUGGESTED_REPLY,
    concreteLanguageTag: target.kind === 'property_default' ? 'bg-Cyrl' : 'en-Latn-US',
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

/** Menus portal to `document.body`, outside the story canvas. */
const page = () => within(document.body)

const AI_TRIGGER = /^AI tone and language:/
const TEMPLATE_TRIGGER = 'Choose a reply template'

async function openMenu(trigger: string | RegExp): Promise<void> {
  await userEvent.click(page().getByRole('button', { name: trigger }))
  const menu = await page().findByRole('menu')
  await waitFor(() => expect(menu).toBeVisible())
}

async function closeMenu(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
}

/** The `Write in` rows of the open AI menu. */
const writeIn = () => within(page().getByRole('group', { name: 'Write in' }))

/**
 * The result tag as printed text (row 18). Matched on the element's whole
 * text because the tag is three spans — the lead word and two quiet parts.
 */
const tagText = (text: string) => (_: string, element: Element | null) =>
  element !== null &&
  ['P', 'BUTTON'].includes(element.tagName) &&
  element.textContent === text

/**
 * A review whose language cannot be detected: `Detect automatically` is
 * listed in `Write in` but disabled, and says why in its own name — the
 * reason a screen reader could never have hovered a tooltip for. When a
 * property default exists it is the checked row.
 */
async function expectDisabledAutomaticDetection(
  optionName: RegExp,
  propertyDefaultSelected: boolean,
): Promise<void> {
  await openMenu(AI_TRIGGER)
  if (propertyDefaultSelected) {
    await expect(
      writeIn().getByRole('menuitem', { name: 'Bulgarian · property default' }),
    ).toHaveAttribute('aria-current', 'true')
  }
  const autoDetect = writeIn().getByRole('menuitem', { name: optionName })
  await expect(autoDetect).toHaveAttribute('aria-disabled', 'true')
  await closeMenu()
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

// Over the 4096-byte limit → destructive counter + disabled actions (validation).
export const OverLimit: Story = {
  args: { initialText: 'x'.repeat(5000) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/5000\/4096/)).toHaveClass('text-destructive')
    expect(canvas.getByRole('button', { name: /submit for approval/i })).toBeDisabled()
  },
}

// The story above cannot tell bytes from characters: an ASCII letter is one of
// each. Google's limit is 4,096 UTF-8 bytes and a Cyrillic letter is two, so
// 2,049 letters (4,098 bytes) read `2049/4096` in the neutral colour with
// Submit enabled, and the worker could not send them (`reply-comment.ts`).
const CYRILLIC_OVER_LIMIT = 'Б'.repeat(2_049)
const CYRILLIC_AT_LIMIT = 'Б'.repeat(2_048)

export const OverLimitInBytes: Story = {
  args: { initialText: CYRILLIC_OVER_LIMIT },
  play: async ({ canvas }) => {
    expect(canvas.getByText('4098/4096')).toHaveClass('text-destructive')
    expect(canvas.getByRole('button', { name: /submit for approval/i })).toBeDisabled()
  },
}

export const AtTheByteLimit: Story = {
  args: { initialText: CYRILLIC_AT_LIMIT },
  play: async ({ canvas }) => {
    const counter = canvas.getByText('4096/4096')
    expect(counter).toHaveClass('text-muted-foreground')
    expect(counter).not.toHaveClass('text-destructive')
    expect(canvas.getByRole('button', { name: /submit for approval/i })).toBeEnabled()
  },
}

// An AI draft is held to the same rule before it is offered: under 4,096
// characters is not under Google's 4,096 bytes (`use-reply-suggestion.ts`).
const onGenerateOverByteLimit = fn(async () => ({
  ...readySuggestion(),
  replyText: CYRILLIC_OVER_LIMIT,
}))

export const AiDraftOverTheByteLimitIsRefused: Story = {
  args: { onGenerateSuggestion: onGenerateOverByteLimit },
  play: async ({ canvas }) => {
    onGenerateOverByteLimit.mockClear()
    onSaveDraft.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await expect(
      canvas.findByText('The AI draft could not be verified. Try again.'),
    ).resolves.toBeVisible()
    expect(onGenerateOverByteLimit).toHaveBeenCalledOnce()
    expect(canvas.queryByRole('button', { name: /use draft/i })).toBeNull()
    expect(canvas.getByRole('textbox')).toHaveValue('')
    expect(onSaveDraft).not.toHaveBeenCalled()
  },
}

// A loaded template is held to it too (`use-reply-template.ts`): the server
// refuses to render one over the byte limit, and the client must not adopt one.
const onLoadOverByteLimit = fn(async (templateId: string) => ({
  text: CYRILLIC_OVER_LIMIT,
  replyLanguageTag: 'en-Latn-US',
  templateId,
  templateVersion: 3,
}))

export const TemplateOverTheByteLimitIsRefused: Story = {
  args: {
    propertyDefaultReplyLanguage: 'en-Latn-US',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'no_review_text',
    onListTemplates: onListLibraryTemplates,
    onLoadTemplate: onLoadOverByteLimit,
  },
  play: async ({ canvas }) => {
    onLoadOverByteLimit.mockClear()
    onSaveDraft.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'Template' }))
    await waitFor(() => expect(onLoadOverByteLimit).toHaveBeenCalledOnce())
    await expect(
      canvas.findByText('The loaded template could not be verified.'),
    ).resolves.toBeVisible()
    expect(canvas.getByRole('textbox')).toHaveValue('')
    expect(onSaveDraft).not.toHaveBeenCalled()
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
    // A preview is not a draft: no result tag until it is adopted.
    expect(canvas.queryByText(tagText('AI draft · English'))).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(SUGGESTED_REPLY))
    await waitFor(() =>
      expect(onSaveDraft).toHaveBeenCalledWith(
        SUGGESTED_REPLY,
        'test-provenance-token',
        'en-Latn',
      ),
    )
    // Row 18: the tag names the language the draft was made in. The property
    // default and the review language are the same language here, so there is
    // no OTHER target to regenerate in and the tag is a fact, not a menu.
    await expect(canvas.findByText(tagText('AI draft · English'))).resolves.toBeVisible()
    expect(canvas.queryByRole('button', { name: 'AI draft · English' })).toBeNull()
  },
}

export const LocalFallbackRequiresAdoption: Story = {
  args: { onGenerateSuggestion: onGenerateNotPersonalized },
  play: async ({ canvas }) => {
    onGenerateNotPersonalized.mockClear()
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

    // One language here (the review's folds into the property default), so
    // there is nothing to switch between and no switch is drawn.
    expect(canvas.queryByRole('button', { name: /^Reply language:/ })).toBeNull()
    await openMenu(TEMPLATE_TRIGGER)
    expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    await userEvent.click(page().getByRole('menuitem', { name: 'Local safe template' }))

    await waitFor(() =>
      expect(onGenerateFallback).toHaveBeenCalledWith(
        'professional',
        { kind: 'property_default' },
        true,
        expect.any(String),
      ),
    )
    await expect(canvas.findByText('Local safe starting point')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    // Row 18: a local safe template has no library id and so no title — the
    // tag says `Template` and the language, and invents nothing between them.
    await expect(canvas.findByText(tagText('Template · English'))).resolves.toBeVisible()
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

    // No property default and no recorded review language: automatic
    // detection is the selection, and the chevron's name says so.
    await openMenu('AI tone and language: Professional, Detect automatically')
    await expect(
      writeIn().getByRole('menuitem', { name: 'Detect automatically' }),
    ).toHaveAttribute('aria-current', 'true')
    // The `Property reply language not set` alert is a row in the menu now
    // (row 18), carrying the same fix for a manager with `ai.manage`.
    const fix = writeIn().getByRole('menuitem', { name: 'Set property language' })
    await expect(fix).toHaveAttribute(
      'href',
      expect.stringContaining(
        '/properties/10000000-0000-4000-8000-000000000101/settings/replies',
      ),
    )
    await expect(fix).toHaveAccessibleDescription(
      'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.',
    )
    await closeMenu()
    const aiButton = canvas.getByRole('button', { name: /draft with ai/i })
    expect(aiButton).toBeEnabled()
    await userEvent.click(aiButton)

    await waitFor(() =>
      expect(onGenerateDetectedSuggestion).toHaveBeenCalledWith(
        'professional',
        { kind: 'review_language' },
        false,
        expect.any(String),
      ),
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
    // The detected language becomes the review language: the tag names it and
    // `Write in` checks it.
    await expect(canvas.findByText(tagText('AI draft · English'))).resolves.toBeVisible()
    await openMenu('AI tone and language: Professional, English')
    await expect(
      writeIn().getByRole('menuitem', { name: 'English · review language' }),
    ).toHaveAttribute('aria-current', 'true')
    await closeMenu()

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
    // Undo restores the text, not the detection: the language stays known.
    await openMenu('AI tone and language: Professional, English')
    await expect(
      writeIn().getByRole('menuitem', { name: 'English · review language' }),
    ).toHaveAttribute('aria-current', 'true')
    await closeMenu()
    // ...and it restores the text's PROVENANCE: the manager's own words carry
    // no `AI draft · English` tag (PR 4 review — the tag outlived the Undo).
    expect(canvas.queryByText(tagText('AI draft · English'))).toBeNull()
    expect(canvas.queryByRole('button', { name: 'AI draft · English' })).toBeNull()
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

    await openMenu('AI tone and language: Professional, Bulgarian')
    await expect(
      writeIn().getByRole('menuitem', { name: 'Bulgarian · property default' }),
    ).toHaveAttribute('aria-current', 'true')
    // Picking a language switches it and does NOT draft (reply-ai-menu.tsx).
    await userEvent.click(
      writeIn().getByRole('menuitem', { name: 'Detect automatically' }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    expect(onGenerateDetectedSuggestion).not.toHaveBeenCalled()
    await expect(
      canvas.getByRole('button', {
        name: 'AI tone and language: Professional, Detect automatically',
      }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await waitFor(() =>
      expect(onGenerateDetectedSuggestion).toHaveBeenCalledWith(
        'professional',
        { kind: 'review_language' },
        false,
        expect.any(String),
      ),
    )
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await waitFor(() =>
      expect(
        canvas.getByRole('button', {
          name: 'AI tone and language: Professional, English',
        }),
      ).toBeVisible(),
    )
  },
}

/**
 * Row 18: `AI draft · English ▾` regenerates in the OTHER target. Here the
 * property default is Bulgarian, so after an English (review-language) draft
 * the tag is a menu with one row, `Regenerate in Bulgarian`, and choosing it
 * requests the draft for `property_default` without selecting it
 * (`regenerateScope`); the language commits when the preview is adopted.
 */
export const AiDraftTagRegeneratesInTheOtherLanguage: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl',
    reviewReplyLanguage: 'en-Latn-US',
    reviewLanguageReadiness: 'detectable',
    onGenerateSuggestion: onGenerateByTarget,
  },
  play: async ({ canvas }) => {
    const generate = onGenerateByTarget
    generate.mockClear()

    await openMenu('AI tone and language: Professional, Bulgarian')
    await userEvent.click(
      writeIn().getByRole('menuitem', { name: 'English · review language' }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await userEvent.click(await canvas.findByRole('button', { name: /use draft/i }))
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(SUGGESTED_REPLY))

    const tag = await canvas.findByRole('button', { name: 'AI draft · English' })
    expect(tag).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(tag)
    await waitFor(() => expect(page().getByRole('menu')).toBeVisible())
    // Only the other target: the language the draft is already in is not a row.
    expect(
      page()
        .getAllByRole('menuitem')
        .map((row) => row.textContent),
    ).toEqual(['Regenerate in Bulgarian · property default'])
    await userEvent.click(
      page().getByRole('menuitem', {
        name: 'Regenerate in Bulgarian · property default',
      }),
    )
    await waitFor(() =>
      expect(generate).toHaveBeenLastCalledWith(
        'professional',
        { kind: 'property_default' },
        false,
        expect.any(String),
      ),
    )
    // Still a preview: nothing replaces the text until it is adopted.
    await expect(canvas.findByText(BULGARIAN_TEMPLATE)).resolves.toBeVisible()
    expect(canvas.getByRole('textbox')).toHaveValue(SUGGESTED_REPLY)
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    await expect(
      canvas.findByRole('button', { name: 'AI draft · Bulgarian' }),
    ).resolves.toBeVisible()
    await expect(
      canvas.getByRole('button', {
        name: 'AI tone and language: Professional, Bulgarian',
      }),
    ).toBeVisible()
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
      /^Detect automatically — This review has no text to detect\.$/,
      true,
    )

    const templateButton = canvas.getByRole('button', { name: 'Template' })
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
      expect.any(String),
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
      /^Detect automatically — This review is too short to detect its language\.$/,
      true,
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Template' }))
    await waitFor(() =>
      expect(onListShortTemplate).toHaveBeenCalledWith({
        kind: 'property_default',
      }),
    )
    expect(onGenerateShortTemplate).toHaveBeenCalledWith(
      'professional',
      { kind: 'property_default' },
      true,
      expect.any(String),
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

    expect(canvas.getByRole('button', { name: 'Template' })).toBeEnabled()
    expect(canvas.getByRole('button', { name: /draft with ai/i })).toBeVisible()
    await openMenu(TEMPLATE_TRIGGER)
    // Detection can never filter the library, so the template menu does not
    // list it — refused or otherwise — and with the property default left
    // alone there is no switch. `Write in` still lists it with its reason.
    expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    expect(page().queryByRole('menuitem', { name: /^Detect automatically/ })).toBeNull()
    // The list is headed, in words, by the language the server returned it in.
    const listGroup = await page().findByRole('group', { name: 'Templates in English' })
    await expect(
      within(listGroup).findByText('Templates in English'),
    ).resolves.toBeVisible()
    const list = within(listGroup)
    await expect(
      list.findByRole('menuitem', { name: 'Guest appreciation' }),
    ).resolves.toBeVisible()
    expect(page().getByRole('menuitem', { name: 'Local safe template' })).toBeVisible()
    await closeMenu()

    await userEvent.click(canvas.getByRole('button', { name: 'Template' }))

    await waitFor(() =>
      expect(onLoadLibraryTemplate).toHaveBeenCalledWith(LIBRARY_TEMPLATE_ID, {
        kind: 'property_default',
      }),
    )
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(LIBRARY_REPLY))
    // Row 18: the tag names the template by the title it was loaded under, and
    // its language. The old `Template loaded: …` line is still announced to a
    // screen reader, but no longer printed beside a tag that says the same.
    await expect(
      canvas.findByText(tagText('Template · Guest appreciation · English')),
    ).resolves.toBeVisible()
    expect(canvas.getByText('Template loaded: Guest appreciation')).toHaveAttribute(
      'role',
      'status',
    )
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
    const reason =
      'This review is too short to detect its language. Set a property default to load a local template.'
    // Row 18: the standing alert above the box is gone — the sentence is not
    // printed in the composer at all until a menu is opened.
    expect(canvas.queryByText(reason)).toBeNull()
    expect(canvas.queryByText('Property reply language not set')).toBeNull()
    await expectDisabledAutomaticDetection(
      /^Detect automatically — This review is too short to detect its language\.$/,
      false,
    )
    // ...and it is a row in BOTH menus, beside the language it explains.
    await openMenu(TEMPLATE_TRIGGER)
    await expect(
      page().getByRole('menuitem', { name: 'Set property language' }),
    ).toHaveAccessibleDescription(reason)
    await closeMenu()

    const templateButton = canvas.getByRole('button', { name: 'Template' })
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
      expect.any(String),
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
      expect(canvas.getByText(/AI is off for this property/i)).toBeVisible(),
    )
    const link = canvas.getByRole('link', { name: /enable ai replies/i })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(
        '/properties/10000000-0000-4000-8000-000000000101/settings/ai',
      ),
    )
  },
}

// A busy interactive lane is our own capacity, not a failure: the composer
// says so, counts down to the retry time the server gave, and offers the
// governed template as a separate choice. Nothing is substituted.
const onGenerateBusy = fn(
  async (
    _tone: string,
    _target: ReplyLanguageTarget,
    templateOnly: boolean,
    _idempotencyKey: string,
  ): Promise<ReplySuggestionResult> =>
    templateOnly
      ? {
          status: 'fallback',
          kind: 'local_safe_template',
          reason: 'template_requested',
          languageSource: 'explicit',
          replyText: FALLBACK_REPLY,
          concreteLanguageTag: 'en-Latn',
        }
      : {
          status: 'unavailable',
          code: 'busy',
          retryAfterEpochMillis: Date.now() + 20_000,
        },
).mockName('onGenerateBusy')

export const BusyOffersRetryAndTemplate: Story = {
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateBusy,
  },
  play: async ({ canvas }) => {
    onGenerateBusy.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await expect(
      canvas.findByText('AI drafting is handling other requests for this property.'),
    ).resolves.toBeVisible()
    expect(canvas.getByRole('button', { name: /try again in \d+s/i })).toBeDisabled()
    expect(canvas.getByRole('textbox')).toHaveValue(
      'Thank you for sharing your experience.',
    )
    expect(canvas.queryByText('Local safe starting point')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: /use a template instead/i }))

    await waitFor(() =>
      expect(onGenerateBusy).toHaveBeenLastCalledWith(
        'professional',
        { kind: 'property_default' },
        true,
        expect.any(String),
      ),
    )
    await expect(canvas.findByText('Local safe starting point')).resolves.toBeVisible()
  },
}

// A repeated click on the same draft reuses the same idempotency key, so the
// server coalesces it; a busy answer keeps the key for the retry.
export const BusyRetryReusesTheRequest: Story = {
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateBusy,
  },
  play: async ({ canvas }) => {
    onGenerateBusy.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await canvas.findByText('AI drafting is handling other requests for this property.')
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await waitFor(() => expect(onGenerateBusy).toHaveBeenCalledTimes(2))
    const [first, second] = onGenerateBusy.mock.calls
    expect(first?.[3]).toEqual(expect.any(String))
    expect(second?.[3]).toBe(first?.[3])
  },
}

const onGenerateProviderFailure = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'unavailable',
  code: 'provider_unavailable',
  retryAfterEpochMillis: Date.now() + 1_000,
})).mockName('onGenerateProviderFailure')

export const ProviderFailureOffersTemplate: Story = {
  args: {
    initialText: 'Thank you for sharing your experience.',
    onGenerateSuggestion: onGenerateProviderFailure,
  },
  play: async ({ canvas }) => {
    onGenerateProviderFailure.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))

    await expect(
      canvas.findByText("AI couldn't write a personalized draft this time."),
    ).resolves.toBeVisible()
    expect(canvas.getByRole('button', { name: /use a template instead/i })).toBeVisible()
    expect(canvas.queryByRole('button', { name: /try again in/i })).toBeNull()
    expect(canvas.queryByText('Local safe starting point')).toBeNull()
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
        '/properties/10000000-0000-4000-8000-000000000101/settings/profile',
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

// ── PR 4 review: the language, provenance and focus in the real composer ────

const TYPED_REPLY = 'Thank you for staying with us — we hope to see you again.'
const TURKISH_REPLY =
  'Harika yorumunuz için teşekkür ederiz. Sizi tekrar ağırlamayı umuyoruz.'
const BULGARIAN_LIBRARY_ID = '73000000-0000-4000-8000-0000000000b1'
const BULGARIAN_LIBRARY_TITLE = 'Благодарност'

/**
 * `Detect automatically` on a Bulgarian property whose review language is NOT
 * recorded (the production case): the AI boundary answers in the detected
 * Turkish; the template library answers the way `resolveTargetLanguage` does
 * — for EITHER target it can only return the property default's templates,
 * stamped `bg`.
 */
const onGenerateDetectsTurkish = fn(
  async (_tone: string, target: ReplyLanguageTarget): Promise<ReplySuggestionResult> => ({
    ...readySuggestion(),
    replyText: target.kind === 'review_language' ? TURKISH_REPLY : BULGARIAN_TEMPLATE,
    concreteLanguageTag: target.kind === 'review_language' ? 'tr-Latn-TR' : 'bg-Cyrl',
  }),
)
const bulgarianLibrary = (): ReplyTemplateListResult => ({
  profile: null,
  groups: [
    {
      languageGroup: 'bg-Cyrl',
      templates: [
        {
          id: BULGARIAN_LIBRARY_ID,
          title: BULGARIAN_LIBRARY_TITLE,
          aspect: null,
          openLabel: null,
          languageTag: 'bg-Cyrl',
          version: 1,
        },
      ],
    },
  ],
  recommendedTemplateId: BULGARIAN_LIBRARY_ID,
})
const onListFallsBackToProperty = fn(async () => bulgarianLibrary())
const onLoadFallsBackToProperty = fn(async (templateId: string) => ({
  text: BULGARIAN_TEMPLATE,
  replyLanguageTag: 'bg-Cyrl',
  templateId,
  templateVersion: 1,
}))

/**
 * Finding 5. A Turkish AI draft teaches the composer the review's language;
 * a library template loaded afterwards must not UN-teach it.
 *
 * The template menu offers no `Templates in` switch — neither detection nor a
 * detected (unrecorded) language can filter the library — and heads its list
 * with the language the server returned, `Templates in Bulgarian`, where it
 * used to say `Templates in Turkish` over Bulgarian templates. Loading one
 * tags the draft Bulgarian, and `Turkish · review language` stays on the
 * language lists: the old adoption rule took the template's `bg` for the
 * review's language and folded Turkish away for the rest of the visit.
 */
export const DetectedLanguageSurvivesATemplate: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'detectable',
    onGenerateSuggestion: onGenerateDetectsTurkish,
    onListTemplates: onListFallsBackToProperty,
    onLoadTemplate: onLoadFallsBackToProperty,
  },
  play: async ({ canvas }) => {
    await openMenu(AI_TRIGGER)
    await userEvent.click(
      writeIn().getByRole('menuitem', { name: 'Detect automatically' }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await userEvent.click(await canvas.findByRole('button', { name: /use draft/i }))
    await expect(
      canvas.findByRole('button', { name: 'AI draft · Turkish' }),
    ).resolves.toBeVisible()

    await openMenu(TEMPLATE_TRIGGER)
    expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    expect(page().queryByRole('group', { name: 'Templates in Turkish' })).toBeNull()
    const list = within(
      await page().findByRole('group', { name: 'Templates in Bulgarian' }),
    )
    await userEvent.click(
      await list.findByRole('menuitem', { name: BULGARIAN_LIBRARY_TITLE }),
    )

    await waitFor(() =>
      expect(canvas.getByRole('textbox')).toHaveValue(BULGARIAN_TEMPLATE),
    )
    await expect(
      canvas.findByText(tagText(`Template · ${BULGARIAN_LIBRARY_TITLE} · Bulgarian`)),
    ).resolves.toBeVisible()
    expect(canvas.queryByRole('button', { name: /^Reply language:/ })).toBeNull()
    await openMenu(AI_TRIGGER)
    await expect(
      writeIn().getByRole('menuitem', { name: 'Turkish · review language' }),
    ).not.toHaveAttribute('aria-current')
    await closeMenu()
  },
}

/**
 * Finding 3, the template half. A hand-typed reply, then the recommended
 * template, then Undo: the manager's words come back WITHOUT `Template ·
 * Guest appreciation · English` over them. (The AI half is the end of
 * `AiDetectsMissingReviewLanguage`.)
 */
export const UndoAfterATemplateDropsItsTag: Story = {
  args: {
    initialText: TYPED_REPLY,
    initialLanguageTag: 'en-Latn',
    onListTemplates: onListLibraryTemplates,
    onLoadTemplate: onLoadLibraryTemplate,
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Template' }))
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(LIBRARY_REPLY))
    const templateTag = tagText('Template · Guest appreciation · English')
    await expect(canvas.findByText(templateTag)).resolves.toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue(TYPED_REPLY))
    expect(canvas.queryByText(templateTag)).toBeNull()
  },
}

/**
 * Finding 4. A regenerate row asks in the other language WITHOUT committing
 * it. The Bulgarian preview names its language; dismissing it leaves the
 * English draft exactly as it was — its text, its tag, its saved language (no
 * save went out at all) and the language the ghost control and `Draft with
 * AI` use — and the tag's menu still offers the way to Bulgarian.
 */
export const RegenerateDismissedChangesNothing: Story = {
  tags: ['ai-language-regression'],
  args: {
    propertyDefaultReplyLanguage: 'bg-Cyrl',
    reviewReplyLanguage: 'en-Latn-US',
    reviewLanguageReadiness: 'detectable',
    onGenerateSuggestion: onGenerateByTarget,
  },
  play: async ({ canvas }) => {
    await openMenu('AI tone and language: Professional, Bulgarian')
    await userEvent.click(
      writeIn().getByRole('menuitem', { name: 'English · review language' }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    await userEvent.click(await canvas.findByRole('button', { name: /use draft/i }))
    const tag = await canvas.findByRole('button', { name: 'AI draft · English' })
    onSaveDraft.mockClear()
    onGenerateByTarget.mockClear()

    await userEvent.click(tag)
    await userEvent.click(
      await page().findByRole('menuitem', {
        name: 'Regenerate in Bulgarian · property default',
      }),
    )
    const preview = await canvas.findByRole('region', { name: 'Draft suggestion' })
    await waitFor(() => expect(preview).toHaveTextContent(BULGARIAN_TEMPLATE))
    expect(preview).toHaveTextContent(/Personalized AI suggestion\s*· Bulgarian/)
    expect(onGenerateByTarget).toHaveBeenCalledWith(
      'professional',
      { kind: 'property_default' },
      false,
      expect.any(String),
    )
    expect(canvas.queryByRole('button', { name: /^Reply language:/ })).toBeNull()

    await userEvent.click(within(preview).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'Draft suggestion' })).toBeNull(),
    )
    expect(canvas.getByRole('textbox')).toHaveValue(SUGGESTED_REPLY)
    expect(onSaveDraft).not.toHaveBeenCalled()
    expect(canvas.queryByRole('button', { name: /^Reply language:/ })).toBeNull()
    expect(
      canvas.getByRole('button', { name: 'AI tone and language: Professional, English' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'AI draft · English' }))
    await expect(
      page().findByRole('menuitem', {
        name: 'Regenerate in Bulgarian · property default',
      }),
    ).resolves.toBeVisible()
    await closeMenu()
  },
}

/**
 * Finding 9. `Use draft` from the keyboard unmounts the preview — and the
 * focused button with it — so the caret is put into the text the adoption
 * produced instead of falling to `<body>`.
 */
export const UseDraftReturnsTheCaretToTheText: Story = {
  args: { onGenerateSuggestion },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /draft with ai/i }))
    const useDraft = await canvas.findByRole('button', { name: /use draft/i })
    useDraft.focus()
    await userEvent.keyboard('{Enter}')
    const text = canvas.getByRole('textbox', { name: 'Public reply' })
    await waitFor(() => expect(text).toHaveValue(SUGGESTED_REPLY))
    await waitFor(() => expect(text).toHaveFocus())
  },
}

let resolveEnglishLibrary: ((result: ReplyTemplateListResult) => void) | undefined
/** The property list answers at once; the review-language list waits for the play. */
const onListEnglishLater = fn((target: ReplyLanguageTarget) =>
  target.kind === 'property_default'
    ? Promise.resolve(bulgarianLibrary())
    : new Promise<ReplyTemplateListResult>((resolve) => {
        resolveEnglishLibrary = resolve
      }),
)
const resolveEnglish = (result: ReplyTemplateListResult): void => {
  if (!resolveEnglishLibrary) throw new Error('The English list was never requested')
  resolveEnglishLibrary(result)
}

/**
 * Finding 1. Inside `Template ▾`: the Bulgarian list loads; `English` starts
 * the review-language fetch; a tap back on `Bulgarian` is answered from the
 * cache before English returns. The English fetch is discarded — and the
 * loading state with it. It used to stay `true` for good, which disabled the
 * textarea, Submit and every assist trigger until the manager left the item.
 */
export const TemplateSwitchBackWhileLoadingKeepsTheComposerLive: Story = {
  args: {
    initialText: TYPED_REPLY,
    initialLanguageTag: 'bg-Cyrl',
    propertyDefaultReplyLanguage: 'bg-Cyrl',
    reviewReplyLanguage: 'en-Latn-US',
    reviewLanguageReadiness: 'detectable',
    onListTemplates: onListEnglishLater,
  },
  play: async ({ canvas }) => {
    await openMenu(TEMPLATE_TRIGGER)
    await expect(
      page().findByRole('menuitem', { name: BULGARIAN_LIBRARY_TITLE }),
    ).resolves.toBeVisible()
    const switchGroup = () => within(page().getByRole('group', { name: 'Templates in' }))

    await userEvent.click(
      switchGroup().getByRole('menuitem', { name: 'English · review language' }),
    )
    await expect(
      page().findByRole('menuitem', { name: 'Loading property templates…' }),
    ).resolves.toBeVisible()
    await userEvent.click(
      switchGroup().getByRole('menuitem', { name: 'Bulgarian · property default' }),
    )
    await expect(
      page().findByRole('menuitem', { name: BULGARIAN_LIBRARY_TITLE }),
    ).resolves.toBeVisible()
    resolveEnglish({ profile: null, groups: [], recommendedTemplateId: null })
    await closeMenu()

    await waitFor(() => expect(canvas.getByRole('textbox')).toBeEnabled())
    expect(canvas.getByRole('button', { name: 'Template' })).toBeEnabled()
    expect(canvas.getByRole('button', { name: /^AI tone and language/ })).toBeEnabled()
    expect(canvas.queryByRole('button', { name: /^Reply language:/ })).toBeNull()
  },
}
