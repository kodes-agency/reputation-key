// DIAG (temporary, diag branch only): a breadcrumb trail in localStorage, which
// the orchestrator page shares with every test iframe, so the watchdog can read
// where a stalled story stopped even if its iframe no longer answers.
const DIAG_KEY = '__diag'

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return String(target)
  const id = target.id ? `#${target.id}` : ''
  const label =
    target.getAttribute('aria-label') ?? target.textContent?.trim().slice(0, 24) ?? ''
  return `${target.tagName.toLowerCase()}${id}[${label}]`
}

export function diag(message: string): void {
  try {
    const entries = JSON.parse(localStorage.getItem(DIAG_KEY) ?? '[]') as string[]
    const frame =
      new URLSearchParams(location.search).get('iframeId')?.split('/').pop() ??
      location.pathname
    entries.push(
      `${Math.round(performance.timeOrigin + performance.now())} ${frame} ${message}`,
    )
    localStorage.setItem(DIAG_KEY, JSON.stringify(entries.slice(-400)))
  } catch {
    // diagnostics only
  }
}

for (const type of [
  'pagehide',
  'beforeunload',
  'unload',
  'visibilitychange',
  'freeze',
  'resume',
]) {
  window.addEventListener(
    type,
    () => diag(`window ${type} visibility=${document.visibilityState}`),
    true,
  )
}
for (const type of ['keydown', 'click', 'focusin', 'focusout', 'submit', 'pointerdown']) {
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
diag(`module loaded ${location.href}`)
