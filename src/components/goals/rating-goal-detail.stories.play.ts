// What the plays of the Google rating goal's detail page share (2026-11-01, ADR 0067):
// the card that says where the goal stands, a band found by its question, "What
// happened" (closed until its button is pressed), a chart read by keyboard, and the
// rule the card and the page keep alike: Google's exact average is never printed.
import { expect, userEvent, waitFor, within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/** The three questions of a climbing goal's page, as its bands ask them. */
export const QUESTION = {
  rising: 'Is your rating going up?',
  reviews: 'Are enough good reviews coming in?',
  week: 'What can you do this week?',
} as const

/** The card that says where the goal stands, first on the page. */
export function whereOf(canvasElement: HTMLElement): Scope {
  const card = canvasElement.querySelector<HTMLElement>('[data-slot="goal-where"]')
  if (card === null) throw new Error('The page draws no card for where the goal stands.')
  return within(card)
}

/** A band, found by its question: a region named by it. */
export const bandOf = (scope: Scope, question: string): Scope =>
  within(scope.getByRole('region', { name: question }))

/** A chart or its bars, found by the name its figure carries. */
export const figureOf = (scope: Scope, name: string): HTMLElement =>
  scope.getByRole('figure', { name })

/** The rows of a chart's list for a screen reader, as text, in order. */
export const readoutsOf = (figure: HTMLElement): string[] =>
  within(within(figure).getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')

/**
 * "What happened", closed until asked: its rows are not on the page until the
 * button that is its title is pressed. Returns the rows, as text, once open.
 */
export async function whatHappened(canvasElement: HTMLElement): Promise<string[]> {
  const trigger = within(canvasElement).getByRole('button', { name: 'What happened' })
  const card = trigger.closest('[data-slot="card"]')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(card?.querySelector('li') ?? null).toBeNull()
  await userEvent.click(trigger)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(card?.querySelector('li')).not.toBeNull())
  return [...(card?.querySelectorAll('li') ?? [])].map((row) => row.textContent ?? '')
}

/**
 * Reads a chart's point by keyboard: the figure's group takes the focus, the key
 * moves to a point, and the line under the chart says it.
 */
export async function readByKey(figure: HTMLElement, key: string): Promise<string> {
  const group = within(figure).getByRole('group')
  group.focus()
  await userEvent.keyboard(`{${key}}`)
  const line = figure.querySelector('[aria-live="polite"]')
  return await waitFor(() => {
    const said = line?.textContent ?? ''
    expect(said).not.toMatch(/^Hover or tap/u)
    return said
  })
}

/**
 * Google's exact average is worked from and never printed: no number with two
 * decimals in any word, name or label the page carries. Each text is read on its own,
 * so two figures side by side ("4.1" then "4.1") are never read as one.
 */
export async function expectNoExactAverage(canvasElement: HTMLElement): Promise<void> {
  const texts: string[] = []
  const walker = document.createTreeWalker(canvasElement, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    texts.push(node.textContent ?? '')
  }
  for (const named of canvasElement.querySelectorAll('[aria-label], [aria-valuetext]')) {
    texts.push(
      named.getAttribute('aria-label') ?? '',
      named.getAttribute('aria-valuetext') ?? '',
    )
  }
  await expect(texts.filter((text) => /\d\.\d{2,}/u.test(text))).toEqual([])
}
