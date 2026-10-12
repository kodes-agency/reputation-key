// Shared by every story that opens a confirmation: press the trigger, wait for
// the alert dialog, and hand back queries scoped to the document body, where
// Radix portals it.
import { expect, userEvent, waitFor, within } from 'storybook/test'

/**
 * `triggerName` is the trigger button's accessible name; `index` picks one when
 * several rows carry the same trigger. The wait is for the dialog to be visible,
 * because it mounts through an entry animation that starts at opacity 0.
 */
export async function openAlertDialog(
  canvasElement: HTMLElement,
  triggerName: string,
  index = 0,
) {
  const triggers = within(canvasElement).getAllByRole('button', { name: triggerName })
  await userEvent.click(triggers[index]!)
  const dialog = within(canvasElement.ownerDocument.body)
  const alert = await dialog.findByRole('alertdialog')
  await waitFor(() => expect(alert).toBeVisible())
  return dialog
}
