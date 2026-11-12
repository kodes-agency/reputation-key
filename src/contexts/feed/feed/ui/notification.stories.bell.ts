// Story-only helpers for opening the bell; the `.stories.` segment keeps this
// module out of production-shaped source inventories and bundles.
//
// The popover body is lazy (notification-panel.tsx). The popover itself opens
// at once with a loading stand-in, and in the story runner the body's first
// load compiles its whole module tree in the dev server, which can outlast the
// default one-second `findBy` wait on a busy machine. A story waits for the
// body, not only the popover, before it looks inside.

import { userEvent, within } from 'storybook/test'

/** Long enough for a cold dev server to compile the lazy popover body once. */
const LAZY_BODY_TIMEOUT_MS = 10_000

/** The open bell popover, once its lazily loaded body has rendered. */
export async function findOpenBellPopover() {
  const dialog = await within(document.body).findByRole(
    'dialog',
    {},
    { timeout: LAZY_BODY_TIMEOUT_MS },
  )
  await within(dialog).findByRole(
    'heading',
    { name: 'Notifications' },
    { timeout: LAZY_BODY_TIMEOUT_MS },
  )
  return within(dialog)
}

/** Clicks the bell in the story canvas and returns its open popover. */
export async function openBell(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
  return findOpenBellPopover()
}
