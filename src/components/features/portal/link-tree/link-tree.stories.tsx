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

const meta: Meta<typeof LinkTree> = {
  title: 'Portal/LinkTree',
  component: LinkTree,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
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
