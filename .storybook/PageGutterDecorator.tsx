// Storybook decorator that gives a page story the gutter `<main>` gives a page in
// the app. A page, and any fallback a route renders, pads nothing of its own
// (see `PAGE_GUTTER` in components/layout/page-shell), so a story that mounts
// one with `layout: 'fullscreen'` and no `<main>` above it draws the page flush
// against the edges of a phone. Wearing the same tokens as `<main>` keeps the
// story's geometry the app's: use it on a story of a page, not of a full-bleed
// surface (which pads nothing, on purpose).
import type { ReactNode } from 'react'
import { PAGE_GUTTER } from '#/components/layout/page-shell'

export function PageGutterDecorator(Story: () => ReactNode) {
  return (
    <div className={PAGE_GUTTER}>
      <Story />
    </div>
  )
}
