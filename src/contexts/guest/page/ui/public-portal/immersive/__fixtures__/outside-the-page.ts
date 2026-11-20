// A copy of the page drawn outside its root, for stories that prove the page's
// stylesheets reach nothing else in the app.

/** The index just past the parentheses that open at `from`, or `from` when none do. */
function afterParentheses(selector: string, from: number): number {
  if (selector[from] !== '(') return from
  let depth = 0
  let index = from
  do {
    if (selector[index] === '(') depth += 1
    if (selector[index] === ')') depth -= 1
    index += 1
  } while (depth > 0 && index < selector.length)
  return index
}

/** The selector without its pseudo-classes and pseudo-elements, which need a state this copy is not in. */
function withoutStates(selector: string): string {
  const pseudo = /:+[a-z-]*/iuy
  let kept = ''
  let index = 0
  while (index < selector.length) {
    pseudo.lastIndex = index
    const match = pseudo.exec(selector)
    if (!match) {
      kept += selector[index]
      index += 1
      continue
    }
    index = afterParentheses(selector, index + match[0].length)
  }
  return kept.trim()
}

/** The selectors of a list, split at the commas outside any parentheses (`:is(a, button)` is one). */
function selectorsOf(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1
    if (list[index] === ')') depth -= 1
    if (list[index] === ',' && depth === 0) {
      parts.push(list.slice(from, index))
      from = index + 1
    }
  }
  return [...parts, list.slice(from)].map((part) => part.trim())
}

/** What the app draws that the page may not: a rule on any of these tags is a leak even if this page has none of it. */
const APP_TAGS = [
  'a',
  'button',
  'nav',
  'ul',
  'ol',
  'li',
  'img',
  'svg',
  'p',
  'span',
  'div',
  'h1',
  'h2',
  'h3',
  'section',
  'header',
  'footer',
  'main',
  'label',
  'input',
  'textarea',
  'select',
  'details',
  'summary',
  'dialog',
  'form',
  'table',
  'strong',
  'em',
] as const

type Options = Readonly<{
  /**
   * Keep the page's own class names on the copy. Without them the copy is what
   * the app draws: markup that no page rule may style, whatever tag it is.
   * With them it proves a stylesheet that promises to sit under the page root
   * styles nothing once that root is gone.
   */
  keepClasses?: boolean
  /** Look only at the stylesheet that carries this text. */
  sheetHolding?: string
}>

/** Rules of the stylesheets that belong to the page, whatever they are nested in. */
function pageRules(sheetHolding: string): CSSStyleRule[] {
  const found: CSSStyleRule[] = []
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) found.push(rule)
      else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    // The page hoists its own stylesheets, each marked with its `href`; the app's are not.
    const owner = sheet.ownerNode
    if (!(owner instanceof Element) || !owner.hasAttribute('data-href')) continue
    const text = owner.textContent ?? ''
    if (text.includes('.ih-root') && text.includes(sheetHolding)) visit(sheet.cssRules)
  }
  return found
}

/**
 * Every selector the page's stylesheets declare, matched against a copy of the
 * page drawn outside its root. Returns the selectors that still match, which
 * are the rules that would reach the app. Returns `null` when there is nothing
 * to check, so a story cannot pass with no stylesheet to look at.
 */
export function selectorsReachingOutside(
  canvasElement: HTMLElement,
  { keepClasses = false, sheetHolding = '' }: Options = {},
): string[] | null {
  const root = canvasElement.querySelector<HTMLElement>('.ih-root')
  const rules = pageRules(sheetHolding)
  if (!root || rules.length < 5) return null
  const copy = root.cloneNode(true) as HTMLElement
  const everyElement = [copy, ...copy.querySelectorAll('*')]
  for (const element of everyElement) {
    const kept = keepClasses
      ? Array.from(element.classList).filter((name) => name !== 'ih-root')
      : []
    element.removeAttribute('class')
    element.classList.add(...kept)
  }
  copy.removeAttribute('data-ih-surface')
  for (const tag of APP_TAGS) copy.appendChild(document.createElement(tag))
  document.body.appendChild(copy)
  try {
    const reaching: string[] = []
    for (const rule of rules) {
      for (const selector of selectorsOf(rule.selectorText)) {
        const stateless = withoutStates(selector)
        if (stateless === '' || stateless.endsWith('>')) continue
        try {
          if (copy.matches(stateless) || copy.querySelector(stateless) !== null)
            reaching.push(selector)
        } catch {
          // A selector this browser cannot parse cannot match anything either.
        }
      }
    }
    return reaching
  } finally {
    copy.remove()
  }
}
