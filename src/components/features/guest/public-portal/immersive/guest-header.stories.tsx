// The header, title block and language chip and sheet of the round-4 guest
// design, built on the real shell: boards G01 (the chip), G02 (the sheet), G10
// (German) and G11 (Bulgarian), and the locale-set matrix of 1, 2, 4 and 6
// languages. Axe runs on every story (`a11y.test = 'error'`), the sheet open
// where a play function leaves it open. The play functions add what axe cannot
// see: the keyboard path, the focus trap, Esc, and the sizes of the boards.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { AvelaChrome } from './__fixtures__/avela-chrome'
import { PhoneFrame } from './__fixtures__/phone-frame'
import { STORY_HERO_PHOTO } from './__fixtures__/story-hero-photo'
import { ImmersiveShell } from './immersive-shell'

const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const

const meta: Meta<typeof ImmersiveShell> = {
  title: 'Features/Guest/ImmersiveHeader',
  component: ImmersiveShell,
  decorators: [PhoneFrame],
  parameters: { layout: 'fullscreen' },
  args: {
    lang: 'en',
    height: 'container',
    heroAlt: { value: 'The colonnade pool at dusk, under an old olive tree' },
    brand: { ...CHAMPAGNE, hero: STORY_HERO_PHOTO },
    children: <AvelaChrome />,
  },
}
export default meta

type Story = StoryObj<typeof ImmersiveShell>

const chipOf = (canvasElement: HTMLElement) => {
  const chip = canvasElement.querySelector<HTMLButtonElement>('button[aria-haspopup]')
  if (!chip) throw new Error('the language chip is missing')
  return chip
}

const dialogOf = (canvasElement: HTMLElement) => {
  const dialog = canvasElement.querySelector<HTMLDialogElement>('dialog.ih-sheet')
  if (!dialog) throw new Error('the language sheet is missing')
  return dialog
}

/** Board G01: the chip at the top right, the wordmark at the top left, the title block. */
export const G01HeaderAndTitle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = chipOf(canvasElement)
    expect(chip.getBoundingClientRect().height).toBe(44)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(chip).toHaveAccessibleName('EN, Language: English')
    expect(chip.textContent).toBe('EN')
    expect(canvasElement.querySelector('dialog')?.open).toBe(false)

    const header = canvasElement.querySelector('header')
    expect(header?.getBoundingClientRect().height).toBe(64)
    expect(within(header as HTMLElement).getByText('Avela')).toBeVisible()

    // The h1 is the portal title; the display name is the large serif line.
    const h1 = canvas.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Pool & Terrace')
    const name = canvas.getByText('Avela Resort', { selector: 'p' })
    expect(parseFloat(getComputedStyle(name).fontSize)).toBe(44)
    expect(getComputedStyle(name).fontFamily).toContain('Cormorant Garamond')
    expect(
      name.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  },
}

/** Board G02: the sheet open over the dimmed page, the current language first. */
export const G02LanguageSheet: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement)
    await userEvent.click(chip)
    const dialog = dialogOf(canvasElement)
    expect(dialog.open).toBe(true)
    expect(dialog.matches(':modal')).toBe(true)
    await waitFor(() => expect(chip.getAttribute('aria-expanded')).toBe('true'))

    const sheet = within(dialog)
    expect(dialog).toHaveAccessibleName('Language')
    const rows = sheet.getAllByRole('link')
    expect(rows.map((row) => row.getAttribute('hreflang'))).toEqual([
      'en',
      'bg',
      'es',
      'de',
    ])
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/p/story-token?locale=en',
      '/p/story-token?locale=bg',
      '/p/story-token?locale=es',
      '/p/story-token?locale=de',
    ])
    // Native names, each in its own language, and the page's word for it beneath.
    expect(rows.map((row) => row.querySelector('[lang]')?.textContent)).toEqual([
      'English',
      'Български',
      'Español',
      'Deutsch',
    ])
    expect(sheet.getByText('Bulgarian')).toBeVisible()
    expect(sheet.getByText('German')).toBeVisible()
    // Only the current row is marked, in words as well as by the check.
    expect(dialog.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('aria-current', 'page')
    expect(rows[0]).toHaveAccessibleName(/English\s*Selected/u)
    expect(rows[0]?.getBoundingClientRect().height).toBe(60)
    expect(
      sheet.getByText('This page opens in your phone’s language when it has it.'),
    ).toBeVisible()

    // A bottom sheet: it sits on the bottom edge and keeps the page's column width.
    const panel = dialog.querySelector<HTMLElement>('.ih-sheet__panel')
    expect(Math.round(dialog.getBoundingClientRect().bottom)).toBe(window.innerHeight)
    expect((panel as HTMLElement).getBoundingClientRect().width).toBeLessThanOrEqual(480)
  },
}

