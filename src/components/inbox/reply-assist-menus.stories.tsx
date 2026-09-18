// The dock's assist tools — `Draft with AI ▾`, `Template ▾`, the quick AI
// actions, `Undo` and the error line — rendered through
// `ReplySuggestionControls` on their own.
//
// Plan v2.1 rows 17-18: the reply language left the composer chrome and lives
// inside both menus (`Write in` under `Tone`; `Templates in` at the top of the
// template list), and the `Property reply language not set` alert became a row
// in each. The template switch is narrowed to languages the library can
// actually filter (`templateLanguageOptions`). These stories prove the menus'
// STRUCTURE and BEHAVIOUR — roles,
// names, `aria-current`, what a pick calls and what it does not — without the
// composer around them, so they hold while `reply-editor-compose.tsx` is being
// rewired and keep holding after.
//
// The Storybook Vitest project compiles no Tailwind (contract), so the phone
// collapse — both primaries to 36 px glyph squares with their words `sr-only`
// — is inert here and no play asserts a class or a pixel. What a 390 twin
// DOES prove is the claim worth making: nothing is removed below `md`, the
// words stay in the DOM as the accessible names, so the same plays pass.
//
// The composer's `languageChoices` is a stateful value (`use-reply-composer.ts`,
// `ReplyLanguageChoices`); `Harness` stands in for it with the same shape — the
// real `replyLanguageOptions`, a selected tag in state, and an `updateLanguage`
// that returns the scope it committed, built from the real
// `targetForReplyLanguage`.
import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  replyLanguageOptions,
  targetForReplyLanguage,
} from './reply-language-options'
import { ReplySuggestionControls } from './reply-suggestion-controls'
import type { ReplyLanguageChoices } from './use-reply-composer'

const PANE_WIDTH_PX = 720
const PHONE_WIDTH_PX = 390
const PHONE = {
  paneWidth: PHONE_WIDTH_PX,
  viewport: { defaultViewport: 'mobileStaff' },
} as const

const BULGARIAN = 'bg-Cyrl'
const TURKISH = 'tr-Latn-TR'

type TemplateOption = Readonly<{ id: string; title: string }>

/**
 * The library per language. The harness hands the controls the list for the
 * SELECTED language, which is what `useReplyTemplate().templates` does once
 * the reload a switch triggers has landed — so a play can watch the list below
 * the switch re-scope.
 */
const TEMPLATES_BY_TAG: Readonly<Record<string, ReadonlyArray<TemplateOption>>> = {
  [BULGARIAN]: [{ id: 'tpl-bg-1', title: 'Благодарност за чистотата' }],
  [TURKISH]: [{ id: 'tpl-tr-1', title: 'Temizlik için teşekkürler' }],
}

type HarnessProps = Omit<
  ComponentProps<typeof ReplySuggestionControls>,
  'languageChoices' | 'templates' | 'templateLanguageTag'
> &
  Readonly<{
    propertyTag: string | null
    reviewTag: string | null
    /** Whether `reviewTag` came from the server (`true`) or an AI detection. */
    isReviewLanguageRecorded: boolean
    initialTag: string | null
    /** Spy: every tag `updateLanguage` was called with. */
    onUpdateLanguage: (languageTag: string) => void
  }>

