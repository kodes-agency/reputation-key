// Choosing an image by keyboard goes through the native file input: it is the
// field's one tab stop, and the drop surfaces are mouse and drag conveniences
// (a role="button" surface would nest the Remove button inside an interactive
// element, and add a second stop for the same action). The input is visually
// hidden, so its focus has to show on the surface; with nothing to show it, a
// sighted keyboard user saw focus vanish (WCAG 2.4.7).
//
// The ring itself is browser behaviour (Storybook); this pins the structure it
// rests on. The input comes first, as the `peer`, and the surface after it
// carries the focus-visible ring. Being first and outside the surfaces also
// keeps it mounted, and focused, when an upload swaps the empty circle for the
// preview.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageUploadField } from './image-upload-field'

const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function render(variant: 'rect' | 'circle', state: 'empty' | 'preview'): string {
  return renderToStaticMarkup(
    createElement(ImageUploadField, {
      imageUrl: state === 'preview' ? IMAGE : null,
      onImageUrlChange: () => undefined,
      onUpload: async () => null,
      variant,
    }),
  )
}

/** The class list of the element that directly follows the file input. */
function surfaceAfterFileInput(markup: string): string {
  const input = /<input[^>]*type="file"[^>]*\/?>/u.exec(markup)
  if (!input) throw new Error('no file input')
  const next = /^<div[^>]*class="([^"]*)"/u.exec(
    markup.slice(input.index + input[0].length),
  )
  if (!next) throw new Error('the file input is not followed by its surface')
  return next[1]!
}

describe('ImageUploadField keyboard focus', () => {
  it.each([
    ['rect', 'empty'],
    ['rect', 'preview'],
    ['circle', 'empty'],
    ['circle', 'preview'],
  ] as const)('shows the file input focus on the %s %s surface', (variant, state) => {
    const markup = render(variant, state)

    expect(markup).toMatch(/<input[^>]*class="peer sr-only"/u)
    expect(surfaceAfterFileInput(markup)).toContain('peer-focus-visible:ring-[3px]')
  })
})
