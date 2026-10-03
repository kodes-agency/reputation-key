// The theme control, in both of the places the setting is drawn in full: the
// Preferences row (a segmented radio group) and the account menu (the same pill,
// drawn from menu radio items so the menu's arrow keys reach it). Light, Dark,
// System, in that order, in both. The Storybook Vitest project compiles no
// Tailwind, so nothing here claims a pixel; the plays prove what a screenshot
// cannot: the choice reaches the document and storage, the arrow keys move it,
// and the menu keeps its choices reachable from the keyboard.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ThemeModeControl } from './theme-mode-control'
import { ThemeModeMenuControl } from './theme-mode-menu-control'

const meta: Meta<typeof ThemeModeControl> = {
  title: 'Patterns/Theme mode control',
  component: ThemeModeControl,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ThemeModeControl>

const LABEL_ID = 'story-theme-label'

function PreferencesRow() {
  return (
    <div className="flex w-96 items-center justify-between gap-4">
      <span id={LABEL_ID} className="text-sm leading-none font-medium">
        Theme
      </span>
      <ThemeModeControl labelledBy={LABEL_ID} />
    </div>
  )
}

function stored(): string | null {
  return window.localStorage.getItem('theme')
}

async function pickAndRestore(
  canvas: ReturnType<typeof within>,
  name: string,
  restore: string,
) {
  await userEvent.click(canvas.getByRole('radio', { name }))
  expect(canvas.getByRole('radio', { name })).toBeChecked()
  expect(stored()).toBe(name === 'System' ? 'auto' : name.toLowerCase())
  await userEvent.click(canvas.getByRole('radio', { name: restore }))
}

// The Preferences row: the label names the group, the three modes read in order.
export const Preferences: Story = {
  render: () => <PreferencesRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('radiogroup', { name: 'Theme' })
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.textContent)
    expect(names).toEqual(['Light', 'Dark', 'System'])

    await userEvent.click(canvas.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement).toHaveClass('light')
    await pickAndRestore(canvas, 'Dark', 'Dark')
    expect(document.documentElement).toHaveClass('dark')
  },
}

// The arrow keys move the choice and focus together, in the listed order. Radix
// checks the radio that receives focus only while the arrow is still held, so
// the key is held until focus has arrived (see the Segmented Control story).
export const ArrowKeys: Story = {
  render: () => <PreferencesRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Light' }))
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(canvas.getByRole('radio', { name: 'Dark' })).toHaveFocus())
    await userEvent.keyboard('{/ArrowRight}')
    expect(canvas.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(stored()).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
  },
}

function AccountMenu() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Account menu">
          AL
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <ThemeModeMenuControl />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The account menu: the same three modes, as menu radio items, so the menu's
// own arrow keys move through them. Choosing leaves the menu open.
export const InTheAccountMenu: Story = {
  render: () => <AccountMenu />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const group = await page.findByRole('group', { name: 'Theme' })
    const names = within(group)
      .getAllByRole('menuitemradio')
      .map((item) => item.textContent)
    expect(names).toEqual(['Light', 'Dark', 'System'])
    // Each segment keeps the phone touch target the menu item it replaced had
    // (44 px below `md`). The Storybook runner compiles no Tailwind, so the
    // class is what can be asserted, not the pixels.
    for (const segment of within(group).getAllByRole('menuitemradio')) {
      expect(segment).toHaveClass('max-md:h-11', 'max-md:min-h-11')
    }

    await userEvent.click(page.getByRole('menuitemradio', { name: 'Light' }))
    expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeChecked()
    expect(document.documentElement).toHaveClass('light')
    // The choice does not close the menu: the change is the point of the row.
    expect(page.getByRole('menu')).toBeVisible()
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Dark' }))
    expect(stored()).toBe('dark')
  },
}

export const PreferencesLight: Story = {
  ...Preferences,
  parameters: { layout: 'centered', theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Light' }))
    expect(canvas.getByRole('radio', { name: 'Light' })).toBeChecked()
  },
}

export const InTheAccountMenuLight: Story = {
  ...InTheAccountMenu,
  parameters: { layout: 'centered', theme: 'light' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('menuitemradio', { name: 'Light' }))
    expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeChecked()
  },
}
