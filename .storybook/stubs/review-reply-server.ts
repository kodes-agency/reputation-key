// Browser stub for #/contexts/review/server/reply.
//
// The real module imports getContainer from #/composition + runs createServerFn,
// which leaks @tanstack/start-server-core into the preview bundle and breaks
// `pnpm build-storybook` (Missing "#tanstack-start-entry" specifier). This stub
// is aliased ONLY in the Storybook Vite build (see .storybook/main.ts
// viteFinal); tsc still resolves the real module for type-checking.
//
// Why it's safe: the sole value-importer is reply-form.tsx — the sanctioned
// 5+-mutation exception (CONTEXT.md:48) — which renders inside the inbox
// detail pane on review selection. The inbox-page story can reach it
// (InboxPageV2 → inbox-detail-content → ReplyEditor), but these no-ops return
// undefined gracefully; they exist primarily so the static import resolves in
// the browser bundle.
const noop = async () => undefined

export const draftReplyFn = noop
export const submitReplyFn = noop
export const approveReplyFn = noop
export const rejectReplyFn = noop
export const deleteReplyFn = noop
export const retryPublishFn = noop
export const editPublishedReplyFn = noop
export const getReplyFn = noop
