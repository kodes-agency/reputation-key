// Board G12: the page every denied portal address shows. Axe runs on it
// (`a11y.test = 'error'`). It takes the visitor's language and nothing else.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, waitFor, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PortalUnavailable } from './portal-unavailable'
import { PortalUnavailableInBrowserLanguage } from './portal-unavailable-in-browser-language'
import { unavailableCopyOf } from './portal-unavailable-copy'
import { bgV2 } from './public-portal/language-packs/bg-v2'
import { deV2 } from './public-portal/language-packs/de-v2'

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

/** English alone, for a visitor whose browser asks for nothing the guest surface writes. */
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
    expect(canvas.getByRole('main')).toBeVisible()
    // No fixed second language: the Bulgarian line is gone.
    expect(canvasElement.querySelector('[lang="bg"]')).toBeNull()
    const retry = canvas.getByRole('button', { name: 'Try again' })
    expect(retry.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

/** A German visitor reads German first, the English words follow, and the button is German. */
export const G12UnavailableInGerman: Story = {
  args: { copy: unavailableCopyOf(deV2) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Diese Seite ist derzeit nicht verfügbar.')
    expect(heading).toHaveAttribute('lang', 'de')
    const english = canvas.getByText('This page isn’t available right now.')
    expect(english).toHaveAttribute('lang', 'en')
    expect(
      heading.compareDocumentPosition(english) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(canvas.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()
  },
}

/** Bulgarian is one of the six, not a fixed extra: a Bulgarian visitor gets it first. */
export const G12UnavailableInBulgarian: Story = {
  args: { copy: unavailableCopyOf(bgV2) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Тази страница не е достъпна в момента.',
    )
    expect(canvas.getByText('This page isn’t available right now.')).toHaveAttribute(
      'lang',
      'en',
    )
  },
}

/** "Try again" is a real button that asks the page to load again. */
export const TryAgainIsAButton: Story = {
  play: async ({ canvasElement }) => {
    const retry = within(canvasElement).getByRole('button', { name: 'Try again' })
    expect(retry.tagName).toBe('BUTTON')
    expect(retry).toHaveAttribute('type', 'button')
    retry.focus()
    expect(document.activeElement).toBe(retry)
    expect(getComputedStyle(retry).outlineStyle).not.toBe('none')
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

/** Sets what the browser asks for and puts it back when the story ends. */
function browserLanguages(languages: readonly string[]) {
  return () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'languages')
    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      value: languages,
    })
    return () => {
      if (original) Object.defineProperty(window.navigator, 'languages', original)
      else Reflect.deleteProperty(window.navigator, 'languages')
    }
  }
}

/**
 * A render with no server answer (the error and not-found pages) reads the
 * browser's own language: English first, then the visitor's language once its
 * copy pack has loaded.
 */
export const BrowserLanguageWhenThereIsNoServerAnswer: Story = {
  render: () => <PortalUnavailableInBrowserLanguage />,
  beforeEach: browserLanguages(['de-DE', 'en']),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Diese Seite ist derzeit nicht verfügbar.',
      ),
    )
    expect(canvas.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()
  },
}

/** A browser that asks for nothing the guest surface writes keeps the English page. */
export const BrowserWithNoGuestLanguageStaysEnglish: Story = {
  render: () => <PortalUnavailableInBrowserLanguage />,
  beforeEach: browserLanguages(['ja-JP', 'zh-CN']),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('heading', {
        level: 1,
        name: 'This page isn’t available right now.',
      }),
    ).toBeVisible()
    expect(canvasElement.querySelector('.portal-unavailable__rule')).toBeNull()
  },
}