/** The sheet opens from the keyboard, traps focus, and Esc, Close and the current row close it. */
export const SheetKeyboardAndFocus: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement)
    const dialog = dialogOf(canvasElement)

    // Reach the chip and open with Enter, as a keyboard user does.
    chip.focus()
    expect(document.activeElement).toBe(chip)
    await userEvent.keyboard('{Enter}')
    expect(dialog.open).toBe(true)

    // Focus moved into the sheet, and the page behind it cannot take it back.
    expect(dialog.contains(document.activeElement)).toBe(true)
    chip.focus()
    expect(document.activeElement).not.toBe(chip)
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tabbing walks the sheet's own controls, in order: Close, then each row.
    // (The browser wraps from the last one back to the first; the page behind is
    // inert. The simulated keyboard does not model that wrap, so it is not driven here.)
    const stops = [...dialog.querySelectorAll<HTMLElement>('button, a[href]')]
    expect(stops).toHaveLength(5)
    expect(document.activeElement).toBe(stops[0])
    for (const stop of stops.slice(1)) {
      await userEvent.tab()
      expect(document.activeElement).toBe(stop)
    }

    // Esc closes it and the chip has focus again.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog.open).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(chip))
    await waitFor(() => expect(chip.getAttribute('aria-expanded')).toBe('false'))

    // The Close button does the same.
    await userEvent.click(chip)
    expect(dialog.open).toBe(true)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(dialog.open).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(chip))

    // A tap on the dimmed page closes it.
    await userEvent.click(chip)
    await userEvent.click(dialog)
    await waitFor(() => expect(dialog.open).toBe(false))
    await waitFor(() => expect(chip.getAttribute('aria-expanded')).toBe('false'))

    // The row of the language already shown closes the sheet and stays on the page.
    await userEvent.click(chip)
    await waitFor(() => expect(dialog.open).toBe(true))
    await userEvent.click(within(dialog).getByRole('link', { name: /English/u }))
    await waitFor(() => expect(dialog.open).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(chip))
  },
}

/** Board G10: German. The chip reads DE, and the sheet is named in German. */
export const G10German: Story = {
  args: {
    lang: 'de',
    children: <AvelaChrome locale="de" locales={['de', 'en', 'bg']} />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = chipOf(canvasElement)
    expect(chip.textContent).toBe('DE')
    expect(chip).toHaveAccessibleName('DE, Sprache: Deutsch')
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Pool & Terrasse')
    await userEvent.click(chip)
    const sheet = within(dialogOf(canvasElement))
    expect(sheet.getByRole('heading', { name: 'Sprache' })).toBeVisible()
    expect(sheet.getByText('Englisch')).toBeVisible()
    expect(sheet.getByText('Bulgarisch')).toBeVisible()
    expect(sheet.getByRole('button', { name: 'Schließen' })).toBeVisible()
  },
}

/** Board G11: Bulgarian. The chip reads БГ and the Cyrillic stays on the shipped fonts. */
export const G11Bulgarian: Story = {
  args: {
    lang: 'bg',
    children: <AvelaChrome locale="bg" locales={['bg', 'en']} />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = chipOf(canvasElement)
    expect(chip.textContent).toBe('БГ')
    expect(chip).toHaveAccessibleName('БГ, Език: Български')
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Басейн и тераса')
    await userEvent.click(chip)
    const sheet = within(dialogOf(canvasElement))
    expect(sheet.getByRole('button', { name: 'Затвори' })).toBeVisible()
    expect(sheet.getByText('Английски')).toBeVisible()
    // The Bulgarian row has no second line: its name reads the same in both.
    const [bulgarian] = sheet.getAllByRole('link')
    expect(bulgarian?.querySelector('.ih-sheet__aside')).toBeNull()
  },
}

/** One language: no chip and no sheet at all. */
export const OneLanguageShowsNoChip: Story = {
  args: { children: <AvelaChrome locales={['en']} /> },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('button')).toBeNull()
    expect(canvasElement.querySelector('dialog')).toBeNull()
    expect(within(canvasElement).getByText('Avela')).toBeVisible()
    // The wordmark keeps the left edge; nothing is pushed to the right.
    const header = canvasElement.querySelector('header') as HTMLElement
    expect(header.children).toHaveLength(1)
  },
}

/** Two languages: a chip and two rows. */
export const TwoLanguages: Story = {
  args: { children: <AvelaChrome locales={['en', 'bg']} /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(chipOf(canvasElement))
    expect(within(dialogOf(canvasElement)).getAllByRole('link')).toHaveLength(2)
  },
}

/** All six languages: the sheet lists each in the portal's order and fits the screen. */
export const SixLanguages: Story = {
  args: { children: <AvelaChrome locales={['en', 'es', 'it', 'fr', 'de', 'bg']} /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(chipOf(canvasElement))
    const dialog = dialogOf(canvasElement)
    const rows = within(dialog).getAllByRole('link')
    expect(rows.map((row) => row.getAttribute('hreflang'))).toEqual([
      'en',
      'es',
      'it',
      'fr',
      'de',
      'bg',
    ])
    const panel = dialog.querySelector<HTMLElement>('.ih-sheet__panel') as HTMLElement
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(
      window.innerHeight * 0.92,
    )
    // Every row is a full-size touch target.
    for (const row of rows)
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(60)
  },
}

/** A property logo replaces the wordmark. */
export const LogoReplacesWordmark: Story = {
  args: { children: <AvelaChrome withLogo /> },
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector('header') as HTMLElement
    const logo = within(header).getByRole('img', { name: 'Avela Resort logo' })
    expect(logo.getBoundingClientRect().height).toBe(32)
    expect(within(header).queryByText('Avela')).toBeNull()
    expect(logo.getAttribute('fetchpriority')).toBeNull()
  },
}

/** Narrow phone, a long name in German: it wraps inside the column, never sideways. */
export const LongNameOnNarrowPhone: Story = {
  parameters: { frameWidth: 320 },
  args: {
    lang: 'de',
    children: (
      <AvelaChrome
        locale="de"
        displayName="Donaudampfschifffahrtsgesellschaft Kapitän"
        title="Pool & Terrasse am Wasser"
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const name = within(canvasElement).getByText(/Donaudampf/u)
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth)
    const frame = canvasElement.querySelector<HTMLElement>('[data-testid="phone-frame"]')
    expect((frame as HTMLElement).scrollWidth).toBeLessThanOrEqual(320)
  },
}
