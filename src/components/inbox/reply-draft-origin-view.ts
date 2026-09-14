import type { ReplyDraftOrigin } from './reply-draft-origin'
import type { ReplyLanguageMenuEntry } from './reply-assist-language'
import {
  equivalentReplyLanguageTags,
  languageDisplayName,
} from './reply-language-options'

/*
 * Plan v2.1 row 18 — the words of the result tag at the top of the dock's
 * text row, and the choices its menu offers. Pure, so both are tested without
 * a DOM and the component (`reply-draft-origin-tag.tsx`) only lays them out.
 *
 * WHY the tag names the language at all: the language left the chrome
 * (row 17). It only ever chose between the property default and the review's
 * language (`reply-language-options.ts`, `ReplyLanguageTarget` is exactly
 * `property_default | review_language`), and only the two assist actions read
 * it — the template library is filtered by the target's `templateGroup`
 * (`reply-template-operations.ts:137`) and a loaded template stamps
 * `replyLanguageTag` on the draft (`:304`); an accepted AI draft is stamped the
 * same way (`ai-suggested-draft-store.ts:360`); a hand-typed draft only RECORDS
 * the tag (`reply-operations.ts:325`) and nothing reads it at publish. So once
 * the select is gone, the one place a manager still needs to SEE the language
 * is on text an assist action produced — and that is exactly what this tag
 * sits on, and nothing else.
 */

/**
 * The tag as three parts. `kind` is the lead word, printed at full weight;
 * `title` and `language` follow it after middle dots in quieter ink — the
 * canvas's `.aitag` (`AI draft` then `· Bulgarian` in tertiary).
 *
 * A part is `null` when there is nothing true to print, never a placeholder:
 * `Local safe template` has no library id and therefore no title
 * (`replyDraftOrigin`, `reply-draft-origin.ts`), a library id the list did not
 * contain resolves to no title (`templateTitleIn`, `use-reply-template.ts`),
 * and an AI draft reloaded from a reply saved without a tag has no language.
 * Row 18: those read `Template · Bulgarian`, `AI draft`.
 */
export type ReplyDraftOriginParts = Readonly<{
  kind: 'AI draft' | 'Template'
  title: string | null
  language: string | null
}>

export function replyDraftOriginParts(origin: ReplyDraftOrigin): ReplyDraftOriginParts {
  const language = languageDisplayName(origin.languageTag)
  if (origin.kind === 'ai_draft') return { kind: 'AI draft', title: null, language }
  return { kind: 'Template', title: origin.title, language }
}

/** One row of the AI tag's menu: the language to act in, and what the row says. */
export type RegenerateChoice = Readonly<{
  tag: string
  /** `Regenerate in Turkish` — the action, and the accessible name's lead. */
  label: string
  /** `review language` — the quiet suffix, as the `Write in` rows print it. */
  source: string | null
}>

/**
 * The OTHER targets an AI draft can be regenerated in — row 18's
 * `AI draft · Bulgarian ▾`, whose items "regenerate in the other target".
 *
 * Built from the same entries `Write in` lists (`replyLanguageMenuEntries`), so
 * the two menus cannot disagree about which languages exist. Three kinds of
 * entry are left out, each because pressing it would do nothing or the wrong
 * thing:
 *
 * - The language the draft is ALREADY in AND that `Write in` still has
 *   selected, matched by language rather than by spelling
 *   (`equivalentReplyLanguageTags`; the AI boundary adopts a concrete tag such
 *   as `bg-Cyrl-BG` beside an option spelled `bg-Cyrl`). "Regenerate in
 *   Bulgarian" on a Bulgarian draft is `Draft with AI` again, which the foot
 *   row already offers — but only while the selection is still Bulgarian.
 *   Once `Write in` has moved to another language, `Draft with AI` drafts in
 *   THAT one, and this menu is the only way back to a fresh draft in the
 *   draft's own language, so the row stays. (It was filtered on the draft's
 *   language alone, and the PR 4 review found the result: after a selection
 *   change the tag's menu offered no way back.)
 * - A disabled entry (`Detect automatically` on a review too short to detect):
 *   its reason is printed where the choice is MADE, in `Write in`.
 * - A `saved draft` entry. It exists so a draft saved in a language that is
 *   neither the property's nor the review's still shows as selected, but it is
 *   not a TARGET — `targetForReplyLanguage` resolves it to `null`
 *   (`reply-language-options.ts`), and `ai.request` returns without generating
 *   when the target is `null` (`use-reply-suggestion.ts`). A row that silently
 *   does nothing is worse than no row.
 *
 * `Detect automatically` keeps a row when it is enabled: it is a real target
 * (`review_language`), and it is the only way to ask for the review's language
 * before that language is known.
 */
export function regenerateChoices(
  entries: ReadonlyArray<ReplyLanguageMenuEntry>,
  draftLanguageTag: string | null,
): ReadonlyArray<RegenerateChoice> {
  return entries
    .filter((entry) => entry.disabledReason === null)
    .filter((entry) => entry.source !== 'saved draft')
    .filter(
      (entry) =>
        !(entry.isSelected && equivalentReplyLanguageTags(entry.tag, draftLanguageTag)),
    )
    .map((entry) =>
      entry.source === null
        ? { tag: entry.tag, label: 'Regenerate in the review’s language', source: null }
        : { tag: entry.tag, label: `Regenerate in ${entry.name}`, source: entry.source },
    )
}
