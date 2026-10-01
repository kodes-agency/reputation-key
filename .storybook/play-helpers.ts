// Assertions that several stories' `play` functions share.

import { expect, userEvent, within } from 'storybook/test'

/**
 * The unhandled rejections raised while `act` runs. `unhandledrejection` is
 * dispatched from a task queued after the microtask checkpoint, so two task
 * turns are waited out before reading.
 */
export async function unhandledRejectionsDuring(
  act: () => Promise<void>,
): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const record = (event: PromiseRejectionEvent) => {
    event.preventDefault()
    unhandled.push(event.reason)
  }
  window.addEventListener('unhandledrejection', record)
  try {
    await act()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    window.removeEventListener('unhandledrejection', record)
  }
  return unhandled
}

/**
 * A modal that cannot be left while its request is in flight: Cancel is
 * disabled, Escape does not close it, and it is still on screen afterwards.
 */
export async function expectHeldOpen(
  findModal: () => Promise<HTMLElement>,
  onClose: unknown,
) {
  expect(within(await findModal()).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
  expect(await findModal()).toBeInTheDocument()
}
