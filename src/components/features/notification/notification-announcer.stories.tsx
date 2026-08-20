// The polite live region behind mark-all-read / clear-all / dismiss.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import {
  NotificationAnnouncer,
  useNotificationAnnouncer,
} from './notification-announcer'

const meta: Meta<typeof NotificationAnnouncer> = {
  title: 'Notification/NotificationAnnouncer',
  component: NotificationAnnouncer,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof NotificationAnnouncer>

export const Announced: Story = {
  args: { announcement: { text: 'All notifications marked as read.', seq: 1 } },
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('All notifications marked as read.')
  },
}

export const Silent: Story = {
  args: { announcement: { text: '', seq: 0 } },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeEmptyDOMElement()
  },
}

function RepeatHarness() {
  const { announcement, announce } = useNotificationAnnouncer()
  return (
    <div>
      <Button onClick={() => announce('Notification dismissed.')}>Dismiss</Button>
      <NotificationAnnouncer announcement={announcement} />
      <p data-testid="seq">{announcement.seq}</p>
    </div>
  )
}

/**
 * Repeating the SAME message must still be announced. The sequence number is
 * part of the rendered key, so the text node is replaced rather than left
 * unchanged and swallowed by the screen reader.
 */
export const RepeatedMessageIsReAnnounced: Story = {
  render: () => <RepeatHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dismiss = canvas.getByRole('button', { name: 'Dismiss' })
    await userEvent.click(dismiss)
    expect(canvas.getByTestId('seq')).toHaveTextContent('1')
    await userEvent.click(dismiss)
    expect(canvas.getByTestId('seq')).toHaveTextContent('2')
    expect(canvas.getByRole('status')).toHaveTextContent('Notification dismissed.')
  },
}
