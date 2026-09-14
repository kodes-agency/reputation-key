import type { LoadedReplyTemplate } from './use-reply-template'

/**
 * What the composer's current draft was produced from — row 18's result tag.
 * `AI draft · Bulgarian`, `Template · <title> · Bulgarian`, or, with no
 * resolvable title, `Template · Bulgarian`. The display name is
 * `languageDisplayName(languageTag)`; the tag omits it when that is `null`.
 */
export type ReplyDraftOrigin =
  | Readonly<{ kind: 'ai_draft'; languageTag: string | null }>
  | Readonly<{
      kind: 'template'
      /** `null` for a local safe template, which has no library id. */
      templateId: string | null
      title: string | null
      languageTag: string | null
    }>

/** One adoption this mount made: which path, in which language, from what. */
export type ReplyDraftAdoption = Readonly<{
  kind: 'personalized' | 'local_fallback' | 'library_template'
  languageTag: string | null
  template: LoadedReplyTemplate | null
}>

/**
 * Resolves the result tag from the last adoption this mount made.
 *
 * The language is the one the text was ADOPTED in, not `draft.languageTag`.
 * Row 17's menus call `updateLanguage` before the action, and `updateLanguage`
 * rewrites the draft's tag while the text is still the previous adoption's; if
 * the new request then fails or its preview is dismissed, the draft's tag names
 * a language the text is not written in, and a tag reading it would say so.
 *
 * `local_fallback` is a template. It is what `Local safe template` loads
 * (`use-reply-template.ts` `loadLocalSafe` → the composer's `onLoadLocalSafe`,
 * `ai.request(undefined, true)`) and what a `Draft with AI` that could not
 * personalise returns instead — `reply-suggestion-preview.tsx` titles both
 * `Local safe starting point`. It has no library id, so no title.
 *
 * Provenance lives in this mount only; after a reload there is no template
 * tag, and that is intended rather than a gap. The server does keep a
 * `templateId` on the reply (`reply-operations.ts:328`, and `ReplyView`
 * carries it to the client, `reply-lookup.port.ts:28`), but it is not the
 * draft's provenance: a hand-typed save sends no `templateId`
 * (`use-reply-actions.ts:101`), the update spreads it only when present, and so
 * the id survives every later edit — it names the template the draft last
 * started from, whatever the text now says. The AI tag, by contrast, does
 * survive a reload: every save that is not an AI acceptance writes
 * `aiGenerated: false` (`reply-operations.ts:336`), so a saved `true` still
 * describes the text, and the saved tag is the one the AI store stamped
 * (`ai-suggested-draft-store.ts:360`).
 *
 * Within a mount the template tag follows `hasAiDraft` exactly: an adoption
 * sets it, the next adoption replaces it, and a hand edit does not clear it.
 * `Undo` RESTORES it: the composer's history keeps each draft together with
 * its adoption (`ReplyComposerSnapshot`, `reply-composer-transitions.ts`), so
 * undoing back to the manager's own text brings back no tag at all, and undoing
 * back to a template brings back that template's. It used to leave the tag of
 * the draft being undone over the restored text — `AI draft · Turkish` over a
 * hand-typed Bulgarian reply (PR 4 review).
 */
export function replyDraftOrigin(
  input: Readonly<{
    hasAiDraft: boolean
    adoption: ReplyDraftAdoption | null
    savedLanguageTag: string | null
  }>,
): ReplyDraftOrigin | null {
  const { adoption } = input
  if (adoption === null) {
    return input.hasAiDraft
      ? { kind: 'ai_draft', languageTag: input.savedLanguageTag }
      : null
  }
  if (adoption.kind === 'personalized') {
    return { kind: 'ai_draft', languageTag: adoption.languageTag }
  }
  return {
    kind: 'template',
    templateId: adoption.template?.templateId ?? null,
    title: adoption.template?.title ?? null,
    languageTag: adoption.languageTag,
  }
}
