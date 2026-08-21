// Link tree — full CRUD for categories + links with DnD support.
//
// Renders in the Storybook preview thanks to two infra pieces:
//  - `.storybook/stubs/portal-links.ts` (aliased in main.ts viteFinal) stubs the
//    8 server fns useLinkTreeMutations value-imports — the real module leaks
//    @tanstack/start-server-core into the browser. The create fns echo their
//    inputs so the add-category/add-link flow works end-to-end here.
//  - The global RouterDecorator provides `/_authenticated` with the owner role,
//    so usePermissions() (LinkTree + children call it) resolves.
// DnD is a client lib and renders fine; this story asserts render + the
// add-category flow only (no real drag).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { LinkTree } from './link-tree'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'
import { useQuery } from '@tanstack/react-query'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { portalKeys } from '#/shared/queries/query-keys'

// Scopes assertions to ONE category card, which is what makes the per-category
// grouping (`links.filter(l => l.categoryId === cat.id)` in
// link-tree-category-list) assertable rather than just "the label is somewhere
// on the page". SortableCategory's root is the nearest `rounded-lg` div ancestor
// of the title: the wrappers in between are plain flex rows, link rows use
// `rounded-md`, and LinkTree's own card is a <section>.
function categoryCard(canvasElement: HTMLElement, title: string) {
  const card = within(canvasElement)
    .getByRole('heading', { name: title, level: 3 })
    .closest('div.rounded-lg')
  if (!(card instanceof HTMLElement)) {
    throw new Error(`no category card wraps the "${title}" heading`)
  }
  return within(card)
}

// Renders LinkTree the way the route does: its props ARE the
// `portalKeys.links(portalId)` query data ($portalId.tsx portalLinksQuery).
//
// This wrapper is load-bearing, not ceremony. LinkTree does not append created
// rows itself — `useLinkTreeState` mirrors its props and waits for
// invalidate -> refetch -> new props. Feeding it the story's args directly (what
// this file used to do) freezes the tree, so `AddCategory` could never see the
// row it creates. Going through the query is what makes the create observable.
type LinkTreeQueryData = Readonly<{
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
}>

// The fake backend behind the Storybook stub, reached through the global seam
// the stub publishes (.storybook/stubs/portal-links.ts).
//
// Not imported: this file is a `components` element and eslint
// `boundaries/dependencies` forbids components -> test-helpers, which is the
// right rule — production components must not reach for test doubles. Throwing
// when the seam is absent means a story run outside Storybook fails saying so,
// rather than rendering an empty tree and blaming the component.
type PortalLinksFake = Readonly<{
  seed: (
    categories?: readonly LinkTreeCategory[],
    links?: readonly LinkTreeLink[],
  ) => void
  read: () => LinkTreeQueryData
}>

function portalLinksFake(): PortalLinksFake {
  const { __portalLinksFake: fake } = globalThis as typeof globalThis & {
    __portalLinksFake?: PortalLinksFake
  }
  if (!fake) {
    throw new Error(
      'portalLinksFake: .storybook/stubs/portal-links.ts has not published the ' +
        'fake backend. These stories only run under the Storybook build, whose ' +
        'viteFinal aliases that stub over #/contexts/portal/server/portal-links.',
    )
  }
  return fake
}

function LinkTreeFromLinksQuery({ portalId }: { portalId: string }) {
  const { data } = useQuery<LinkTreeQueryData>({
    queryKey: portalKeys.links(portalId),
    // Narrowed to the view shape the component consumes, so the story is not
    // coupled to the repository row types behind the server fn.
    queryFn: async () => {
      const tree = await listPortalLinks({ data: { portalId } })
      return { categories: tree.categories, links: tree.links }
    },
    // The first paint must ALREADY hold the seeded tree: `Default` asserts the
    // heading list synchronously, so a loading tick would render nothing. This
    // also means an unwired story never touches the fake backend, which is what
    // makes the create throw instead of silently passing.
    initialData: () => portalLinksFake().read(),
  })

  return <LinkTree portalId={portalId} categories={data.categories} links={data.links} />
}

