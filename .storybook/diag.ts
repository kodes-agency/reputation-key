// DIAG (temporary, diag branch only): breadcrumbs for the stalled story. Each one
// goes to console.debug with a [DIAG] prefix, which the watchdog reporter hears
// live over the DevTools protocol (Runtime.consoleAPICalled), so the trail
// survives a renderer whose main thread later wedges.
let enabled = false

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return String(target)
  const id = target.id ? `#${target.id}` : ''
  const label =
    target.getAttribute('aria-label') ?? target.textContent?.trim().slice(0, 24) ?? ''
  return `${target.tagName.toLowerCase()}${id}[${label}]`
}

export function diag(message: string): void {
  if (!enabled) return
  console.debug(`[DIAG] ${Math.round(performance.now())} ${message}`)
}

export function diagFor(on: boolean): void {
  enabled = on
}

const EVENTS = [
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'click',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'focusin',
  'focusout',
  'submit',
  'toggle',
  'transitionstart',
  'transitionend',
  'animationstart',
  'animationend',
  'scroll',
  'selectionchange',
]
for (const type of EVENTS) {
  document.addEventListener(
    type,
    (event) => {
      const key = event instanceof KeyboardEvent ? ` key=${event.key}` : ''
      diag(
        `${type}${key} on ${describe(event.target)} active=${describe(document.activeElement)}`,
      )
    },
    true,
  )
}
for (const type of ['pagehide', 'beforeunload', 'unload', 'visibilitychange', 'freeze']) {
  window.addEventListener(type, () => diag(`window ${type}`), true)
}
new MutationObserver((records) => {
  const changed = records
    .map((r) =>
      r.type === 'attributes'
        ? `${describe(r.target)}@${r.attributeName}`
        : `${r.type}:${describe(r.target)}`,
    )
    .slice(0, 6)
  diag(`mutations ${records.length}: ${changed.join(' | ')}`)
}).observe(document, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
})
