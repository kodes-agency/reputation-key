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
// still resolves the real module for type-checking. listPortalLinks returns
// empty data (empty states render); createLinkCategory/createLink echo their
// inputs so the link-tree add-category/add-link flow works end-to-end in stories.
const noop = async () => undefined
const noopList = async () => ({ categories: [], links: [] })
let catSeq = 0
let linkSeq = 0

export const createLink = async (input: {
  data: { categoryId: string; portalId: string; label: string; url: string }
}) => ({
  link: {
    id: `link-stub-${++linkSeq}`,
    label: input.data.label,
    url: input.data.url,
    sortKey: `sk-${linkSeq}`,
    categoryId: input.data.categoryId,
  },
})
export const updateLink = noop
export const deleteLink = noop
export const reorderLinks = noop
export const listPortalLinks = noopList
export const createLinkCategory = async (input: {
  data: { portalId: string; title: string }
}) => ({
  category: {
    id: `cat-stub-${++catSeq}`,
    title: input.data.title,
    sortKey: `sk-${catSeq}`,
  },
})
export const updateLinkCategory = noop
export const deleteLinkCategory = noop
export const reorderCategories = noop
