// What the plays of the Monthly portal goal's stories share: reading each
// Portal's count of the month, as the card and the goal's page draw it.
import { within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/** Each row of "From your portals", name and count, in the order drawn. */
export function portalRows(scope: Scope): string[][] {
  const list = scope.getByRole('list', { name: 'From your portals' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((part) => part.textContent ?? ''))
}
