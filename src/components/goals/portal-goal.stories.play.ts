// What the plays of the Monthly portal goal's stories share: reading each
// Portal's count of the month, as the card and the goal's page draw it; the
// goal page's headings, the card that says where the goal stands, its closed
// cards ("What changed", "How this goal counts"), tiles and month chips (the
// average goal's page keeps them, PLAN PG-21); and what follows an answer on the
// card: its toast, the card read again, and the focus on the card's title.
import { expect, userEvent, waitFor, within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/** Each row of "From your portals", name and count, in the order drawn. */
export function portalRows(scope: Scope): string[][] {
  const list = scope.getByRole('list', { name: 'From your portals' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((part) => part.textContent ?? ''))
}

/**
 * The headline of a running goal, whole: its figure, its words and its target
 * sit in three elements, so it is found by what its paragraph reads.
 */
export const headlineOf = (scope: Scope, text: string): HTMLElement =>
  scope.getByText(
    (_: string, element: Element | null) =>
      element?.tagName === 'P' && element.textContent === text,
  )

/**
 * Once a command on the card is answered: `said` in a toast (once it has faded
 * in), the card read again (`reread`), and the focus on the card's title.
 */
export async function expectAnsweredOnTheCard(
  said: string,
  reread: () => unknown,
): Promise<void> {
  const shown = await within(document.body).findByText(said)
  await waitFor(() => expect(shown).toBeVisible())
  await waitFor(() => expect(reread).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute('id', 'portal-goal-title'),
  )
}

/**
 * The card under the month-start check-in's strip: the running month from its
 * first day (December's ruler, the number it counts against, its pill) and the
 * way to the goal's page.
 */
export async function expectRunningCardUnderTheStrip(
  scope: Scope,
  target = 40,
): Promise<void> {
  await expect(
    scope.getByRole('img', { name: `0 of ${target} private ratings so far.` }),
  ).toBeVisible()
  await expect(scope.getByText('Getting started', { exact: true })).toBeVisible()
  await expect(scope.getByRole('link', { name: 'View details' })).toBeVisible()
}

/** The page's headings, in document order, as "h2 What changed". */
export const outline = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )

/**
 * The card that says where the goal stands, first on its page: what is left, the
 * days left and what a day takes, and the ruler.
 */
export function whereOf(canvasElement: HTMLElement): Scope {
  const where = canvasElement.querySelector<HTMLElement>('[data-slot="goal-where"]')
  if (!where) throw new Error('expected the card that says where the goal stands')
  return within(where)
}

/**
 * A card closed until asked is pressed open by its title, which is its button. It
 * returns the button, expanded; one that is open already is left open.
 */
export async function openClosedCard(scope: Scope, title: string): Promise<HTMLElement> {
  const trigger = scope.getByRole('button', { name: title })
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger)
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
  return trigger
}

/** The tiles: a description list, in the section titled "Your goal, so far". */
export function tilesOf(canvasElement: HTMLElement): Scope {
  const strip = canvasElement.querySelector<HTMLElement>('[data-slot="metric-strip"]')
  if (!strip) throw new Error('expected the tiles')
  return within(strip)
}

/** Each chip of "Month by month", by its name. */
export function chipNames(scope: Scope): (string | null)[] {
  const strip = within(scope.getByRole('list', { name: 'Month by month' }))
  return strip.getAllByRole('button').map((chip) => chip.getAttribute('aria-label'))
}

/** "What changed", opened (it is closed until asked), as the region it is. */
export async function openWhatChanged(scope: Scope): Promise<Scope> {
  await openClosedCard(scope, 'What changed')
  return within(scope.getByRole('region', { name: 'What changed' }))
}

/**
 * Each fact of "What changed", its date cell and its words cell apart: the
 * History list draws the date in a column of its own, so the two are read as the
 * two cells they are, not as one line with a separator.
 */
export async function changeCells(scope: Scope): Promise<[string, string][]> {
  const section = await openWhatChanged(scope)
  return section.getAllByRole('listitem').map((item: HTMLElement) => {
    const [when, words] = [...item.children]
    return [when?.textContent ?? '', words?.textContent ?? '']
  })
}

/**
 * The width each date cell of "What changed" is given inline: empty in a list whose
 * dates are all of this year (the cell is five rem by its class), six rem where a
 * date carries a year.
 */
export async function changeDateWidths(scope: Scope): Promise<string[]> {
  const section = await openWhatChanged(scope)
  return section
    .getAllByRole('listitem')
    .map((item: HTMLElement) =>
      item.firstElementChild instanceof HTMLElement
        ? item.firstElementChild.style.width
        : '',
    )
}

/** Each line of "What changed", as the page reads it out: the date, then the words. */
export async function changeTexts(scope: Scope): Promise<string[]> {
  return (await changeCells(scope)).map(([when, words]) => `${when} · ${words}`)
}

/** The goal's menu, named for it, offers Stop and no other measure; closed again. */
export async function expectStopAloneInMenu(scope: Scope, name: string): Promise<void> {
  await userEvent.click(scope.getByRole('button', { name: `More actions for ${name}` }))
  const body = within(document.body)
  await expect(
    await body.findByRole('menuitem', { name: 'Stop this goal…' }),
  ).toBeVisible()
  await expect(body.queryByRole('menuitem', { name: /instead/u })).toBeNull()
  await userEvent.keyboard('{Escape}')
}

/** The bars' figure of a month (or week) goal, by what it counts: "Private ratings each month…". */
export const barsOf = (scope: Scope, caption: string): Scope =>
  within(scope.getByRole('figure', { name: caption }))

/** The months a goal's bars say, as the list a screen reader reads, oldest first. */
export const barLines = (bars: Scope): string[] =>
  bars.getAllByRole('listitem').map((item: HTMLElement) => item.textContent ?? '')

/**
 * The bars read by keyboard: one stop, and Home and End read the first and the
 * last bar into the line under them. `expected` is what that line says after each
 * key, then the hint it falls back to when the bars lose the focus.
 */
export async function expectBarsReadByKeyboard(
  bars: Scope,
  expected: Readonly<{ hint: string; first: string; last: string }>,
): Promise<void> {
  const chart = bars.getByRole('group', {
    name: 'Each month; use left and right arrows to read each one.',
  })
  const reads = (line: string) =>
    waitFor(() => expect(chart).toHaveAccessibleDescription(line))
  await reads(expected.hint)
  chart.focus()
  await userEvent.keyboard('{Home}')
  await reads(expected.first)
  await userEvent.keyboard('{End}')
  await reads(expected.last)
  chart.blur()
  await reads(expected.hint)
}