function Harness({
  propertyTag,
  reviewTag,
  isReviewLanguageRecorded,
  initialTag,
  onUpdateLanguage,
  ...controls
}: HarnessProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag)
  const readiness = controls.reviewLanguageReadiness
  const languageChoices: ReplyLanguageChoices = {
    options: replyLanguageOptions({
      propertyTag,
      reviewTag,
      savedTag: null,
      reviewLanguageReadiness: readiness,
    }),
    selectedTag,
    isAutoDetecting: selectedTag === AUTO_DETECT_REVIEW_LANGUAGE,
    isReviewLanguageRecorded,
    updateLanguage: (languageTag) => {
      onUpdateLanguage(languageTag)
      setSelectedTag(languageTag)
      const isAutoDetecting = languageTag === AUTO_DETECT_REVIEW_LANGUAGE
      return {
        draft: { text: '', languageTag: isAutoDetecting ? null : languageTag },
        target: targetForReplyLanguage(languageTag, propertyTag, reviewTag, readiness),
      }
    },
  }
  const templates = selectedTag === null ? [] : (TEMPLATES_BY_TAG[selectedTag] ?? [])
  return (
    <ReplySuggestionControls
      {...controls}
      languageChoices={languageChoices}
      templates={templates}
      templateLanguageTag={templates.length > 0 ? selectedTag : null}
    />
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Inbox/Composer/Assist menus',
  component: Harness,
  parameters: { layout: 'fullscreen', paneWidth: PANE_WIDTH_PX },
  decorators: [
    (Story, { parameters }) => (
      <div
        style={{
          width:
            typeof parameters.paneWidth === 'number'
              ? parameters.paneWidth
              : PANE_WIDTH_PX,
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    // Hotel Elegance: a Turkish review, a Bulgarian property default.
    propertyTag: BULGARIAN,
    reviewTag: TURKISH,
    isReviewLanguageRecorded: true,
    initialTag: BULGARIAN,
    reviewLanguageReadiness: 'detectable',
    primaryMode: 'ai',
    primaryExplanation:
      'AI drafting is recommended because this review has enough specific text.',
    tone: 'professional',
    disabled: false,
    aiDisabled: false,
    aiUnavailableReason: null,
    isGenerating: false,
    templateDisabled: false,
    templateUnavailableReason: null,
    isLoadingTemplate: false,
    propertyId: 'prop-elegance',
    hasAiDraft: false,
    canUndo: false,
    aiError: null,
    templateError: null,
    errorFixTarget: null,
    onUpdateLanguage: fn(),
    onToneChange: fn(),
    onRequestAi: fn(async () => undefined),
    onPrepareTemplateMenu: fn(),
    onLoadRecommended: fn(async () => undefined),
    onLoadTemplate: fn(async () => undefined),
    onLoadLocalSafe: fn(async () => undefined),
    onUndo: fn(),
  },
}
export default meta
type Story = StoryObj<typeof Harness>

// ─── helpers ─────────────────────────────────────────────────────────────────

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

const item = (name: string | RegExp) => page().getByRole('menuitem', { name })

// ─── Draft with AI ▾ ─────────────────────────────────────────────────────────

/**
 * The resting row on a detectable review: `Draft with AI` leads (it is the
 * recommended path), `Template` follows. The AI menu holds `Tone` and, below a
 * separator, `Write in` — the property default checked, the review's language
 * offered. Picking Turkish switches the language and DOES NOT draft: the
 * manager presses the button next (a menu that regenerated on pick would spend
 * an AI call on a mis-tap). The trigger's name follows the selection.
 */
export const WriteInSwitchesWithoutDrafting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const primaries = canvas
      .getAllByRole('button')
      .filter((button) =>
        ['Draft with AI', 'Template'].includes(button.textContent ?? ''),
      )
    await expect(primaries.map((button) => button.textContent)).toEqual([
      'Draft with AI',
      'Template',
    ])
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).toHaveAttribute(
      'title',
      args.primaryExplanation,
    )

    await openMenu('AI tone and language: Professional, Bulgarian')
    await expect(page().getByRole('group', { name: 'Tone' })).toBeVisible()
    const writeIn = within(page().getByRole('group', { name: 'Write in' }))
    await expect(writeIn.getAllByRole('menuitem').map((row) => row.textContent)).toEqual([
      'Bulgarian · property default',
      'Turkish · review language',
    ])
    await expect(item('Professional')).toHaveAttribute('aria-current', 'true')
    await expect(item('Bulgarian · property default')).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(item('Turkish · review language')).not.toHaveAttribute('aria-current')
    await expect(
      page().queryByRole('menuitem', { name: /property language/i }),
    ).toBeNull()

    await userEvent.click(item('Turkish · review language'))
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    await expect(args.onUpdateLanguage).toHaveBeenCalledOnce()
    await expect(args.onUpdateLanguage).toHaveBeenCalledWith(TURKISH)
    await expect(args.onRequestAi).not.toHaveBeenCalled()

    await openMenu('AI tone and language: Professional, Turkish')
    await expect(item('Turkish · review language')).toHaveAttribute(
      'aria-current',
      'true',
    )
    // Re-picking the selected language changes nothing and calls nothing.
    await userEvent.click(item('Turkish · review language'))
    await expect(args.onUpdateLanguage).toHaveBeenCalledTimes(1)
  },
}
export const WriteInSwitchesWithoutDrafting390: Story = {
  ...WriteInSwitchesWithoutDrafting,
  parameters: PHONE,
}

