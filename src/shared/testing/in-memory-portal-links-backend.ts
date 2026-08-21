// Stateful in-memory stand-in for `#/contexts/portal/server/portal-links`.
//
// Used by the Storybook stub (.storybook/stubs/portal-links.ts, aliased over the
// real module in .storybook/main.ts viteFinal) and seeded by the stories that
// drive the link-tree CRUD flows.
//
// WHY IT HOLDS STATE INSTEAD OF ECHOING ITS INPUT
//
// `LinkTree` does not append created rows itself. It mirrors its props and
// relies on `invalidateKeys: [portalKeys.links(portalId)]` -> refetch -> new
// props -> the resync effect in `useLinkTreeState`. A create is therefore only
// observable if what the query reads back has actually CHANGED, which means the
// fake has to persist the write.
//
// An echoing stub (what this replaced) plus a story that passed static props
// made that loop unobservable: `AddCategory` went red the moment main's
// `useLinkTreeState` dropped its manual `setCategories` append, because nothing
// in the story could ever produce a second version of the tree.

export type FakePortalLinkCategory = Readonly<{
  id: string
  title: string
  sortKey: string
}>

export type FakePortalLink = Readonly<{
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}>

let categories: readonly FakePortalLinkCategory[] = []
let links: readonly FakePortalLink[] = []
let catSeq = 0
let linkSeq = 0
let wasReadBack = false

/** Reset and seed the fake. Call once per story, before it renders. */
export function seedPortalLinksBackend(
  seedCategories: readonly FakePortalLinkCategory[] = [],
  seedLinks: readonly FakePortalLink[] = [],
): void {
  categories = [...seedCategories]
  links = [...seedLinks]
  catSeq = 0
  linkSeq = 0
  wasReadBack = false
}

/**
 * Fresh arrays on every call, deliberately.
 *
 * `useLinkTreeState` resyncs its mirror on `[initialCategories]` IDENTITY, so
 * handing back the same array after a refetch would leave a created row
 * invisible even though the backend holds it.
 */
export function listPortalLinksFromBackend(): {
  categories: readonly FakePortalLinkCategory[]
  links: readonly FakePortalLink[]
} {
  wasReadBack = true
  return { categories: [...categories], links: [...links] }
}

/**
 * A write is only meaningful if something reads this backend back.
 *
 * If a future refactor unwires the story from
 * `useQuery(portalKeys.links(portalId))` and feeds `LinkTree` static props
 * again, the create flow becomes unobservable — exactly how the regression this
 * fake exists for went unnoticed.
 *
 * Reported through `console.error` and NOT only by throwing: a throw from here
 * happens inside `mutationFn`, so React Query catches it and the inline form
 * renders it as an ordinary "failed to create" banner — the diagnosis would be
 * swallowed and the play would fail with an unrelated array mismatch. The
 * console is the one channel the mutation cannot absorb, and
 * `test-storybook --failOnConsole` (how this repo runs the plays) turns it into
 * a failure that names the actual cause. The throw stays so the flow also stops
 * rather than half-completing.
 */
function assertReadBackFirst(operation: string): void {
  if (wasReadBack) return
  const message =
    `${operation}: nothing has read this fake backend, so the story is not ` +
    `wired to useQuery(portalKeys.links(portalId)). LinkTree only shows a ` +
    `created row via invalidate -> refetch -> the mirror resync in ` +
    `useLinkTreeState, so a story rendering static props cannot observe a ` +
    `create and must not be allowed to pass.`
  console.error(message)
  throw new Error(message)
}

export function createCategoryInBackend(title: string): FakePortalLinkCategory {
  assertReadBackFirst('createLinkCategory')
  const category = { id: `cat-stub-${++catSeq}`, title, sortKey: `sk-${catSeq}` }
  categories = [...categories, category]
  return category
}

export function createLinkInBackend(
  input: Readonly<{ categoryId: string; label: string; url: string }>,
): FakePortalLink {
  assertReadBackFirst('createLink')
  const link = {
    id: `link-stub-${++linkSeq}`,
    label: input.label,
    url: input.url,
    sortKey: `sk-${linkSeq}`,
    categoryId: input.categoryId,
  }
  links = [...links, link]
  return link
}
