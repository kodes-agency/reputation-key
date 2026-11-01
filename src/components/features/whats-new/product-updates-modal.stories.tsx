import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import { storyAiNoticeUpdate } from '../../../../.storybook/stubs/merchant-ai-notice-updates-server'
import { AiUpdateSection } from './ai-update-section'
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
    await expect(page.getAllByRole('link', { name: /Show me/ })).toHaveLength(
      PRODUCT_UPDATES.filter((e) => e.kind === 'highlight' && e.showMe).length,
    )
    await expect(
      page.queryByRole('button', { name: /Also fixed/ }),
    ).not.toBeInTheDocument()
    // Days belong to the history page's months; the modal is what changed lately.
    await expect(
      canvasElement.ownerDocument.querySelector('[role="dialog"] article time'),
    ).toBeNull()
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
    await expect(page.getAllByRole('link', { name: /Show me/ })).toHaveLength(
      PRODUCT_UPDATES.filter(
        (e) => e.kind === 'highlight' && e.showMe && !e.showMe.needsProperty,
      ).length,
    )
  },
}

/** What an AccountAdmin's modal leads with: the real shape of the server function's answer. */
const aiItem = <AiUpdateSection update={storyAiNoticeUpdate} onFollow={fn()} />

export const WithAiUpdate: Story = {
  args: { leadingItem: aiItem, fixes: PRODUCT_UPDATES.filter((e) => e.kind === 'fix') },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(page.getByRole('dialog', { name: "What's new" })).toBeVisible(),
    )
    const ai = page.getByRole('region', { name: 'AI update' })
    await expect(
      within(ai).getByRole('heading', { name: storyAiNoticeUpdate.title }),
    ).toBeVisible()
    await expect(within(ai).getAllByRole('listitem')).toHaveLength(
      storyAiNoticeUpdate.points.length,
    )
    await expect(
      within(ai).getByRole('link', { name: 'Read the full AI notice' }),
    ).toHaveAttribute('href', '/settings/ai')
    // It leads: it comes before the first highlight.
    const [firstHighlight] = page.getAllByRole('article')
    expect(
      ai.compareDocumentPosition(firstHighlight!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}
export const AiUpdatePhone: Story = {
  ...WithAiUpdate,
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
}
export const AiUpdateLight: Story = { ...WithAiUpdate, parameters: { theme: 'light' } }
/** An update with nothing else unseen: the modal is the AI update, and the way to the history. */
export const AiUpdateAlone: Story = {
  args: { leadingItem: aiItem, highlights: [], fixes: [] },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(page.getByRole('region', { name: 'AI update' })).toBeVisible(),
    )
    await expect(page.queryByRole('link', { name: /Show me/ })).not.toBeInTheDocument()
    await expect(
      page.queryByRole('button', { name: /Also fixed/ }),
    ).not.toBeInTheDocument()
    await expect(page.getByRole('link', { name: 'See all updates' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Close' }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}
