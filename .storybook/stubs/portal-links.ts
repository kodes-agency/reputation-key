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
// still resolves the real module for type-checking.
//
// The create/list fns are backed by a STATEFUL fake rather than echoing their
// inputs, because LinkTree shows a created row only through
// invalidate -> refetch -> the mirror resync in useLinkTreeState. See
// src/shared/testing/in-memory-portal-links-backend.ts for the full reasoning.
// The backend starts EMPTY, so pages that merely compose LinkTree keep
// rendering their empty states; the link-tree stories seed it explicitly.
import {
  createCategoryInBackend,
  createLinkInBackend,
  listPortalLinksFromBackend,
  seedPortalLinksBackend,
} from '../../src/shared/testing/in-memory-portal-links-backend'

/** The seam the link-tree stories drive the fake through. */
export type PortalLinksFake = Readonly<{
  seed: typeof seedPortalLinksBackend
  read: typeof listPortalLinksFromBackend
}>

// Published on globalThis instead of imported by the stories, deliberately.
//
// A story under src/components/** is a `components` element, and eslint
// `boundaries/dependencies` forbids components -> test-helpers
// (src/shared/testing/**) on purpose: production components must not reach for
// test doubles. The real server module has no seed export either, so tsc would
// reject a direct import of one. This stub is the only file that legitimately
// sits on both sides of that line, so it hands the fake over here rather than
// anyone loosening the boundary for a story's convenience.
//
// Unchecked cast: widening the preview's own global to declare the property this
// module is about to define. Nothing external is being trusted.
const previewGlobal = globalThis as typeof globalThis & {
  __portalLinksFake?: PortalLinksFake
}
previewGlobal.__portalLinksFake = {
  seed: seedPortalLinksBackend,
  read: listPortalLinksFromBackend,
}

const noop = async () => undefined

export const createLink = async (input: {
  data: { categoryId: string; portalId: string; label: string; url: string }
}) => ({
  link: createLinkInBackend(input.data),
})
export const updateLink = noop
export const deleteLink = noop
export const reorderLinks = noop
export const listPortalLinks = async () => listPortalLinksFromBackend()
export const createLinkCategory = async (input: {
  data: { portalId: string; title: string }
}) => ({
  category: createCategoryInBackend(input.data.title),
})
export const updateLinkCategory = noop
export const deleteLinkCategory = noop
export const reorderCategories = noop