const meta: Meta<typeof LinkTree> = {
  title: 'Portal/LinkTree',
  component: LinkTree,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  // The args are the SEED for the fake backend, not props handed straight to
  // the component — the query below is the only path data reaches LinkTree by,
  // so an unwired story goes red instead of quietly passing on static props.
  // Reset on the way OUT too: the fake is module state shared by the whole
  // preview, and the stories that merely COMPOSE LinkTree (portal-detail,
  // portal-settings) expect an empty backend. Without this, whether they see an
  // empty tree depends on story order.
  beforeEach: ({ args }) => {
    portalLinksFake().seed(args.categories, args.links)
    return () => portalLinksFake().seed()
  },
  render: (args) => <LinkTreeFromLinksQuery portalId={args.portalId} />,
  decorators: [
    (Story) => (
      <div className="w-[480px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof LinkTree>

const categories: readonly LinkTreeCategory[] = [
  { id: 'cat-1', title: 'Review sites', sortKey: 'a0' },
  { id: 'cat-2', title: 'Social media', sortKey: 'b0' },
]

const links: readonly LinkTreeLink[] = [
  {
    id: 'link-1',
    label: 'Google Reviews',
    url: 'https://google.com',
    sortKey: 'a0',
    categoryId: 'cat-1',
  },
  {
    id: 'link-2',
    label: 'Yelp',
    url: 'https://yelp.com',
    sortKey: 'a1',
    categoryId: 'cat-1',
  },
  {
    id: 'link-3',
    label: 'Instagram',
    url: 'https://instagram.com',
    sortKey: 'b0',
    categoryId: 'cat-2',
  },
]

// Seeded tree: two categories with links, the CategoryAddForm visible (owner).
export const Default: Story = {
  args: { portalId: 'portal-1', categories, links },
  // Restores the play deleted in eef8c716 ("simplify … to pass vitest
  // storybook"). Asserts the SEEDED TREE, not that something mounted: both
  // categories in sortKey order, and each link under its own category. The
  // negative checks are the discriminating half — a broken categoryId filter
  // renders every link under every category, which a presence-only assertion
  // cannot see. axe stays enabled (BQC-6.8).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(
      canvas.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual(['Review sites', 'Social media'])

    const reviewSites = categoryCard(canvasElement, 'Review sites')
    await expect(reviewSites.getByText('Google Reviews')).toBeVisible()
    await expect(reviewSites.getByText('https://google.com')).toBeVisible()
    await expect(reviewSites.getByText('Yelp')).toBeVisible()
    expect(reviewSites.queryByText('Instagram')).toBeNull()

    const social = categoryCard(canvasElement, 'Social media')
    await expect(social.getByText('Instagram')).toBeVisible()
    await expect(social.getByText('https://instagram.com')).toBeVisible()
    expect(social.queryByText('Google Reviews')).toBeNull()

    // The seeded tree rendered, so the empty-state affordance must not be.
    expect(canvas.queryByText(/No categories yet/)).toBeNull()
  },
}

// Empty tree renders the empty-state affordance.
export const Empty: Story = {
  args: { portalId: 'portal-1', categories: [], links: [] },
}

// Add-category flow: type a name → submit → the new category appears.
// (The stubbed createLinkCategory echoes the input title.)
export const AddCategory: Story = {
  args: { portalId: 'portal-1', categories, links },
  // Restores the play deleted in eef8c716. Drives the real flow through
  // CategoryAddForm → useLinkTreeState.handleAddCategory →
  // useActionMutation(createLinkCategory) → the stub, which echoes the title.
  // The discriminating assertion is the heading LIST: the new category must be
  // APPENDED, so a handler that replaces the tree, drops the result, or
  // double-submits fails here where a lone `findByText('Feedback')` would pass.
  // axe stays enabled (BQC-6.8).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const input = canvas.getByPlaceholderText('New category name')
    await userEvent.type(input, 'Feedback')

    const submit = canvas.getByRole('button', { name: /add category/i })
    await expect(submit).toBeEnabled()
    await userEvent.click(submit)

    await waitFor(() =>
      expect(
        canvas.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
      ).toEqual(['Review sites', 'Social media', 'Feedback']),
    )

    // A category created through the form starts with no links — proves we
    // asserted the NEW card, not a stray match on the seeded ones.
    await expect(
      categoryCard(canvasElement, 'Feedback').getByText(/No links yet/),
    ).toBeVisible()

    // The form clears only after the mutation resolves (CategoryAddForm awaits
    // onSubmit before setTitle('')), so this witnesses a settled create rather
    // than an optimistic paint.
    await waitFor(() => expect(input).toHaveValue(''))
  },
}