/**
 * A tone pick calls `onToneChange` and, like a language pick, drafts nothing.
 */
export const TonePickDraftsNothing: Story = {
  play: async ({ args }) => {
    await openMenu(AI_TRIGGER)
    await userEvent.click(item('Friendly'))
    await expect(args.onToneChange).toHaveBeenCalledOnce()
    await expect(args.onToneChange).toHaveBeenCalledWith('friendly')
    await expect(args.onRequestAi).not.toHaveBeenCalled()
  },
}

/**
 * AI drafting is blocked on the language itself. The PRIMARY half is
 * disabled and described by the reason; the CHEVRON stays enabled, because
 * the fix — a language — is inside its menu. Disabling both would lock the
 * only door to the fix.
 */
export const LanguageBlockKeepsMenuReachable: Story = {
  args: {
    initialTag: null,
    aiDisabled: true,
    aiUnavailableReason: 'Choose a supported reply language before drafting with AI.',
    templateDisabled: true,
    templateUnavailableReason:
      'Choose a supported reply language before loading a template.',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const draft = canvas.getByRole('button', { name: 'Draft with AI' })
    // Blocked with a reason is `aria-disabled`: it stays focusable so the
    // description below can be reached, and refuses the click.
    await expect(draft).toHaveAttribute('aria-disabled', 'true')
    await expect(draft).toHaveAccessibleDescription(
      'Choose a supported reply language before drafting with AI.',
    )
    const template = canvas.getByRole('button', { name: 'Template' })
    await expect(template).toHaveAttribute('aria-disabled', 'true')

    // Both stay in the tab order — that is the point of `aria-disabled` — and
    // both still refuse the click: the early return in each onClick is the only
    // thing standing between a blocked tool and its request.
    draft.focus()
    await expect(draft).toHaveFocus()
    await userEvent.click(draft)
    await expect(args.onRequestAi).not.toHaveBeenCalled()
    template.focus()
    await expect(template).toHaveFocus()
    await userEvent.click(template)
    await expect(args.onLoadRecommended).not.toHaveBeenCalled()

    const chevron = canvas.getByRole('button', {
      name: 'AI tone and language: Professional',
    })
    await expect(chevron).toBeEnabled()
    await openMenu(chevron.getAttribute('aria-label') ?? '')
    await userEvent.click(item('Bulgarian · property default'))
    await expect(args.onUpdateLanguage).toHaveBeenCalledOnce()
    await expect(args.onUpdateLanguage).toHaveBeenCalledWith(BULGARIAN)
    await expect(canvas.getByRole('button', { name: TEMPLATE_TRIGGER })).toBeEnabled()
  },
}
export const LanguageBlockKeepsMenuReachable390: Story = {
  ...LanguageBlockKeepsMenuReachable,
  parameters: PHONE,
}

/** Busy: both halves of both split buttons are disabled. */
export const Busy: Story = {
  args: { disabled: true, isGenerating: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Drafting…' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: AI_TRIGGER })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Template' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: TEMPLATE_TRIGGER })).toBeDisabled()
  },
}

// ─── the ghost `Reply language` control (row 17's fallback) ─────────────────

/**
 * The language, printed. After both tools — whichever leads — a GHOST button
 * reads `Bulgarian` with a globe and a chevron, named `Reply language:
 * Bulgarian · property default` (the visible word inside the name). It is not
 * a second primary and not an outline tool: it is the setting both tools
 * share. Its menu is the same rows as `Write in`; a pick switches the
 * language, drafts nothing, and the control reads the new language.
 */
/**
 * No default and nothing selected: the control says so in words and carries
 * the fix — the same `Set property language` row the two tool menus carry.
 */
// ─── Template ▾ ──────────────────────────────────────────────────────────────

/**
 * The template menu opens on its `Templates in` switch, then the list for the
 * selected language, then `Local safe template`. Opening fetches the list for
 * the current target (bare `onPrepareTemplateMenu()`). Switching to Turkish
 * calls `updateLanguage` and then `onPrepareTemplateMenu` WITH the scope it
 * returned — so the reload asks for the review language's library, not the one
 * just left — and the menu stays open while the list below re-scopes.
 */
