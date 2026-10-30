// Browser stub for #/contexts/review/server/reply-templates.
//
// use-reply-actions.ts loads the template and draft-check server functions with a
// dynamic import so they stay out of first paint. In the Storybook Vite build the
// real module would leak @tanstack/start-server-core (createServerFn and
// #/composition), exactly like #/contexts/review/server/reply, so it is aliased to
// the same scripted commands (see ./review-reply-server.ts and .storybook/main.ts).
export {
  checkReplyDraftFn,
  listReplyTemplatesFn,
  loadReplyTemplateFn,
} from './review-reply-server'
