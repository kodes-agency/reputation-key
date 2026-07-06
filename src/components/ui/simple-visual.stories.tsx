import type { Meta, StoryObj } from '@storybook/react'
import { Inbox, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './button'
import { CopyButton } from './copy-button'
import { EmptyState } from './empty-state'
import { Field, FieldError, FieldGroup, FieldLabel } from './field'
import { Input } from './input'
import { Separator } from './separator'
import { Toaster } from './sonner'
import { expect, userEvent, within } from 'storybook/test'

const meta: Meta = {
  title: 'UI/Simple Visual',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj

export const SeparatorHorizontal: Story = {
  render: () => (
    <div className="flex h-20 w-80 items-center">
      <Separator orientation="horizontal" decorative className="w-full" />
    </div>
  ),
}

export const SeparatorVertical: Story = {
  render: () => (
    <div className="flex h-20 items-center gap-4 text-sm text-muted-foreground">
      <span>Left</span>
      <Separator orientation="vertical" decorative={false} />
      <span>Right</span>
    </div>
  ),
}

export const EmptyStateInbox: Story = {
  render: () => (
    <div className="w-80">
      <EmptyState icon={Inbox} title="No messages yet">
        <Button size="sm">Start a conversation</Button>
      </EmptyState>
    </div>
  ),
}

export const EmptyStateSearch: Story = {
  render: () => (
    <div className="w-80">
      <EmptyState icon={Search} title="No results found">
        <p className="text-xs text-muted-foreground">Try a different search term.</p>
      </EmptyState>
    </div>
  ),
}

export const CopyButtonDefault: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Share this link</span>
      {/* Copies `${window.location.origin}/inbox` to the clipboard */}
      <CopyButton text="/inbox" />
    </div>
  ),
}

export const FieldVertical: Story = {
  render: () => (
    <FieldGroup className="w-80">
      <Field orientation="vertical">
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" type="email" placeholder="you@example.com" />
        <FieldError errors={[{ message: 'Enter a valid email address.' }]} />
      </Field>
    </FieldGroup>
  ),
}

export const FieldHorizontal: Story = {
  render: () => (
    <FieldGroup className="w-96">
      <Field orientation="horizontal">
        <FieldLabel htmlFor="name">Display name</FieldLabel>
        <Input id="name" placeholder="Ada Lovelace" />
        <FieldError errors={[{ message: 'Required.' }]} />
      </Field>
    </FieldGroup>
  ),
}
export const FieldResponsive: Story = {
  render: () => (
    <FieldGroup className="w-[640px]">
      <Field orientation="responsive">
        <FieldLabel htmlFor="bio">Bio</FieldLabel>
        <Input id="bio" placeholder="Tell us about yourself" />
        <FieldError errors={[{ message: 'Required.' }]} />
      </Field>
    </FieldGroup>
  ),
}

export const SonnerToaster: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Toaster />
      <p className="text-xs text-muted-foreground">Click a button to fire a toast.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => toast.success('Saved successfully')}>
          Success
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => toast.info('A new update is available')}
        >
          Info
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => toast.warning('Storage is almost full')}
        >
          Warning
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => toast.error('Could not save changes')}
        >
          Error
        </Button>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^success$/i }))
    // Sonner renders toasts inside a <section aria-live="polite"> (role is
    // not "status"). Assert on the toast message text directly.
    await expect(await canvas.findByText(/saved successfully/i)).toBeInTheDocument()
  },
}