export const TemplateSwitchReloadsTheList: Story = {
  args: {
    reviewLanguageReadiness: 'detectable',
    primaryMode: 'ai',
  },
  play: async ({ args }) => {
    await openMenu(TEMPLATE_TRIGGER)
    await expect(args.onPrepareTemplateMenu).toHaveBeenCalledOnce()
    await expect(args.onPrepareTemplateMenu).toHaveBeenCalledWith()

    const switchGroup = within(page().getByRole('group', { name: 'Templates in' }))
    await expect(
      switchGroup.getAllByRole('menuitem').map((segment) => segment.textContent),
    ).toEqual(['Bulgarian', 'Turkish'])
    await expect(item('Bulgarian · property default')).toHaveAttribute(
      'aria-current',
      'true',
    )
    const list = () =>
      within(page().getByRole('group', { name: /^Templates in (Bulgarian|Turkish)$/ }))
    await expect(
      list().getByRole('menuitem', { name: 'Благодарност за чистотата' }),
    ).toBeVisible()

    await userEvent.click(item('Turkish · review language'))
    await expect(args.onUpdateLanguage).toHaveBeenCalledOnce()
    await expect(args.onUpdateLanguage).toHaveBeenCalledWith(TURKISH)
    await expect(args.onPrepareTemplateMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { kind: 'review_language' } }),
    )

    await expect(item('Local safe template')).toBeVisible()
    await expect(item('Turkish · review language')).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(
      page().getByRole('group', { name: 'Templates in Turkish' }),
    ).toBeVisible()
    await expect(
      list().getByRole('menuitem', { name: 'Temizlik için teşekkürler' }),
    ).toBeVisible()
    await expect(
      page().queryByRole('menuitem', { name: 'Благодарност за чистотата' }),
    ).toBeNull()

    await userEvent.click(item('Temizlik için teşekkürler'))
    await expect(args.onLoadTemplate).toHaveBeenCalledOnce()
    await expect(args.onLoadTemplate).toHaveBeenCalledWith(
      'tpl-tr-1',
      'Temizlik için teşekkürler',
    )
  },
}
export const TemplateSwitchReloadsTheList390: Story = {
  ...TemplateSwitchReloadsTheList,
  parameters: PHONE,
}

/**
 * The switch lists only languages the template library can be FILTERED by. A
 * review language only an AI draft detected (not recorded by the server) and
 * automatic detection both resolve to the property default's templates on the
 * server, so neither is a segment — and with the property default alone there
 * is no switch. The list is headed by the language it was returned in.
 */
export const TemplateSwitchOnlyForListableLanguages: Story = {
  args: { isReviewLanguageRecorded: false },
  play: async () => {
    await openMenu(TEMPLATE_TRIGGER)
    await expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    await expect(page().queryByRole('menuitem', { name: /^Turkish/ })).toBeNull()
    const list = page().getByRole('group', { name: 'Templates in Bulgarian' })
    await expect(within(list).getByText('Templates in Bulgarian')).toBeVisible()
    await expect(
      within(list).getByRole('menuitem', { name: 'Благодарност за чистотата' }),
    ).toBeVisible()
    await closeMenu()
  },
}
export const TemplateSwitchOnlyForListableLanguages390: Story = {
  ...TemplateSwitchOnlyForListableLanguages,
  parameters: PHONE,
}

/** The loading row and the empty row survive the move. */
export const TemplateLoadingAndEmpty: Story = {
  args: { reviewTag: null, initialTag: 'de-Latn', isLoadingTemplate: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Loading…' }),
    ).toBeVisible()
    await openMenu(TEMPLATE_TRIGGER)
    await expect(item('Loading property templates…')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeMenu()
  },
}

// ─── no property default (row 18) ────────────────────────────────────────────

/**
 * No property default, a review too short to detect. The template path leads.
 * The standing alert is gone; its content is a row in BOTH menus. A manager
 * (`ai.manage`, the default AccountAdmin role here) gets `Set property
 * language`, a link to the AI settings for this property, described by the
 * readiness sentence that explains why the default matters in this state.
 * `Detect automatically` is disabled with its reason in its own name.
 */
