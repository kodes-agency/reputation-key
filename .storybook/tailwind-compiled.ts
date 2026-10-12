// Whether Tailwind is compiled where a story runs: Storybook proper is, the Vitest
// story runner is not. A story that needs a layout the classes carry (a scrolling
// strip) stands in for it only where it is missing: where it is present the classes
// are what has to be measured, and a scaffold beside them would decide instead.
export function tailwindIsCompiled(): boolean {
  const probe = document.createElement('div')
  probe.className = 'hidden'
  document.body.append(probe)
  const compiled = getComputedStyle(probe).display === 'none'
  probe.remove()
  return compiled
}
