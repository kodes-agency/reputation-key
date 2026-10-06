// The app's Toaster. A plain toast sits on the popover surface; success, info,
// warning and error toasts take their colour from the same tokens an Alert or a
// delta uses, so a toast means what that colour means elsewhere in both themes.
// Dark is the default theme; the light variant renders the same stack on the
// light surface. Toasts here never time out, so the play and axe read a settled
// stack.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, waitFor, within } from 'storybook/test'
import { toast } from 'sonner'
import { Toaster } from './sonner'

const meta: Meta<typeof Toaster> = {
  title: 'Patterns/Toast',
  component: Toaster,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  render: () => <Toaster position="top-right" closeButton expand visibleToasts={5} />,
}

export default meta
type Story = StoryObj<typeof Toaster>

const PERSIST = { duration: Number.POSITIVE_INFINITY } as const

/** The colour a token paints as a background or as ink, as the browser resolves it. */
function paintOf(token: string, as: 'background' | 'ink' = 'background'): string {
  const probe = document.createElement('div')
  if (as === 'background') probe.style.backgroundColor = `var(${token})`
  else probe.style.color = `var(${token})`
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const painted = as === 'background' ? style.backgroundColor : style.color
  probe.remove()
  return painted
}

/** The toast holding `text`, once it has finished fading in. */
async function settledToast(canvas: ReturnType<typeof within>, text: string) {
  const find = (): HTMLElement => {
    const item = canvas.getByText(text).closest('[data-sonner-toast]')
    if (!(item instanceof HTMLElement)) throw new Error(`"${text}" is not in a toast`)
    return item
  }
  await waitFor(() => expect(getComputedStyle(find()).opacity).toBe('1'))
  return find()
}

function showEveryTone() {
  toast.dismiss()
  toast('Draft restored', PERSIST)
  toast.success('Profile saved', PERSIST)
  toast.info('Reply drafted for review', PERSIST)
  toast.warning('Invitation created, but the email did not send', PERSIST)
  toast.error('Couldn’t save your changes. Try again.', PERSIST)
}

/** One of each tone, stacked: the typed toasts use the tinted token surfaces. */
export const EveryTone: Story = {
  play: async ({ canvasElement }) => {
    showEveryTone()
    const canvas = within(canvasElement)
    const success = await settledToast(canvas, 'Profile saved')
    const failure = await settledToast(canvas, 'Couldn’t save your changes. Try again.')
    const plain = await settledToast(canvas, 'Draft restored')

    // The browser's own resolution of the token, so this fails if Sonner's
    // palette (or a colour literal) comes back.
    expect(getComputedStyle(success).backgroundColor).toBe(paintOf('--success-muted'))
    expect(getComputedStyle(success).color).toBe(paintOf('--positive', 'ink'))
    expect(getComputedStyle(failure).backgroundColor).toBe(paintOf('--destructive-muted'))
    expect(getComputedStyle(failure).color).toBe(paintOf('--negative', 'ink'))
    expect(getComputedStyle(plain).backgroundColor).toBe(paintOf('--popover'))
  },
}

/** The stack follows the theme the document shows, in both directions. */
export const FollowsTheTheme: Story = {
  play: async ({ canvasElement }) => {
    showEveryTone()
    const canvas = within(canvasElement)
    await settledToast(canvas, 'Profile saved')
    const themed = canvasElement.querySelector('[data-sonner-toaster]')
    const applied = document.documentElement.classList.contains('light')
      ? 'light'
      : 'dark'
    expect(themed).toHaveAttribute('data-sonner-theme', applied)
  },
}

export const EveryToneLight: Story = {
  ...EveryTone,
  parameters: { layout: 'fullscreen', theme: 'light' },
}

export const FollowsTheThemeLight: Story = {
  ...FollowsTheTheme,
  parameters: { layout: 'fullscreen', theme: 'light' },
}
