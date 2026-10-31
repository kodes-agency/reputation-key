import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from '#/shared/merchant-ai-notice-announcements'
import { MerchantAiNoticeUpdateBanner } from './merchant-ai-notice-update-banner'

const update = {
  ...MERCHANT_AI_NOTICE_ANNOUNCEMENTS['merchant-ai-notice-2026-10-30.v1']!,
  noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
  noticeDigest: 'a'.repeat(64),
  renewedAt: '2026-10-31T09:00:00Z',
}
const meta = {
  title: 'Settings/AI update announcement',
  component: MerchantAiNoticeUpdateBanner,
  decorators: [
    withRole('AccountAdmin'),
    (Story) => (
      <main tabIndex={-1}>
        <Story />
      </main>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  args: { update, markSeen: fn(async () => {}), pending: false },
} satisfies Meta<typeof MerchantAiNoticeUpdateBanner>
export default meta
type Story = StoryObj<typeof meta>

export const UnseenUpdate: Story = {}
export const GotIt: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Got it' }))
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
    await expect(args.markSeen).toHaveBeenCalledWith(update)
  },
}
export const WhatChanged: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'What changed' }),
    )
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog')).toBeVisible()
    await expect(body.getByText('Updated automatically on 31 Oct 2026')).toBeVisible()
    await expect(
      body.getByRole('link', { name: 'Read the full AI notice' }),
    ).toHaveAttribute('href', '/settings/ai')
    await expect(args.markSeen).toHaveBeenCalledWith(update)
    await userEvent.keyboard('{Escape}')
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(body.getByRole('main')).toHaveFocus())
  },
}
export const AlreadySeen: Story = { args: { update: null } }
export const PendingReceipt: Story = { args: { pending: true } }
export const FailedReceipt: Story = {
  args: {
    markSeen: fn(async () => {
      throw new Error('fixture failure')
    }),
  },
}
export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}
export const Dark: Story = { parameters: { theme: 'dark' } }
export const Light: Story = { parameters: { theme: 'light' } }
