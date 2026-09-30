// Browser stub for #/contexts/portal/server/portal-links.
//
// The real module uses createServerFn (@tanstack/react-start), which pulls
// @tanstack/start-server-core into the preview bundle — its virtual imports
// `#tanstack-router-entry` / `#tanstack-start-entry` are unresolved once the
// TanStack vite plugin is stripped in .storybook/main.ts viteFinal, breaking
// the whole `pnpm storybook` / `build-storybook` build. Any component that
// value-imports these fns (the Linktree section's mutations hook, and every
// page that composes the section: portal-detail, the editor) hits this.
//
// Aliased ONLY in the Storybook Vite build (.storybook/main.ts viteFinal); tsc
// still resolves the real module for type-checking.
//
// The writes resolve without doing anything: the Linktree stories that exercise
// behaviour hand the section stub actions of their own, so nothing here has to
// remember what was written.

const noop = async () => undefined

export const createLink = async () => ({ link: { id: 'story-new-link' } })
export const updateLink = noop
export const deleteLink = noop
export const reorderLinks = noop
export const savePortalLinkTexts = noop
export const saveLinktreeSettings = noop
export const listPortalLinks = async () => ({ categories: [], links: [] })
export const getPortalLinktree = noop
export const createLinkCategory = noop
export const updateLinkCategory = noop
export const deleteLinkCategory = noop
export const reorderCategories = noop
