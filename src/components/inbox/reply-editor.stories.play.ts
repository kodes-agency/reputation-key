import { expect, userEvent, waitFor, within } from 'storybook/test'

type Canvas = ReturnType<typeof within>

/**
 * What choosing "Local safe template" asks the suggestion function for: the
 * professional tone, the property default language, template only, and a fresh
 * idempotency key. Shared by the compose editor and composer stories.
 */
export const LOCAL_SAFE_TEMPLATE_REQUEST = [
  'professional',
  { kind: 'property_default' },
  true,
  expect.any(String),
] as const

/**
 * Exactly 4,096 UTF-8 bytes, Google's reply limit: the counter reads full and
 * stays neutral. Shared by the draft and published-edit stories, which then
 * assert their own action is allowed.
 */
export function expectNeutralCounterAtTheByteLimit(canvas: Canvas): void {
  const counter = canvas.getByText('4096/4096')
  expect(counter).toHaveClass('text-muted-foreground')
  expect(counter).not.toHaveClass('text-negative')
}

/**
 * Presses the control named `trigger` and resolves the confirmation it opens,
 * once the dialog shows `copy`. Shared by the thread message's Confirm &
 * publish stories and the published-edit story: each then asserts that nothing
 * was sent before its own confirm button is pressed.
 */
export async function openConfirmation(
  canvasElement: HTMLElement,
  trigger: RegExp | string,
  copy: RegExp,
): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name: trigger }))
  const dialog = await within(document.body).findByRole('alertdialog')
  // The copy mounts with the dialog's entry animation — wait for it rather
  // than sampling the first frame.
  await waitFor(() => expect(within(dialog).getByText(copy)).toBeVisible())
  return dialog
}
