import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Toaster } from '#/components/ui/sonner'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import {
  productUpdatesStoryState,
  productUpdatesStoryClient as client,
} from '../../../../.storybook/stubs/product-updates-server'
import { ProductUpdatePreferences } from './product-update-preferences'

const meta = {
  title: 'Product updates/Preferences',
  component: ProductUpdatePreferences,
  args: { getClient: async () => client },
  beforeEach: () => {
    productUpdatesStoryState.view = {
      entries: PRODUCT_UPDATES,
      unseenIds: PRODUCT_UPDATES.map(({ id }) => id),
      autoShow: true,
      shouldAutoOpen: false,
    }
    productUpdatesStoryState.failSave = false
  },
  render: () => (
    <>
      <ProductUpdatePreferences getClient={async () => client} />
      <Toaster />
    </>
  ),
} satisfies Meta<typeof ProductUpdatePreferences>
export default meta
type Story = StoryObj<typeof meta>
export const Saved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('switch', {
      name: 'Show updates automatically',
    })
    await userEvent.click(toggle)
    await expect(toggle).not.toBeChecked()
    await waitFor(() => expect(productUpdatesStoryState.view.autoShow).toBe(false))
    await expect(await canvas.findByText('Saved')).toBeVisible()
  },
}
export const SaveFailure: Story = {
  beforeEach: () => {
    productUpdatesStoryState.failSave = true
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('switch', {
      name: 'Show updates automatically',
    })
    await userEvent.click(toggle)
    await expect(toggle).not.toBeChecked()
    await waitFor(() => expect(toggle).toBeChecked())
    // In the document, not visible: a toast fades in, and its first frames are transparent.
    await expect(
      await within(canvasElement.ownerDocument.body).findByText(
        "Couldn't save your update preference. Try again.",
      ),
    ).toBeInTheDocument()
  },
}
