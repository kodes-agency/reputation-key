// What the plays of the Monthly portal goal's stories share: reading each
// Portal's count of the month, as the card and the goal's page draw it; the
// goal page's headings, tiles, month chips and changes (the Monthly portal
// goal's page and a goal's own, PLAN PG-21); and what follows an answer on the
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
 * first day (December's bar, its pill) and the way to the goal's page.
 */
export async function expectRunningCardUnderTheStrip(scope: Scope): Promise<void> {
  await expect(
    scope.getByRole('progressbar', { name: 'Private ratings in December' }),
  ).toBeVisible()
  await expect(scope.getByText('Getting started', { exact: true })).toBeVisible()
  await expect(scope.getByRole('link', { name: 'View details' })).toBeVisible()
}

/** The page's headings, in document order, as "h2 Changes". */
export const outline = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )

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

/**
 * Each fact of "Changes", its date cell and its words cell apart: the History
 * list draws the date in a column of its own, so the two are read as the two
 * cells they are, not as one line with a separator.
 */
export function changeCells(scope: Scope): [string, string][] {
  const section = scope.getByRole('region', { name: 'Changes' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => {
      const [when, words] = [...item.children]
      return [when?.textContent ?? '', words?.textContent ?? '']
    })
}

/** Each line of "Changes", as the page reads it out: the date, then the words. */
export function changeTexts(scope: Scope): string[] {
  return changeCells(scope).map(([when, words]) => `${when} · ${words}`)
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
