// Renders the response view to markup and reads it back, for the section's
// tests. Nothing here asserts; the tests do.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GuestPagePreviewState } from '../../guest-page-preview-state'
import { directChildren, text } from '../../__fixtures__/markup-walk'
import { immersiveResponseProps } from '../immersive-response-preview'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from '../immersive-response-view'
import { DISPLAY_NAME, type PACKS } from './immersive-response-fixtures'

export const body = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')
export const responseChildren = (html: string) => directChildren(html, 'data-ih-response')

type PackOf = (typeof PACKS)[number]

export function render(
  pack: PackOf,
  state: GuestPagePreviewState,
  options: Readonly<{
    open?: boolean
    overrides?: Partial<ImmersiveResponseViewProps>
  }> = {},
): string {
  const base = immersiveResponseProps(state, { pack, displayName: DISPLAY_NAME })
  const yourResponse = base.yourResponse && {
    ...base.yourResponse,
    initialOpen: options.open ?? false,
  }
  return body(
    renderToStaticMarkup(
      createElement(ImmersiveResponseView, {
        ...base,
        yourResponse,
        ...options.overrides,
      }),
    ),
  )
}

/** The section: the last card of the response area. */
export const sectionOf = (html: string) => responseChildren(html).at(-1) ?? ''
export const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu)].map((match) => match[0])

/** The text of the element with this id, or '' when there is none. */
function textOfId(html: string, id: string): string {
  const at = html.indexOf(` id="${id}"`)
  if (at === -1) return ''
  const start = html.lastIndexOf('<', at)
  const name = /^<([a-z0-9]+)/u.exec(html.slice(start))?.[1]
  const contentStart = html.indexOf('>', at) + 1
  const contentEnd = html.indexOf(`</${name ?? ''}>`, contentStart)
  return text(html.slice(contentStart, contentEnd))
}

/** A button's accessible name: aria-labelledby, else aria-label, else its own text. */
export function accessibleName(html: string, button: string): string {
  const labelledBy = /aria-labelledby="([^"]*)"/u.exec(button)?.[1]
  if (labelledBy !== undefined) {
    return labelledBy
      .split(' ')
      .map((id) => (id === buttonId(button) ? text(button) : textOfId(html, id)))
      .join(' ')
  }
  return /aria-label="([^"]*)"/u.exec(button)?.[1] ?? text(button)
}

const buttonId = (button: string) => /\sid="([^"]*)"/u.exec(button)?.[1]
