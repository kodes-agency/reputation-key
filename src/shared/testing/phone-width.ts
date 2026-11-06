// Phone-width checks for a rendered state, in a browser: nothing sticks out past
// the right edge of the window, and every control is at least 44 px on its smaller
// side. Call it from a story's play or a browser test once the state is drawn.
//
// A scroller (`overflow-x` other than visible) owns what spills out of it, so
// what it holds is not overflow; its own box still has to fit. The WCAG inline
// exception applies: a link set inside a sentence (`display: inline`) has the
// line for its box.

/** The widths a state is checked at: the narrowest supported, and a common one. */
export const PHONE_WIDTHS = [320, 390] as const

/** The smaller side of a target. */
export const MIN_TARGET_PX = 44

export type PhoneWidthMeasurement = Readonly<{
  width: (typeof PHONE_WIDTHS)[number]
  overflow: readonly string[]
  targets: readonly string[]
}>

/** Wider than any phone: past it a window is not a phone's. */
const PHONE_MAX_PX = 480
const PHONE_HEIGHT_PX = 900
/** Layout rounding only; a target 43 px wide is a finding. */
const SLACK_PX = 0.5

const WIDGET_ROLES = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'combobox',
  'textbox',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'treeitem',
]

// A focusable element with no widget role (a scroll region, a tab panel) is a
// focus stop, not a target.
const CONTROLS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  ...WIDGET_ROLES.map((role) => `[role="${role}"]`),
].join(',')

type SetViewport = (width: number, height: number) => Promise<void>

// The runner owns the browser's viewport. A story cannot import `vitest/browser`
// (the Storybook UI has no such module), so the runner hands the setter over on a
// key from the global registry.
const VIEWPORT_SETTER: unique symbol = Symbol.for('repkey.phone-width.set-viewport')
const registry = globalThis as typeof globalThis & { [VIEWPORT_SETTER]?: SetViewport }

/** Called by the story runner's setup: lets `checkPhoneWidths` resize the window. */
export function provideViewportSetter(setViewport: SetViewport): void {
  registry[VIEWPORT_SETTER] = setViewport
}

function isShown(element: Element): boolean {
  return (
    element.closest('[hidden], [inert], [aria-hidden="true"]') === null &&
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    element.getClientRects().length > 0
  )
}

function nameOf(element: Element): string {
  const label =
    'labels' in element ? (element as HTMLInputElement).labels?.[0] : undefined
  const text =
    element.getAttribute('aria-label') || label?.textContent || element.textContent
  return text?.trim().replace(/\s+/g, ' ').slice(0, 60) || element.tagName.toLowerCase()
}

/** True when an ancestor below the page is a scroller or a clipper. */
function isHeldByAncestor(element: Element, view: Window): boolean {
  const { body, documentElement } = element.ownerDocument
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === body || parent === documentElement) return false
    if (view.getComputedStyle(parent).overflowX !== 'visible') return true
  }
  return false
}

function overflowFindings(doc: Document, view: Window): string[] {
  const findings: string[] = []
  const { scrollWidth } = doc.documentElement
  if (scrollWidth > view.innerWidth) {
    findings.push(
      `the page scrolls sideways: ${scrollWidth} px wide in ${view.innerWidth} px`,
    )
  }
  for (const element of doc.body.querySelectorAll('*')) {
    const { right } = element.getBoundingClientRect()
    if (right <= view.innerWidth + SLACK_PX || !isShown(element)) continue
    if (isHeldByAncestor(element, view)) continue
    findings.push(
      `${nameOf(element)} extends past the right edge: ${Math.round(right)} px in ${view.innerWidth} px`,
    )
  }
  return findings
}

