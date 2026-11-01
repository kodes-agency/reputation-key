import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import { PageGutterDecorator } from '../../../../.storybook/PageGutterDecorator'
import {
  productUpdatesStoryState,
  productUpdatesStoryClient as client,
} from '../../../../.storybook/stubs/product-updates-server'
import { ProductUpdatesHistory } from './product-updates-history'

const meta = {
  title: 'Product updates/History',
  component: ProductUpdatesHistory,
  args: { getClient: async () => client },
  parameters: { layout: 'fullscreen' },
  decorators: [PageGutterDecorator],
  beforeEach: () => {
    productUpdatesStoryState.view = {
      entries: PRODUCT_UPDATES,
      unseenIds: PRODUCT_UPDATES.map(({ id }) => id),
      autoShow: false,
      shouldAutoOpen: false,
    }
  },
} satisfies Meta<typeof ProductUpdatesHistory>
export default meta
type Story = StoryObj<typeof meta>
export const AllUpdates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'October 2026' }),
    ).toBeVisible()
    await expect(canvas.getAllByRole('article')).toHaveLength(PRODUCT_UPDATES.length)
    // Every update shows its own day under the month. Registry dates never change.
    await expect(canvasElement.querySelectorAll('article time')).toHaveLength(
      PRODUCT_UPDATES.length,
    )
    await expect(
      canvasElement.querySelector('article time[datetime="2026-10-31"]'),
    ).toHaveTextContent('Oct 31')
  },
}
export const Phone: Story = {
  ...AllUpdates,
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
}
