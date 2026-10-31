// Browser stub for #/contexts/review/server/reply.
//
// The real module imports getContainer from #/composition + runs createServerFn,
// which leaks @tanstack/start-server-core into the preview bundle and breaks
// `pnpm build-storybook` (Missing "#tanstack-start-entry" specifier). This stub
// is aliased ONLY in the Storybook Vite build (see .storybook/main.ts
// viteFinal); tsc still resolves the real module for type-checking.
//
// Why it's safe: the sole value-importer is use-reply-actions.ts — the
// sanctioned 5+-mutation exception (src/components/CONTEXT.md "Server-function
// boundary", and the one inbox entry in scripts/check-component-boundaries.mjs).
// The pane now calls that hook from two places, so the inbox-page story reaches
// it on both paths (InboxPageV2 → inbox-detail-content directly for the
// approve/reject/check/retry family, and → ReplyEditor for the draft and the
// open editor). Every command answers undefined gracefully, except the draft
// save (`savedDraft`); the exports exist primarily so the static import
// resolves in the browser bundle.
//
// A story about what a command ANSWERS (a refusal, say) scripts that one
// command for its own run with `scriptReplyCommand`, so the story drives the
// real `useReplyActions` rather than a copy of its options.

type ReplyCommand = (input: unknown) => Promise<unknown>

type ReplyCommandName =
  | 'draftReplyFn'
  | 'submitReplyFn'
  | 'approveReplyFn'
  | 'rejectReplyFn'
  | 'deleteReplyFn'
  | 'retryPublishFn'
  | 'checkReplyPublicationFn'
  | 'editPublishedReplyFn'
  | 'listReplyTemplatesFn'
  | 'loadReplyTemplateFn'
  | 'checkReplyDraftFn'

const noop: ReplyCommand = async () => undefined

/**
 * What a draft save answers. The real `draftReplyFn` resolves the saved reply,
 * and `useReplyActions.saveDraft` reads its `id` and `stateRevision` (the
 * revision a submit's measurement is pinned to), so the no-op's `undefined`
 * rejects every save made through the real hook: an AI draft could never be
 * adopted. Only that identity is answered. A story that needs a whole reply in
 * the cache scripts one with `scriptReplyCommand`.
 */
const savedDraft: ReplyCommand = async () => ({
  id: 'storybook-reply',
  stateRevision: 1,
})

/** The commands a story scripted for its own run; every other one answers its default. */
const scripted = new Map<ReplyCommandName, ReplyCommand>()

/**
 * Script what one command answers. Returns the function that puts the default
 * back: a story's `beforeEach` returns it, so the script ends with the story.
 */
export function scriptReplyCommand(
  name: ReplyCommandName,
  answer: ReplyCommand,
): () => void {
  scripted.set(name, answer)
  return () => {
    scripted.delete(name)
  }
}

const command =
  (name: ReplyCommandName, unscripted: ReplyCommand = noop): ReplyCommand =>
  (input) =>
    (scripted.get(name) ?? unscripted)(input)

export const draftReplyFn = command('draftReplyFn', savedDraft)
export const submitReplyFn = command('submitReplyFn')
export const approveReplyFn = command('approveReplyFn')
export const rejectReplyFn = command('rejectReplyFn')
export const deleteReplyFn = command('deleteReplyFn')
export const retryPublishFn = command('retryPublishFn')
export const checkReplyPublicationFn = command('checkReplyPublicationFn')
export const editPublishedReplyFn = command('editPublishedReplyFn')
export const listReplyTemplatesFn = command('listReplyTemplatesFn')
export const loadReplyTemplateFn = command('loadReplyTemplateFn')
export const checkReplyDraftFn = command('checkReplyDraftFn')
