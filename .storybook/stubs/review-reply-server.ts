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
// open editor). These no-ops return undefined gracefully; they exist primarily
// so the static import resolves in the browser bundle.
const noop = async () => undefined

export const draftReplyFn = noop
export const submitReplyFn = noop
export const approveReplyFn = noop
export const rejectReplyFn = noop
export const deleteReplyFn = noop
export const retryPublishFn = noop
export const checkReplyPublicationFn = noop
export const editPublishedReplyFn = noop
export const listReplyTemplatesFn = noop
export const loadReplyTemplateFn = noop
export const getReplyFn = noop
