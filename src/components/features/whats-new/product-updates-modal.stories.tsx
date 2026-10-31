import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import { ProductUpdatesModal } from './product-updates-modal'

const meta = {
  title: 'Product updates/Modal',
  component: ProductUpdatesModal,
  args: {
    highlights: PRODUCT_UPDATES.filter((e) => e.kind === 'highlight'),
    fixes: [],
    propertyId: '00000000-0000-4000-8000-000000000001',
    onClose: fn(),
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProductUpdatesModal>
export default meta
type Story = StoryObj<typeof meta>

export const HighlightsOnly: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    // The dialog fades in: its first frame is transparent, so wait for it to be seen.
    await waitFor(() =>
      expect(page.getByRole('dialog', { name: "What's new" })).toBeVisible(),
    )
    await expect(page.getAllByRole('link', { name: /Show me/ })).toHaveLength(3)
    await expect(
      page.queryByRole('button', { name: /Also fixed/ }),
    ).not.toBeInTheDocument()
  },
}
export const WithFixes: Story = {
  args: { fixes: PRODUCT_UPDATES.filter((e) => e.kind === 'fix') },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    const disclosure = page.getByRole('button', { name: 'Also fixed (3)' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(disclosure)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(page.getByText('Pages no longer jump while they load')).toBeVisible(),
    )
    await userEvent.click(page.getByRole('button', { name: 'Close' }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}
export const Phone: Story = {
  ...WithFixes,
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
}
export const Light: Story = { ...WithFixes, parameters: { theme: 'light' } }
export const WithoutProperty: Story = {
  args: { propertyId: null },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getAllByRole('link', { name: /Show me/ })).toHaveLength(1)
  },
}
