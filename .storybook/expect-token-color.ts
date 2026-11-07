import { expect, userEvent, waitFor } from 'storybook/test'

/** Compare the painted colour with the browser's resolution of the theme token. */
export async function expectTokenColor(
  element: Element,
  token: string,
  property: 'color' | 'backgroundColor' = 'color',
  opacity = 1,
) {
  // A modal sets pointer-events: none on the page, which must not refuse moving the pointer away.
  await userEvent.setup({ pointerEventsCheck: 0 }).unhover(element)
  const probe = element.ownerDocument.createElement('span')
  probe.style[property] =
    opacity === 1
      ? `var(${token})`
      : `color-mix(in oklab, var(${token}) ${opacity * 100}%, transparent)`
  element.ownerDocument.body.append(probe)
  try {
    await waitFor(() =>
      expect(getComputedStyle(element)[property]).toBe(getComputedStyle(probe)[property]),
    )
  } finally {
    probe.remove()
  }
}
