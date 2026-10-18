// What the plays of the Monthly portal goal's stories share: reading each
// Portal's count of the month, as the card and the goal's page draw it; and
// what follows an answer on the card: its toast, the card read again, and the
// focus on the card's title.
import { expect, waitFor, within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/** Each row of "From your portals", name and count, in the order drawn. */
export function portalRows(scope: Scope): string[][] {
  const list = scope.getByRole('list', { name: 'From your portals' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((part) => part.textContent ?? ''))
}

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