/** What a finger can press for this control: its box, its label's, or a pad drawn around it. */
function targetBoxes(
  control: Element,
  view: Window,
): { width: number; height: number }[] {
  const labels =
    'labels' in control ? Array.from((control as HTMLInputElement).labels ?? []) : []
  return [control, ...labels].filter(isShown).flatMap((target) => {
    const { width, height } = target.getBoundingClientRect()
    const pads = ['::before', '::after'].flatMap((pseudo) => {
      const style = view.getComputedStyle(target, pseudo)
      const drawn = style.content !== 'none' && style.content !== 'normal'
      return drawn && style.position === 'absolute' && style.pointerEvents !== 'none'
        ? [
            {
              width: Number.parseFloat(style.width),
              height: Number.parseFloat(style.height),
            },
          ]
        : []
    })
    return [{ width, height }, ...pads]
  })
}

function targetFindings(doc: Document, view: Window): string[] {
  const findings: string[] = []
  for (const control of doc.querySelectorAll(CONTROLS)) {
    if (view.getComputedStyle(control).display === 'inline') continue
    const boxes = targetBoxes(control, view)
    if (boxes.length === 0) continue
    if (
      boxes.some(({ width, height }) => Math.min(width, height) >= MIN_TARGET_PX - 0.01)
    )
      continue
    const sizes = boxes.map(
      ({ width, height }) => `${Math.round(width)}x${Math.round(height)}`,
    )
    findings.push(
      `${nameOf(control)} is ${sizes.join(', ')}; a target is at least ${MIN_TARGET_PX} px`,
    )
  }
  return findings
}

/** Everything wrong with the document at the window's current width; empty when it fits. */
export function phoneWidthFindings(doc: Document = document): string[] {
  const view = doc.defaultView
  if (!view) throw new Error('Expected a browser document')
  return [...overflowFindings(doc, view), ...targetFindings(doc, view)]
}

/** Throws with every finding when the document, at the window's current width, does not fit a phone. */
export function assertPhoneWidth(doc: Document = document): void {
  const view = doc.defaultView
  if (!view || view.innerWidth > PHONE_MAX_PX) {
    throw new Error(`Expected a phone-width window of at most ${PHONE_MAX_PX} px`)
  }
  const findings = phoneWidthFindings(doc)
  if (findings.length > 0) {
    throw new Error(
      findings.map((finding) => `${view.innerWidth} px: ${finding}`).join('\n'),
    )
  }
}

async function settled(view: Window): Promise<void> {
  await view.document.fonts.ready
  await new Promise<void>((resolve) =>
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())),
  )
}

/**
 * Checks the state drawn now at every phone width, then puts the window back.
 * Without a runner to resize the window (the Storybook UI), it checks the width
 * the window has.
 */
export async function checkPhoneWidths(doc: Document = document): Promise<void> {
  const view = doc.defaultView
  if (!view) throw new Error('Expected a browser document')
  if (!registry[VIEWPORT_SETTER]) return assertPhoneWidth(doc)
  const measurements = await measurePhoneWidths(doc)
  const failures = measurements.flatMap(({ width, overflow, targets }) =>
    [...overflow, ...targets].map((finding) => `${width} px: ${finding}`),
  )
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

/** Records each check separately for a runner's story-state baseline. */
export async function measurePhoneWidths(
  doc: Document = document,
): Promise<PhoneWidthMeasurement[]> {
  const view = doc.defaultView
  if (!view) throw new Error('Expected a browser document')
  const setViewport = registry[VIEWPORT_SETTER]
  if (!setViewport) throw new Error('Phone-width measurements require a viewport setter')
  const original = { width: view.innerWidth, height: view.innerHeight }
  const measurements: PhoneWidthMeasurement[] = []
  try {
    for (const width of PHONE_WIDTHS) {
      await setViewport(width, PHONE_HEIGHT_PX)
      await settled(view)
      measurements.push({
        width,
        overflow: overflowFindings(doc, view),
        targets: targetFindings(doc, view),
      })
    }
  } finally {
    await setViewport(original.width, original.height)
  }
  return measurements
}
