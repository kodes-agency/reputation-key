// Board G12: the page every denied portal address shows. Axe runs on it
// (`a11y.test = 'error'`). It has no props, so one story is the whole page.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PortalUnavailable } from './portal-unavailable'

/** In the app the root links the guest fonts for this route; a story has no root. */
const GuestFonts: Decorator = (Story) => (
  <>
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </>
)

const meta: Meta<typeof PortalUnavailable> = {
  title: 'Features/Guest/PortalUnavailable',
  component: PortalUnavailable,
  decorators: [GuestFonts],
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof PortalUnavailable>

export const G12Unavailable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', {
        level: 1,
        name: 'This page isn’t available right now.',
      }),
    ).toBeVisible()
    expect(canvas.getByText('Please check back later.')).toBeVisible()
    const bulgarian = canvas.getByText('Тази страница не е достъпна в момента.')
    expect(bulgarian).toHaveAttribute('lang', 'bg')
    expect(canvas.getByRole('main')).toBeVisible()
  },
}

/** The page is light and drawn from its own colours, whatever theme the app is in. */
export const IgnoresTheAppTheme: Story = {
  parameters: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector<HTMLElement>('main')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(main && getComputedStyle(main).backgroundColor).toBe('rgb(246, 244, 240)')
    expect(main && getComputedStyle(main).color).toBe('rgb(42, 39, 35)')
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light')
  },
}
