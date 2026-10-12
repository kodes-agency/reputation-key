// A small tag walker for markup assertions. The unit project has no DOM, so
// the markup a component renders is split by tag depth rather than queried.

import { expect } from 'vitest'

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])
const TAG_NAME = /^[a-zA-Z][\w-]*/

type Tag = Readonly<{ start: number; end: number; closing: boolean; name: string }>

/** The end (exclusive) of the tag that opens at `start`: the first `>` outside a quoted value. */
function tagEnd(html: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html.charAt(i)
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return i + 1
  }
  return -1
}

/** The next tag at or after `from`, or null. Text between tags is skipped. */
function nextTag(html: string, from: number): Tag | null {
  for (let at = html.indexOf('<', from); at !== -1; at = html.indexOf('<', at + 1)) {
    const closing = html.charAt(at + 1) === '/'
    const name = TAG_NAME.exec(html.slice(at + (closing ? 2 : 1), at + 40))?.[0]
    const end = tagEnd(html, at)
    if (name && end !== -1) return { start: at, end, closing, name }
  }
  return null
}

/** Direct-child markup of the first element whose opening tag contains `marker`. */
export function directChildren(html: string, marker: string): string[] {
  const opening = html.indexOf(marker)
  expect(opening, `${marker} is present`).toBeGreaterThan(-1)
  const children: string[] = []
  let depth = 0
  let childStart = -1
  for (
    let tag = nextTag(html, html.lastIndexOf('<', opening));
    tag;
    tag = nextTag(html, tag.end)
  ) {
    const whole = html.slice(tag.start, tag.end)
    const selfContained = VOID_TAGS.has(tag.name.toLowerCase()) || whole.endsWith('/>')
    if (tag.closing) depth -= 1
    else if (!selfContained) depth += 1
    if (!tag.closing && depth === 2 && childStart === -1) childStart = tag.start
    if (childStart !== -1 && depth === 1) {
      children.push(html.slice(childStart, tag.end))
      childStart = -1
    }
    if (tag.closing && depth === 0) return children
    if (selfContained && !tag.closing && depth === 1 && childStart === -1) {
      children.push(whole)
    }
  }
  throw new Error(`${marker} is not closed`)
}

export const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The markup without its <style> elements, so assertions read only the content. A
 * cut-and-search loop rather than a one-pass regex replace: removing one match
 * cannot join two halves into a new `<style`.
 */
export function withoutStyleElements(html: string): string {
  const parts: string[] = []
  let rest = html
  for (let start = rest.indexOf('<style'); start !== -1; start = rest.indexOf('<style')) {
    parts.push(rest.slice(0, start))
    const close = rest.indexOf('</style>', start)
    if (close === -1) return parts.join('')
    rest = rest.slice(close + '</style>'.length)
  }
  parts.push(rest)
  return parts.join('')
}
