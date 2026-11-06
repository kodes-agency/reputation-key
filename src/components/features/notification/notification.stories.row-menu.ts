import { expect, userEvent, waitFor, within } from 'storybook/test'

/** Chooses Dismiss from an unread row's menu using only the keyboard. */
export async function dismissFromTheKeyboard(trigger: HTMLElement): Promise<void> {
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const menu = within(trigger.ownerDocument.body)
  await waitFor(() =>
    expect(menu.getByRole('menuitem', { name: 'Mark as read' })).toHaveFocus(),
  )
  await userEvent.keyboard('{ArrowDown}')
  expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
}
