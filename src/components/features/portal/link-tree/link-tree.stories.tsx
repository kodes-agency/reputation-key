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
import { expect, userEvent, within } from 'storybook/test'
import { LinkTree } from './link-tree'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Review sites')).resolves.toBeInTheDocument()
    await expect(canvas.findByText('Google Reviews')).resolves.toBeInTheDocument()
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText('New category name'), 'Feedback')
    await userEvent.click(canvas.getByRole('button', { name: /add category/i }))
    await expect(await canvas.findByText('Feedback')).toBeInTheDocument()
  },
}
