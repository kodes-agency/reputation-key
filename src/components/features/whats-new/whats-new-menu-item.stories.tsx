import type { Meta, StoryObj } from '@storybook/react'
import { expect, waitFor, within } from 'storybook/test'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Button } from '#/components/ui/button'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import {
  productUpdatesStoryState,
  productUpdatesStoryClient as client,
} from '../../../../.storybook/stubs/product-updates-server'
import { WhatsNewMenuItem } from './whats-new-menu-item'

const meta = {
  title: 'Product updates/Account menu',
  component: WhatsNewMenuItem,
  args: { getClient: async () => client },
  beforeEach: () => {
    productUpdatesStoryState.reads = 0
    productUpdatesStoryState.view = {
      entries: PRODUCT_UPDATES,
      unseenIds: PRODUCT_UPDATES.map(({ id }) => id),
      autoShow: false,
      shouldAutoOpen: false,
    }
  },
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button>Account menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <WhatsNewMenuItem getClient={async () => client} />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
} satisfies Meta<typeof WhatsNewMenuItem>
export default meta
type Story = StoryObj<typeof meta>
export const WithDot: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const item = await page.findByRole('menuitem', { name: /What's new.*Unseen updates/ })
    await waitFor(() => expect(item).toBeVisible())
  },
}
export const WithoutDot: Story = {
  beforeEach: () => {
    productUpdatesStoryState.view = { ...productUpdatesStoryState.view, unseenIds: [] }
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    // Judge the item only once the page has asked for the view: before that, no dot is no news.
    await waitFor(() => expect(productUpdatesStoryState.reads).toBe(1))
    const item = await page.findByRole('menuitem', { name: "What's new" })
    await waitFor(() => expect(item).toBeVisible())
  },
}