export const NoDefaultManagerGetsTheFix: Story = {
  args: {
    propertyTag: null,
    reviewTag: null,
    initialTag: null,
    reviewLanguageReadiness: 'insufficient_language_evidence',
    primaryMode: 'template',
    primaryExplanation:
      'A template is recommended because this review is too short to identify its language.',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Property reply language not set')).toBeNull()
    const primaries = canvas
      .getAllByRole('button')
      .filter((button) =>
        ['Draft with AI', 'Template'].includes(button.textContent ?? ''),
      )
    await expect(primaries.map((button) => button.textContent)).toEqual([
      'Template',
      'Draft with AI',
    ])

    const reason =
      'This review is too short to detect its language. Set a property default to load a local template.'

    await openMenu(TEMPLATE_TRIGGER)
    const fixInTemplates = item('Set property language')
    await expect(fixInTemplates).toHaveAccessibleDescription(reason)
    await expect(fixInTemplates.getAttribute('href')).toContain('/settings/replies')
    await expect(fixInTemplates.getAttribute('href')).toContain(args.propertyId)
    await closeMenu()

    await openMenu(AI_TRIGGER)
    await expect(item('Set property language')).toHaveAccessibleDescription(reason)
    const auto = item(
      'Detect automatically — This review is too short to detect its language.',
    )
    await expect(auto).toHaveAttribute('aria-disabled', 'true')
    await closeMenu()
  },
}
export const NoDefaultManagerGetsTheFix390: Story = {
  ...NoDefaultManagerGetsTheFix,
  parameters: PHONE,
}

/**
 * The same state for a Member, who holds no `ai.manage`: the read-only
 * sentence instead of the link. It is `aria-disabled` but still reachable, and
 * choosing it neither navigates nor closes the menu.
 */
export const NoDefaultMemberReadsTheSentence: Story = {
  ...NoDefaultManagerGetsTheFix,
  decorators: [withRole('Member')],
  play: async () => {
    await openMenu(TEMPLATE_TRIGGER)
    await expect(
      page().queryByRole('menuitem', { name: 'Set property language' }),
    ).toBeNull()
    const sentence = item('Ask a manager to set this property’s reply language')
    await expect(sentence).toHaveAttribute('aria-disabled', 'true')
    await expect(sentence).toHaveAccessibleDescription(
      'This review is too short to detect its language. Set a property default to load a local template.',
    )
    await userEvent.click(sentence)
    await expect(page().getByRole('menu')).toBeVisible()
    await closeMenu()
  },
}
export const NoDefaultMemberReadsTheSentence390: Story = {
  ...NoDefaultMemberReadsTheSentence,
  parameters: PHONE,
}

/**
 * A detectable review with no default, auto-detecting: the sentence changes
 * to the one that says this draft still gets the review's language.
 */
export const NoDefaultWhileAutoDetecting: Story = {
  args: {
    propertyTag: null,
    reviewTag: null,
    initialTag: AUTO_DETECT_REVIEW_LANGUAGE,
    reviewLanguageReadiness: 'detectable',
  },
  play: async () => {
    await openMenu(AI_TRIGGER)
    await expect(item('Detect automatically')).toHaveAttribute('aria-current', 'true')
    await expect(item('Set property language')).toHaveAccessibleDescription(
      'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.',
    )
    await closeMenu()
  },
}

// ─── the row ─────────────────────────────────────────────────────────────────

/**
 * An adopted AI draft restores the two one-click rewrites beside the menus.
 * Undo and the actionable error line remain in the same row.
 */
export const UndoAndError: Story = {
  args: {
    canUndo: true,
    hasAiDraft: true,
    aiError: 'AI is off for this property.',
    errorFixTarget: 'ai_settings',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Friendlier' }))
    await expect(args.onRequestAi).toHaveBeenCalledWith('friendly')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRequestAi).toHaveBeenCalledWith()
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalledOnce()
    const status = canvas.getByRole('status')
    await expect(status).toHaveTextContent('AI is off for this property.')
    await expect(
      within(status).getByRole('link', { name: 'Enable AI replies' }),
    ).toBeVisible()
  },
}
export const UndoAndError390: Story = { ...UndoAndError, parameters: PHONE }
