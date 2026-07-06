// Browser stub for #/contexts/portal/server/portal-links.
//
// The real module uses createServerFn (@tanstack/react-start), which pulls
// @tanstack/start-server-core into the preview bundle — its virtual imports
// `#tanstack-router-entry` / `#tanstack-start-entry` are unresolved once the
// TanStack vite plugin is stripped in .storybook/main.ts viteFinal, breaking
// the whole `pnpm storybook` / `build-storybook` build. Any component that
// value-imports these fns (link-tree → useLinkTreeMutations, plus every page
// that composes LinkTree: portal-detail, portal-settings) hits this.
//
// Aliased ONLY in the Storybook Vite build (.storybook/main.ts viteFinal); tsc
// still resolves the real module for type-checking. The no-ops return empty
// data so consumers render their empty/loading states in stories; they exist
// primarily so the static import resolves without leaking server code.
const noop = async () => undefined
const noopList = async () => ({ categories: [], links: [] })

export const createLink = noop
export const updateLink = noop
export const deleteLink = noop
export const reorderLinks = noop
export const listPortalLinks = noopList
export const createLinkCategory = noop
export const updateLinkCategory = noop
export const deleteLinkCategory = noop
export const reorderCategories = noop
